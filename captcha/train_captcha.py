#!/usr/bin/env python3
"""
train_captcha.py — 台灣高鐵驗證碼 CNN 訓練腳本
================================================
功能：
  1. 讀取 captcha_images/ 和 labels.json
  2. 圖片前處理：灰階 → 去雜訊 → Otsu 二值化 → 形態學清理
  3. 切割單字元（Connected Components），失敗時 fallback 整圖辨識
  4. 定義 CNN 模型（Conv2D × 3 → BN → Dropout → Dense）
  5. 資料增強（小幅旋轉 / 平移 / 縮放）
  6. 訓練 + EarlyStopping + ReduceLROnPlateau
  7. 儲存最佳模型為 captcha_model.h5（及 .keras 格式）
  8. 輸出訓練曲線圖 training_history.png
  9. 最終在測試集輸出字元準確率 / 全字串準確率

執行方式：
  python train_captcha.py                    ← 使用預設路徑
  python train_captcha.py --epochs 150       ← 最多跑 150 epoch
  python train_captcha.py --colab            ← 在 Google Colab 執行（掛載 Drive）

Google Colab 快速啟動：
  !git clone https://github.com/joseph101039/thsrc.git
  %cd thsrc
  !python train_captcha.py --colab

依賴：
  pip install tensorflow opencv-python matplotlib scikit-learn numpy
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from pathlib import Path
from typing import Optional

import cv2
import matplotlib
matplotlib.use("Agg")   # 非互動環境（Colab / server）不需 GUI backend
import matplotlib.pyplot as plt
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

# ─── TensorFlow（延遲匯入以支援環境偵測） ───────────────────────────────────
try:
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers
    from tensorflow.keras.preprocessing.image import ImageDataGenerator
    print(f"TensorFlow 版本：{tf.__version__}")
except ImportError:
    print("[錯誤] 找不到 TensorFlow，請執行：pip install tensorflow", file=sys.stderr)
    sys.exit(1)

# ─── 全域設定 ─────────────────────────────────────────────────────────────────

# 高鐵驗證碼字元集（去除視覺上易混淆的 I 和 O）
CHARS: str = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"
NUM_CLASSES: int = len(CHARS)           # 34 類
CHAR2IDX: dict[str, int] = {c: i for i, c in enumerate(CHARS)}
IDX2CHAR: dict[int, str] = {i: c for i, c in enumerate(CHARS)}

# 驗證碼預期長度
CAPTCHA_LEN_MIN: int = 4
CAPTCHA_LEN_MAX: int = 5

# 切割後單字元圖片尺寸（寬 × 高）
CHAR_W: int = 30
CHAR_H: int = 40

# 整圖 fallback 尺寸（若切割失敗）
FULL_W: int = 120
FULL_H: int = 40

# 訓練超參數預設值
DEFAULT_BATCH_SIZE: int = 32
DEFAULT_EPOCHS: int = 100
DEFAULT_LR: float = 1e-3
DEFAULT_VALIDATION_SPLIT: float = 0.15
DEFAULT_TEST_SPLIT: float = 0.15

# 預設路徑
BASE_DIR = Path(__file__).parent
DEFAULT_IMG_DIR = BASE_DIR / "captcha_images"
DEFAULT_LABELS_JSON = BASE_DIR / "labels.json"
DEFAULT_MODEL_H5 = BASE_DIR / "captcha_model.h5"
DEFAULT_MODEL_KERAS = BASE_DIR / "captcha_model.keras"
DEFAULT_HISTORY_PNG = BASE_DIR / "training_history.png"

# ─── 1. 圖片前處理 ────────────────────────────────────────────────────────────

def preprocess_image(img_bgr: np.ndarray) -> np.ndarray:
    """
    將彩色驗證碼圖片轉換為乾淨的二值化影像。

    流程：
      BGR → 灰階 → 中值濾波（去椒鹽雜訊）→ Otsu 二值化 →
      形態學開運算（去細橫線干擾）

    回傳：uint8 灰階影像，字元為白（255），背景為黑（0）
    """
    # 灰階化
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

    # 中值濾波：對椒鹽雜訊與干擾點效果佳，kernel 3x3 保留字元細節
    denoised = cv2.medianBlur(gray, 3)

    # Otsu 自動閾值二值化（THRESH_BINARY_INV 讓字元為白）
    _, binary = cv2.threshold(
        denoised, 0, 255,
        cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
    )

    # 形態學開運算：移除細橫線干擾（kernel 高度 > 寬度 → 對水平線敏感）
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)

    return cleaned


# ─── 2. 字元切割 ──────────────────────────────────────────────────────────────

def split_chars_by_connected_components(
    binary: np.ndarray,
    expected_len: int,
) -> Optional[list[np.ndarray]]:
    """
    使用連通分量分析（Connected Components）切割單字元。

    參數：
      binary       — 前處理後的二值影像（字元白 / 背景黑）
      expected_len — 預期字元數量

    回傳：
      list of 單字元圖片（CHAR_H × CHAR_W，歸一化至 [0,1]）
      若切割結果與預期不符回傳 None（觸發 fallback）
    """
    # 取得連通分量（第 2 個回傳值是 label map，第 3 個是 stats）
    num_labels, _, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)

    # stats 格式：[x, y, w, h, area]；第 0 個是背景，跳過
    char_stats = []
    h_img, w_img = binary.shape
    min_area = (h_img * w_img) * 0.003   # 過濾面積過小的雜訊點

    for lbl in range(1, num_labels):
        x, y, w, h, area = stats[lbl]
        if area < min_area:
            continue
        char_stats.append((x, y, w, h))

    # 依 x 座標排序（由左至右）
    char_stats.sort(key=lambda s: s[0])

    # 若分量數量不符，嘗試合併過度分裂的分量（字元斷裂情況）
    if len(char_stats) > expected_len:
        char_stats = _merge_close_components(char_stats, w_img, expected_len)

    # 數量仍不符 → 切割失敗
    if len(char_stats) != expected_len:
        return None

    # 裁切並 resize 每個字元 ROI
    char_imgs: list[np.ndarray] = []
    for (x, y, w, h) in char_stats:
        # 稍微擴展邊界（避免裁切太緊貼字元邊緣）
        pad = 2
        x1 = max(0, x - pad)
        y1 = max(0, y - pad)
        x2 = min(w_img, x + w + pad)
        y2 = min(h_img, y + h + pad)
        roi = binary[y1:y2, x1:x2]
        # resize 至統一尺寸，並歸一化
        resized = cv2.resize(roi, (CHAR_W, CHAR_H), interpolation=cv2.INTER_AREA)
        char_imgs.append(resized.astype("float32") / 255.0)

    return char_imgs


def _merge_close_components(
    stats: list[tuple[int, int, int, int]],
    img_width: int,
    target_count: int,
) -> list[tuple[int, int, int, int]]:
    """
    合併水平方向上相鄰過近的連通分量（處理字元斷裂情況）。
    以貪婪方式依間距由小到大合併，直到數量等於 target_count。
    """
    stats = list(stats)   # 複製，避免修改原始資料

    while len(stats) > target_count:
        # 計算相鄰分量的水平間距
        gaps = []
        for i in range(len(stats) - 1):
            x_i, _, w_i, _ = stats[i]
            x_next = stats[i + 1][0]
            gap = x_next - (x_i + w_i)
            gaps.append((gap, i))

        # 合併間距最小的一對
        gaps.sort()
        _, idx = gaps[0]
        x0, y0, w0, h0 = stats[idx]
        x1, y1, w1, h1 = stats[idx + 1]
        merged_x = min(x0, x1)
        merged_y = min(y0, y1)
        merged_w = max(x0 + w0, x1 + w1) - merged_x
        merged_h = max(y0 + h0, y1 + h1) - merged_y
        stats[idx] = (merged_x, merged_y, merged_w, merged_h)
        del stats[idx + 1]

    return stats


def split_chars_by_fixed_width(
    binary: np.ndarray,
    num_chars: int,
) -> list[np.ndarray]:
    """
    Fallback 切割方式：依固定寬度等分圖片（假設字元間距均勻）。
    """
    h, w = binary.shape
    char_w = w // num_chars
    char_imgs: list[np.ndarray] = []
    for i in range(num_chars):
        x1 = i * char_w
        x2 = x1 + char_w if i < num_chars - 1 else w
        roi = binary[:, x1:x2]
        resized = cv2.resize(roi, (CHAR_W, CHAR_H), interpolation=cv2.INTER_AREA)
        char_imgs.append(resized.astype("float32") / 255.0)
    return char_imgs


def split_captcha(
    img_bgr: np.ndarray,
    label: str,
) -> Optional[list[np.ndarray]]:
    """
    嘗試切割驗證碼圖片為單字元列表。
    策略：
      1. 連通分量分析（精確但可能失敗）
      2. 固定寬度等分（保底 fallback）
    """
    binary = preprocess_image(img_bgr)
    num_chars = len(label)

    # 策略 1：連通分量分析
    chars = split_chars_by_connected_components(binary, num_chars)
    if chars is not None:
        return chars

    # 策略 2：固定寬度等分
    return split_chars_by_fixed_width(binary, num_chars)


# ─── 3. 資料集建立 ────────────────────────────────────────────────────────────

def load_dataset(
    img_dir: Path,
    labels_json: Path,
) -> tuple[np.ndarray, np.ndarray, list[str]]:
    """
    讀取所有已標注的驗證碼，切割為單字元後建立訓練資料。

    回傳：
      X  — shape (N, CHAR_H, CHAR_W, 1)，float32，值域 [0, 1]
      y  — shape (N,)，int32，字元 index
      skipped — 跳過的圖片 stem 列表（切割失敗且無法 fallback）
    """
    with open(labels_json, encoding="utf-8") as f:
        labels: dict[str, str] = json.load(f)

    X_list: list[np.ndarray] = []
    y_list: list[int] = []
    skipped: list[str] = []

    print(f"\n[資料載入] 共 {len(labels)} 筆標注，開始處理...")

    for stem, label in sorted(labels.items()):
        # 過濾非法標注
        label_upper = label.strip().upper()
        if not all(c in CHARS for c in label_upper):
            print(f"  [跳過] {stem}：含無效字元「{label}」")
            skipped.append(stem)
            continue

        img_path = img_dir / f"{stem}.jpg"
        if not img_path.exists():
            img_path = img_dir / f"{stem}.png"
        if not img_path.exists():
            print(f"  [跳過] {stem}：找不到圖片")
            skipped.append(stem)
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            print(f"  [跳過] {stem}：無法讀取圖片")
            skipped.append(stem)
            continue

        # 切割字元
        char_imgs = split_captcha(img, label_upper)
        if char_imgs is None or len(char_imgs) != len(label_upper):
            print(f"  [警告] {stem}：切割失敗，使用固定等分切割")
            binary = preprocess_image(img)
            char_imgs = split_chars_by_fixed_width(binary, len(label_upper))

        # 將每個字元加入資料集
        for char_img, char in zip(char_imgs, label_upper):
            X_list.append(char_img[..., np.newaxis])   # 增加 channel 維度
            y_list.append(CHAR2IDX[char])

    if not X_list:
        print("[錯誤] 資料集為空！請確認 labels.json 與圖片是否正確對應", file=sys.stderr)
        sys.exit(1)

    X = np.array(X_list, dtype="float32")
    y = np.array(y_list, dtype="int32")

    print(f"[資料載入完成] 字元樣本數：{len(X)}")
    print(f"  跳過圖片：{len(skipped)} 張")
    # 顯示各類別樣本分布（簡略）
    unique, counts = np.unique(y, return_counts=True)
    min_cnt = counts.min()
    max_cnt = counts.max()
    print(f"  每類樣本數：最少 {min_cnt}，最多 {max_cnt}")
    if min_cnt < 5:
        print(f"  [警告] 部分類別樣本數過少（< 5），建議補充資料")

    return X, y, skipped


# ─── 4. 模型架構 ──────────────────────────────────────────────────────────────

def build_char_classifier(
    num_classes: int = NUM_CLASSES,
    input_shape: tuple[int, ...] = (CHAR_H, CHAR_W, 1),
    dropout_rate: float = 0.4,
) -> keras.Model:
    """
    建立字元分類 CNN 模型。

    架構：
      Input → [Conv2D(32) → BN → MaxPool] ×1
            → [Conv2D(64) → BN → MaxPool] ×1
            → [Conv2D(128) → BN → MaxPool] ×1
            → Flatten → Dense(256, relu) → Dropout
            → Dense(num_classes, softmax)

    約 500K 參數，適合 500 張驗證碼資料集，不易 overfitting。
    """
    model = keras.Sequential(
        [
            layers.Input(shape=input_shape),

            # ── Block 1：偵測低階特徵（邊緣、筆畫起點） ────────────────────
            layers.Conv2D(32, (3, 3), activation="relu", padding="same"),
            layers.BatchNormalization(),
            layers.MaxPooling2D((2, 2)),

            # ── Block 2：偵測中階特徵（筆畫組合、弧度） ────────────────────
            layers.Conv2D(64, (3, 3), activation="relu", padding="same"),
            layers.BatchNormalization(),
            layers.MaxPooling2D((2, 2)),

            # ── Block 3：偵測高階特徵（字元整體形狀） ───────────────────────
            layers.Conv2D(128, (3, 3), activation="relu", padding="same"),
            layers.BatchNormalization(),
            layers.MaxPooling2D((2, 2)),

            # ── 全連接分類層 ─────────────────────────────────────────────────
            layers.Flatten(),
            layers.Dense(256, activation="relu"),
            layers.Dropout(dropout_rate),   # 防止 overfitting（資料量少時關鍵）
            layers.Dense(num_classes, activation="softmax"),
        ],
        name="ThsrcCaptchaClassifier",
    )
    return model


# ─── 5. 訓練輔助函數 ──────────────────────────────────────────────────────────

def get_data_augmentation() -> ImageDataGenerator:
    """
    建立資料增強器。
    注意：增強幅度不宜過大，避免 '6' 旋轉後像 '9'、'Z' 像 '2' 等問題。
    """
    return ImageDataGenerator(
        rotation_range=8,           # ±8 度旋轉（小幅，保留字元可讀性）
        width_shift_range=0.10,     # 水平位移 ±10%
        height_shift_range=0.10,    # 垂直位移 ±10%
        zoom_range=0.05,            # 縮放 ±5%
        shear_range=5.0,            # 剪切 ±5 度（模擬斜體）
        brightness_range=[0.85, 1.15],   # 亮度微調
        fill_mode="nearest",        # 邊界填充：複製最近像素
    )


def plot_training_history(
    history: keras.callbacks.History,
    save_path: Path,
) -> None:
    """繪製並儲存訓練過程的 accuracy / loss 曲線圖。"""
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
    fig.suptitle("THSRC Captcha CNN — 訓練歷程", fontsize=14)

    epochs = range(1, len(history.history["accuracy"]) + 1)

    # ── Accuracy 曲線 ────────────────────────────────────────────────────────
    ax1.plot(epochs, history.history["accuracy"],     "b-o", markersize=3, label="訓練集")
    ax1.plot(epochs, history.history["val_accuracy"], "r-o", markersize=3, label="驗證集")
    ax1.set_title("字元準確率 (Accuracy)")
    ax1.set_xlabel("Epoch")
    ax1.set_ylabel("Accuracy")
    ax1.legend()
    ax1.grid(True, alpha=0.3)
    ax1.set_ylim([0, 1.05])

    # ── Loss 曲線 ────────────────────────────────────────────────────────────
    ax2.plot(epochs, history.history["loss"],     "b-o", markersize=3, label="訓練集")
    ax2.plot(epochs, history.history["val_loss"], "r-o", markersize=3, label="驗證集")
    ax2.set_title("損失 (Loss)")
    ax2.set_xlabel("Epoch")
    ax2.set_ylabel("Loss")
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(save_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"[圖表] 訓練曲線已儲存至：{save_path}")


def evaluate_full_captcha_accuracy(
    img_dir: Path,
    labels_json: Path,
    model: keras.Model,
    test_stems: list[str],
) -> float:
    """
    計算整張驗證碼（全字串）的辨識準確率。
    （字元準確率高不代表全字串準確率高，因此兩者都要量）
    """
    with open(labels_json, encoding="utf-8") as f:
        all_labels: dict[str, str] = json.load(f)

    correct = 0
    total = 0

    for stem in test_stems:
        if stem not in all_labels:
            continue
        true_label = all_labels[stem].upper()

        img_path = img_dir / f"{stem}.jpg"
        if not img_path.exists():
            img_path = img_dir / f"{stem}.png"
        if not img_path.exists():
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue

        # 切割並逐字預測
        char_imgs = split_captcha(img, true_label)
        if char_imgs is None:
            binary = preprocess_image(img)
            char_imgs = split_chars_by_fixed_width(binary, len(true_label))

        pred_chars: list[str] = []
        for char_img in char_imgs:
            inp = char_img[np.newaxis, ..., np.newaxis].astype("float32")
            pred_probs = model.predict(inp, verbose=0)
            pred_idx = int(np.argmax(pred_probs[0]))
            pred_chars.append(IDX2CHAR[pred_idx])

        pred_label = "".join(pred_chars)
        if pred_label == true_label:
            correct += 1
        total += 1

    return correct / max(total, 1)


# ─── 6. 主訓練流程 ────────────────────────────────────────────────────────────

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
    """完整訓練流程入口。"""

    # 固定隨機種子，確保可重現
    random.seed(seed)
    np.random.seed(seed)
    tf.random.set_seed(seed)

    # ── 6.1 載入並切分資料集 ──────────────────────────────────────────────────
    X, y, _ = load_dataset(img_dir, labels_json)

    # 先切出測試集（15%），剩下再切訓練/驗證
    X_trainval, X_test, y_trainval, y_test = train_test_split(
        X, y,
        test_size=DEFAULT_TEST_SPLIT,
        stratify=y,         # 分層抽樣，確保各類別均勻
        random_state=seed,
    )
    X_train, X_val, y_train, y_val = train_test_split(
        X_trainval, y_trainval,
        test_size=DEFAULT_VALIDATION_SPLIT / (1 - DEFAULT_TEST_SPLIT),
        stratify=y_trainval,
        random_state=seed,
    )

    print(f"\n[資料切分]  訓練：{len(X_train)}  驗證：{len(X_val)}  測試：{len(X_test)}")

    # ── 6.2 建立模型 ──────────────────────────────────────────────────────────
    model = build_char_classifier()
    model.summary()

    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=learning_rate),
        loss="sparse_categorical_crossentropy",
        metrics=["accuracy"],
    )

    # ── 6.3 Callback 設定 ────────────────────────────────────────────────────
    callbacks: list[keras.callbacks.Callback] = [
        # 儲存驗證集準確率最高的模型
        keras.callbacks.ModelCheckpoint(
            filepath=str(model_keras_path),
            monitor="val_accuracy",
            save_best_only=True,
            verbose=1,
        ),
        # 驗證損失連續 12 epoch 未改善則提前停止
        keras.callbacks.EarlyStopping(
            monitor="val_loss",
            patience=12,
            restore_best_weights=True,
            verbose=1,
        ),
        # 學習率自動衰減（驗證損失停滯 5 epoch 後減半）
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=5,
            min_lr=1e-6,
            verbose=1,
        ),
        # 訓練進度 CSV 記錄（方便事後分析）
        keras.callbacks.CSVLogger(
            str(BASE_DIR / "training_log.csv"),
            append=False,
        ),
    ]

    # ── 6.4 資料增強 ─────────────────────────────────────────────────────────
    datagen = get_data_augmentation()

    print(f"\n[訓練開始] epochs={epochs}, batch_size={batch_size}, lr={learning_rate}")
    print(f"  模型將儲存至：{model_keras_path}")

    # ── 6.5 訓練 ─────────────────────────────────────────────────────────────
    history = model.fit(
        datagen.flow(X_train, y_train, batch_size=batch_size, seed=seed),
        steps_per_epoch=max(1, len(X_train) // batch_size),
        validation_data=(X_val, y_val),
        epochs=epochs,
        callbacks=callbacks,
        verbose=1,
    )

    # ── 6.6 繪製訓練曲線 ──────────────────────────────────────────────────────
    plot_training_history(history, history_png_path)

    # ── 6.7 評估 ─────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("測試集評估（字元層級）")
    print("=" * 60)
    test_loss, test_acc = model.evaluate(X_test, y_test, verbose=0)
    print(f"  字元準確率：{test_acc * 100:.2f}%  |  損失：{test_loss:.4f}")

    # 詳細分類報告
    y_pred = np.argmax(model.predict(X_test, verbose=0), axis=1)
    present_classes = sorted(set(y_test))
    target_names = [IDX2CHAR[i] for i in present_classes]
    print("\n字元分類詳細報告：")
    print(classification_report(
        y_test, y_pred,
        labels=present_classes,
        target_names=target_names,
        zero_division=0,
    ))

    # ── 6.8 儲存模型（同時存 .h5 與 .keras） ─────────────────────────────────
    model.save(str(model_h5_path))
    print(f"\n[模型] 已儲存 H5 格式：{model_h5_path}")
    # .keras 格式在 ModelCheckpoint 中已存；再明確確認一次
    if not model_keras_path.exists():
        model.save(str(model_keras_path))
    print(f"[模型] 已儲存 Keras 格式：{model_keras_path}")

    # ── 6.9 顯示常見混淆對 ───────────────────────────────────────────────────
    _report_confusion_pairs(y_test, y_pred, top_n=5)

    print("\n[訓練完成] 下一步：執行 python predict_captcha.py <圖片路徑> 測試辨識效果")


def _report_confusion_pairs(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    top_n: int = 5,
) -> None:
    """列出最常見的混淆字元對（如 '8' 被誤認為 'B'）。"""
    cm = confusion_matrix(y_true, y_pred)
    np.fill_diagonal(cm, 0)   # 排除正確預測

    # 取出前 top_n 個混淆對
    flat = cm.flatten()
    top_indices = np.argsort(flat)[::-1][:top_n]

    present_classes = sorted(set(y_true))
    idx_to_present = {i: present_classes[i] for i in range(len(present_classes))}

    print(f"\n[常見混淆對 Top-{top_n}]（真實 → 被誤認為 × 次）")
    for flat_idx in top_indices:
        if flat[flat_idx] == 0:
            break
        row_idx = flat_idx // cm.shape[1]
        col_idx = flat_idx % cm.shape[1]
        # row_idx / col_idx 是 cm 的索引，需對應回 present_classes
        if row_idx < len(present_classes) and col_idx < len(present_classes):
            true_char = IDX2CHAR[present_classes[row_idx]]
            pred_char = IDX2CHAR[present_classes[col_idx]]
            count = flat[flat_idx]
            print(f"  '{true_char}' → '{pred_char}'  ×{count}")


# ─── 7. CLI 介面 ──────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="台灣高鐵驗證碼 CNN 訓練腳本",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
範例：
  python train_captcha.py                         # 使用預設設定
  python train_captcha.py --epochs 200 --lr 5e-4  # 自訂超參數
  python train_captcha.py --colab                 # Google Colab 模式
        """,
    )
    parser.add_argument("--img-dir", default=str(DEFAULT_IMG_DIR),
                        help=f"驗證碼圖片資料夾（預設：{DEFAULT_IMG_DIR}）")
    parser.add_argument("--labels", default=str(DEFAULT_LABELS_JSON),
                        help=f"標注檔案路徑（預設：{DEFAULT_LABELS_JSON}）")
    parser.add_argument("--model-h5", default=str(DEFAULT_MODEL_H5),
                        help=f"輸出 .h5 模型路徑（預設：{DEFAULT_MODEL_H5}）")
    parser.add_argument("--model-keras", default=str(DEFAULT_MODEL_KERAS),
                        help=f"輸出 .keras 模型路徑（預設：{DEFAULT_MODEL_KERAS}）")
    parser.add_argument("--history-png", default=str(DEFAULT_HISTORY_PNG),
                        help=f"訓練曲線圖路徑（預設：{DEFAULT_HISTORY_PNG}）")
    parser.add_argument("--epochs", type=int, default=DEFAULT_EPOCHS,
                        help=f"最大訓練 epoch 數（預設：{DEFAULT_EPOCHS}）")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE,
                        help=f"batch 大小（預設：{DEFAULT_BATCH_SIZE}）")
    parser.add_argument("--lr", type=float, default=DEFAULT_LR,
                        help=f"初始學習率（預設：{DEFAULT_LR}）")
    parser.add_argument("--seed", type=int, default=42,
                        help="隨機種子（預設：42）")
    parser.add_argument("--colab", action="store_true",
                        help="Google Colab 模式（從 Google Drive 讀取）")

    args = parser.parse_args()

    # ── Google Colab 路徑覆蓋 ──────────────────────────────────────────────────
    if args.colab:
        try:
            from google.colab import drive  # type: ignore
            drive.mount("/content/drive", force_remount=False)
            colab_base = Path("/content/drive/MyDrive/thsrc_captcha")
            print(f"[Colab] 使用 Google Drive 路徑：{colab_base}")
            args.img_dir    = str(colab_base / "captcha_images")
            args.labels     = str(colab_base / "labels.json")
            args.model_h5   = str(colab_base / "models" / "captcha_model.h5")
            args.model_keras = str(colab_base / "models" / "captcha_model.keras")
            args.history_png = str(colab_base / "models" / "training_history.png")
            Path(args.model_h5).parent.mkdir(parents=True, exist_ok=True)
        except ImportError:
            print("[警告] --colab 參數僅在 Google Colab 環境中有效，忽略此參數")

    # ── 路徑驗證 ──────────────────────────────────────────────────────────────
    img_dir = Path(args.img_dir)
    labels_json = Path(args.labels)

    if not img_dir.exists():
        print(f"[錯誤] 找不到圖片資料夾：{img_dir}", file=sys.stderr)
        print("請先執行 scrape_captcha.py 下載驗證碼圖片")
        sys.exit(1)

    if not labels_json.exists():
        print(f"[錯誤] 找不到標注檔案：{labels_json}", file=sys.stderr)
        print("請先執行 label_captcha.py 進行人工標注")
        sys.exit(1)

    # ── 顯示 GPU 資訊 ─────────────────────────────────────────────────────────
    gpus = tf.config.list_physical_devices("GPU")
    if gpus:
        print(f"[GPU] 偵測到 {len(gpus)} 個 GPU：{[g.name for g in gpus]}")
        # 允許動態增長顯存，避免佔用全部 VRAM
        for gpu in gpus:
            tf.config.experimental.set_memory_growth(gpu, True)
    else:
        print("[GPU] 未偵測到 GPU，使用 CPU 訓練（速度較慢）")

    # ── 開始訓練 ──────────────────────────────────────────────────────────────
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
