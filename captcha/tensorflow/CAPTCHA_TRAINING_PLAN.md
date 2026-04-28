# THSRC 驗證碼辨識模型訓練計畫

> 目標：以 Google Colab + TensorFlow 訓練一個能自動辨識台灣高鐵（THSRC）驗證碼的模型，並整合回自動訂票流程。

---

## 0. 背景說明

`scrape_captcha.py` 會從 `https://irs.thsrc.com.tw/IMINT/CheckCode.jsp` 爬取驗證碼圖片，儲存至 `captcha_images/`（共 500 張，命名格式 `captcha_001.jpg` ～ `captcha_500.jpg`）。

高鐵驗證碼特性（爬取後需進一步確認）：
- **字元種類**：通常為英文大寫字母（A–Z）與數字（0–9）的混合，部分驗證碼會排除易混淆字元（如 O/0、I/1/l）。
- **字串長度**：通常為 4～5 個字元。
- **圖片尺寸**：約 100×40 px，背景有雜訊干擾線。

---

## 第一階段：資料準備

### 1.1 上傳圖片至 Google Drive

在本機整理好 `captcha_images/` 資料夾後，上傳至 Google Drive 供 Colab 存取。

```bash
# 本機壓縮後上傳（加速傳輸）
cd ~/projects/nodejs/thsrc
zip -r captcha_images.zip captcha_images/
# 手動拖曳至 Google Drive，或使用 rclone：
# rclone copy captcha_images.zip gdrive:thsrc_captcha/
```

建議在 Google Drive 建立如下目錄結構：

```
MyDrive/
└── thsrc_captcha/
    ├── captcha_images/        ← 原始 500 張圖片
    ├── labeled/               ← 標註後的資料
    │   ├── train/
    │   ├── val/
    │   └── test/
    └── models/                ← 訓練完成的模型
```

### 1.2 分析驗證碼特性

在 Colab 中執行以下分析，確認實際圖片規格：

```python
import cv2
import numpy as np
from pathlib import Path
from google.colab import drive

drive.mount('/content/drive')
IMG_DIR = Path('/content/drive/MyDrive/thsrc_captcha/captcha_images')

# 讀取所有圖片，分析尺寸與色彩分布
sizes = []
for p in sorted(IMG_DIR.glob('*.jpg'))[:20]:   # 先看前 20 張
    img = cv2.imread(str(p))
    sizes.append(img.shape)
    print(p.name, img.shape)

# 顯示樣本
import matplotlib.pyplot as plt
fig, axes = plt.subplots(2, 5, figsize=(15, 6))
for ax, p in zip(axes.flat, sorted(IMG_DIR.glob('*.jpg'))[:10]):
    ax.imshow(cv2.cvtColor(cv2.imread(str(p)), cv2.COLOR_BGR2RGB))
    ax.set_title(p.name)
    ax.axis('off')
plt.tight_layout()
plt.show()
```

**目的**：確認字元數量、字型風格、雜訊類型（干擾線 / 扭曲 / 斑點），以決定後續前處理強度。

### 1.3 圖片前處理

每張圖片在送入模型前需做標準化處理：

```python
def preprocess(img_path, target_size=(200, 60)):
    img = cv2.imread(str(img_path))
    # 1. 灰階化
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 2. 去雜訊（中值濾波器對椒鹽雜訊效果好）
    denoised = cv2.medianBlur(gray, 3)
    # 3. 二值化（Otsu 自動閾值）
    _, binary = cv2.threshold(denoised, 0, 255,
                               cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    # 4. 形態學操作去除干擾線
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 3))
    cleaned = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    # 5. 統一尺寸
    resized = cv2.resize(cleaned, target_size)
    return resized
```

若字元排列緊密，可嘗試**連通分量分析（Connected Components）**切割單字元，每個字元單獨辨識。

### 1.4 資料標註方式

500 張圖片需人工標注答案。建議策略：

**半自動輔助標注流程**：

1. 先用一個粗糙的啟發式規則（如 OCR tesseract）做初步猜測，降低人工負擔。
2. 建立一個簡單的本機標注小工具，顯示圖片讓人輸入答案：

