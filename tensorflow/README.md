# THSRC Captcha Solver

台灣高鐵訂票驗證碼自動辨識模組。
流程：抓圖 → 人工標注 → 訓練 CRNN → CTC 推論。

## 環境設定

python 3.9

```bash
python3 -m venv venv
source .venv/bin/activate
pip3 install -r requirements.txt
```

之後每次進入工作環境：

```bash
source .venv/bin/activate
```

---

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `scrape_captcha.py` | 用真實 Chrome（Selenium）從高鐵訂票頁批次截圖，儲存至 `captcha_images/` |
| `label_captcha.py` | 人工標注工具：用 OpenCV 視窗顯示圖片，逐張輸入文字，存至 `labels.json` |
| `train_captcha.py` | CRNN + CTC 訓練腳本：讀取 `labels.json` → 整張圖前處理 → 訓練 → 輸出 `captcha_model.keras` |
| `predict_captcha.py` | 推論腳本：載入訓練好的模型，CTC 解碼，支援單張 / 批次 / base64 / Flask 服務 |
| `labels.json` | 驗證碼標注資料（`{"captcha_001": "ABCD", ...}`） |
| `captcha_images/` | 原始驗證碼圖片目錄 |
| `captcha_model.keras` | 訓練完成的模型（含完整 CRNN + CTC 架構） |
| `captcha_model.h5` | 同模型的 H5 格式（僅含權重，可重建用） |
| `training_log.csv` | 每個 epoch 的 loss、val_loss、val_char_acc、val_str_acc |
| `training_history.png` | 訓練曲線視覺化 |

---

## 執行方法

### 1. 抓取圖片

```bash
python3 scrape_captcha.py
# 預設抓 100 張，儲存至 captcha_images/captcha_001.png …
```

### 2. 人工標注 / Review

```bash
# 從頭標注
python3 label_captcha.py

# 從第 101 張開始
python3 label_captcha.py --start 100

# 只看標注進度
python3 label_captcha.py --stats
```

**操作說明：**
- 已有預標注的圖片會顯示 `[ABCD]`，直接 Enter 確認，輸入新值才覆蓋
- 未標注的圖片直接 Enter 跳過
- 輸入 `q` 儲存並退出
- 輸入 `d` 刪除前一筆標注

### 3. 訓練模型

```bash
python3 train_captcha.py

# 指定最多 epoch 數
python3 train_captcha.py --epochs 300

# 在 Google Colab 執行
python3 train_captcha.py --colab
```

訓練完成後輸出 `captcha_model.keras`、`captcha_model.h5` 與 `training_history.png`。

#### 模型架構（CRNN + CTC）

CNN 特徵萃取 → BiLSTM 序列建模 → CTC 解碼，這是 OCR 與 captcha 辨識的標準架構。
不同於分類器路線，CRNN+CTC **不需切字元**，模型自動學習對齊，能處理粘連、扭曲、重疊。

**輸入**：整張驗證碼灰階圖 `50 × 160 × 1`（normalized to [0,1]，無二值化）
**字元集**：`0-9A-Z` 去除易混 `I`、`O`，共 34 類；CTC 額外 +1 個 blank 共 35 類
**輸出**：`(T=40, 35)` softmax 序列，CTC 貪婪解碼成 4 字元字串

| 層 | 輸出形狀 | 說明 |
|----|----------|------|
| Conv2D(64) + BN + ReLU + MaxPool | 25×80×64 | 邊緣 / 筆畫起點 |
| Conv2D(128) + BN + ReLU + MaxPool | 12×40×128 | 筆畫組合 |
| Conv2D(256)×2 + BN + ReLU + MaxPool(2,1) | 6×40×256 | 字元局部結構（只壓高、保時間步） |
| Conv2D(512)×2 + BN + ReLU + MaxPool(2,1) | 3×40×512 | 字元整體形狀 |
| Conv2D(512) + BN + ReLU + MaxPool(3,1) | 1×40×512 | 把高度壓到 1 |
| Reshape | 40×512 | 轉序列：每個寬度位置一個時間步 |
| BiLSTM(128) ×2，dropout 0.25 | 40×256 | 學習字元間順序與依賴 |
| Dense(35, softmax) | 40×35 | 每個時間步的字元 + blank 機率 |

約 7.9M 參數。

#### 資料切分

| 子集 | 比例 |
|------|------|
| 訓練集 | 80% |
| 驗證集 | 10% |
| 測試集 | 10% |

#### 訓練超參數（預設值）

| 參數 | 值 |
|------|----|
| epochs | 200（EarlyStopping monitor=`val_str_acc`, patience=30）|
| batch size | 16 |
| learning rate | 1e-3（ReduceLROnPlateau factor=0.5, patience=10, min=1e-6）|
| optimizer | Adam，clipnorm=5.0（防 RNN 梯度爆炸）|
| loss | CTC（`keras.backend.ctc_batch_cost`） |
| 資料增強 | 旋轉 ±5°、平移 ±5%、縮放 ±3%、亮度 ±10% |

訓練暖機需 ~9 epoch（CTC loss 從 ln(35)×4 ≈ 14 開始下降），之後快速收斂。
每個 epoch 結束會印 `val_char_acc` 與 `val_str_acc`，並寫入 `training_log.csv`。

#### 目前實測準確率

690 張標注、無 IO 字元、Adam 1e-3：

| 指標 | 數值 |
|------|------|
| Test char accuracy | **98.91%** |
| Test string accuracy | **97.10%** |
| 全資料集 char accuracy | 99.13% |
| 全資料集 string accuracy | 96.67% |

> 字串準確率 ≥ 99% 通常需要 1500+ 張標注。實務上可搭配「驗證碼錯就重新請求」機制，
> 第一次成功率 97% 等價於兩次內 99.92% 成功率，已達實用級。

### 4. 推論

```bash
# 辨識單張圖片
python3 predict_captcha.py captcha_images/captcha_001.png

# 批次辨識整個資料夾
python3 predict_captcha.py --batch captcha_images/

# 批次並比對 labels.json 計算準確率
python3 predict_captcha.py --batch captcha_images/ --labels labels.json

# 辨識 base64 字串
python3 predict_captcha.py --base64 "<base64 字串>"

# JSON 輸出（方便程式解析）
python3 predict_captcha.py captcha_001.png --json

# 啟動 Flask HTTP 服務（供 GAS 後端呼叫）
python3 predict_captcha.py --server --port 5001
```

#### HTTP API

啟動 `--server` 後可透過以下端點辨識：

| Method | Endpoint | Body | 回應 |
|--------|----------|------|------|
| POST | `/solve` | `{"image": "<base64>"}` | `{"answer": "ABCD", "confidence": [0.99, ...]}` |
| POST | `/solve_url` | `{"url": "<image url>"}` | 同上 |
| GET | `/health` | — | `{"status": "ok"}` |
