# FSD — THSRC 自動訂票代理系統

| 項目 | 內容 |
|---|---|
| 文件類型 | Functional Specification Document(功能規格文件) |
| 版本 | 1.0(現況回顧 / as-is) |
| 撰寫日期 | 2026-05-15 |
| 對應 PRD | `2026-05-15-thsrc-system-prd.md` |
| 目標讀者 | 後端 RD、前端 RD、QA、SRE |

> 本文僅描述「系統做什麼、如何做」;商業需求請見 PRD,使用者觀點請見 User Story / Use Case。

---

## 1. 系統架構(Architecture)

```
[ Browser: GitHub Pages UI ]
         │  HTTPS (JWT)
         ▼
[ Cloudflare Named Tunnel ] ── api.joseph101039.uk
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│ GCE VM (e2-micro, us-west1-b)                            │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐            │
│  │  server    │ │ scheduler  │ │  captcha   │            │
│  │  :8081     │ │  (poll DB) │ │  :8080     │            │
│  └─────┬──────┘ └─────┬──────┘ └─────┬──────┘            │
│        │  share volume: /app/data (SQLite)               │
│        ▼                                                 │
│   ┌──────────────┐    ┌────────────┐                     │
│   │ alloy (push) │    │ watchtower │                     │
│   └──────┬───────┘    └────────────┘                     │
└─────────┼────────────────────────────────────────────────┘
          ▼
  [ Grafana Cloud ] ── Alerting ── webhook → server ── LINE Push API
          │
          └── Dashboard / Explore

[ scripts/backup-db.sh ]  ──daily──>  [ GCS bucket: thsrc-db-backup ]
[ irs.thsrc.com.tw ] <── server / scheduler outbound(Akamai + Wicket)
```

詳細圖請見 `docs/data_flow.md`。

## 2. 分層架構(Layered Architecture)

```
controllers/   HTTP I/O、輸入驗證、回傳格式
services/      業務邏輯,可跨 controller 重用
repositories/  SQLite 查詢,單一 table 一個 repo
models/        共用驗證常數 / schema
middlewares/   auth、adminOnly、requestLogger
```

依賴方向只准從上往下流動。Repository 不直接被 controller 呼叫。

## 3. 模組責任清單(Module Responsibilities)

| 模組 | 路徑 | 主要責任 |
|---|---|---|
| Express API | `server/src/api.js` | 啟動 HTTP server(8081)、掛載 middleware、Swagger UI |
| 排程器 | `server/src/scheduler.js` | 60s 輪詢 SQLite;heartbeat 寫入 `system_heartbeat` |
| THSRC 自動化 | `server/src/thsrc.js` | 模擬瀏覽器 Init → GetCaptcha → S1 → S2 → S3 → S4 |
| 訂票引擎 | `services/bookingEngineService.js` | `runBooking()` / `runRefund()` / `handleRetry()` |
| Auth 服務 | `services/authService.js` | Google OAuth 驗證、JWT 簽發 / 驗證 |
| 通知 | `services/lineNotifier.js` | `pushText` / `pushBookingResult`(fire-and-forget) |
| 告警分派 | `services/alertDispatcher.js` | Grafana webhook → LINE,30 分鐘去重 |
| Grafana API | `services/grafanaApi.js` | `listAlertRules` / `pauseAlertRule`(last-writer-wins) |
| Settings 快取 | `services/settingsService.js` | 30s in-process cache + KV repo 包裝 |
| Captcha solver | `captcha/apiserver/` | CRNN+CTC 模型,POST `/solve` 回傳 4 字元答案 |
| 備份 | `scripts/backup-db.sh` | `docker exec VACUUM INTO` → `gsutil cp` |

## 4. 資料模型(Data Model)

> 完整 schema 以 `server/src/db.js` 為準;以下為功能視角摘要。

### 4.1 `users`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `email` | TEXT PK | 唯一識別,由 Google OAuth 取得 |
| `role` | TEXT | `'admin'` / `'user'`;`VALID_ROLES` 限制 |
| `created_at` | INTEGER | unix ms |

### 4.2 `passengers`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `user_email` | TEXT | FK → users.email |
| `name`, `id_number`, `phone`, `email` | TEXT | 乘客資料(redact in log) |
| `is_default` | INTEGER | 預設乘客旗標 |

