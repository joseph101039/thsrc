#!/usr/bin/env python3
"""
predict_captcha.py — 台灣高鐵驗證碼辨識推論腳本
================================================
功能：
  1. 載入 captcha_model.h5（或 .keras）訓練好的模型
  2. 接受單張圖片路徑 → 輸出預測的驗證碼文字
  3. 支援 base64 輸入（方便整合至 Web 服務）
  4. 支援批次辨識多張圖片
  5. 可選啟動輕量 HTTP 服務（供 GAS 後端呼叫）

執行方式：
  python predict_captcha.py captcha_images/captcha_001.jpg
  python predict_captcha.py --batch captcha_images/
  python predict_captcha.py --base64 "<base64 字串>"
  python predict_captcha.py --server               ← 啟動 Flask HTTP 服務

依賴：
  pip install tensorflow opencv-python numpy
  pip install flask          ← 僅 --server 模式需要
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ─── 全域設定（與 train_captcha.py 保持一致） ─────────────────────────────────

CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)
CHAR2IDX: dict[str, int] = {c: i for i, c in enumerate(CHARS)}
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}

CAPTCHA_LENGTH: int = 4       # 高鐵驗證碼通常為 4 字元（可改為 5）
CHAR_W: int = 30              # 單字元輸入寬度（與訓練時一致）
CHAR_H: int = 40              # 單字元輸入高度（與訓練時一致）

BASE_DIR = Path(__file__).parent
DEFAULT_MODEL_PATH = BASE_DIR / "captcha_model.h5"

# ─── 1. 圖片前處理（與訓練腳本相同邏輯，避免 train/test skew） ───────────────

def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    """BGR 圖片 → 去雜訊二值化影像（字元白 / 背景黑）。"""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    denoised = cv2.medianBlur(gray, 3)
    _, binary = cv2.threshold(
        denoised, 0, 255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    return cleaned


# ─── 2. 字元切割（與訓練腳本相同邏輯） ───────────────────────────────────────

def _merge_close_components(
    stats: list[tuple[int, int, int, int]],
    target_count: int,
) -> list[tuple[int, int, int, int]]:
    """合併相鄰過近的連通分量（處理字元斷裂）。"""
    stats = list(stats)
    while len(stats) > target_count:
        gaps = []
        for i in range(len(stats) - 1):
            x_i, _, w_i, _ = stats[i]
            x_next = stats[i + 1][0]
            gaps.append((x_next - (x_i + w_i), i))
        gaps.sort()
        idx = gaps[0][1]
        x0, y0, w0, h0 = stats[idx]
        x1, y1, w1, h1 = stats[idx + 1]
        stats[idx] = (
            min(x0, x1), min(y0, y1),
            max(x0 + w0, x1 + w1) - min(x0, x1),
            max(y0 + h0, y1 + h1) - min(y0, y1),
        )
        del stats[idx + 1]
    return stats


def split_chars(
    binary: np.ndarray,
    num_chars: int,
) -> list[np.ndarray]:
    """
    將二值化圖片切割為 num_chars 個字元圖片。
    優先使用連通分量分析；失敗時 fallback 固定寬度等分。
    回傳：list of float32 arrays，每個 shape = (CHAR_H, CHAR_W)，值域 [0,1]
    """
    h_img, w_img = binary.shape
    min_area = h_img * w_img * 0.003

    # ── 連通分量分析 ──────────────────────────────────────────────────────────
    num_labels, _, stats_cv, _ = cv2.connectedComponentsWithStats(
        binary, connectivity=8
    )
    char_stats: list[tuple[int, int, int, int]] = []
    for lbl in range(1, num_labels):
        x, y, w, h, area = stats_cv[lbl]
        if area >= min_area:
            char_stats.append((x, y, w, h))
    char_stats.sort(key=lambda s: s[0])

    if len(char_stats) > num_chars:
        char_stats = _merge_close_components(char_stats, num_chars)

    # 數量不符 → fallback 固定等分
    if len(char_stats) != num_chars:
        char_w = w_img // num_chars
        char_stats = [
            (i * char_w, 0,
             char_w if i < num_chars - 1 else w_img - i * char_w, h_img)
            for i in range(num_chars)
        ]

    # 裁切並 resize
    char_imgs: list[np.ndarray] = []
    pad = 2
    for (x, y, w, h) in char_stats:
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(w_img, x + w + pad)
        y2 = min(h_img, y + h + pad)
        roi = binary[y1:y2, x1:x2]
        resized = cv2.resize(roi, (CHAR_W, CHAR_H), interpolation=cv2.INTER_AREA)
        char_imgs.append(resized.astype("float32") / 255.0)

    return char_imgs


# ─── 3. 推論核心 ──────────────────────────────────────────────────────────────

class CaptchaSolver:
    """
    驗證碼辨識器。
    載入訓練好的模型，對外提供 solve() / solve_bytes() / solve_b64() 介面。
    """

    def __init__(self, model_path: Path, captcha_length: int = CAPTCHA_LENGTH) -> None:
        """
        參數：
          model_path     — .h5 或 .keras 模型路徑
          captcha_length — 預期驗證碼字元數（預設 4）
        """
        if not model_path.exists():
            raise FileNotFoundError(
                f"找不到模型檔案：{model_path}\n"
                "請先執行 train_captcha.py 訓練模型"
            )

        # 延遲匯入 TensorFlow，縮短一般 CLI 使用的啟動時間
        try:
            import tensorflow as tf
            from tensorflow import keras
        except ImportError:
            print("[錯誤] 找不到 TensorFlow，請執行：pip install tensorflow",
                  file=sys.stderr)
            sys.exit(1)

        print(f"[載入模型] {model_path} ...")
        self.model = keras.models.load_model(str(model_path))
        self.captcha_length = captcha_length
        print(f"[模型就緒] 輸入 shape：{self.model.input_shape}，類別數：{NUM_CLASSES}")

    def solve(self, img_bgr: np.ndarray) -> tuple[str, list[float]]:
        """
        辨識一張驗證碼圖片。

        參數：
          img_bgr — OpenCV 讀取的 BGR 圖片陣列

        回傳：
          (預測字串, 各字元最高信心值列表)
          例如：('H7KR', [0.99, 0.87, 0.95, 0.92])
        """
        binary = preprocess_image(img_bgr)
        char_imgs = split_chars(binary, self.captcha_length)

        predicted_chars: list[str] = []
        confidences: list[float] = []

        for char_img in char_imgs:
            # 建立模型輸入：(1, CHAR_H, CHAR_W, 1)
            inp = char_img[np.newaxis, ..., np.newaxis].astype("float32")
            probs = self.model.predict(inp, verbose=0)[0]   # shape: (NUM_CLASSES,)

            idx = int(np.argmax(probs))
            predicted_chars.append(IDX2CHAR[idx])
            confidences.append(float(probs[idx]))

        return "".join(predicted_chars), confidences

    def solve_bytes(self, img_bytes: bytes) -> tuple[str, list[float]]:
        """從圖片 bytes 辨識（方便 HTTP 服務使用）。"""
        nparr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("無法解碼圖片 bytes，請確認格式是否正確")
        return self.solve(img)

    def solve_b64(self, b64_str: str) -> tuple[str, list[float]]:
        """從 base64 字串辨識（方便 JavaScript 前端傳遞圖片）。"""
        # 去除 data URL 前綴（如 "data:image/jpeg;base64,"）
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        img_bytes = base64.b64decode(b64_str)
        return self.solve_bytes(img_bytes)

    def solve_file(self, img_path: Path) -> tuple[str, list[float]]:
        """從檔案路徑辨識。"""
        img = cv2.imread(str(img_path))
        if img is None:
            raise FileNotFoundError(f"無法讀取圖片：{img_path}")
        return self.solve(img)


# ─── 4. 批次評估 ──────────────────────────────────────────────────────────────

def batch_predict(
    solver: CaptchaSolver,
    img_dir: Path,
    labels_json: Optional[Path] = None,
) -> None:
    """
    批次辨識資料夾內所有圖片，並可選與 labels.json 比對計算準確率。
    """
    img_files = sorted(img_dir.glob("*.jpg")) + sorted(img_dir.glob("*.png"))
    if not img_files:
        print(f"[錯誤] 在 {img_dir} 找不到任何圖片", file=sys.stderr)
        return

    # 若有 labels.json，載入作為 ground truth
    labels: dict[str, str] = {}
    if labels_json and labels_json.exists():
        with open(labels_json, encoding="utf-8") as f:
            labels = json.load(f)
        print(f"[批次] 載入 {len(labels)} 筆標注，將計算準確率")

    correct_char = 0
    total_char = 0
    correct_full = 0
    total_full = 0

    results: list[dict] = []

    for img_path in img_files:
        try:
            pred, confs = solver.solve_file(img_path)
        except Exception as e:
            print(f"  [失敗] {img_path.name}：{e}")
            continue

        stem = img_path.stem
        true_label = labels.get(stem, "").upper()
        avg_conf = sum(confs) / len(confs) if confs else 0.0

        result_entry = {
            "file": img_path.name,
            "prediction": pred,
            "confidence": round(avg_conf, 4),
        }

        if true_label:
            result_entry["truth"] = true_label
            result_entry["correct"] = pred == true_label
            # 字元準確率
            for p, t in zip(pred, true_label):
                if p == t:
                    correct_char += 1
                total_char += 1
            # 全字串準確率
            if pred == true_label:
                correct_full += 1
            total_full += 1

        results.append(result_entry)

        # 顯示結果
        match_str = ""
        if true_label:
            match_str = "  ✓" if pred == true_label else f"  ✗ (真實：{true_label})"
        conf_str = " ".join(f"{c:.2f}" for c in confs)
        print(f"  {img_path.name}  →  {pred}  [{conf_str}]{match_str}")

    # ── 總結 ──────────────────────────────────────────────────────────────────
    print("\n" + "=" * 50)
    print(f"批次辨識完成：共 {len(results)} 張")
    if total_full > 0:
        char_acc = correct_char / max(total_char, 1) * 100
        full_acc = correct_full / total_full * 100
        print(f"  字元準確率：{char_acc:.2f}%  ({correct_char}/{total_char})")
        print(f"  全字串準確率：{full_acc:.2f}%  ({correct_full}/{total_full})")
    print("=" * 50)


# ─── 5. Flask HTTP 微服務（選用） ─────────────────────────────────────────────

def start_server(
    solver: CaptchaSolver,
    host: str = "0.0.0.0",
    port: int = 5001,
) -> None:
    """
    啟動 Flask HTTP 服務，供外部程式（如 GAS relay / Node.js）呼叫。

    API 端點：
      POST /solve
      Content-Type: application/json
      Body: { "image": "<base64 字串>" }
      Response: { "answer": "ABCD", "confidence": [0.99, 0.87, ...] }
               或 { "error": "錯誤訊息" }
    """
    try:
        from flask import Flask, request, jsonify  # type: ignore
    except ImportError:
        print("[錯誤] Flask 未安裝，請執行：pip install flask", file=sys.stderr)
        sys.exit(1)

    app = Flask(__name__)

    @app.route("/health", methods=["GET"])
    def health():
        """健康檢查端點。"""
        return jsonify({"status": "ok", "model": str(DEFAULT_MODEL_PATH)})

    @app.route("/solve", methods=["POST"])
    def solve_endpoint():
        """
        接受 base64 圖片，回傳預測結果。
        請求範例（JavaScript）：
          fetch('http://localhost:5001/solve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64ImageString })
          })
        """
        try:
            data = request.get_json(force=True)
            if not data or "image" not in data:
                return jsonify({"error": "請提供 'image' 欄位（base64 字串）"}), 400

            answer, confidences = solver.solve_b64(data["image"])
            return jsonify({
                "answer": answer,
                "confidence": [round(c, 4) for c in confidences],
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/solve_url", methods=["POST"])
    def solve_url_endpoint():
        """
        接受圖片 URL（需能公開存取），下載後辨識。
        適用於 GAS 傳入高鐵驗證碼 URL 的場景。
        """
        try:
            import urllib.request
            data = request.get_json(force=True)
            if not data or "url" not in data:
                return jsonify({"error": "請提供 'url' 欄位"}), 400

            with urllib.request.urlopen(data["url"], timeout=10) as resp:
                img_bytes = resp.read()

            answer, confidences = solver.solve_bytes(img_bytes)
            return jsonify({
                "answer": answer,
                "confidence": [round(c, 4) for c in confidences],
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    print(f"\n[HTTP 服務] 啟動於 http://{host}:{port}")
    print(f"  POST /solve      — 接受 base64 圖片")
    print(f"  POST /solve_url  — 接受圖片 URL")
    print(f"  GET  /health     — 健康檢查")
    print("按 Ctrl+C 停止服務\n")
    app.run(host=host, port=port, debug=False, threaded=True)


# ─── 6. CLI 介面 ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="台灣高鐵驗證碼辨識推論腳本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用範例：
  # 辨識單張圖片
  python predict_captcha.py captcha_images/captcha_001.jpg

  # 指定模型路徑
  python predict_captcha.py --model captcha_model.keras captcha_001.jpg

  # 批次辨識整個資料夾
  python predict_captcha.py --batch captcha_images/

  # 批次辨識並與 labels.json 對比準確率
  python predict_captcha.py --batch captcha_images/ --labels labels.json

  # 從 base64 字串辨識
  python predict_captcha.py --base64 "/9j/4AAQSkZJRg..."

  # 啟動 HTTP 服務（供外部呼叫）
  python predict_captcha.py --server --port 5001
        """,
    )

    # 輸入來源（互斥）
    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument("image_path", nargs="?", default=None,
                             help="單張圖片路徑（.jpg 或 .png）")
    input_group.add_argument("--batch", metavar="DIR",
                             help="批次辨識指定資料夾內的所有圖片")
    input_group.add_argument("--base64", metavar="STR",
                             help="從 base64 字串辨識")
    input_group.add_argument("--server", action="store_true",
                             help="啟動 Flask HTTP 服務")

    # 共用選項
    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH),
                        help=f"模型路徑（預設：{DEFAULT_MODEL_PATH}）")
    parser.add_argument("--labels", default=None,
                        help="labels.json 路徑（批次模式可選，用於計算準確率）")
    parser.add_argument("--length", type=int, default=CAPTCHA_LENGTH,
                        help=f"驗證碼字元數（預設：{CAPTCHA_LENGTH}）")
    parser.add_argument("--host", default="0.0.0.0",
                        help="HTTP 服務綁定地址（預設：0.0.0.0）")
    parser.add_argument("--port", type=int, default=5001,
                        help="HTTP 服務埠號（預設：5001）")
    parser.add_argument("--json", action="store_true",
                        help="以 JSON 格式輸出結果（方便程式解析）")

    args = parser.parse_args()

    # ── 初始化辨識器 ──────────────────────────────────────────────────────────
    model_path = Path(args.model)

    # 若 .h5 不存在，嘗試 .keras
    if not model_path.exists() and model_path.suffix == ".h5":
        alt = model_path.with_suffix(".keras")
        if alt.exists():
            model_path = alt
            print(f"[提示] 找不到 .h5，改用：{model_path}")

    try:
        solver = CaptchaSolver(model_path, captcha_length=args.length)
    except FileNotFoundError as e:
        print(f"[錯誤] {e}", file=sys.stderr)
        sys.exit(1)

    # ── 執行模式分派 ──────────────────────────────────────────────────────────

    if args.server:
        # HTTP 服務模式
        start_server(solver, host=args.host, port=args.port)

    elif args.batch:
        # 批次辨識模式
        img_dir = Path(args.batch)
        if not img_dir.is_dir():
            print(f"[錯誤] 不是有效的資料夾：{img_dir}", file=sys.stderr)
            sys.exit(1)
        labels_path = Path(args.labels) if args.labels else None
        batch_predict(solver, img_dir, labels_path)

    elif args.base64:
        # base64 輸入模式
        try:
            pred, confs = solver.solve_b64(args.base64)
        except Exception as e:
            print(f"[錯誤] {e}", file=sys.stderr)
            sys.exit(1)

        if args.json:
            print(json.dumps({"answer": pred, "confidence": confs}, ensure_ascii=False))
        else:
            conf_str = " ".join(f"{c:.2f}" for c in confs)
            print(f"預測結果：{pred}  (各字元信心值：[{conf_str}])")

    elif args.image_path:
        # 單張圖片模式
        img_path = Path(args.image_path)
        if not img_path.exists():
            print(f"[錯誤] 找不到圖片：{img_path}", file=sys.stderr)
            sys.exit(1)

        try:
            pred, confs = solver.solve_file(img_path)
        except Exception as e:
            print(f"[錯誤] {e}", file=sys.stderr)
            sys.exit(1)

        if args.json:
            print(json.dumps({
                "file": str(img_path),
                "answer": pred,
                "confidence": [round(c, 4) for c in confs],
            }, ensure_ascii=False))
        else:
            conf_str = " ".join(f"{c:.2f}" for c in confs)
            print(f"圖片：{img_path.name}")
            print(f"預測：{pred}")
            print(f"信心值：[{conf_str}]  (平均：{sum(confs)/len(confs):.2f})")

    else:
        # 未提供任何輸入 → 顯示說明
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
