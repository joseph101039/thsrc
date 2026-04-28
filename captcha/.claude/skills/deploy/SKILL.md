---
name: deploy
description: Deploy the captcha solver API to GCP Compute Engine (GCE). Use when shipping a new model or API changes. Requires Docker (buildx) and Docker Hub access.
disable-model-invocation: true
---

# Deploy Captcha Solver to GCE

**Note:** `captcha/` is now part of the main monorepo. Run all commands from the repo root (`thsrc/`).

## Pre-flight checklist

1. **TFLite model is current** — convert if needed: `python3 captcha/tensorflow/convert_to_tflite.py`
2. **Docker logged in to Docker Hub** — `docker login` if needed

## Deploy

```bash
DOCKERHUB_USER=joseph50804 ./captcha/apiserver/deploy-gce.sh
```

`deploy-gce.sh` will:
1. Copy `captcha/tensorflow/captcha_model.tflite` → `captcha/apiserver/`
2. Build `linux/amd64` image via `docker buildx` and push to `joseph50804/captcha-solver:latest`
3. VM cron job auto-pulls every 5 minutes — no SSH required

## Verify deployment

```bash
curl http://35.212.154.47:8080/health
curl -X POST http://35.212.154.47:8080/solve/upload -F file=@captcha.png
```