### 4.3 `bookings`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | INTEGER PK | |
| `user_email` | TEXT | 訂票擁有者 |
| `passenger_id` | INTEGER | FK → passengers |
| `start_station`, `dest_station` | TEXT | 站碼(見 config) |
| `travel_date` | TEXT | YYYY-MM-DD |
| `desired_time` | TEXT | HH:mm,期望搭乘時間 |
| `time_window_start`, `time_window_end` | TEXT | 允許搭乘區間 |
| `ticket_count` | INTEGER | 票數(目前 1 張為主) |
| `status` | TEXT | `pending` / `running` / `success` / `failed` / `cancelled` / `refunding` / `refunded` / `refund_failed` |
| `scheduled_at` | INTEGER | 下一次嘗試的 unix ms |
| `max_retries` | INTEGER | 最大重試次數 |
| `retry_count` | INTEGER | 已重試次數 |
| `pnr_code` | TEXT | 訂位代號(成功才有) |
| `created_at`, `updated_at` | INTEGER | unix ms |

### 4.4 `booking_attempts`

每次嘗試一筆,記錄 success/false、訊息、選到的車次、耗時。

### 4.5 `settings`

KV 結構,目前鍵:`notification.bookingSuccess`、`notification.bookingFailure`。

### 4.6 `alert_state`

Grafana webhook dedup;`tryClaim` / `rollbackClaim` 樂觀鎖。

### 4.7 `system_heartbeat`

scheduler/process heartbeat,`/readyz` 檢查最後寫入時間。

## 5. 訂票狀態機(State Machine)

完整圖見 `docs/data_flow.md`。允許轉移:

| 從 | 到 | 觸發 |
|---|---|---|
| pending | running | scheduler `tryClaimBooking()` |
| pending | cancelled | `POST /v1/bookings/:id/cancel` |
| running | success | `_doBooking()` 成功(取得 PNR) |
| running | pending | `handleRetry()`(`scheduledAt = now + 2min`)或排程器恢復卡住 running |
| running | failed | retry_count >= max_retries |
| success | refunding | `POST /v1/bookings/:id/refund` |
| refunding | refunded | `runRefund()` 成功 |
| refunding | refund_failed | `runRefund()` 失敗 |
| refunding | refunding | 排程器恢復卡住 refunding |
| refund_failed | refunding | 再次 POST `/refund` |

## 6. API 介面(Public API,JWT 必要)

> 完整 OpenAPI 規格:`docs/swagger.yaml`;Swagger UI 路徑 `/api-docs`。

### 6.1 Auth

| Method | Path | 說明 |
|---|---|---|
| POST | `/v1/auth/google` | Google OAuth code → JWT |

### 6.2 Passengers

| Method | Path | 權限 |
|---|---|---|
| GET | `/v1/passengers` | user |
| POST | `/v1/passengers` | user |
| DELETE | `/v1/passengers/:id` | user |

### 6.3 Bookings

| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET | `/v1/bookings` | user | 列出自己的訂票 |
| POST | `/v1/bookings` | user | 建立訂票(`scheduled_at` ≤ now 視為立即訂) |
| DELETE | `/v1/bookings/:id` | user | 僅 `success/failed/cancelled/refunded/refund_failed` 可刪 |
| GET | `/v1/bookings/:id/attempts` | user | 列出嘗試紀錄 |
| POST | `/v1/bookings/:id/cancel` | user | 僅 `pending` 可取消 |
| POST | `/v1/bookings/:id/refund` | user | 僅 `success` / `refund_failed` 可退票 |

### 6.4 Admin

| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET / POST / DELETE | `/v1/users[/:email]` | admin | 使用者白名單 |
| GET / PUT | `/v1/settings/notification` | admin | 通知開關 |
| GET | `/v1/alerts/rules` | admin + 60req/5min | Grafana rule 列表 |
| POST | `/v1/alerts/rules/:uid/pause` | admin + 60req/5min | pause/unpause |

### 6.5 Operational

| Method | Path | 權限 | 說明 |
|---|---|---|---|
| GET | `/healthz` | public | liveness |
| GET | `/readyz` | public | readiness(DB + scheduler heartbeat) |
| GET | `/metrics` | Bearer `METRICS_TOKEN` | Prometheus 指標 |
| POST | `/alerts/grafana` | Bearer `ALERT_WEBHOOK_TOKEN` | Grafana webhook → LINE |

## 7. 關鍵流程(Key Flows)

### 7.1 建立預約搶票

1. UI 表單送出 → `POST /v1/bookings`
2. controller 驗證(站碼、日期 ≥ 今天且 ≤ 高鐵開放、`time_window_start ≤ desired_time ≤ time_window_end`)
3. service 寫入 `bookings`,`status='pending'`,`scheduled_at = max(now, 預約時刻)`
4. 排程器於 ≤ 60s 內掃到 → `tryClaimBooking()` 把 `status='pending' → 'running'`(原子更新避免雙重執行)
5. `runBooking()` 跑 THSRC 自動化流程(見下節)
6. 終態寫回 `bookings`,呼叫 `lineNotifier.pushBookingResult()`

### 7.2 THSRC 自動化流程

