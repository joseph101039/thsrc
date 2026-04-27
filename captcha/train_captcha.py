#!/usr/bin/env python3
"""
train_captcha.py — 台灣高鐵驗證碼 CRNN + CTC 訓練腳本 v5
========================================================
架構：CNN feature extractor → Bidirectional LSTM → CTC loss

設計理念：
  - CRNN 是 OCR / captcha 的標準架構，適合序列辨識
  - CNN 萃取空間特徵 → reshape 為時序 → BiLSTM 學習字元間依賴 → CTC 解碼
  - CTC loss 讓模型自動學習字元對齊，不需手動切字
  - 即使字元粘連、扭曲、重疊也能正確辨識

執行：
  python train_captcha.py
  python train_captcha.py --epochs 300
  python train_captcha.py --colab
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from sklearn.model_selection import train_test_split

try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers
    print(f"TensorFlow: {tf.__version__}")
except ImportError:
    print("[Error] TensorFlow not found. Run: pip install tensorflow", file=sys.stderr)
    sys.exit(1)

# ─── 字元集 ───────────────────────────────────────────────────────────────────
# CTC 需要 blank token，放在最後一個 index
CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)            # 34（不含 blank）
NUM_CLASSES_CTC: int = NUM_CLASSES + 1   # 35（含 blank）
BLANK_IDX: int = NUM_CLASSES             # blank 索引 = 34
CHAR2IDX: dict[str, int] = {c: i for i, c in enumerate(CHARS)}
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}
CAPTCHA_LEN: int = 4

# 整張圖輸入尺寸（CRNN 要 width 比 height 大很多，配合時序展開）
IMG_W: int = 160
IMG_H: int = 50

DEFAULT_BATCH_SIZE: int = 16
DEFAULT_EPOCHS: int = 200
DEFAULT_LR: float = 1e-3
DEFAULT_VALIDATION_SPLIT: float = 0.1
DEFAULT_TEST_SPLIT: float = 0.1

BASE_DIR = Path(__file__).parent
DEFAULT_IMG_DIR      = BASE_DIR / "captcha_images"
DEFAULT_LABELS_JSON  = BASE_DIR / "labels.json"
DEFAULT_MODEL_H5     = BASE_DIR / "captcha_model.h5"
DEFAULT_MODEL_KERAS  = BASE_DIR / "captcha_model.keras"
DEFAULT_HISTORY_PNG  = BASE_DIR / "training_history.png"


# ─── 前處理 ───────────────────────────────────────────────────────────────────

def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    """BGR → grayscale → resize → normalize [0,1]，shape: (H, W, 1)。"""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    resized = cv2.resize(gray, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    return (resized.astype("float32") / 255.0)[..., np.newaxis]


# ─── 資料集載入 ───────────────────────────────────────────────────────────────

def load_dataset(
    img_dir: Path,
    labels_json: Path,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    回傳 (X, Y, stems)
      X: (N, H, W, 1) float32
      Y: (N, CAPTCHA_LEN) int32  ─ 每張圖的 4 個字元索引
    """
    with open(labels_json, encoding="utf-8") as f:
        labels: dict[str, str] = json.load(f)

    X_list: list[np.ndarray] = []
    Y_list: list[list[int]] = []
    stem_list: list[str] = []
    skipped = 0

    print(f"\n[Load] {len(labels)} labels found, processing...")
    for stem, label in sorted(labels.items()):
        label_upper = label.strip().upper()
        if len(label_upper) != CAPTCHA_LEN or not all(c in CHARS for c in label_upper):
            skipped += 1
            continue

        img_path = img_dir / f"{stem}.png"
        if not img_path.exists():
            img_path = img_dir / f"{stem}.jpg"
        if not img_path.exists():
            skipped += 1
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            skipped += 1
            continue

        X_list.append(preprocess_image(img))
        Y_list.append([CHAR2IDX[c] for c in label_upper])
        stem_list.append(stem)

    if not X_list:
        print("[Error] Dataset is empty!", file=sys.stderr)
        sys.exit(1)

    X = np.array(X_list, dtype="float32")
    Y = np.array(Y_list, dtype="int32")
    print(f"[Load] {len(X)} images loaded, {skipped} skipped")
    return X, Y, stem_list


# ─── CRNN 模型 ────────────────────────────────────────────────────────────────

