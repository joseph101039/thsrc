#!/usr/bin/env python3
"""
predict_captcha_tflite.py — TFLite batch accuracy evaluation
=============================================================
Mirrors predict_captcha.py batch mode but uses tflite-runtime
(or tensorflow.lite) for inference instead of Keras.

Usage:
  python predict_captcha_tflite.py
  python predict_captcha_tflite.py --quiet
  python predict_captcha_tflite.py --model tensorflow/captcha_model.tflite \
                                   --images tensorflow/captcha_images/ \
                                   --labels tensorflow/labels.json
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

import cv2
import numpy as np

CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)
BLANK: int = NUM_CLASSES
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}

IMG_W: int = 160
IMG_H: int = 50
CAPTCHA_LEN: int = 4

BASE_DIR = Path(__file__).parent
DEFAULT_MODEL = BASE_DIR / "captcha_model.tflite"
DEFAULT_IMAGES = BASE_DIR / "captcha_images"
DEFAULT_LABELS = BASE_DIR / "labels.json"


def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    return (resized.astype("float32") / 255.0)[..., np.newaxis]


def ctc_greedy_decode_with_conf(
    y_pred: np.ndarray,
) -> tuple[list[list[int]], list[list[float]]]:
    B, T, _ = y_pred.shape
    argmax = np.argmax(y_pred, axis=-1)
    maxprob = np.max(y_pred, axis=-1)
    decoded: list[list[int]] = []
    confs: list[list[float]] = []
    for b in range(B):
        seq_idx: list[int] = []
        seq_conf: list[float] = []
        prev = -1
        for t in range(T):
            c = int(argmax[b, t])
            if c != prev and c != BLANK:
                seq_idx.append(c)
                seq_conf.append(float(maxprob[b, t]))
            prev = c
        decoded.append(seq_idx)
        confs.append(seq_conf)
    return decoded, confs


def load_interpreter(model_path: Path):
    # Disable GPU so TFLite runs on CPU (same as target deployment env)
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    try:
        from tflite_runtime.interpreter import Interpreter
    except ImportError:
        try:
            from tensorflow.lite.python.interpreter import Interpreter
        except ImportError:
            print("[錯誤] 請安裝 tflite-runtime 或 tensorflow", file=sys.stderr)
            sys.exit(1)
    if not model_path.exists():
        print(f"[錯誤] 找不到模型：{model_path}", file=sys.stderr)
        print("請先執行：python tensorflow/convert_to_tflite.py", file=sys.stderr)
        sys.exit(1)
    interp = Interpreter(model_path=str(model_path))
    interp.allocate_tensors()
    return interp


def predict_one(interp, img_bgr: np.ndarray) -> tuple[str, list[float]]:
    input_details = interp.get_input_details()
    output_details = interp.get_output_details()
    x = preprocess_image(img_bgr)[np.newaxis, ...]
    interp.set_tensor(input_details[0]["index"], x)
    interp.invoke()
    y_pred = interp.get_tensor(output_details[0]["index"])
    decoded, confs = ctc_greedy_decode_with_conf(y_pred)
    idx, conf = decoded[0], confs[0]
    return "".join(IDX2CHAR.get(i, "?") for i in idx), conf


def batch_evaluate(model_path: Path, img_dir: Path, labels_path: Path, verbose: bool = True) -> None:
    with open(labels_path, encoding="utf-8") as f:
        labels: dict[str, str] = json.load(f)

    interp = load_interpreter(model_path)
    print(f"[TFLite] 模型已載入：{model_path}")

    def _sort_key(p: Path) -> int:
        m = re.search(r"(\d+)", p.stem)
        return int(m.group(1)) if m else 0

    img_files = sorted(
        list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")),
        key=_sort_key,
    )
    labeled_files = [p for p in img_files if p.stem in labels]
    if not labeled_files:
        print("[錯誤] 沒有已標注的圖片", file=sys.stderr)
        sys.exit(1)

    print(f"[TFLite] 評估 {len(labeled_files)} 張已標注圖片...\n")

    correct_char = total_char = correct_full = total_full = 0
    errors: list[str] = []

    for img_path in labeled_files:
        img = cv2.imread(str(img_path))
        if img is None:
            errors.append(img_path.name)
            continue
        try:
            pred, confs = predict_one(interp, img)
        except Exception as e:
            errors.append(f"{img_path.name}: {e}")
            continue

        true_label = labels[img_path.stem].upper()
        for pos in range(min(len(pred), len(true_label))):
            if pred[pos] == true_label[pos]:
                correct_char += 1
        total_char += len(true_label)
        if pred == true_label:
            correct_full += 1
        total_full += 1

        if verbose:
            match = "✓" if pred == true_label else f"✗ (真實：{true_label})"
            conf_str = " ".join(f"{c:.2f}" for c in confs)
            print(f"  {img_path.name}  →  {pred}  [{conf_str}]  {match}")

    print("\n" + "=" * 55)
    print(f"TFLite 模型評估結果（{model_path.name}）")
    print(f"  評估張數：{total_full}  /  讀取失敗：{len(errors)}")
    if total_full > 0:
        print(f"  字元準確率：  {correct_char / max(total_char, 1) * 100:.2f}%  ({correct_char}/{total_char})")
        print(f"  全字串準確率：{correct_full / total_full * 100:.2f}%  ({correct_full}/{total_full})")
    print("=" * 55)


def main() -> None:
    parser = argparse.ArgumentParser(description="TFLite 驗證碼精確度評估")
    parser.add_argument("--model", default=str(DEFAULT_MODEL))
    parser.add_argument("--images", default=str(DEFAULT_IMAGES))
    parser.add_argument("--labels", default=str(DEFAULT_LABELS))
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()
    batch_evaluate(Path(args.model), Path(args.images), Path(args.labels), verbose=not args.quiet)


if __name__ == "__main__":
    main()
