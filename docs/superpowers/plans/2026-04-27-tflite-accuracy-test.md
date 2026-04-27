# TFLite Accuracy Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify that `captcha_model.tflite` (float32, no quantization) produces the same or near-identical accuracy as `captcha_model.keras` on the existing labeled dataset, before committing to the GCE TFLite deployment.

**Architecture:** Convert the Keras model to TFLite (float32, no quantization) using a one-shot script. Then run both the original `predict_captcha.py` (Keras path) and a new `predict_captcha_tflite.py` (TFLite path) over the labeled dataset, printing per-image results and summary statistics. Compare character accuracy and full-string accuracy side-by-side.

**Tech Stack:** Python 3.9–3.11, TensorFlow 2.x (conversion only), tflite-runtime (inference), OpenCV, NumPy, existing `labels.json`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `tensorflow/convert_to_tflite.py` | **Create** | One-shot Keras → TFLite conversion (float32) |
| `tensorflow/predict_captcha_tflite.py` | **Create** | TFLite inference + batch accuracy script |
| `tensorflow/captcha_model.tflite` | **Generated** | Output of conversion (gitignored via `*.tflite`) |

---

### Task 1: Convert Keras model to TFLite

**Files:**
- Create: `tensorflow/convert_to_tflite.py`

This script loads `captcha_model.keras` and saves `captcha_model.tflite` as float32 (no quantization — preserves original accuracy).

- [ ] **Step 1: Create the conversion script**

```python
#!/usr/bin/env python3
"""Convert captcha_model.keras → captcha_model.tflite (float32, no quantization)."""

import sys
from pathlib import Path

BASE_DIR = Path(__file__).parent
SRC = BASE_DIR / "captcha_model.keras"
DST = BASE_DIR / "captcha_model.tflite"

if not SRC.exists():
    print(f"[錯誤] 找不到模型：{SRC}", file=sys.stderr)
    sys.exit(1)

try:
    import tensorflow as tf
except ImportError:
    print("[錯誤] 請在 tensorflow venv 中執行：source tensorflow/.venv/bin/activate", file=sys.stderr)
    sys.exit(1)

print(f"載入模型：{SRC} ...")
model = tf.keras.models.load_model(str(SRC), compile=False)

print("轉換為 TFLite（float32）...")
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()

DST.write_bytes(tflite_model)
print(f"完成：{DST}  ({len(tflite_model) / 1e6:.1f} MB)")
```

- [ ] **Step 2: Run conversion (requires tensorflow venv)**

```bash
source tensorflow/.venv/bin/activate
python3 tensorflow/convert_to_tflite.py
```

Expected output (approximate):
```
載入模型：.../tensorflow/captcha_model.keras ...
轉換為 TFLite（float32）...
完成：.../tensorflow/captcha_model.tflite  (X.X MB)
```

Verify the file was created:
```bash
ls -lh tensorflow/captcha_model.tflite
```

- [ ] **Step 3: Confirm `.tflite` is gitignored**

```bash
git check-ignore -v tensorflow/captcha_model.tflite
```

Expected: `.gitignore:...  tensorflow/captcha_model.tflite`

If not ignored, add `*.tflite` to `.gitignore`:
```bash
echo "*.tflite" >> .gitignore
```

- [ ] **Step 4: Commit the conversion script**

```bash
git add tensorflow/convert_to_tflite.py
git commit -m "feat: add Keras→TFLite float32 conversion script"
```

---

### Task 2: Write TFLite batch inference + accuracy script

**Files:**
- Create: `tensorflow/predict_captcha_tflite.py`

This script mirrors `predict_captcha.py`'s batch mode exactly: loads `labels.json`, runs TFLite inference on every labeled image, and reports character accuracy and full-string accuracy.

Key differences from `predict_captcha.py`:
- Uses `tflite_runtime.interpreter.Interpreter` instead of `keras.models.load_model`
- Identical `preprocess_image()` and `ctc_greedy_decode_with_conf()` logic (copy verbatim — must stay in sync with training)
- Reads `input_details` / `output_details` from the interpreter (TFLite API)

- [ ] **Step 1: Install tflite-runtime in the current environment**

