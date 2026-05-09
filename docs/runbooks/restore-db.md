# SQLite DB 從 GCS 備份還原

> ⚠️ 此 runbook 會 **覆寫** 線上 DB,執行前請確認備份來源與時間點。

## 1. 列出可用備份

```bash
gsutil ls -l gs://sincere-office-thsrc-db-backup/daily/
```

## 2. 下載指定備份到 VM

```bash
TIMESTAMP="20260509T190000Z"  # 改成要還原的時間
gsutil cp gs://sincere-office-thsrc-db-backup/daily/backup-${TIMESTAMP}.db.gz /tmp/
gunzip /tmp/backup-${TIMESTAMP}.db.gz
```

## 3. 停止 server 與 scheduler

captcha 與 thsrc.db 無關,可保留執行。

```bash
cd ~ && docker compose stop server scheduler
```

## 4. 備份目前的 DB(以防還原錯版本)

從容器內取(使用 docker cp,避免依賴 host 上 volume mountpoint 路徑):

```bash
SAFETY_TS="$(date -u +%Y%m%dT%H%M%SZ)"

# 即使 server 已停,容器仍然存在,docker cp 仍可作用
docker cp joseph-server-1:/app/data/thsrc.db ~/thsrc.db.before-restore-${SAFETY_TS}
# WAL / SHM 若存在也一起留存
docker cp joseph-server-1:/app/data/thsrc.db-wal ~/thsrc.db-wal.before-restore-${SAFETY_TS} 2>/dev/null || true
docker cp joseph-server-1:/app/data/thsrc.db-shm ~/thsrc.db-shm.before-restore-${SAFETY_TS} 2>/dev/null || true
```

## 5. 還原(包含清掉舊 WAL / SHM)

備份檔來自 `VACUUM INTO`,本身已是完整快照,**不應**搭配舊的 WAL / SHM 還原。

```bash
# 拷回容器
docker cp /tmp/backup-${TIMESTAMP}.db joseph-server-1:/app/data/thsrc.db

# 移除舊 WAL / SHM,讓 sqlite 在下次開啟時用快照重建
docker exec joseph-server-1 sh -c 'rm -f /app/data/thsrc.db-wal /app/data/thsrc.db-shm'
```

## 6. 啟動服務並驗證

```bash
docker compose start server scheduler
sleep 5

# liveness
curl -f http://localhost:8081/healthz

# readiness — DB SELECT 1 + scheduler heartbeat
curl -f http://localhost:8081/readyz
```

預期:兩個都回 200。

## 7. 直接驗證還原資料完整性

不依賴帳號密碼,直接從 DB 讀(node:sqlite 已在 server image):

```bash
docker exec joseph-server-1 node --experimental-sqlite -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/app/data/thsrc.db");
console.log("users     :", db.prepare("SELECT count(*) AS c FROM users").get().c);
console.log("passengers:", db.prepare("SELECT count(*) AS c FROM passengers").get().c);
console.log("bookings  :", db.prepare("SELECT count(*) AS c FROM bookings").get().c);
'
```

預期三個 count 與還原時間點預期值相符。

## 8. 清理

```bash
rm /tmp/backup-${TIMESTAMP}.db
```

確認線上一切正常後,可進一步刪除 step 4 的 `~/thsrc.db.before-restore-*` 安全副本。

## 9. 演練

每季手動執行一次本 runbook(在測試 VM 或 staging),把結果記錄於專案 wiki 或 ops 行事曆。
