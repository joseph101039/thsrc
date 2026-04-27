#!/usr/bin/env bash
# Deploy captcha-solver to GCP Cloud Run.
# Usage:
#   ./deploy.sh                      # use defaults below
#   PROJECT=my-project ./deploy.sh   # override project
set -euo pipefail

PROJECT="${PROJECT:-$(gcloud config get-value project)}"
SERVICE="${SERVICE:-captcha-solver}"
REGION="${REGION:-asia-east1}"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"

echo "==> Project : ${PROJECT}"
echo "==> Service : ${SERVICE}"
echo "==> Region  : ${REGION}"
echo "==> Image   : ${IMAGE}"
echo ""

# 1. Copy trained model into build context (required by Dockerfile)
MODEL_SRC="../thsrc/captcha/captcha_model.keras"
if [[ ! -f "captcha_model.keras" ]]; then
  if [[ -f "${MODEL_SRC}" ]]; then
    echo "==> Copying model from ${MODEL_SRC}"
    cp "${MODEL_SRC}" captcha_model.keras
  else
    echo "ERROR: captcha_model.keras not found."
    echo "Run: cp <path>/captcha_model.keras captcha-web/"
    exit 1
  fi
fi

# 2. Build & push image via Cloud Build (no local Docker needed)
echo "==> Building and pushing image..."
gcloud builds submit \
  --tag "${IMAGE}" \
  --project "${PROJECT}"

# 3. Deploy to Cloud Run
echo "==> Deploying to Cloud Run..."
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --platform managed \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --concurrency 4 \
  --timeout 60 \
  --set-env-vars "MODEL_PATH=captcha_model.keras" \
  --project "${PROJECT}"

echo ""
echo "==> Done. Service URL:"
gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --format "value(status.url)"
