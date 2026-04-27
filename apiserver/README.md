# THSRC Captcha Solver — Web API

FastAPI server that runs the CRNN+CTC captcha model and exposes a REST API.
Designed to deploy on **GCP Cloud Run**.

## Structure

```
captcha-web/
├── main.py              FastAPI application
├── requirements.txt     Python dependencies (tensorflow-cpu, fastapi, uvicorn, opencv-headless)
├── Dockerfile           Container image definition
├── .dockerignore
├── .env.example         Environment variable template
├── deploy.sh            One-command GCP Cloud Run deployment
└── swagger.yaml         OpenAPI 3.0 spec
```

## Local development

```bash
# 1. Copy trained model
cp ../thsrc/captcha/captcha_model.keras .

# 2. Create venv and install deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Run server
MODEL_PATH=captcha_model.keras uvicorn main:app --reload --port 8080
```

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
BASE_URL=http://localhost:8080

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

## Deploy to GCP Cloud Run

### Prerequisites

```bash
gcloud auth login
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com containerregistry.googleapis.com
```

### Deploy

```bash
./deploy.sh
# Or with overrides:
PROJECT=my-project REGION=asia-east1 ./deploy.sh
```

`deploy.sh` will:
1. Copy `captcha_model.keras` from `../thsrc/captcha/` if not already present
2. Build the Docker image via **Cloud Build** (no local Docker required)
3. Deploy to **Cloud Run** with 2 vCPU / 2 GB RAM, concurrency 4

Typical cold start: ~15 s (model load). Warm inference: ~50 ms.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_PATH` | `captcha_model.keras` | Path to the `.keras` model file inside the container |
| `PORT` | `8080` | Port the server listens on (Cloud Run sets this automatically) |

## Calling from Google Apps Script (GAS)

```javascript
function solveCaptcha(base64Image) {
  const url = 'https://captcha-solver-<hash>-uc.a.run.app/solve';
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

| Metric | Value |
|--------|-------|
| Test char accuracy | 98.91% |
| Test string accuracy | 97.10% |

Architecture: CNN × 5 blocks → Reshape → BiLSTM × 2 → CTC decode.  
See `../thsrc/captcha/README.md` for full training details.

## Memory usage

Measured on the actual `captcha_model.keras` (7.9M params, 30.2 MB float32 weights):

| Stage | Delta | Cumulative |
|-------|-------|-----------|
| Python baseline | 24 MB | 24 MB |
| + TensorFlow import | +428 MB | 452 MB |
| + Model load | +98 MB | 549 MB |
| + First inference (batch=1) | +114 MB | 663 MB |
| + Concurrent inference (batch=4) | +101 MB | 764 MB |

> Measured with `tensorflow-metal` on macOS. `tensorflow-cpu` on Linux (GCP) runs ~50–100 MB lighter,
> giving a stable footprint of **~500–650 MB** per worker process.

### Recommended Cloud Run memory setting: 2 GB

| Setting | Verdict |
|---------|---------|
| 512 MB | ❌ OOM — TF import alone uses 452 MB |
| 1 GB | ⚠️ Marginal — concurrent requests will OOM |
| **2 GB** | ✅ Recommended — ~1.2 GB headroom for concurrency |
| 4 GB | Only needed for high concurrency (10+) |

`deploy.sh` defaults to `--memory 2Gi --concurrency 4`, which keeps each worker well within budget.
