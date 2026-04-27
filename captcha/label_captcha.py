#!/usr/bin/env python3
"""
label_captcha.py — 台灣高鐵驗證碼人工標注工具
================================================
功能：
  1. 依序讀取 captcha_images/ 中的圖片
  2. 用 OpenCV 視窗顯示（放大 3 倍方便辨識）
  3. 讓使用者在終端機輸入對應文字標注
  4. 儲存 / 增量更新 labels.json
  5. 支援跳過（直接 Enter）、退出（q）、顯示預覽統計

執行方式（本機）：
  python label_captcha.py                   ← 從頭開始
  python label_captcha.py --start 101       ← 從第 101 張繼續
  python label_captcha.py --dir my_imgs     ← 指定圖片資料夾

依賴：
  pip install opencv-python
"""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

# ── 字元集（與訓練腳本保持一致，去除易混淆的 I、O） ────────────────────────
VALID_CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
CAPTCHA_LENGTH_MIN: int = 4
CAPTCHA_LENGTH_MAX: int = 5

# ── 預設路徑 ─────────────────────────────────────────────────────────────────
DEFAULT_IMG_DIR: Path = Path(__file__).parent / "captcha_images"
DEFAULT_LABELS_JSON: Path = Path(__file__).parent / "labels.json"
DEFAULT_MODEL_PATH: Path = Path(__file__).parent / "captcha_model.keras"

# ── 顯示設定 ─────────────────────────────────────────────────────────────────
DISPLAY_SCALE: int = 2      # 放大倍數，讓小圖更清楚
WINDOW_NAME: str = "THSRC Captcha Labeler"


def preprocess_for_display(img: np.ndarray) -> np.ndarray:
    """將圖片放大並加上邊框，方便人眼辨識。"""
    h, w = img.shape[:2]
    # 放大
    big = cv2.resize(img, (w * DISPLAY_SCALE, h * DISPLAY_SCALE),
                     interpolation=cv2.INTER_NEAREST)
    # 加上白色邊框（5px）
    bordered = cv2.copyMakeBorder(big, 5, 5, 5, 5,
                                   cv2.BORDER_CONSTANT, value=(255, 255, 255))
    return bordered


def load_existing_labels(labels_path: Path) -> dict[str, str]:
    """讀取已存在的 labels.json；若不存在回傳空字典。"""
    if labels_path.exists():
        with open(labels_path, encoding="utf-8") as f:
            data: dict[str, str] = json.load(f)
        print(f"[載入] 已有 {len(data)} 筆標注：{labels_path}")
        return data
    return {}


def save_labels(labels: dict[str, str], labels_path: Path) -> None:
    """將標注字典儲存為 JSON（以 key 排序，便於版本管理）。"""
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(labels.items())), f, indent=2, ensure_ascii=False)


def save_one_label(stem: str, value: str, labels_path: Path) -> None:
    """只更新 JSON 中的單一筆記錄，避免每次寫入全部資料。"""
    labels: dict[str, str] = {}
    if labels_path.exists():
        with open(labels_path, encoding="utf-8") as f:
            labels = json.load(f)
    labels[stem] = value
    with open(labels_path, "w", encoding="utf-8") as f:
        json.dump(dict(sorted(labels.items())), f, indent=2, ensure_ascii=False)


def validate_label(text: str) -> tuple[bool, str]:
    """
    驗證使用者輸入的標注字串。
    回傳 (是否合法, 正規化後的字串 or 錯誤訊息)
    """
    text = text.strip().upper()
    if len(text) < CAPTCHA_LENGTH_MIN or len(text) > CAPTCHA_LENGTH_MAX:
        return False, (f"長度應為 {CAPTCHA_LENGTH_MIN}～{CAPTCHA_LENGTH_MAX}，"
                       f"目前輸入了 {len(text)} 個字元")
    invalid = [c for c in text if c not in VALID_CHARS]
    if invalid:
        return False, f"包含無效字元：{''.join(invalid)}（允許字元：{VALID_CHARS}）"
    return True, text