```python
# 簡易本機標注腳本（在本機執行，非 Colab）
import cv2, json
from pathlib import Path

img_dir = Path('captcha_images')
labels = {}

for p in sorted(img_dir.glob('*.jpg')):
    img = cv2.imread(str(p))
    cv2.imshow('captcha', cv2.resize(img, (300, 120)))
    cv2.waitKey(100)
    label = input(f'{p.name} → ').strip().upper()
    if label:
        labels[p.stem] = label

cv2.destroyAllWindows()
with open('labels.json', 'w') as f:
    json.dump(labels, f, indent=2)
```

3. 標注完畢後將 `labels.json` 一起上傳至 Google Drive。

**注意**：500 張標注大約需 1～2 小時。若想擴充資料集，可用訓練好的初始模型做**主動學習（active learning）**——先跑模型預測，只對低信心樣本做人工確認。

### 1.5 資料集切分

```python
import json, shutil, random
from pathlib import Path

with open('labels.json') as f:
    labels = json.load(f)

items = list(labels.items())
random.seed(42)
random.shuffle(items)

n = len(items)
train_items = items[:int(n * 0.7)]   # 70% 訓練
val_items   = items[int(n * 0.7):int(n * 0.85)]  # 15% 驗證
test_items  = items[int(n * 0.85):]  # 15% 測試

for split_name, split_items in [('train', train_items),
                                  ('val', val_items),
                                  ('test', test_items)]:
    split_labels = dict(split_items)
    with open(f'labeled/{split_name}/labels.json', 'w') as f:
        json.dump(split_labels, f)
    for stem, _ in split_items:
        shutil.copy(f'captcha_images/{stem}.jpg',
                    f'labeled/{split_name}/{stem}.jpg')
```

---

## 第二階段：Colab 環境設定

### 2.1 掛載 Google Drive

```python
from google.colab import drive
drive.mount('/content/drive')

BASE_DIR = '/content/drive/MyDrive/thsrc_captcha'
```

### 2.2 安裝必要套件

Colab 預裝了 TensorFlow 與 OpenCV，通常只需確認版本或補裝少數工具：

```python
# 確認 TensorFlow 版本
import tensorflow as tf
print(tf.__version__)   # 建議 2.12+

# 補裝（若需要）
!pip install -q opencv-python-headless matplotlib scikit-learn
```

### 2.3 確認 GPU 啟用

在 Colab 選單 **執行階段 → 變更執行階段類型 → 硬體加速器 → GPU（T4）**，接著確認：

```python
import tensorflow as tf
gpus = tf.config.list_physical_devices('GPU')
print('GPU 清單：', gpus)
# 應顯示類似 [PhysicalDevice(name='/physical_device:GPU:0', device_type='GPU')]
```

---

## 第三階段：模型架構選擇

### 3.1 兩種主要方案比較

| 方案 | 做法 | 優點 | 缺點 |
|------|------|------|------|
| **A：整圖 CNN + CTC Loss** | 輸入整張圖，以 CTC 解碼輸出字串 | 不需手動切割字元；對字元重疊仍可處理 | 資料量需求較大（建議 2000 張以上）；CTC 除錯難度高 |
| **B：切割單字元 + CNN 分類器** | 先切割每個字元，再分別辨識 | 實作簡單；500 張資料即可訓練；準確率容易提升 | 切割品質影響整體準確率；需額外的分割邏輯 |

**建議**：以現有 500 張資料量，先採用**方案 B（切割 + 分類器）**，確認可行後若要提升魯棒性再轉換至方案 A。

### 3.2 建議架構（方案 B：CNN 字元分類器）

每個字元圖片尺寸約 30×40 px，類別數約 32（A–Z 去掉易混淆字，加 0–9）。

```python
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

def build_char_classifier(num_classes=36, input_shape=(40, 30, 1)):
    model = keras.Sequential([
        layers.Input(shape=input_shape),
        # Block 1
        layers.Conv2D(32, (3, 3), activation='relu', padding='same'),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        # Block 2
        layers.Conv2D(64, (3, 3), activation='relu', padding='same'),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        # Block 3
        layers.Conv2D(128, (3, 3), activation='relu', padding='same'),
        layers.BatchNormalization(),
        layers.MaxPooling2D((2, 2)),
        # 全連接層
        layers.Flatten(),
        layers.Dense(256, activation='relu'),
        layers.Dropout(0.4),
        layers.Dense(num_classes, activation='softmax'),
    ])
    return model

model = build_char_classifier()
model.summary()
```

