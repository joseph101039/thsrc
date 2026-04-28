# Node.js Server 設計文件

**日期：** 2026-04-28
**目標：** 以 Node.js 取代 Google Apps Script 後端，部署在現有 GCE VM（`35.212.154.47`）上

---

## 背景

GAS 後端部署和測試困難（clasp push 流程慢、無法本地測試、5 分鐘執行限制），改用 Node.js server 在 `server/` 目錄下，功能完全對應現有 GAS，部署在同一台 VM 的新 port 8081。

---

## 目錄結構

```
server/
  src/
    api.js            # Express HTTP server（port 8081）
    scheduler.js      # node-schedule worker（每分鐘輪詢）
    db.js             # SQLite schema + query helpers
    thsrc.js          # THSRC 網站 scraping（從 Thsrc.gs 移植）
    mailer.js         # Nodemailer + Gmail SMTP
    config.js         # 設定常數
  package.json
  Dockerfile
  deploy-server.sh    # build linux/amd64 + push to Docker Hub
docker-compose.yml    # 根目錄，統一管理 captcha + server + watchtower
```

---

## 資料層（SQLite）

資料庫檔案存在 Docker volume（`db-data:/app/data/thsrc.db`），重啟不遺失。

### bookings 表

```sql
CREATE TABLE IF NOT EXISTS bookings (
  id           TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL,
  from_station TEXT NOT NULL,
  to_station   TEXT NOT NULL,
  date         TEXT NOT NULL,
  desired_time TEXT NOT NULL,
  earliest_time TEXT NOT NULL,
  latest_time  TEXT NOT NULL,
  max_retries  INTEGER NOT NULL DEFAULT 10,
  scheduled_at TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  retry_count  INTEGER NOT NULL DEFAULT 0,
  train_no     TEXT,
  ticket_no    TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

### passengers 表

```sql
CREATE TABLE IF NOT EXISTS passengers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  id_number  TEXT NOT NULL,
  type       TEXT NOT NULL,
  email      TEXT NOT NULL
);
```

`db.js` 提供以下函數（直接對應 GAS 版本）：
- `getPassengers()`
- `savePassenger(data)` — id 有值則 update，無則 insert
- `deletePassenger(id)`
- `getBookings()`
- `createBooking(data)`
- `updateBookingFields(id, fields)`

---

## API Layer（`api.js`）

**Port：** 8081
**協議：** HTTP（與現有 captcha API 一致，內部 VM 使用）

維持現有 action-based POST 介面，讓 `ui/js/api.js` 只需改一行 URL：

```js
// ui/js/api.js
const SERVER_URL = 'http://35.212.154.47:8081';
```

### 端點

```
GET  /          → { status: 'ok' }
POST /          → action-based dispatch
```

### 支援的 action

| action | 對應 GAS 函數 |
|--------|-------------|
| `getPassengers` | `getPassengers()` |
| `savePassenger` | `savePassenger(data)` |
| `deletePassenger` | `deletePassenger(id)` |
| `getBookings` | `getBookings()` |
| `createBooking` | `createBooking(data)` |

CORS 全開（`Access-Control-Allow-Origin: *`）。

---

## Scheduler（`scheduler.js`）

用 `node-schedule` 每分鐘執行 `pollPendingBookings()`：

1. 查詢所有 `status = 'running'` 且 `updated_at < now - 10分鐘` 的 booking → 重置為 `pending`
2. 查詢第一筆 `status = 'pending'` 且 `scheduled_at IS NULL OR scheduled_at <= now` 的 booking
3. 呼叫 `runBooking(id)`

### `runBooking(id)` 流程

```
updateBookingFields(id, { status: 'running' })
  → thsrcInit()                    # 取 JSESSIONID + security token
  → thsrcQueryTrains(...)          # 查可用班次
  → if 無班次: handleRetry()
  → selectBestTrain(trains, desiredTime)
  → thsrcGetCaptcha(sessionId)     # 取驗證碼圖片（base64）
  → POST http://35.212.154.47:8080/solve  # 解碼驗證碼
  → thsrcSubmitBooking(...)        # 送出訂票
  → if 成功: status=success, 寄成功信
  → if 失敗: handleRetry()
