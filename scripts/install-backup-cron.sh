#!/usr/bin/env bash
# 在 GCE VM host 上安裝每日 SQLite 備份 cron。
# 03:00 台灣時間 = 19:00 UTC。
# 注意:不要以 sudo 直接執行此腳本(會讓 cron 以 root 身份跑備份);
# 由「實際的備份操作使用者」執行,腳本會自行 sudo 寫 /etc/cron.d/。

set -euo pipefail

CRON_FILE="/etc/cron.d/thsrc-backup"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/backup-db.sh"
LOG_PATH="/var/log/thsrc-backup.log"
# 偵測:若被 sudo 啟動,以原始 invoker 為 cron 使用者
RUN_USER="${SUDO_USER:-$(id -un)}"

if [ ! -x "${SCRIPT_PATH}" ]; then
  echo "ERROR: ${SCRIPT_PATH} not executable" >&2
  exit 1
fi

# 驗證 docker / gsutil 可用
for cmd in docker gsutil; do
  if ! command -v "${cmd}" >/dev/null; then
    echo "ERROR: ${cmd} not installed" >&2
    exit 1
  fi
done

# Verify the chosen user is in the docker group (能 docker exec 不需 sudo)
if ! id -nG "${RUN_USER}" | grep -qw docker; then
  echo "ERROR: user '${RUN_USER}' is not in 'docker' group; backup-db.sh requires docker access" >&2
  echo "Hint:  sudo usermod -aG docker ${RUN_USER}  (then re-login)" >&2
  exit 1
fi

# log file 預先建立並授權給目標使用者(0640 限制非預期讀取)
sudo touch "${LOG_PATH}"
sudo chown "${RUN_USER}:${RUN_USER}" "${LOG_PATH}"
sudo chmod 640 "${LOG_PATH}"

# gsutil 在 Ubuntu 一般經由 snap 安裝,固定路徑為 /snap/bin。
# 額外把當前解析到的 gsutil 目錄加進來作為 fallback,以涵蓋透過 apt / pip 安裝的環境。
GSUTIL_BIN="$(command -v gsutil)"
case "${GSUTIL_BIN}" in
  *[[:space:]\;\&\|\$\`\\]*)
    echo "ERROR: gsutil path contains unsafe characters: ${GSUTIL_BIN}" >&2
    exit 1
    ;;
esac
GSUTIL_DIR="$(dirname "${GSUTIL_BIN}")"

sudo tee "${CRON_FILE}" >/dev/null <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin:${GSUTIL_DIR}
MAILTO=""

# 每日 UTC 19:00 (台灣 03:00) 備份 SQLite 至 GCS
0 19 * * * ${RUN_USER} ${SCRIPT_PATH} >> ${LOG_PATH} 2>&1
EOF

sudo chmod 644 "${CRON_FILE}"
echo "OK: cron installed at ${CRON_FILE}"
echo "    user:      ${RUN_USER}"
echo "    schedule:  daily 19:00 UTC (Taipei 03:00)"
echo "    log:       ${LOG_PATH} (mode 640)"
echo ""
echo "Verify gsutil auth works first, then test:"
echo "  gsutil ls gs:// >/dev/null  # 任一 bucket,確認認證 OK"
echo "  ${SCRIPT_PATH}              # 立即執行一次備份"