def pre_label_with_model(
    unlabeled_paths: list[Path],
    labels: dict[str, str],
    model_path: Path,
) -> dict[str, str]:
    """
    用訓練好的 CRNN 模型對未標注圖片產生預標。
    僅當預測長度等於 4 且全為合法字元才寫入 labels（其餘留給人工輸入）。
    回傳記錄哪些 stem 是模型預標的（供 review 階段提示用）。
    """
    try:
        from predict_captcha import CaptchaSolver
    except ImportError as e:
        print(f"[錯誤] 無法匯入 predict_captcha：{e}", file=sys.stderr)
        return {}

    if not model_path.exists():
        print(f"[錯誤] 找不到模型：{model_path}")
        print("請先執行 python train_captcha.py 訓練模型")
        return {}

    print(f"\n[Pre-label] 載入模型：{model_path}")
    try:
        solver = CaptchaSolver(model_path)
    except Exception as e:
        print(f"[錯誤] 模型載入失敗：{e}", file=sys.stderr)
        return {}

    pre_labeled: dict[str, str] = {}
    n = len(unlabeled_paths)
    print(f"[Pre-label] 對 {n} 張未標注圖片進行預測...")

    for i, img_path in enumerate(unlabeled_paths, 1):
        try:
            pred, _ = solver.solve_file(img_path)
        except Exception as e:
            print(f"  [{i}/{n}] {img_path.name} 預測失敗：{e}")
            continue

        ok, result = validate_label(pred)
        if ok:
            labels[img_path.stem] = result
            pre_labeled[img_path.stem] = result
        if i % 20 == 0 or i == n:
            print(f"  [{i}/{n}] 預測完成，目前命中 {len(pre_labeled)} 張")

    print(f"[Pre-label] 完成：{len(pre_labeled)}/{n} 張產生有效預標")
    return pre_labeled


def label_images(
    img_dir: Path,
    labels_path: Path,
    start_index: int = 0,
    model_path: Path | None = None,
    pre_label: bool = False,
) -> None:
    """主標注迴圈。"""
    # 取得所有圖片並排序
    img_files = sorted(img_dir.glob("*.jpg")) + sorted(img_dir.glob("*.png"))
    if not img_files:
        print(f"[錯誤] 在 {img_dir} 找不到任何 .jpg / .png 圖片", file=sys.stderr)
        sys.exit(1)

    # 載入已有標注
    labels = load_existing_labels(labels_path)
    already_labeled = set(labels.keys())

    # 所有圖片都要 review（從指定索引開始）
    todo = list(img_files[start_index:])
    total_todo = len(todo)
    total_all = len(img_files)

    print(f"\n圖片總數：{total_all}　|　已標注：{len(already_labeled)}　|　待 review：{total_todo}")

    # ── 詢問是否用模型 pre-label 未標注圖片 ─────────────────────────────────
    pre_labeled_stems: set[str] = set()
    unlabeled = [p for p in todo if p.stem not in already_labeled]
    if unlabeled and not pre_label:
        mp = model_path or DEFAULT_MODEL_PATH
        if mp.exists():
            try:
                ans = input(
                    f"\n發現 {len(unlabeled)} 張未標注圖片。"
                    f"是否用模型（{mp.name}）先做 pre-labeling，再由人工確認？[y/N] → "
                ).strip().lower()
            except (EOFError, KeyboardInterrupt):
                ans = ""
            pre_label = ans in ("y", "yes")

    if pre_label and unlabeled:
        mp = model_path or DEFAULT_MODEL_PATH
        pre_dict = pre_label_with_model(unlabeled, labels, mp)
        pre_labeled_stems = set(pre_dict.keys())
        if pre_dict:
            save_labels(labels, labels_path)
            print(f"[Pre-label] 已寫入 {labels_path}（人工 Enter 即視為確認）\n")

    # 互動詢問起始編號
    try:
        ans = input("從哪一筆開始？（輸入編號如 232，直接 Enter 從頭）→ ").strip()
    except (EOFError, KeyboardInterrupt):
        ans = ""
    if ans.isdigit():
        target = int(ans)
        skip = next((j for j, p in enumerate(todo) if p.stem.endswith(f"_{target}")), 0)
        todo = todo[skip:]
        total_todo = len(todo)
        print(f"  → 從 {todo[0].name if todo else '(無)'} 開始")

    print("─" * 60)
    print("輸入規則：")
    print(f"  · 輸入 {CAPTCHA_LENGTH_MIN}～{CAPTCHA_LENGTH_MAX} 個字元（英文自動轉大寫）")
    print(f"  · 允許字元：{VALID_CHARS}")
    print("  · 直接 Enter → 確認現有標注（或跳過未標注）")
    print("  · 輸入 q 或 quit → 儲存並退出")
    print("  · 輸入 d + Enter → 刪除前一筆標注")
    print("─" * 60 + "\n")

    # 建立 OpenCV 視窗（可能在無頭環境失敗，先 try）
    use_gui: bool = True
    try:
        cv2.namedWindow(WINDOW_NAME, cv2.WINDOW_NORMAL)
    except Exception:
        use_gui = False
        print("[提示] 無法開啟 OpenCV 視窗（無頭環境），將只在終端顯示檔名。")

    last_stem: str | None = None  # 用於支援刪除功能

    for i, img_path in enumerate(todo):
        stem = img_path.stem
        existing = labels.get(stem)

        # ── 讀取並顯示圖片 ────────────────────────────────────────────────
        img = cv2.imread(str(img_path))
        if img is None:
            print(f"[警告] 無法讀取圖片：{img_path.name}，跳過")
            continue

        if use_gui:
            display = preprocess_for_display(img)
            cv2.imshow(WINDOW_NAME, display)
            cv2.waitKey(100)  # 給視窗時間刷新

        # ── 取得使用者輸入 ────────────────────────────────────────────────
        while True:
            if existing:
                tag = " (模型預標)" if stem in pre_labeled_stems else ""
                prompt = f"[{i + 1}/{total_todo}] {img_path.name} [{existing}]{tag} → "
            else:
                prompt = f"[{i + 1}/{total_todo}] {img_path.name} → "
            try:
                raw = input(prompt)
            except (EOFError, KeyboardInterrupt):
                raw = "q"

            raw = raw.strip()

            # 退出指令
            if raw.lower() in ("q", "quit", "exit"):
                save_labels(labels, labels_path)
                print(f"\n[已儲存] 共 {len(labels)} 筆 → {labels_path}")
                if use_gui:
                    cv2.destroyAllWindows()
                return

            # 刪除前一筆
            if raw.lower() == "d":
                if last_stem and last_stem in labels:
                    del labels[last_stem]
                    save_labels(labels, labels_path)
                    print(f"  [刪除] {last_stem} 的標注已移除")
                    last_stem = None
                else:
                    print("  [提示] 沒有可刪除的前一筆標注")
                continue

            # 直接 Enter：已標注則確認保留，未標注則跳過
            if raw == "":
                if existing:
                    print(f"  [確認] {existing}")
                    last_stem = stem
                else:
                    print(f"  [跳過] {img_path.name}")
                break

            # 驗證輸入
            ok, result = validate_label(raw)
            if not ok:
                print(f"  [錯誤] {result}，請重新輸入")
                continue

            # 只寫入這一筆
            labels[stem] = result
            existing = result
            last_stem = stem
            save_one_label(stem, result, labels_path)
            break

    # ── 全部完成 ──────────────────────────────────────────────────────────
    save_labels(labels, labels_path)
    if use_gui:
        cv2.destroyAllWindows()

    print(f"\n{'=' * 60}")
    print(f"標注完成！共 {len(labels)} 筆標注已儲存至：{labels_path}")
    print(f"下一步：執行 python train_captcha.py 開始訓練")