**為何選擇此架構**：
- 3 層 Conv + BN + Pool 對小尺寸字元圖片已足夠；參數量約 500K，不易 overfitting。
- BatchNormalization 加速收斂、提升穩定性。
- Dropout(0.4) 防止過擬合（資料量少的情況下特別重要）。

---

## 第四階段：訓練流程

### 4.1 資料增強策略

```python
from tensorflow.keras.preprocessing.image import ImageDataGenerator

# 字元辨識的增強不宜過度（避免旋轉太大造成 6 看起來像 9）
datagen = ImageDataGenerator(
    rotation_range=8,          # ±8 度旋轉
    width_shift_range=0.1,     # 水平位移 10%
    height_shift_range=0.1,    # 垂直位移 10%
    zoom_range=0.05,           # 縮放 ±5%
    shear_range=5,             # 剪切 ±5 度
    brightness_range=[0.8, 1.2],
    fill_mode='nearest',
)
```

### 4.2 資料載入與模型訓練

```python
import numpy as np
import json
from pathlib import Path

# 字元集（依實際驗證碼調整）
CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'  # 去除 I、O
char2idx = {c: i for i, c in enumerate(CHARS)}

def load_char_dataset(split_dir):
    """載入切割後的單字元圖片與標籤"""
    X, y = [], []
    label_path = Path(split_dir) / 'labels.json'
    with open(label_path) as f:
        labels = json.load(f)
    for stem, text in labels.items():
        img_path = Path(split_dir) / f'{stem}.jpg'
        img = cv2.imread(str(img_path), cv2.IMREAD_GRAYSCALE)
        img = cv2.resize(img, (30, 40)) / 255.0
        X.append(img[..., np.newaxis])
        # 若是整張驗證碼的標籤，需先切割字元後再加入
        # 此處假設已切割為單字元圖片
        y.append(char2idx[text[0]])
    return np.array(X), np.array(y)

X_train, y_train = load_char_dataset(f'{BASE_DIR}/labeled/train')
X_val,   y_val   = load_char_dataset(f'{BASE_DIR}/labeled/val')

# 編譯模型
model.compile(
    optimizer=keras.optimizers.Adam(learning_rate=1e-3),
    loss='sparse_categorical_crossentropy',
    metrics=['accuracy'],
)

# 回呼函數
callbacks = [
    keras.callbacks.ModelCheckpoint(
        f'{BASE_DIR}/models/best_model.keras',
        monitor='val_accuracy', save_best_only=True, verbose=1,
    ),
    keras.callbacks.EarlyStopping(
        monitor='val_loss', patience=10, restore_best_weights=True,
    ),
    keras.callbacks.ReduceLROnPlateau(
        monitor='val_loss', factor=0.5, patience=5, min_lr=1e-6, verbose=1,
    ),
]

# 訓練
history = model.fit(
    datagen.flow(X_train, y_train, batch_size=32),
    validation_data=(X_val, y_val),
    epochs=100,
    callbacks=callbacks,
)
```

### 4.3 訓練參數總覽

| 參數 | 建議值 | 說明 |
|------|--------|------|
| `batch_size` | 32 | 資料量少時不宜過大 |
| `epochs` | 最多 100（EarlyStopping 控制） | 避免 overfitting |
| `learning_rate` | 1e-3（初始），ReduceLROnPlateau 自動調降 | Adam 優化器 |
| `dropout` | 0.4 | 防止 overfitting |

---

## 第五階段：評估與測試

### 5.1 準確率指標

