#!/usr/bin/env python3
"""
predict_captcha.py — 台灣高鐵驗證碼推論腳本（CRNN + CTC）
=========================================================
搭配 train_captcha.py v5（CRNN + Bidirectional LSTM + CTC）。

功能：
  1. 載入 captcha_model.keras / .h5
  2. 整張圖片輸入（不切字元），CTC 貪婪解碼輸出 4 字元
  3. 支援單張 / 批次 / base64 / Flask HTTP 服務

執行：
  python predict_captcha.py captcha_images/captcha_001.png
  python predict_captcha.py --batch captcha_images/ --labels labels.json
  python predict_captcha.py --base64 "<base64 字串>"
  python predict_captcha.py --server
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

# ─── 與 train_captcha.py 對齊的常數 ───────────────────────────────────────────
CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)            # 34
NUM_CLASSES_CTC: int = NUM_CLASSES + 1   # 35（含 blank）
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}

CAPTCHA_LEN: int = 4
IMG_W: int = 160
IMG_H: int = 50

BASE_DIR = Path(__file__).parent
DEFAULT_MODEL_PATH = BASE_DIR / "captcha_model.keras"


# ─── 前處理（與訓練一致） ─────────────────────────────────────────────────────

def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    """BGR → grayscale → resize(IMG_W, IMG_H) → normalize [0,1]，shape: (H, W, 1)。"""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    return (resized.astype("float32") / 255.0)[..., np.newaxis]


# ─── CTC 貪婪解碼 ────────────────────────────────────────────────────────────

def ctc_greedy_decode_with_conf(
    y_pred: np.ndarray,
    expected_len: int = CAPTCHA_LEN,
) -> tuple[list[list[int]], list[list[float]]]:
    """
    y_pred: (B, T, num_classes_ctc) softmax 機率
    回傳:
      decoded_indices: 每張圖的字元 index 列表（去重 + 去 blank）
      char_confidences: 每個解碼字元在該時間步的最大 softmax 機率
    """
    B, T, _ = y_pred.shape
    # 每個時間步的 argmax 與其機率
    argmax = np.argmax(y_pred, axis=-1)  # (B, T)
    maxprob = np.max(y_pred, axis=-1)    # (B, T)

    decoded: list[list[int]] = []
    confs: list[list[float]] = []
    blank = NUM_CLASSES  # blank index

    for b in range(B):
        seq_idx: list[int] = []
        seq_conf: list[float] = []
        prev = -1
        for t in range(T):
            c = int(argmax[b, t])
            if c != prev and c != blank:
                seq_idx.append(c)
                seq_conf.append(float(maxprob[b, t]))
            prev = c
        decoded.append(seq_idx)
        confs.append(seq_conf)
    return decoded, confs


def indices_to_string(indices: list[int]) -> str:
    return "".join(IDX2CHAR.get(i, "?") for i in indices)


# ─── Solver 類別 ─────────────────────────────────────────────────────────────

class CaptchaSolver:
    """CRNN+CTC 驗證碼辨識器。"""

    def __init__(self, model_path: Path, captcha_length: int = CAPTCHA_LEN) -> None:
        if not model_path.exists():
            raise FileNotFoundError(
                f"找不到模型檔案：{model_path}\n請先執行 train_captcha.py 訓練模型"
            )

        try:
            import tensorflow as tf  # noqa: F401
            from tensorflow import keras
        except ImportError:
            print("[錯誤] 找不到 TensorFlow，請執行：pip install tensorflow",
                  file=sys.stderr)
            sys.exit(1)

        print(f"[載入模型] {model_path} ...")
        # 模型內含 Lambda(squeeze) 與自訂 ctc_batch_loss
        # 推論不需 loss，且 Lambda 反序列化需 safe_mode=False
        keras.config.enable_unsafe_deserialization()
        self.model = keras.models.load_model(str(model_path), compile=False)
        self.captcha_length = captcha_length
        print(f"[模型就緒] 輸入 shape：{self.model.input_shape}，"
              f"輸出 shape：{self.model.output_shape}")

    # ── 核心辨識 ─────────────────────────────────────────────────────────────
    def solve(self, img_bgr: np.ndarray) -> tuple[str, list[float]]:
        """
        辨識一張驗證碼。
        回傳 (預測字串, 各字元信心值列表)。
        """
        x = preprocess_image(img_bgr)[np.newaxis, ...]  # (1, H, W, 1)
        y_pred = self.model.predict(x, verbose=0)        # (1, T, 35)
        decoded, confs = ctc_greedy_decode_with_conf(y_pred, self.captcha_length)
        idx, conf = decoded[0], confs[0]
        return indices_to_string(idx), conf

    def solve_bytes(self, img_bytes: bytes) -> tuple[str, list[float]]:
        nparr = np.frombuffer(img_bytes, dtype=np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("無法解碼圖片 bytes，請確認格式是否正確")
        return self.solve(img)

    def solve_b64(self, b64_str: str) -> tuple[str, list[float]]:
        if "," in b64_str:
            b64_str = b64_str.split(",", 1)[1]
        return self.solve_bytes(base64.b64decode(b64_str))

    def solve_file(self, img_path: Path) -> tuple[str, list[float]]:
        img = cv2.imread(str(img_path))
        if img is None:
            raise FileNotFoundError(f"無法讀取圖片：{img_path}")
        return self.solve(img)


# ─── 批次辨識 ────────────────────────────────────────────────────────────────

def batch_predict(
    solver: CaptchaSolver,
    img_dir: Path,
    labels_json: Optional[Path] = None,
) -> None:
    img_files = sorted(img_dir.glob("*.png")) + sorted(img_dir.glob("*.jpg"))
    if not img_files:
        print(f"[錯誤] 在 {img_dir} 找不到任何圖片", file=sys.stderr)
        return

    labels: dict[str, str] = {}
    if labels_json and labels_json.exists():
        with open(labels_json, encoding="utf-8") as f:
            labels = json.load(f)
        print(f"[批次] 載入 {len(labels)} 筆標注，將計算準確率")

    correct_char = total_char = 0
    correct_full = total_full = 0

    for img_path in img_files:
        try:
            pred, confs = solver.solve_file(img_path)
        except Exception as e:
            print(f"  [失敗] {img_path.name}：{e}")
            continue

        stem = img_path.stem
        true_label = labels.get(stem, "").upper()

        if true_label:
            for pos in range(min(len(pred), len(true_label))):
                if pred[pos] == true_label[pos]:
                    correct_char += 1
            total_char += len(true_label)
            if pred == true_label:
                correct_full += 1
            total_full += 1

        match_str = ""
        if true_label:
            match_str = "  ✓" if pred == true_label else f"  ✗ (真實：{true_label})"
        conf_str = " ".join(f"{c:.2f}" for c in confs)
        print(f"  {img_path.name}  →  {pred}  [{conf_str}]{match_str}")

    print("\n" + "=" * 50)
    print(f"批次辨識完成：共 {len(img_files)} 張")
    if total_full > 0:
        char_acc = correct_char / max(total_char, 1) * 100
        full_acc = correct_full / total_full * 100
        print(f"  字元準確率：{char_acc:.2f}%  ({correct_char}/{total_char})")
        print(f"  全字串準確率：{full_acc:.2f}%  ({correct_full}/{total_full})")
    print("=" * 50)


# ─── Flask HTTP 服務 ────────────────────────────────────────────────────────

def start_server(solver: CaptchaSolver, host: str = "0.0.0.0", port: int = 5001) -> None:
    try:
        from flask import Flask, request, jsonify  # type: ignore
    except ImportError:
        print("[錯誤] Flask 未安裝，請執行：pip install flask", file=sys.stderr)
        sys.exit(1)

    app = Flask(__name__)

    @app.route("/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    @app.route("/solve", methods=["POST"])
    def solve_endpoint():
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
    print("  POST /solve      — 接受 base64 圖片")
    print("  POST /solve_url  — 接受圖片 URL")
    print("  GET  /health     — 健康檢查")
    print("按 Ctrl+C 停止服務\n")
    app.run(host=host, port=port, debug=False, threaded=True)


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="台灣高鐵驗證碼推論（CRNN + CTC）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用範例：
  python predict_captcha.py captcha_images/captcha_001.png
  python predict_captcha.py --batch captcha_images/ --labels labels.json
  python predict_captcha.py --base64 "<base64 字串>"
  python predict_captcha.py --server --port 5001
        """,
    )

    input_group = parser.add_mutually_exclusive_group()
    input_group.add_argument("image_path", nargs="?", default=None,
                             help="單張圖片路徑（.png / .jpg）")
    input_group.add_argument("--batch", metavar="DIR",
                             help="批次辨識指定資料夾內的所有圖片")
    input_group.add_argument("--base64", metavar="STR",
                             help="從 base64 字串辨識")
    input_group.add_argument("--server", action="store_true",
                             help="啟動 Flask HTTP 服務")

    parser.add_argument("--model", default=str(DEFAULT_MODEL_PATH),
                        help=f"模型路徑（預設：{DEFAULT_MODEL_PATH}）")
    parser.add_argument("--labels", default=None,
                        help="labels.json 路徑（批次模式可選）")
    parser.add_argument("--length", type=int, default=CAPTCHA_LEN,
                        help=f"驗證碼字元數（預設：{CAPTCHA_LEN}）")
    parser.add_argument("--host", default="0.0.0.0",
                        help="HTTP 服務綁定地址（預設：0.0.0.0）")
    parser.add_argument("--port", type=int, default=5001,
                        help="HTTP 服務埠號（預設：5001）")
    parser.add_argument("--json", action="store_true",
                        help="以 JSON 格式輸出結果")

    args = parser.parse_args()

    model_path = Path(args.model)
    # 若 .keras 不存在，嘗試 .h5；反之亦然
    if not model_path.exists():
        if model_path.suffix == ".keras":
            alt = model_path.with_suffix(".h5")
        else:
            alt = model_path.with_suffix(".keras")
        if alt.exists():
            print(f"[提示] 找不到 {model_path.suffix}，改用：{alt}")
            model_path = alt

    try:
        solver = CaptchaSolver(model_path, captcha_length=args.length)
    except FileNotFoundError as e:
        print(f"[錯誤] {e}", file=sys.stderr)
        sys.exit(1)

    if args.server:
        start_server(solver, host=args.host, port=args.port)

    elif args.batch:
        img_dir = Path(args.batch)
        if not img_dir.is_dir():
            print(f"[錯誤] 不是有效的資料夾：{img_dir}", file=sys.stderr)
            sys.exit(1)
        labels_path = Path(args.labels) if args.labels else None
        batch_predict(solver, img_dir, labels_path)

    elif args.base64:
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
            avg = sum(confs) / len(confs) if confs else 0.0
            print(f"圖片：{img_path.name}")
            print(f"預測：{pred}")
            print(f"信心值：[{conf_str}]  (平均：{avg:.2f})")

    else:
        parser.print_help()
        sys.exit(0)


if __name__ == "__main__":
    main()
