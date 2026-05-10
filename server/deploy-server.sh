#!/usr/bin/env bash
# 部署 server image。同時 push :vMAJOR.MINOR.PATCH 與 :latest;watchtower 仍追 latest。
# 用法:
#   bash server/deploy-server.sh           # patch bump (default)
#   bash server/deploy-server.sh patch
#   bash server/deploy-server.sh minor
#   bash server/deploy-server.sh major

set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-joseph50804}"
IMAGE="${DOCKERHUB_USER}/thsrc-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BUMP="${1:-patch}"
case "${BUMP}" in
  patch|minor|major) ;;
  *)
    echo "ERROR: invalid bump '${BUMP}' (expected patch|minor|major)" >&2
    exit 1
    ;;
esac

# 強制 working tree clean — 避免推未提交的程式造成 image 與 source 不一致
if ! git -C "${REPO_ROOT}" diff --quiet || ! git -C "${REPO_ROOT}" diff --cached --quiet; then
  echo "ERROR: working tree has uncommitted changes; commit or stash first" >&2
  exit 1
fi

# 必須在 main 上(避免從 feature branch 直接打 prod tag)
CURRENT_BRANCH="$(git -C "${REPO_ROOT}" rev-parse --abbrev-ref HEAD)"
if [ "${CURRENT_BRANCH}" != "main" ]; then
  echo "ERROR: must deploy from 'main' branch (currently on '${CURRENT_BRANCH}')" >&2
  exit 1
fi

# 同步遠端 tag 與 main(避免本地過時計算錯 NEXT;並確認本地 main 已 ff 到遠端)
echo "[部署] 同步遠端 tag 與 main..."
git -C "${REPO_ROOT}" fetch origin --tags --prune --prune-tags
LOCAL_MAIN="$(git -C "${REPO_ROOT}" rev-parse main)"
ORIGIN_MAIN="$(git -C "${REPO_ROOT}" rev-parse origin/main)"
if [ "${LOCAL_MAIN}" != "${ORIGIN_MAIN}" ]; then
  echo "ERROR: local main (${LOCAL_MAIN}) != origin/main (${ORIGIN_MAIN}); pull first" >&2
  exit 1
fi

# 取最新 SemVer tag — 限制 glob 只接受純 X.Y.Z 數字格式
LATEST_TAG="$(git -C "${REPO_ROOT}" tag -l 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n 1)"
LATEST_TAG="${LATEST_TAG:-v0.0.0}"
LATEST="${LATEST_TAG#v}"
IFS='.' read -r MAJ MIN PAT <<<"${LATEST}"
# 防呆:確認三個都是純數字(理論上 glob 已過濾,雙重保險)
if ! [[ "${MAJ}" =~ ^[0-9]+$ ]] || ! [[ "${MIN}" =~ ^[0-9]+$ ]] || ! [[ "${PAT}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: cannot parse SemVer from '${LATEST_TAG}' (got MAJ='${MAJ}' MIN='${MIN}' PAT='${PAT}')" >&2
  exit 1
fi

case "${BUMP}" in
  patch) NEXT="v${MAJ}.${MIN}.$((PAT+1))" ;;
  minor) NEXT="v${MAJ}.$((MIN+1)).0" ;;
  major) NEXT="v$((MAJ+1)).0.0" ;;
esac

# Dry-run:只印不做事
if [ "${DRY_RUN:-}" = "1" ]; then
  echo "[dry-run] 從 ${LATEST_TAG} bump ${BUMP} → ${NEXT}"
  echo "[dry-run] would push ${IMAGE}:${NEXT} + ${IMAGE}:latest"
  echo "[dry-run] would push git tag ${NEXT}"
  exit 0
fi

echo "[部署] 從 ${LATEST_TAG} bump ${BUMP} → ${NEXT}"

# 先打 git tag 並 push origin —
# 若失敗(他人已 push 同名 tag、權限不足、network),立刻退出,Docker Hub 不會被污染
COMMIT_SUBJECT="$(git -C "${REPO_ROOT}" log -1 --format='%s')"
git -C "${REPO_ROOT}" tag -a "${NEXT}" -m "deploy: ${COMMIT_SUBJECT}"
if ! git -C "${REPO_ROOT}" push origin "${NEXT}"; then
  echo "ERROR: git push origin ${NEXT} failed; rolling back local tag" >&2
  git -C "${REPO_ROOT}" tag -d "${NEXT}"
  exit 1
fi

echo "[部署] git tag ${NEXT} 已 push;接著 build + push image..."

docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:${NEXT}" \
  -t "${IMAGE}:latest" \
  --push \
  "${SCRIPT_DIR}"

echo ""
echo "[完成] ${IMAGE}:${NEXT} 與 :latest 已推送"
echo "       Watchtower 將在 5 分鐘內拉新 latest"
echo "       立即生效:gcloud compute ssh ... --command=\"docker compose pull server scheduler && docker compose up -d server scheduler\""
echo "       Rollback: 見 docs/runbooks/rollback-server.md"
