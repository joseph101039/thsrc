---
name: deploy
description: Deploy the captcha solver API to GCP Cloud Run. Use when shipping a new model or API changes. Requires gcloud CLI authenticated and a GCP project set up.
disable-model-invocation: true
---

# Deploy Captcha Solver to GCP Cloud Run

## Pre-flight checklist

1. **Model is current** — `tensorflow/captcha_model.keras` has been trained and validated
2. **gcloud is authenticated** — run `gcloud auth login` and `gcloud auth configure-docker` if needed
3. **Project is set** — `gcloud config get-value project` returns the correct project ID

## Copy model into apiserver

```bash
cp tensorflow/captcha_model.keras apiserver/captcha_model.keras
```

## Deploy

```bash
cd apiserver
./deploy.sh
```

Or with explicit overrides:

```bash
cd apiserver
PROJECT=my-gcp-project REGION=asia-east1 SERVICE=captcha-solver ./deploy.sh
```

The script uses Cloud Build (no local Docker needed). Defaults: region=`asia-east1`, 2 GB RAM, 2 vCPU, concurrency=4.

## Verify deployment

After deploy, check the Cloud Run URL printed by the script:

```bash
curl -X POST https://<cloud-run-url>/solve \
  -H "Content-Type: application/json" \
  -d '{"image": "<base64_captcha_image>"}'
```

Health check endpoint: `GET /health`

Swagger UI: `https://<cloud-run-url>/docs`
