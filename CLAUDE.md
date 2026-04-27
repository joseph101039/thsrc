# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC captcha solver — a two-module Python project:
- `tensorflow/` — CRNN+CTC model training pipeline (scrape → label → train → predict)
- `apiserver/` — FastAPI REST service deployable to GCP Cloud Run

This captcha solver is a component of a larger THSRC (Taiwan High Speed Rail) booking automation project. The API has no authentication by design (internal use only).

## Python Version Requirements

- `tensorflow/`: Python 3.9–3.11 (uses `.venv` at `tensorflow/.venv`; `tensorflow-metal` for macOS GPU breaks on 3.12+)
- `apiserver/`: Python 3.11 (matches Dockerfile base image)

## Model File

The trained model lives at `tensorflow/captcha_model.keras` (30 MB, `.keras` format). The `.h5` version at the same path is a larger duplicate. When deploying the API, copy the `.keras` file into `apiserver/` before building the Docker image — `deploy.sh` previously referenced a cross-repo path that no longer applies.

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

# 3. Train CRNN+CTC model
python3 tensorflow/train_captcha.py
python3 tensorflow/train_captcha.py --epochs 300

# 4. Run inference
python3 tensorflow/predict_captcha.py path/to/image.png
python3 tensorflow/predict_captcha.py --batch tensorflow/captcha_images/ --labels tensorflow/labels.json
python3 tensorflow/predict_captcha.py --base64 "<base64_string>"
python3 tensorflow/predict_captcha.py --server --port 5001
```

### API Server (`apiserver/`)

```bash
cd apiserver
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
MODEL_PATH=captcha_model.keras uvicorn main:app --reload --port 8080
# Swagger UI: http://localhost:8080/docs
```

### GCP Deployment

```bash
cd apiserver
# Copy model first
cp ../tensorflow/captcha_model.keras .
# Deploy (uses Cloud Build — no local Docker needed)
./deploy.sh
# Or with overrides:
PROJECT=my-project REGION=asia-east1 SERVICE=captcha-solver ./deploy.sh
```

## Character Set

The model recognizes 34 characters: `0123456789ABCDEFGHJKLMNPQRSTUVWXYZ` (no `I` or `O` to avoid visual ambiguity with `1` and `0`).

## Image Format

All captcha images are preprocessed to 160×50 grayscale, normalized to [0, 1]. The API and training pipeline must use identical preprocessing or accuracy will degrade.

## Gotchas

- `deploy.sh` defaults to `asia-east1` region — pass `REGION=` explicitly if deploying elsewhere.
- Selenium scraping requires a real system Chrome install, not a headless/sandboxed one.
- Google Colab is preferred for training (GPU); `tensorflow-metal` enables Metal GPU on macOS locally.
- The FastAPI CTC decoder is a custom greedy implementation — it differs from Keras built-ins and returns per-character confidence scores.
- API memory usage is ~550–650 MB per worker (TensorFlow import overhead); Cloud Run is configured for 2 GB.