def print_stats(labels_path: Path, img_dir: Path) -> None:
    """顯示目前標注進度統計。"""
    labels = load_existing_labels(labels_path)
    img_files = sorted(img_dir.glob("*.jpg")) + sorted(img_dir.glob("*.png"))
    print(f"\n{'=' * 40}")
    print(f"  圖片總數：{len(img_files)}")
    print(f"  已標注：  {len(labels)}")
    print(f"  未標注：  {len(img_files) - len(labels)}")
    print(f"  標注率：  {len(labels) / max(len(img_files), 1) * 100:.1f}%")
    # 字元長度分布
    from collections import Counter
    length_dist = Counter(len(v) for v in labels.values())
    print(f"  字串長度分布：{dict(sorted(length_dist.items()))}")
    print(f"{'=' * 40}\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="台灣高鐵驗證碼標注工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--dir", default=str(DEFAULT_IMG_DIR),
        help=f"圖片資料夾路徑（預設：{DEFAULT_IMG_DIR}）",
    )
    parser.add_argument(
        "--labels", default=str(DEFAULT_LABELS_JSON),
        help=f"labels.json 路徑（預設：{DEFAULT_LABELS_JSON}）",
    )
    parser.add_argument(
        "--start", type=int, default=0,
        help="從第幾張圖片開始（0-based index，預設從頭）",
    )
    parser.add_argument(
        "--stats", action="store_true",
        help="只顯示目前標注進度統計，不進入標注模式",
    )
    parser.add_argument(
        "--pre-label", action="store_true",
        help="直接使用模型對未標注圖片做 pre-labeling（跳過詢問）",
    )
    parser.add_argument(
        "--model", default=str(DEFAULT_MODEL_PATH),
        help=f"pre-labeling 使用的模型路徑（預設：{DEFAULT_MODEL_PATH}）",
    )
    args = parser.parse_args()

    img_dir = Path(args.dir)
    labels_path = Path(args.labels)

    if not img_dir.exists():
        print(f"[錯誤] 圖片資料夾不存在：{img_dir}", file=sys.stderr)
        print("請先執行 scrape_captcha.py 下載驗證碼圖片")
        sys.exit(1)

    if args.stats:
        print_stats(labels_path, img_dir)
        return

    label_images(
        img_dir, labels_path,
        start_index=args.start,
        model_path=Path(args.model),
        pre_label=args.pre_label,
    )


if __name__ == "__main__":
    main()
