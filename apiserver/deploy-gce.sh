#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-}"
if [[ -z "$DOCKERHUB_USER" ]]; then
  echo "[錯誤] 請設定 DOCKERHUB_USER 環境變數，例如："
  echo "  DOCKERHUB_USER=youruser ./deploy-gce.sh"
  exit 1
fi

IMAGE="${DOCKERHUB_USER}/captcha-solver"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TFLITE_SRC="$(cd "$SCRIPT_DIR/.." && pwd)/tensorflow/captcha_model.tflite"

if [[ ! -f "$TFLITE_SRC" ]]; then
  echo "[錯誤] 找不到 TFLite 模型：$TFLITE_SRC"
  echo "請先執行：python tensorflow/convert_to_tflite.py"
  exit 1
fi

echo "[部署] 複製 TFLite 模型..."
cp "$TFLITE_SRC" "$SCRIPT_DIR/captcha_model.tflite"

echo "[部署] 建構並推送 linux/amd64 映像..."
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:latest" \
  --push \
  "$SCRIPT_DIR"

echo "[完成] 已推送 ${IMAGE}:latest"
echo "Watchtower 將在 5 分鐘內自動更新 VM 上的容器。"