```bash
# Still inside tensorflow/.venv  (activated in Task 1)
pip install tflite-runtime
```

If `tflite-runtime` is not available for your Python/platform combination (common on macOS arm64), use the TFLite interpreter bundled with TensorFlow instead:

```python
# fallback import — add this to predict_captcha_tflite.py
try:
    from tflite_runtime.interpreter import Interpreter
except ImportError:
    from tensorflow.lite.python.interpreter import Interpreter
```

- [ ] **Step 2: Create the script**

```python
#!/usr/bin/env python3
"""
predict_captcha_tflite.py — TFLite 推論 + 精確度比較
=====================================================
與 predict_captcha.py 的 batch 模式邏輯完全一致，
但使用 tflite-runtime（或 tensorflow.lite）進行推論。

執行：
  python predict_captcha_tflite.py
  python predict_captcha_tflite.py --model tensorflow/captcha_model.tflite \
                                   --images tensorflow/captcha_images/ \
                                   --labels tensorflow/labels.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

# ── 與訓練/推論腳本保持一致的常數 ────────────────────────────────────────────
CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)           # 34
BLANK: int = NUM_CLASSES                # 34 (CTC blank index)
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}

IMG_W: int = 160
IMG_H: int = 50
CAPTCHA_LEN: int = 4

BASE_DIR = Path(__file__).parent
DEFAULT_MODEL = BASE_DIR / "captcha_model.tflite"
DEFAULT_IMAGES = BASE_DIR / "captcha_images"
DEFAULT_LABELS = BASE_DIR / "labels.json"


# ── 前處理（必須與 train_captcha.py 完全一致） ────────────────────────────────

def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    """BGR → grayscale → resize(IMG_W, IMG_H) → normalize [0,1]，shape: (H, W, 1)。"""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    return (resized.astype("float32") / 255.0)[..., np.newaxis]


# ── CTC 貪婪解碼（與 predict_captcha.py 完全一致） ───────────────────────────

def ctc_greedy_decode_with_conf(
    y_pred: np.ndarray,
    expected_len: int = CAPTCHA_LEN,
) -> tuple[list[list[int]], list[list[float]]]:
    """y_pred: (B, T, num_classes_ctc)  →  (decoded_indices, char_confidences)"""
    B, T, _ = y_pred.shape
    argmax = np.argmax(y_pred, axis=-1)   # (B, T)
    maxprob = np.max(y_pred, axis=-1)     # (B, T)

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


# ── TFLite 推論器 ─────────────────────────────────────────────────────────────

def load_interpreter(model_path: Path):
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

    x = preprocess_image(img_bgr)[np.newaxis, ...]  # (1, H, W, 1)
    interp.set_tensor(input_details[0]["index"], x)
    interp.invoke()
    y_pred = interp.get_tensor(output_details[0]["index"])  # (1, T, 35)

    decoded, confs = ctc_greedy_decode_with_conf(y_pred, CAPTCHA_LEN)
    idx, conf = decoded[0], confs[0]
    text = "".join(IDX2CHAR.get(i, "?") for i in idx)
    return text, conf


# ── 批次評估 ─────────────────────────────────────────────────────────────────

def batch_evaluate(
    model_path: Path,
    img_dir: Path,
    labels_path: Path,
    verbose: bool = True,
) -> dict:
    if not labels_path.exists():
        print(f"[錯誤] 找不到 labels.json：{labels_path}", file=sys.stderr)
        sys.exit(1)

    with open(labels_path, encoding="utf-8") as f:
        labels: dict[str, str] = json.load(f)

    interp = load_interpreter(model_path)
    print(f"[TFLite] 模型已載入：{model_path}")

    def _img_sort_key(p: Path) -> int:
        import re
        m = re.search(r"(\d+)", p.stem)
        return int(m.group(1)) if m else 0

    img_files = sorted(
        list(img_dir.glob("*.jpg")) + list(img_dir.glob("*.png")),
        key=_img_sort_key,
    )

    # Only evaluate images that have labels
    labeled_files = [p for p in img_files if p.stem in labels]
    if not labeled_files:
        print("[錯誤] 圖片目錄中沒有已標注的圖片", file=sys.stderr)
        sys.exit(1)

    print(f"[TFLite] 評估 {len(labeled_files)} 張已標注圖片...\n")

    correct_char = total_char = 0
    correct_full = total_full = 0
    errors: list[str] = []

    for img_path in labeled_files:
        img = cv2.imread(str(img_path))
        if img is None:
            errors.append(f"  [無法讀取] {img_path.name}")
            continue

        try:
            pred, confs = predict_one(interp, img)
        except Exception as e:
            errors.append(f"  [推論失敗] {img_path.name}: {e}")
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
        char_acc = correct_char / max(total_char, 1) * 100
        full_acc = correct_full / total_full * 100
        print(f"  字元準確率：  {char_acc:.2f}%  ({correct_char}/{total_char})")
        print(f"  全字串準確率：{full_acc:.2f}%  ({correct_full}/{total_full})")
    if errors:
        print("\n失敗清單：")
        for e in errors:
            print(e)
    print("=" * 55)

    return {
        "char_accuracy": correct_char / max(total_char, 1),
        "full_accuracy": correct_full / max(total_full, 1),
        "total": total_full,
    }


# ── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="TFLite 驗證碼精確度評估")
    parser.add_argument("--model", default=str(DEFAULT_MODEL),
                        help=f"TFLite 模型路徑（預設：{DEFAULT_MODEL}）")
    parser.add_argument("--images", default=str(DEFAULT_IMAGES),
                        help=f"圖片資料夾（預設：{DEFAULT_IMAGES}）")
    parser.add_argument("--labels", default=str(DEFAULT_LABELS),
                        help=f"labels.json 路徑（預設：{DEFAULT_LABELS}）")
    parser.add_argument("--quiet", action="store_true",
                        help="只顯示最終統計，不逐張輸出")
    args = parser.parse_args()

    batch_evaluate(
        model_path=Path(args.model),
        img_dir=Path(args.images),
        labels_path=Path(args.labels),
        verbose=not args.quiet,
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Commit the script**

```bash
git add tensorflow/predict_captcha_tflite.py
git commit -m "feat: add TFLite batch accuracy evaluation script"
```

---

### Task 3: Run accuracy comparison

**Files:**
- Read: `tensorflow/captcha_model.tflite` (generated in Task 1)
- Read: `tensorflow/labels.json` (1,027 labeled images)

- [ ] **Step 1: Run Keras baseline (original model)**

```bash
source tensorflow/.venv/bin/activate
python3 tensorflow/predict_captcha.py \
  --batch tensorflow/captcha_images/ \
  --labels tensorflow/labels.json \
  2>&1 | tail -10