```python
from sklearn.metrics import confusion_matrix, classification_report
import seaborn as sns

# 字元準確率（Character Accuracy）
y_pred_probs = model.predict(X_test)
y_pred = np.argmax(y_pred_probs, axis=1)
char_acc = np.mean(y_pred == y_test)
print(f'字元準確率：{char_acc:.4f}')

# 全字串準確率需在完整驗證碼層級計算
# 假設驗證碼長度固定為 4，每張圖切出 4 個字元
def captcha_accuracy(imgs_labels):
    correct = 0
    for img, true_label in imgs_labels:
        chars = split_captcha(img)     # 切割函數
        pred = ''.join(
            CHARS[np.argmax(model.predict(c[np.newaxis]))]
            for c in chars
        )
        if pred == true_label:
            correct += 1
    return correct / len(imgs_labels)

print(f'全字串準確率：{captcha_accuracy(test_pairs):.4f}')
```

**目標**：字元準確率 > 95%，全字串準確率 > 80%。

### 5.2 Confusion Matrix 分析

```python
idx2char = {i: c for c, i in char2idx.items()}
labels_str = [idx2char[i] for i in range(len(CHARS))]

cm = confusion_matrix(y_test, y_pred)
plt.figure(figsize=(14, 12))
sns.heatmap(cm, annot=True, fmt='d', xticklabels=labels_str,
            yticklabels=labels_str, cmap='Blues')
plt.title('字元辨識 Confusion Matrix')
plt.ylabel('真實標籤')
plt.xlabel('預測標籤')
plt.tight_layout()
plt.savefig(f'{BASE_DIR}/models/confusion_matrix.png', dpi=150)
plt.show()

# 詳細分類報告
print(classification_report(y_test, y_pred, target_names=labels_str))
```

Confusion Matrix 有助於找出常見錯誤對（如 `8`↔`B`、`0`↔`O`），可針對性蒐集這些字元的圖片補充訓練。

### 5.3 測試集最終驗證

在測試集上執行完整推論，確保測試集從未參與訓練或調參過程，以得到真實的泛化性能估計。

```python
test_loss, test_acc = model.evaluate(X_test, y_test, verbose=0)
print(f'測試集損失：{test_loss:.4f}  |  測試集字元準確率：{test_acc:.4f}')
```

---

## 第六階段：匯出與整合

### 6.1 匯出模型

```python
# 儲存為 SavedModel 格式（推薦，支援 TF Serving 與 TFLite 轉換）
model.save(f'{BASE_DIR}/models/captcha_model_savedmodel')

# 同時匯出 TFLite（方便部署至輕量環境）
converter = tf.lite.TFLiteConverter.from_saved_model(
    f'{BASE_DIR}/models/captcha_model_savedmodel'
)
converter.optimizations = [tf.lite.Optimize.DEFAULT]   # 量化壓縮
tflite_model = converter.convert()

with open(f'{BASE_DIR}/models/captcha_model.tflite', 'wb') as f:
    f.write(tflite_model)
print('TFLite 模型已匯出')
```

### 6.2 整合回 Node.js 專案（呼叫 Python 子程序）

在 GAS 後端觸發 captcha email 後，使用者點擊連結到 `ui/captcha.html`；若要**自動辨識**，可在本機或伺服器端另起一個 Python 辨識服務。

**方案：HTTP 微服務**

```python
# captcha_solver_server.py（本機或輕量伺服器執行）
from flask import Flask, request, jsonify
import tensorflow as tf
import numpy as np
import cv2, base64

app = Flask(__name__)
model = tf.saved_model.load('models/captcha_model_savedmodel')
CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'

def solve(img_bytes):
    nparr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    # 前處理 + 切割字元（同訓練時的 preprocess 與 split_captcha）
    chars = split_and_preprocess(img)
    result = ''
    for c in chars:
        inp = c[np.newaxis, ..., np.newaxis].astype('float32') / 255.0
        pred = model(inp)
        result += CHARS[np.argmax(pred)]
    return result

@app.route('/solve', methods=['POST'])
def solve_route():
    data = request.json['image']   # base64 編碼的圖片
    img_bytes = base64.b64decode(data)
    answer = solve(img_bytes)
    return jsonify({'answer': answer})

if __name__ == '__main__':
    app.run(port=5001)
```

**在 GAS `BookingEngine.gs` 中呼叫（需外部 relay，因 GAS 只能呼叫公開 HTTPS）**：

