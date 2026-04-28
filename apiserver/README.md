# THSRC Captcha Solver — Web API

FastAPI server that runs the CRNN+CTC captcha model and exposes a REST API.
部署方式：**GCP Compute Engine e2-micro**（永久免費）。

## Structure

```
apiserver/
├── main.py              FastAPI application（TFLite inference）
├── requirements.txt     Python dependencies (tflite-runtime, fastapi, uvicorn, opencv-headless)
├── Dockerfile           Container image definition（linux/amd64，python:3.11-slim）
├── .dockerignore
└── deploy-gce.sh        GCP Compute Engine（免費方案）部署腳本
```

## Local development

```bash
# 1. Convert and copy TFLite model
python3 ../tensorflow/convert_to_tflite.py   # outputs tensorflow/captcha_model.tflite
cp ../tensorflow/captcha_model.tflite .

# 2. Create venv and install deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Run server
MODEL_PATH=captcha_model.tflite uvicorn main:app --reload --port 8080
```

> 注意：`tflite-runtime` 沒有 macOS arm64 wheel。本機測試可改用 `tensorflow-cpu==2.18.0` 並將 `requirements.txt` 中的 `tflite-runtime` 替換，或直接用 Docker 執行：
> ```bash
> docker build -t captcha-solver . && docker run -p 8080:8080 captcha-solver
> ```

Swagger UI: http://localhost:8080/docs  
ReDoc:       http://localhost:8080/redoc

## API endpoints

| Method | Path | Input | Description |
|--------|------|-------|-------------|
| GET | `/health` | — | Service status + model metadata |
| POST | `/solve` | JSON `{"image": "<base64>"}` | Solve from base64 image |
| POST | `/solve/upload` | multipart `file` | Solve from file upload |
| POST | `/solve/url` | JSON `{"url": "..."}` | Solve from public image URL |

**Response** (all `/solve*`):
```json
{
  "answer": "A3KZ",
  "confidence": [0.999, 0.987, 0.951, 1.0],
  "elapsed_ms": 42.3
}
```

### Quick test with curl

```bash
BASE_URL=http://35.212.154.47:8080   # 或 http://localhost:8080 本機測試

# Health check
curl ${BASE_URL}/health

# Upload file
curl -X POST ${BASE_URL}/solve/upload -F file=@captcha.png

# Base64
B64=$(base64 -i captcha.png)
curl -X POST ${BASE_URL}/solve \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"${B64}\"}"

# URL (server fetches it)
curl -X POST ${BASE_URL}/solve/url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://irs.thsrc.com.tw/IMINT/?action=homeCaptcha"}'
```

## Deploy to GCP Compute Engine（免費方案）

GCP e2-micro（us-west1）每月免費，適合低流量、永遠線上的場景。
架構：Docker Hub 存 image → VM 跑 container → Watchtower 每 5 分鐘自動更新。

**目前線上端點：`http://35.212.154.47:8080`**

### 前置條件

- Docker（本機，用於 buildx cross-compile）
- Docker Hub 帳號（`joseph50804`）
- GCP VM 已建立並安裝 Docker（見下方 VM 初始化）

### 一鍵部署

```bash
cd apiserver

# 將最新 TFLite model 打包進 image 並推送到 Docker Hub
DOCKERHUB_USER=joseph50804 ./deploy-gce.sh
```

`deploy-gce.sh` 的動作：
1. 從 `tensorflow/captcha_model.tflite` 複製 model 到 `apiserver/`
2. 以 `docker buildx build --platform linux/amd64` 建構並推送 `joseph50804/captcha-solver:latest`
3. Watchtower 在 5 分鐘內偵測到新 image 並自動重啟容器（無需 SSH 進 VM）

### GCP VM 初始化（一次性設定）

在 GCP Console 建立 VM 後，SSH 進去執行：

```bash
# 安裝 Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# 啟動 API 容器（port 8080）
docker run -d \
  --name captcha-solver \
  --restart unless-stopped \
  -p 8080:8080 \
  joseph50804/captcha-solver:latest

# 啟動 Watchtower（每 300 秒檢查 Docker Hub 是否有新 image）
docker run -d \
  --name watchtower \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock \
  containrrr/watchtower \
  --interval 300 \
  captcha-solver
```

### GCP 防火牆設定

在 GCP Console → VPC network → Firewall 新增規則：

| 欄位 | 值 |
|------|----|
| Name | `allow-captcha-8080` |
| Direction | Ingress |
| Targets | Specified target tags → `captcha-solver` |
| Source IP ranges | `0.0.0.0/0` |
| Protocols and ports | TCP 8080 |

VM 的 Network tag 設為 `captcha-solver`。

### 驗證部署

```bash
# Health check
curl http://35.212.154.47:8080/health

# 上傳圖片測試
curl -X POST http://35.212.154.47:8080/solve/upload -F file=@captcha.png
```

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `captcha_model.tflite` | TFLite 模型路徑 |
| `PORT` | `8080` | 伺服器監聽 port |

## Calling from Google Apps Script (GAS)

```javascript
function solveCaptcha(base64Image) {
  const url = 'http://35.212.154.47:8080/solve';  // GCE 免費方案端點
  const resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ image: base64Image }),
    muteHttpExceptions: true,
  });
  const data = JSON.parse(resp.getContentText());
  return data.answer;   // e.g. "A3KZ"
}
```

## Model accuracy

基於 1027 張人工標注圖片（TFLite 模型）：

| Metric | Value |
|--------|-------|
| Char accuracy | **99.75%** |
| String accuracy | **99.12%** |

Architecture: CNN × 5 blocks → Reshape → BiLSTM × 2 → CTC decode.  
See `../tensorflow/README.md` for full training details.

## Memory usage

切換到 TFLite（`tflite-runtime`）後記憶體大幅降低：

| 版本 | 記憶體佔用 |
|------|-----------|
| `tensorflow-cpu` + `.keras` | ~550–650 MB per worker |
| `tflite-runtime` + `.tflite` | **~88 MB per worker**（實測） |

GCE e2-micro 有 952 MB RAM，TFLite 版綽綽有餘（剩餘 ~476 MB 可用）。

## GCE 費用分析

| 項目 | 設定 | Free Tier 條件 | 費用 |
|------|------|---------------|------|
| 機器類型 | `e2-micro` | e2-micro ✓ | **$0** |
| 區域 | `us-west1` (Oregon) | us-west1 / us-central1 / us-east1 ✓ | **$0** |
| 開機磁碟 | 10 GB HDD | ≤ 30 GB ✓ | **$0** |
| Static IP（VM 運行中） | `35.212.154.47`（STANDARD tier） | 綁定運行中 VM → 免費 ✓ | **$0** |
| 網路出口 | us-west1 對外流量 | 免費額度 1 GB/月 | **$0**（低流量下） |

**正常運行下每月費用：$0**

> **注意**：若 VM 停機但 Static IP 仍保留（未 release），GCP 會對閒置 IP 計費（約 $7/月）。
> 停 VM 前請先確認是否要 release IP，或直接刪除 VM。