```

Note the reported **字元準確率** and **全字串準確率**.

- [ ] **Step 2: Run TFLite evaluation (quiet mode for clean output)**

```bash
python3 tensorflow/predict_captcha_tflite.py --quiet
```

Expected output shape:
```
[TFLite] 模型已載入：.../captcha_model.tflite
[TFLite] 評估 1027 張已標注圖片...

=======================================================
TFLite 模型評估結果（captcha_model.tflite）
  評估張數：1027  /  讀取失敗：0
  字元準確率：  XX.XX%  (XXXX/4108)
  全字串準確率：XX.XX%  (XXX/1027)
=======================================================
```

- [ ] **Step 3: Compare results**

If TFLite full-string accuracy is within **±1%** of the Keras baseline, the conversion is lossless for practical purposes and the GCE deployment design is confirmed.

If accuracy drops more than 1%, check:
1. The `preprocess_image()` function in both scripts is byte-for-byte identical
2. The `ctc_greedy_decode_with_conf()` function is byte-for-byte identical
3. The TFLite model was converted from the same `.keras` file that was evaluated in Step 1

- [ ] **Step 4: Commit `.gitignore` update if needed**

If `*.tflite` is not yet in `.gitignore` (verified in Task 1 Step 3), add it now:

```bash
# only if needed:
echo "*.tflite" >> .gitignore
git add .gitignore
git commit -m "chore: gitignore *.tflite model binaries"
```
