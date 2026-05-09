#!/usr/bin/env bash
# 每日 SQLite 備份至 GCS。
#
# 設計:
# - 透過 docker exec 在 server container 內以 node:sqlite 的 VACUUM INTO 取得 atomic
#   snapshot,WAL 友善且不需停服務。
# - 用 docker cp 從容器抓快照(不需 sudo,不依賴 docker volume mountpoint 的 host 路徑)
# - host 端 gzip + gsutil cp 後清理。
# - 預期由 host crontab 觸發,執行使用者需在 docker group + 有 gsutil 認證(預設用 GCE VM
#   service account)。

set -euo pipefail

CONTAINER="${BACKUP_CONTAINER:-joseph-server-1}"
DB_IN_CONTAINER="${BACKUP_DB_PATH:-/app/data/thsrc.db}"
BUCKET="${BACKUP_BUCKET:-gs://sincere-office-thsrc-db-backup/daily}"
MIN_SNAPSHOT_BYTES="${BACKUP_MIN_BYTES:-1024}"  # 低於此視為損毀,拒絕上傳

# GCE VM 預設 SA 通常只有 devstorage.read_only scope,改用專用 backup SA 的 key file。
# 若已設置環境變數則尊重,否則 fallback 到 $HOME/thsrc-backup-key.json。
export GOOGLE_APPLICATION_CREDENTIALS="${GOOGLE_APPLICATION_CREDENTIALS:-${HOME}/thsrc-backup-key.json}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT_NAME="backup-${TIMESTAMP}.db"
SNAPSHOT_IN_CONTAINER="/app/data/${SNAPSHOT_NAME}"
HOST_TMP="$(mktemp -d)"

log() { echo "$(date -u +%FT%TZ) $*"; }

cleanup() {
  rm -rf "${HOST_TMP}"
  docker exec "${CONTAINER}" rm -f "${SNAPSHOT_IN_CONTAINER}" 2>/dev/null || true
}
trap cleanup EXIT

# 1. 在 server container 內以 VACUUM INTO 產生快照
#    所有變數透過 -e 環境變數傳入 node;VACUUM INTO 接受 prepare/run 參數綁定,
#    避免任何字串插值。
attempt=0
max_attempts=3
while true; do
  # 每次嘗試前移除舊 snapshot — VACUUM INTO 拒絕覆寫已存在的檔案
  docker exec "${CONTAINER}" rm -f "${SNAPSHOT_IN_CONTAINER}" 2>/dev/null || true

  if docker exec \
        -e SRC="${DB_IN_CONTAINER}" \
        -e DST="${SNAPSHOT_IN_CONTAINER}" \
        "${CONTAINER}" \
        node --experimental-sqlite -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(process.env.SRC);
db.prepare("VACUUM INTO ?").run(process.env.DST);
db.close();
'
  then
    break
  fi

  attempt=$((attempt + 1))
  if [ "${attempt}" -ge "${max_attempts}" ]; then
    log "ERROR: VACUUM INTO failed after ${max_attempts} attempts (container down?)"
    exit 1
  fi
  log "WARN: VACUUM INTO failed (attempt ${attempt}/${max_attempts}); retry in 30s"
  sleep 30
done

# 2. 驗證 container 內快照存在且非空
SNAPSHOT_BYTES=$(docker exec "${CONTAINER}" stat -c '%s' "${SNAPSHOT_IN_CONTAINER}" 2>/dev/null || echo 0)
if [ "${SNAPSHOT_BYTES}" -lt "${MIN_SNAPSHOT_BYTES}" ]; then
  log "ERROR: snapshot too small (${SNAPSHOT_BYTES} bytes < ${MIN_SNAPSHOT_BYTES})"
  exit 1
fi

# 3. 從容器拷出(不需 sudo,不依賴 host 上 volume 路徑)
docker cp "${CONTAINER}:${SNAPSHOT_IN_CONTAINER}" "${HOST_TMP}/${SNAPSHOT_NAME}"

# 4. 壓縮
gzip "${HOST_TMP}/${SNAPSHOT_NAME}"

# 5. 上傳
gsutil -q cp "${HOST_TMP}/${SNAPSHOT_NAME}.gz" "${BUCKET}/${SNAPSHOT_NAME}.gz"

log "OK: ${SNAPSHOT_NAME}.gz uploaded to ${BUCKET} (${SNAPSHOT_BYTES} bytes uncompressed)"