依序執行:`thsrcInit` → `thsrcGetCaptcha` → solver `/solve` → `thsrcQueryTrains`(S1)→ `selectBestTrain` → `thsrcSubmitBooking`(S2 → S3 → S4)→ `parseBookingResult` 取出 PNR。

關鍵實作細節(以下任一失敗即 retry):

- 兩段式 init(302 不 follow,保留 Akamai cookies)。
- 必帶完整瀏覽器 header(`Connection: keep-alive`, `sec-ch-ua*`, `Sec-Fetch-*`)。
- 每個 POST 都採 `_postAndFollow()`:POST `redirect:manual` → 合併 302 cookie → GET。
- CAPTCHA 答案於 S1 與 S2 重複使用(同一組)。
- `selectBestTrain()`:過濾 `time_window_start ≤ QueryDeparture ≤ time_window_end`,挑離 `desired_time` 最近者。

### 7.3 重試 / 卡住恢復

- `handleRetry(booking, error)`:`retry_count++`,若 `< max_retries` 設 `status='pending'`、`scheduled_at = now + 2min`;否則 `status='failed'`。
- 排程器每輪掃 `running AND updated_at < now - 10min`,重置為 `pending`(防止 process crash 卡死)。

### 7.4 退票

`POST /v1/bookings/:id/refund` → `status='refunding'` → 排程器下一輪由 `runRefund()` 執行 → `refunded` 或 `refund_failed`。

### 7.5 終態通知

`runBooking()` 結束 → `settingsService.isBookingSuccessNotifyEnabled()` / `isBookingFailureNotifyEnabled()`(30s cache)→ 開啟則 `lineNotifier.pushBookingResult()`,fire-and-forget,訊息不含 PII。

### 7.6 Grafana 告警 → LINE

Grafana Cloud Alerting 達閾值 → POST `/alerts/grafana`(Bearer)→ `alertDispatcher.handleWebhook()` → 30 分鐘 dedup → `pushText()`。

## 8. 認證 / 授權

- **登入**:Google OAuth(`/v1/auth/google`),僅 `users` 白名單 email 可登入;JWT 7 天有效,放 `Authorization: Bearer`。
- **角色**:`user`(預設)、`admin`;`adminOnly` middleware 守住管理端點。
- **資源歸屬**:bookings / passengers 強制 `WHERE user_email = current_user`,避免越權。

## 9. 觀測 / Logging

- **Pino** structured log,GCP severity;redact `idNumber`、`password`、`token`、`phone`、`email`。
- **X-Request-Id** middleware:UUID fallback,跨 controller/service 共用 child logger。
- **Prometheus 指標** prefix `thsrc_`:HTTP rate / latency、booking pending/running gauge、booking_status_total counter、captcha solve histogram、Node.js default metrics。
- **Dashboard**:`docs/dashboards/thsrc-overview.json`。

## 10. 部署 / Ops

| 元件 | 部署方式 |
|---|---|
| Server image | `server/deploy-server.sh`(SemVer,DRY_RUN 預覽);watchtower 5min 自動 pull |
| Captcha image | `captcha/apiserver/deploy-gce.sh` |
| UI | `git subtree push --prefix=ui ui main` → GitHub Pages |
| DB 備份 | `/etc/cron.d/thsrc-backup` daily 19:00 UTC,GCS 30 天 retention |
| 還原 | `docs/runbooks/restore-db.md` |
| Rollback | `docs/runbooks/rollback-server.md` |

## 11. 安全與合規

- 所有對外流量 HTTPS(Cloudflare Tunnel)。
- 身分證 / phone 在 log redact;DB 內以明文儲存但僅 owner 可讀(rate-limit + admin only)。
- Token rotation:`METRICS_TOKEN` / `ALERT_WEBHOOK_TOKEN` / `GRAFANA_API_TOKEN` / `LINE_CHANNEL_ACCESS_TOKEN`,改 `.env` 後 `docker compose up -d`。
- Rate limit:admin alerts 端點 60 req / 5 min。
- 不寫入 prod DB(僅 dev 操作);所有 destructive ops 須 ops 確認。

## 12. 測試策略

- **單元**:`cd server && npm test`(不需網路)。
- **整合**:`RUN_NETWORK_TESTS=1 npm test`(需 TW IP,實際打高鐵站)。
- **本地 E2E**:`docker-compose up -d --build`,UI 開 `http://localhost:8082`。
- **健康檢查**:`/healthz`、`/readyz`。

## 13. 限制與已知限制

- 單 VM,無 HA。
- LINE 200 通/月(免費)。
- Captcha 模型準確度約 92%+,confidence 過低觸發重試。
- 高鐵僅允許 28 天內訂票,系統不接受超出範圍的日期。
- 不支援多人團體票,單筆 booking 對應 1 名乘客(現況)。
