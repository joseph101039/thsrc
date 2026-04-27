# THSRC Captcha Solver

台灣高鐵訂票驗證碼自動辨識模組。  
流程：抓圖 → 人工標注 → 訓練 CNN → 推論。

## 環境設定

```bash
python3 -m venv venv
source venv/bin/activate
pip3 install tensorflow opencv-python matplotlib scikit-learn numpy selenium flask
```

之後每次進入工作環境：

```bash
source venv/bin/activate
```

---

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `scrape_captcha.py` | 用真實 Chrome（Selenium）從高鐵訂票頁批次截圖，儲存至 `captcha_images/` |
| `label_captcha.py` | 人工標注工具：用 OpenCV 視窗顯示圖片，逐張輸入文字，存至 `labels.json` |
| `train_captcha.py` | CNN 訓練腳本：讀取 `labels.json` → 前處理 → 訓練 → 輸出 `captcha_model.h5` |
| `predict_captcha.py` | 推論腳本：載入訓練好的模型，辨識單張 / 批次 / base64 圖片，或啟動 Flask 服務 |
| `labels.json` | 驗證碼標注資料（`{"captcha_001": "AB12", ...}`） |
| `captcha_images/` | 原始驗證碼圖片目錄 |
| `captcha_model.h5` | 訓練完成的模型（訓練後產生） |

---

## 執行方法

### 1. 抓取圖片

```bash
python3 scrape_captcha.py
# 預設抓 500 張，儲存至 captcha_images/captcha_001.png …
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
python3 train_captcha.py --epochs 150

# 在 Google Colab 執行
python3 train_captcha.py --colab
```

訓練完成後輸出 `captcha_model.h5` 和 `training_history.png`。

### 4. 推論

```bash
# 辨識單張圖片
python3 predict_captcha.py captcha_images/captcha_001.png

# 批次辨識整個資料夾
python3 predict_captcha.py --batch captcha_images/

# 辨識 base64 字串
python3 predict_captcha.py --base64 "<base64 字串>"

# 啟動 Flask HTTP 服務（供 GAS 後端呼叫）
python3 predict_captcha.py --server
```