若要從 GAS 呼叫，需將 Python 服務部署至公開端點（如 Cloud Run、Railway），或改用 **TensorFlow.js** 在瀏覽器端直接辨識。

**方案：TensorFlow.js（瀏覽器端）**

```bash
# 轉換 SavedModel 為 TFJS 格式
pip install tensorflowjs
tensorflowjs_converter \
  --input_format=tf_saved_model \
  models/captcha_model_savedmodel \
  ui/js/captcha_model_tfjs/
```

```javascript
// ui/js/captcha.js — 在 captcha.html 中載入 TFJS 模型自動填入
import * as tf from '@tensorflow/tfjs';

const CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
let model;

async function loadModel() {
  model = await tf.loadGraphModel('/js/captcha_model_tfjs/model.json');
}

async function solveCaptcha(imgElement) {
  const tensor = tf.browser.fromPixels(imgElement, 1)
    .resizeBilinear([40, 30])
    .toFloat()
    .div(255.0)
    .expandDims(0);
  // 分割字元、逐字預測（對應訓練時的切割邏輯）
  const pred = model.predict(tensor);
  const idx = pred.argMax(-1).dataSync()[0];
  return CHARS[idx];
}
```

### 6.3 自動填入驗證碼流程

整合後的完整流程如下：

```
GAS runBooking()
  ↓ 取得驗證碼圖片 URL
  ↓ 發送 email（含圖片與 captcha.html 連結）
captcha.html 開啟
  ↓ 載入 TFJS 模型
  ↓ 自動辨識驗證碼並填入輸入框（使用者可手動修正）
  ↓ 按下「送出」→ 呼叫 GAS submitCaptcha(bookingId, answer)
GAS continueBookingWithCaptcha()
  ↓ 完成訂位
```

---

## 第七階段：預估時間與資源

### 7.1 各階段預估工時

| 階段 | 工作項目 | 預估工時 |
|------|----------|----------|
| 資料準備 | 執行爬蟲取得 500 張 | 30 分鐘（含等待） |
| 資料準備 | 圖片前處理腳本撰寫 | 2 小時 |
| 資料準備 | 人工標注 500 張 | 1.5～2.5 小時 |
| 資料準備 | 資料集切分與上傳 | 30 分鐘 |
| Colab 設定 | 環境確認、Drive 掛載 | 15 分鐘 |
| 模型訓練 | 初次訓練 + 調參（2～3 輪） | 1～2 小時 |
| 評估 | Confusion matrix 分析 + 補強資料 | 1 小時 |
| 匯出整合 | TFJS 轉換 + captcha.html 整合 | 2～3 小時 |
| **總計** | | **約 8～12 小時** |

### 7.2 Colab 免費版 vs. Pro 分析

| 項目 | 免費版 | Pro（~$10/月） |
|------|--------|----------------|
| GPU 類型 | T4（隨機分配，可能得到 CPU） | T4 / A100 優先 |
| 連線時長限制 | ~12 小時（斷線需重連） | ~24 小時 |
| RAM | 12 GB | 25 GB |
| 訓練本專案 CNN 的時間 | 約 10～20 分鐘/100 epoch | 約 5～10 分鐘/100 epoch |
| **建議** | 500 張資料量用免費版即足夠 | 若擴充至 5000+ 張再考慮升級 |

**結論**：本專案資料量小（500 張），Colab **免費版 + T4 GPU 完全足夠**，整個訓練流程預計 15～20 分鐘內完成。

---

## 附錄：建議擴充方向

若初始模型全字串準確率不理想（< 80%），可嘗試以下方向提升：

1. **擴充資料集**：執行 `scrape_captcha.py` 蒐集更多圖片（建議 2000 張以上），配合主動學習減少標注工時。
2. **採用預訓練模型**：使用 MobileNetV2 或 EfficientNetB0 作為 backbone，以 transfer learning 加速收斂。
3. **切換至 CNN + CTC 方案**：對整張驗證碼圖片做序列辨識，不需依賴切割品質。
4. **資料合成**：用 Python Pillow 生成合成驗證碼（字型、雜訊、背景），大量擴充訓練集，再用真實圖片 fine-tune。