```

### `handleRetry(booking, reason)`

- `retry_count + 1 < max_retries` → `status = 'pending'`，`scheduled_at = now + 2分鐘`
- `retry_count + 1 >= max_retries` → `status = 'failed'`，寄失敗信

**注意：** GAS 版本用 ScriptProperties + Trigger 傳 bookingId，Node.js 版本直接用 `scheduled_at` 欄位讓 poller 處理，不需額外機制。

---

## 寄信（`mailer.js`）

Nodemailer + Gmail SMTP（App Password）：

```js
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
});
```

實作：
- `sendSuccessEmail(toEmail, booking, passenger)`
- `sendFailureEmail(toEmail, booking, passenger, reason)`

信件內容與現有 GAS 版本相同（繁體中文）。

---

## THSRC Scraping（`thsrc.js`）

從 `gas/Thsrc.gs` 直譯為 Node.js（`node-fetch` 或 `axios`）：

- `thsrcInit()` → GET `https://irs.thsrc.com.tw/IMINT/`，解析 JSESSIONID + token
- `thsrcGetCaptcha(sessionId)` → GET `/CheckCode.jsp`，回傳 base64
- `thsrcQueryTrains(sessionId, token, params)` → POST `/IMINT`，解析班次
- `thsrcSubmitBooking(sessionId, token, params)` → POST `/IMINT`，解析訂位代號
- `selectBestTrain(trains, desiredTime)` → 選最接近 desiredTime 的班次
- `parseTrainOptions(html, earliestTime, latestTime)` → 解析 HTML

---

## 部署

### Docker image

```dockerfile
# server/Dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
ENV PORT=8081
ENV DB_PATH=/app/data/thsrc.db
EXPOSE 8081
CMD ["node", "src/api.js"]
```

scheduler 作為獨立 service 跑同一個 image，用不同 CMD：`node src/scheduler.js`。

### docker-compose.yml（根目錄）

```yaml
services:
  captcha:
    image: joseph50804/captcha-solver:latest
    ports: ["8080:8080"]
    restart: unless-stopped

  server:
    image: joseph50804/thsrc-server:latest
    ports: ["8081:8081"]
    volumes: [db-data:/app/data]
    env_file: .env
    restart: unless-stopped

  scheduler:
    image: joseph50804/thsrc-server:latest
    command: node src/scheduler.js
    volumes: [db-data:/app/data]
    env_file: .env
    restart: unless-stopped

  watchtower:
    image: containrrr/watchtower
    volumes: [/var/run/docker.sock:/var/run/docker.sock]
    command: --interval 300
    restart: unless-stopped

volumes:
  db-data:
```

### .env（VM 上）

```
GMAIL_USER=joseph101039@gmail.com
GMAIL_APP_PASSWORD=<app password>
```

### 部署腳本（`server/deploy-server.sh`）

```bash
#!/usr/bin/env bash
DOCKERHUB_USER="${DOCKERHUB_USER:-joseph50804}"
docker buildx build --platform linux/amd64 \
  -t "${DOCKERHUB_USER}/thsrc-server:latest" --push server/
```

### 首次上線步驟

1. `DOCKERHUB_USER=joseph50804 ./server/deploy-server.sh`
2. SSH 進 VM，放置 `docker-compose.yml` 和 `.env`
3. `docker-compose up -d`（同時啟動 captcha、server、scheduler、watchtower）
4. 更新 `ui/js/api.js` URL → `http://35.212.154.47:8081`

---

## GCP Firewall

需新增一條 firewall 規則開放 TCP 8081：

```bash
gcloud compute firewall-rules create allow-thsrc-server-8081 \
  --allow tcp:8081 \
  --target-tags captcha-solver \
  --project sincere-office-494609-m3
```

（沿用現有 network tag `captcha-solver`）

---

## 遷移說明

- GAS 後端停用後，原 Google Sheet 資料不需遷移（bookings 歷史記錄可棄置，passengers 需手動重新輸入或寫一次性 migration script）
- `gas/` 目錄保留不刪除，作為參考
