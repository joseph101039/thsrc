# Production Harness P0 Design

**Date:** 2026-05-09
**Scope:** GCE 部署的 server / scheduler / captcha 三個 service 的 P0 級可觀測性與韌性建置
**Status:** Draft — 待 user review

---

## 1. 背景

目前 `thsrc` 後端部署於 GCE(`us-west1-b`),透過 `docker-compose` 啟動 server / scheduler / captcha + watchtower 自動更新 image。現況缺口:

- **無備份**:SQLite 僅存於 PD,VM 被刪、磁碟損毀、誤刪資料皆無回復路徑
- **無健康探針**:容器存活由 docker `restart: unless-stopped` 保證,但 process 卡住、DB 失聯、外部依賴失效時無法自動偵測
- **無 structured logging**:純 `console.log` 文字,無 level / 無 request 關聯 ID,線上故障難以定位

P0 目標:**用最低成本(理想為 $0)補齊上述三項**,作為後續 P1(metrics、告警)的基礎。

## 2. 目標與非目標

### 目標
- DB 每日自動備份至 GCS,保留 30 天,可在 < 5 分鐘內還原
- server / captcha 提供 `/healthz` 與 `/readyz` 探針;scheduler 透過 heartbeat 由 server 暴露狀態
- 全部 Node.js process 改用 `pino` 輸出 JSON structured log,GCP Cloud Logging 自動收集
- **每月 GCP 帳單因此 spec 增加 = $0**(全部落在 Always Free 額度內)

### 非目標(留給 P1+)
- Metrics(Prometheus / Grafana)
- 告警通道(Email / LINE)
- 版本化 image tag 與 rollback runbook
- Tracing
- Audit log

## 3. 設計

### 3.1 SQLite → GCS 備份

**Bucket 規格(關鍵:避免 egress 與超出免費額度):**

| 項目 | 值 | 理由 |
|---|---|---|
| Location | `us-west1`(single region) | 與 GCE VM 同 region → egress 免費;同時落在 Always Free 5GB 涵蓋的 region |
| Storage class | `Standard` | Always Free 僅涵蓋 Standard |
| Bucket 名稱 | `sincere-office-thsrc-db-backup` | project 前綴避免全球命名衝突 |
| Uniform bucket-level access | 啟用 | 簡化權限管理 |
| Object Versioning | **不啟用** | 啟用會讓刪除物件仍佔空間,可能撐爆 5GB |
| Lifecycle rule | `age >= 30 days → delete` | 自動清理,確保長期留在免費額度內 |
| Replication | **不啟用** | 跨 region 複製會產生 egress |

**備份流程:**

1. cron 在 VM 上每日 03:00(台灣時間 UTC+8 對應 UTC 19:00)觸發 `backup-db.sh`
2. 腳本流程:
   ```
   sqlite3 /var/lib/docker/volumes/db-data/_data/app.db \
     ".backup /tmp/backup-$(date -u +%Y%m%dT%H%M%SZ).db"
   gzip /tmp/backup-*.db
   gsutil cp /tmp/backup-*.db.gz gs://sincere-office-thsrc-db-backup/daily/
   rm /tmp/backup-*.db.gz
   ```
3. 使用 `.backup` 指令(SQLite Online Backup API)→ 不需停機、不會讀到寫入中的中間狀態
4. 失敗時 `set -e` 退出非零;由 cron `MAILTO` 或日後 P1 階段的告警接管

**Cron 安裝位置:** GCE VM 的 host crontab(非 container 內),理由:備份腳本需要存取 host 的 docker volume 路徑 + 需要 `gcloud` / `gsutil` 已認證的 service account。

**權限:** VM 的 service account 加上 `roles/storage.objectAdmin`(限定 bucket scope)。

**還原流程(寫成 runbook,放 `docs/runbooks/restore-db.md`):**

1. 確認來源備份檔(`gsutil ls gs://sincere-office-thsrc-db-backup/daily/`)
2. `gsutil cp gs://.../backup-YYYYMMDDTHHMMSSZ.db.gz /tmp/`
3. `gunzip /tmp/backup-*.db.gz`
4. `docker compose stop server scheduler`
5. `docker run --rm -v db-data:/data -v /tmp:/src alpine cp /src/backup-*.db /data/app.db`
6. `docker compose start server scheduler`
7. 驗證:`curl http://localhost:8081/v1/...` 確認資料存在

**用量估算:**

| 項目 | 估算 |
|---|---|
| DB 大小 | 預估 < 100 MB |
| 30 天總量 | < 3 GB(< 5 GB Always Free) |
| 每月 Class A 寫入 | 30 次(< 5,000 free) |
| 每月 Egress | 0(同 region) |
| **月費** | **$0** |

### 3.2 健康探針

**server(`/healthz` 與 `/readyz`):**

| 探針 | 檢查項目 | 失敗條件 |
|---|---|---|
| `GET /healthz` | process 存活 | 永遠回 `200 {status:"ok"}`(只要 Express 還活著) |
| `GET /readyz` | DB 可讀寫 + scheduler heartbeat 新鮮 | DB query 失敗 → 503;scheduler heartbeat > 3 分鐘無更新 → 503(回傳 `{db:"ok", scheduler:"stale"}`) |

**captcha(`/healthz`):**
- 簡單 process-alive 探針,實作於 captcha apiserver
- server 端的 `bookingEngineService` 在呼叫 `/solve` 前**不**先打 `/healthz`(增加延遲不划算),改為對 `/solve` 設 5 秒 timeout