def build_crnn(
    input_shape: tuple = (IMG_H, IMG_W, 1),
    num_classes_ctc: int = NUM_CLASSES_CTC,
    rnn_units: int = 128,
) -> keras.Model:
    """
    CRNN: CNN feature extractor → BiLSTM → Dense(softmax) for CTC.

    Input:  (H=50, W=160, 1)
    CNN 將高度壓到 1，寬度保留為時序步長 T。
      H: 50 → 25 → 12 → 6 → 3 → 1
      W: 160 → 80 → 40 → 40 → 40 → 40   （後段 pool 只壓高，不壓寬）
    Output: (T=40, num_classes_ctc)  ─ 給 CTC 解碼
    """
    inp = layers.Input(shape=input_shape, name="image")

    # ── CNN feature extractor ──
    # Block 1: 50×160 → 25×80
    x = layers.Conv2D(64, (3, 3), padding="same")(inp)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling2D((2, 2))(x)

    # Block 2: 25×80 → 12×40
    x = layers.Conv2D(128, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling2D((2, 2))(x)

    # Block 3: 12×40 → 6×40（只壓高度，保留時間步）
    x = layers.Conv2D(256, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.Conv2D(256, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling2D((2, 1))(x)

    # Block 4: 6×40 → 3×40
    x = layers.Conv2D(512, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.Conv2D(512, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling2D((2, 1))(x)

    # Block 5: 3×40 → 1×40（最後把高度壓成 1）
    x = layers.Conv2D(512, (3, 3), padding="same")(x)
    x = layers.BatchNormalization()(x)
    x = layers.Activation("relu")(x)
    x = layers.MaxPooling2D((3, 1))(x)   # 壓高 3→1

    # ── 轉序列：(B, H=1, W=40, C=512) → (B, T=40, C=512) ──
    # 用 Reshape（不是 Lambda），可正確序列化
    feat_w = input_shape[1] // 4   # 兩次 (2,2) pool 把 W 從 160 → 40
    x = layers.Reshape((feat_w, 512), name="to_sequence")(x)

    # ── BiLSTM ──
    x = layers.Bidirectional(layers.LSTM(rnn_units, return_sequences=True, dropout=0.25))(x)
    x = layers.Bidirectional(layers.LSTM(rnn_units, return_sequences=True, dropout=0.25))(x)

    # ── Dense → softmax over (chars + blank) ──
    y = layers.Dense(num_classes_ctc, activation="softmax", name="ctc_logits")(x)

    return keras.Model(inputs=inp, outputs=y, name="ThsrcCaptchaCRNN")


# ─── CTC loss & decoder ───────────────────────────────────────────────────────

def ctc_batch_loss(y_true: tf.Tensor, y_pred: tf.Tensor) -> tf.Tensor:
    """
    y_true: (B, CAPTCHA_LEN) int32
    y_pred: (B, T, num_classes_ctc) softmax 機率
    """
    batch_len = tf.shape(y_pred)[0]
    time_steps = tf.shape(y_pred)[1]
    label_len  = tf.shape(y_true)[1]

    input_length = tf.fill([batch_len, 1], time_steps)
    label_length = tf.fill([batch_len, 1], label_len)

    return keras.backend.ctc_batch_cost(y_true, y_pred, input_length, label_length)


def ctc_greedy_decode(y_pred: np.ndarray) -> list[list[int]]:
    """
    y_pred: (B, T, num_classes_ctc) numpy
    回傳每個樣本的字元 index list（已去除重複與 blank）。
    """
    B, T, _ = y_pred.shape
    input_length = np.ones(B, dtype="int32") * T
    decoded, _ = keras.backend.ctc_decode(y_pred, input_length=input_length, greedy=True)
    seq = decoded[0].numpy()  # (B, max_len), -1 表示空
    out: list[list[int]] = []
    for row in seq:
        chars = [int(i) for i in row if 0 <= i < NUM_CLASSES]
        out.append(chars)
    return out


# ─── 資料增強 ─────────────────────────────────────────────────────────────────

def augment_batch(X_batch: np.ndarray) -> np.ndarray:
    out = np.empty_like(X_batch)
    h, w = IMG_H, IMG_W
    for i, img in enumerate(X_batch):
        img2d = img[:, :, 0]

        # 旋轉 ±5°
        angle = random.uniform(-5, 5)
        M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
        img2d = cv2.warpAffine(img2d, M, (w, h), borderMode=cv2.BORDER_REPLICATE)

        # 平移 ±5%
        tx = random.uniform(-0.05, 0.05) * w
        ty = random.uniform(-0.05, 0.05) * h
        T = np.float32([[1, 0, tx], [0, 1, ty]])
        img2d = cv2.warpAffine(img2d, T, (w, h), borderMode=cv2.BORDER_REPLICATE)

        # 縮放 ±3%
        scale = random.uniform(0.97, 1.03)
        img2d_s = cv2.resize(img2d, None, fx=scale, fy=scale, interpolation=cv2.INTER_LINEAR)
        ch, cw = img2d_s.shape
        if ch >= h and cw >= w:
            y0 = (ch - h) // 2; x0 = (cw - w) // 2
            img2d_s = img2d_s[y0:y0+h, x0:x0+w]
        else:
            img2d_s = cv2.resize(img2d_s, (w, h))
        img2d = img2d_s

        # 亮度 ±10%
        img2d = np.clip(img2d * random.uniform(0.9, 1.1), 0.0, 1.0)

        out[i] = img2d[..., np.newaxis].astype("float32")
    return out


def data_generator(X: np.ndarray, Y: np.ndarray, batch_size: int, augment: bool = True):
    n = len(X)
    indices = np.arange(n)
    while True:
        np.random.shuffle(indices)
        for start in range(0, n, batch_size):
            idx = indices[start:start + batch_size]
            X_batch = X[idx]
            if augment:
                X_batch = augment_batch(X_batch)
            yield X_batch, Y[idx]


# ─── 評估 ─────────────────────────────────────────────────────────────────────

def evaluate_accuracy(model: keras.Model, X: np.ndarray, Y: np.ndarray) -> tuple[float, float]:
    """回傳 (char_acc, str_acc)。"""
    y_pred = model.predict(X, verbose=0)
    decoded = ctc_greedy_decode(y_pred)

    char_correct = 0
    str_correct  = 0
    n = len(X)
    for i, pred in enumerate(decoded):
        true = list(Y[i])
        # 比對字元（位置對齊；若預測長度不等於 4 視為部分錯）
        for pos in range(CAPTCHA_LEN):
            if pos < len(pred) and pred[pos] == true[pos]:
                char_correct += 1
        if pred == true:
            str_correct += 1
    return char_correct / (n * CAPTCHA_LEN), str_correct / n


class StringAccuracyCallback(keras.callbacks.Callback):
    """每個 epoch 結束在 val 集上計算字串準確率，寫入 logs。"""
    def __init__(self, X_val: np.ndarray, Y_val: np.ndarray):
        super().__init__()
        self.X_val = X_val
        self.Y_val = Y_val

    def on_epoch_end(self, epoch, logs=None):
        logs = logs if logs is not None else {}
        char_acc, str_acc = evaluate_accuracy(self.model, self.X_val, self.Y_val)
        logs["val_char_acc"] = char_acc
        logs["val_str_acc"]  = str_acc
        print(f"  ─ val_char_acc: {char_acc:.4f}   val_str_acc: {str_acc:.4f}")


# ─── 訓練曲線繪圖 ─────────────────────────────────────────────────────────────

def plot_training_history(history: keras.callbacks.History, save_path: Path) -> None:
    h = history.history
    epochs = range(1, len(h.get("loss", [])) + 1)
    if not epochs:
        return

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    if "val_str_acc" in h:
        ax1.plot(epochs, h.get("val_char_acc", []), "g-o", markersize=3, label="val char_acc")
        ax1.plot(epochs, h.get("val_str_acc",  []), "r-o", markersize=3, label="val str_acc")
    ax1.set_title("Validation Accuracy")
    ax1.set_xlabel("Epoch"); ax1.set_ylabel("Accuracy")
    ax1.legend(); ax1.grid(True, alpha=0.3); ax1.set_ylim([0, 1.05])

    ax2.plot(epochs, h.get("loss", []),     "b-o", markersize=3, label="train")
    ax2.plot(epochs, h.get("val_loss", []), "r-o", markersize=3, label="val")
    ax2.set_title("CTC Loss")
    ax2.set_xlabel("Epoch"); ax2.set_ylabel("Loss")
    ax2.legend(); ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[Chart] Saved: {save_path}")


# ─── 主訓練流程 ───────────────────────────────────────────────────────────────

def train(
    img_dir: Path,
    labels_json: Path,
    model_h5_path: Path,
    model_keras_path: Path,
    history_png_path: Path,
    epochs: int = DEFAULT_EPOCHS,
    batch_size: int = DEFAULT_BATCH_SIZE,
    learning_rate: float = DEFAULT_LR,
    seed: int = 42,
) -> None:
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)

    X, Y, stems = load_dataset(img_dir, labels_json)

    idx = np.arange(len(X))
    idx_trainval, idx_test = train_test_split(idx, test_size=DEFAULT_TEST_SPLIT, random_state=seed)
    val_size = DEFAULT_VALIDATION_SPLIT / (1 - DEFAULT_TEST_SPLIT)
    idx_train, idx_val = train_test_split(idx_trainval, test_size=val_size, random_state=seed)

    X_train, Y_train = X[idx_train], Y[idx_train]
    X_val,   Y_val   = X[idx_val],   Y[idx_val]
    X_test,  Y_test  = X[idx_test],  Y[idx_test]
    print(f"[Split] Train: {len(X_train)}  Val: {len(X_val)}  Test: {len(X_test)}")

    model = build_crnn()
    model.summary()

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=learning_rate, clipnorm=5.0),
        loss=ctc_batch_loss,
    )

    steps = max(1, len(X_train) // batch_size)

    callbacks = [
        # StringAccuracyCallback 必須在 CSVLogger 之前，
        # 它寫入 logs 的 val_char_acc / val_str_acc 才會被 CSVLogger 抓到
        StringAccuracyCallback(X_val, Y_val),
        keras.callbacks.ModelCheckpoint(
            filepath=str(model_keras_path),
            monitor="val_loss", save_best_only=True, verbose=1,
        ),
        keras.callbacks.EarlyStopping(
            monitor="val_str_acc", mode="max", patience=30,
            restore_best_weights=True, verbose=1,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=10,
            min_lr=1e-6, verbose=1,
        ),
        keras.callbacks.CSVLogger(str(BASE_DIR / "training_log.csv"), append=False),
    ]

    print(f"\n[Train] epochs={epochs}, batch_size={batch_size}, lr={learning_rate}, steps/epoch={steps}")

    history = model.fit(
        data_generator(X_train, Y_train, batch_size, augment=True),
        steps_per_epoch=steps,
        validation_data=(X_val, Y_val),
        epochs=epochs,
        callbacks=callbacks,
        verbose=1,
    )

    plot_training_history(history, history_png_path)

    print("\n" + "=" * 60)
    char_acc, str_acc = evaluate_accuracy(model, X_test, Y_test)
    print(f"  Test char accuracy:   {char_acc * 100:.2f}%")
    print(f"  Test string accuracy: {str_acc * 100:.2f}%")
    print("=" * 60)

    model.save(str(model_h5_path))
    print(f"\n[Model] H5: {model_h5_path}")
    if not model_keras_path.exists():
        model.save(str(model_keras_path))
    print(f"[Model] Keras: {model_keras_path}")
    print("\n[Done] Next: python predict_captcha.py <image_path>")


# ─── CLI ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="THSRC Captcha CRNN+CTC Training")
    parser.add_argument("--img-dir",     default=str(DEFAULT_IMG_DIR))
    parser.add_argument("--labels",      default=str(DEFAULT_LABELS_JSON))
    parser.add_argument("--model-h5",    default=str(DEFAULT_MODEL_H5))
    parser.add_argument("--model-keras", default=str(DEFAULT_MODEL_KERAS))
    parser.add_argument("--history-png", default=str(DEFAULT_HISTORY_PNG))
    parser.add_argument("--epochs",      type=int,   default=DEFAULT_EPOCHS)
    parser.add_argument("--batch-size",  type=int,   default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--lr",          type=float, default=DEFAULT_LR)
    parser.add_argument("--seed",        type=int,   default=42)
    parser.add_argument("--colab",       action="store_true")
    args = parser.parse_args()

    if args.colab:
        try:
            from google.colab import drive  # type: ignore
            drive.mount("/content/drive", force_remount=False)
            base = Path("/content/drive/MyDrive/thsrc_captcha")
            args.img_dir     = str(base / "captcha_images")
            args.labels      = str(base / "labels.json")
            args.model_h5    = str(base / "models/captcha_model.h5")
            args.model_keras = str(base / "models/captcha_model.keras")
            args.history_png = str(base / "models/training_history.png")
            Path(args.model_h5).parent.mkdir(parents=True, exist_ok=True)
        except ImportError:
            print("[Warning] --colab only works in Google Colab")

    img_dir     = Path(args.img_dir)
    labels_json = Path(args.labels)
    if not img_dir.exists():
        print(f"[Error] Image dir not found: {img_dir}", file=sys.stderr); sys.exit(1)
    if not labels_json.exists():
        print(f"[Error] Labels file not found: {labels_json}", file=sys.stderr); sys.exit(1)

    gpus = tf.config.list_physical_devices("GPU")
    if gpus:
        print(f"[GPU] {len(gpus)} device(s): {[g.name for g in gpus]}")
        for g in gpus:
            tf.config.experimental.set_memory_growth(g, True)
    else:
        print("[GPU] None detected, using CPU")

    train(
        img_dir=img_dir,
        labels_json=labels_json,
        model_h5_path=Path(args.model_h5),
        model_keras_path=Path(args.model_keras),
        history_png_path=Path(args.history_png),
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
