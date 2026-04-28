#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-joseph50804}"
IMAGE="${DOCKERHUB_USER}/thsrc-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[部署] 建構並推送 linux/amd64 映像..."
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:latest" \
  --push \
  "$SCRIPT_DIR"

echo "[完成] 已推送 ${IMAGE}:latest"
echo "Watchtower 將在 5 分鐘內自動更新 VM 上的容器。"
