# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC captcha solver — a two-module Python project:
- `tensorflow/` — CRNN+CTC model training pipeline (scrape → label → train → predict)
- `apiserver/` — FastAPI REST service deployable to GCP Compute Engine

This captcha solver is a component of a larger THSRC (Taiwan High Speed Rail) booking automation project. The API has no authentication by design (internal use only).

## Python Version Requirements

- `tensorflow/`: Python 3.9–3.11 (uses `.venv` at `tensorflow/.venv`; `tensorflow-metal` for macOS GPU breaks on 3.12+)
- `apiserver/`: Python 3.11 (matches Dockerfile base image)

## Model Files

| File | Purpose |
|------|---------|
| `tensorflow/captcha_model.keras` | GPU/Metal 訓練版（原始） |
| `tensorflow/captcha_model_cpu.keras` | CPU 訓練版（`unroll=True`，可轉 TFLite） |
| `tensorflow/captcha_model.tflite` | 部署用（32 MB，gitignored） |

To deploy: run `python3 tensorflow/convert_to_tflite.py` then `DOCKERHUB_USER=joseph50804 ./apiserver/deploy-gce.sh`.

## Key Commands

### ML Pipeline (`tensorflow/`)

```bash
# Activate venv
source tensorflow/.venv/bin/activate

# 1. Scrape captcha images (requires system Chrome + compatible ChromeDriver)
python3 tensorflow/scrape_captcha.py

# 2. Manually label images (interactive OpenCV UI)
python3 tensorflow/label_captcha.py
python3 tensorflow/label_captcha.py --start 100   # resume from index
python3 tensorflow/label_captcha.py --stats        # view progress

# 3a. Train (GPU/Metal — not TFLite-exportable)
python3 tensorflow/train_captcha.py
# 3b. Train CPU version (TFLite-exportable, use_cudnn=False, unroll=True)
python3 tensorflow/train_captcha_cpu.py

# 4. Convert CPU model to TFLite
python3 tensorflow/convert_to_tflite.py

# 5. Run inference
python3 tensorflow/predict_captcha.py path/to/image.png
python3 tensorflow/predict_captcha.py --batch tensorflow/captcha_images/ --labels tensorflow/labels.json
python3 tensorflow/predict_captcha_tflite.py --quiet   # TFLite batch accuracy
```

### API Server (`apiserver/`)

```bash
cd apiserver
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# Copy TFLite model first
cp ../tensorflow/captcha_model.tflite .
MODEL_PATH=captcha_model.tflite uvicorn main:app --reload --port 8080
# Swagger UI: http://localhost:8080/docs
```

Note: `tflite-runtime` has no macOS arm64 wheel — use `tensorflow-cpu==2.18.0` locally and swap back before building the Docker image.

### GCP Deployment (GCE Free Tier)

Live endpoint: `http://35.212.154.47:8080`

```bash
# Build TFLite model and push image to Docker Hub
python3 tensorflow/convert_to_tflite.py
DOCKERHUB_USER=joseph50804 ./apiserver/deploy-gce.sh
# Watchtower on the VM auto-pulls within 5 minutes
```

### GCP VM — Connect & Inspect

```bash
# SSH into VM
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3

# Run a single command without interactive shell
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="docker stats --no-stream"

# Check memory and container status
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="free -m && docker ps"
```

VM spec: `e2-micro`, zone `us-west1-b`, 952 MB RAM, 1 shared vCPU, 0 swap.
Container memory: captcha-solver ~88 MB (TFLite), watchtower ~10 MB.
Network tag: `captcha-solver` (firewall rule `allow-captcha-8080` opens TCP 8080).
External IP: `35.212.154.47` — reserved as static (`captcha-solver-ip`, us-west1, STANDARD tier). Will not change on reboot.

### API curl examples

```bash
API=http://35.212.154.47:8080

# Health check
curl "$API/health"

# Solve from file upload
curl -X POST "$API/solve/upload" -F file=@captcha.png

# Solve from base64
B64=$(base64 -i captcha.png)
curl -X POST "$API/solve" \
  -H "Content-Type: application/json" \
  -d "{\"image\": \"$B64\"}"

# Solve from URL (server fetches image)
curl -X POST "$API/solve/url" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://irs.thsrc.com.tw/IMINT/?action=homeCaptcha"}'
```

Response format (all `/solve*`):
```json
{"answer": "A3KZ", "confidence": [0.999, 0.987, 0.951, 1.0], "elapsed_ms": 12.4}
```

## Character Set

The model recognizes 34 characters: `0123456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no `I` or `O` to avoid visual ambiguity with `1` and `0`).

## Image Format

All captcha images are preprocessed to 160×50 grayscale, normalized to [0, 1]. The API and training pipeline must use identical preprocessing or accuracy will degrade.

## Gotchas

- GPU-trained `.keras` models bake Metal/CuDNN LSTM kernels and cannot be converted to TFLite. Must retrain with `train_captcha_cpu.py` (`use_cudnn=False, unroll=True`) before converting.
- `tflite-runtime` has no macOS arm64 wheels — local smoke tests must use `tensorflow` fallback or Docker.
- Selenium scraping requires a real system Chrome install, not a headless/sandboxed one.
- Google Colab is preferred for GPU training; `tensorflow-metal` enables Metal GPU on macOS locally.
- The FastAPI CTC decoder is a custom greedy implementation — differs from Keras built-ins, returns per-character confidence scores.
- API memory: TFLite ~88 MB per container (vs ~600 MB with tensorflow-cpu). e2-micro has 952 MB total.