**scheduler(無 HTTP,改用 heartbeat):**
- 每次 poll 結束在 SQLite 寫入 `system_heartbeat` 表:`{component:'scheduler', last_seen_at: now}`
- server 的 `/readyz` 讀此表判斷
- 新增 schema migration:`CREATE TABLE IF NOT EXISTS system_heartbeat (component TEXT PRIMARY KEY, last_seen_at TEXT NOT NULL)`

**docker-compose healthcheck 區塊:**

```yaml
server:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8081/healthz"]
    interval: 30s
    timeout: 5s
    retries: 3
    start_period: 10s

captcha:
  healthcheck:
    test: ["CMD", "wget", "-qO-", "http://localhost:8080/healthz"]
    interval: 30s
    timeout: 5s
    retries: 3

# scheduler 無 HTTP,使用 process check
scheduler:
  healthcheck:
    test: ["CMD-SHELL", "pgrep -f scheduler.js || exit 1"]
    interval: 60s
    timeout: 5s
    retries: 2
```

watchtower 會跳過 unhealthy container 的更新,避免持續更新一個壞掉的版本。

### 3.3 Structured Logging(pino)

**選型理由:** `pino` 比 `winston` 快 5x、JSON 原生、API 簡單、無內建 transport 開銷。

**Logger 共享模組:** 新增 `server/src/logger.js`

```js
const pino = require('pino');
module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', '*.password', '*.token', '*.idNumber', '*.creditCard'],
    censor: '[REDACTED]',
  },
});
```

**使用慣例:**

- 所有 `console.log` / `console.error` 改成 `logger.info(obj, msg)` / `logger.error(obj, msg)`
- HTTP 請求加 request_id middleware:每個 req 賦予 UUID,放進 `req.log = logger.child({ req_id })`,後續 controller / service 用 `req.log` 而非 root logger
- booking engine 的 log 帶 `booking_id`:`logger.child({ booking_id }).info('start')`
- scheduler 啟動時 `logger.info({ env: process.env.NODE_ENV }, 'Scheduler started')`

**敏感資料遮罩:**
- 透過 pino `redact` 設定自動處理
- 額外規則:THSRC 的 captcha 圖片 base64 不寫入 log(只記長度)

**GCP Cloud Logging 整合:**
- 不需安裝 agent — Docker 預設輸出到 stdout,GCE VM 內建 Google Cloud Ops Agent 已將 container stdout 推到 Cloud Logging
- pino 預設輸出符合 Cloud Logging 的 JSON 格式;額外加上 `severity` 欄位對應(pino level → GCP severity)以正確分類顏色:

```js
// logger.js 額外設定
formatters: {
  level: (label) => ({ severity: label.toUpperCase() }),
}
```

**遷移範圍:**
- `api.js`、`scheduler.js`、所有 `controllers/*.js`、`services/*.js`、`thsrc.js`、`admin/*.js`
- 一次 PR 全換,避免兩種 log 格式並存

## 4. 對既有檔案的影響

| 檔案 | 變動 |
|---|---|
| `server/src/logger.js` | 新增 |
| `server/src/api.js` | 加 `/healthz`、`/readyz`、request_id middleware;`console.*` → `logger.*` |
| `server/src/scheduler.js` | 加 heartbeat 寫入;log 全換 |
| `server/src/db.js` | 加 `system_heartbeat` 表 migration |
| `server/src/repositories/heartbeatRepo.js` | 新增 |
| `server/package.json` | dep: `pino` |
| `docker-compose.yml` | 三個 service 加 `healthcheck:` |
| `scripts/backup-db.sh` | 新增 |
| `docs/runbooks/restore-db.md` | 新增 |
| 各 controller / service / thsrc.js | `console.*` → `logger.*`(機械式替換) |

## 5. 測試策略

| 項目 | 方式 |
|---|---|
| `/healthz` 回 200 | 既有 jest 加單元測試 |
| `/readyz` DB 失敗 → 503 | mock db 拋錯 |
| `/readyz` heartbeat stale → 503 | 寫入 4 分鐘前 timestamp |
| pino redact 生效 | 單元測試:輸入帶 password 的 object,輸出應為 `[REDACTED]` |
| 備份腳本 | 在 dev VM 跑一次,驗證物件出現在 bucket;手動觸發還原流程一次 |
| docker healthcheck | `docker compose up -d`,`docker ps` 應顯示 `(healthy)` |

## 6. 風險與緩解

| 風險 | 緩解 |
|---|---|
| 備份腳本壞掉但無人察覺 → 真要還原時才發現沒備份 | bucket 加 lifecycle 監控;P1 階段加「24h 內無新備份」告警;runbook 要求每季手動演練一次還原 |
| `.backup` 指令在大 DB(若未來 > 1GB)會鎖太久 | 目前 < 100MB 不是問題;若超過則改用 `VACUUM INTO` + 副本檔 |
| pino 大量寫 stdout 影響效能 | 預期 log 量不大;若需要可加 `pino-roll` 寫檔 + 異步 worker |
| heartbeat 表變大 | 該表只有一行 per component,UPSERT 不會增長 |
| Bucket 命名衝突 | 用 project 前綴 `sincere-office-` |
| GCS 存取憑證外洩 | 使用 VM-attached service account,不放 key 檔在 VM 上 |

## 7. Rollout 順序

建議分三個 PR(便於 review 與回滾):

1. **PR-1: structured logging** — 純內部變更,風險最低
2. **PR-2: healthz/readyz + heartbeat + docker healthcheck** — 加 endpoint,不改既有行為
3. **PR-3: GCS 備份腳本 + bucket + IAM + restore runbook** — infra 動作,需在 VM 上執行

## 8. 開放問題

無 — 待 user review 確認後進入 writing-plans。
