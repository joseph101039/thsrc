# Use Cases — THSRC 自動訂票代理系統

| 項目 | 內容 |
|---|---|
| 文件類型 | Use Cases(使用情境) |
| 版本 | 1.0(現況回顧) |
| 撰寫日期 | 2026-05-15 |
| 對應 PRD / FSD | `2026-05-15-thsrc-system-prd.md` / `-fsd.md` |

> 主要參與者(Actor):**User**(一般使用者)、**Admin**、**System**(排程器 / 通知模組)、**THSRC**(外部系統)、**CAPTCHA Solver**(外部服務)、**Grafana Cloud**(外部觀測平台)、**LINE Messaging API**(外部通知)。

---

## UC-01 預約搶票(主要場景)

| 欄位 | 內容 |
|---|---|
| **編號** | UC-01 |
| **名稱** | 預約於指定時間自動訂票 |
| **主要 Actor** | User |
| **支援 Actor** | System(scheduler、booking engine)、CAPTCHA Solver、THSRC、LINE |
| **前置條件** | 已登入(JWT 有效);至少一筆乘客資料 |
| **後置條件(成功)** | `bookings.status='success'`,PNR 寫入;LINE 推送成功通知 |
| **後置條件(失敗)** | `bookings.status='failed'`,記錄最後失敗原因;LINE 推送失敗通知 |
| **頻率** | 高(系統最常用情境) |

### 主流程

1. User 開啟訂票頁、填入:出發站、目的地、travel_date、desired_time、time_window、ticket_count、passenger、scheduled_at、max_retries。
2. User 送出 → 前端 `POST /v1/bookings`(Bearer JWT)。
3. Server 驗證輸入,寫入 `bookings`(`status='pending'`)、回 201。
4. UI 跳轉訂票列表,顯示「預約中」。
5. Scheduler 於 ≤ 60s 內掃到 `pending AND scheduled_at <= now`,以原子 update 把 `status='pending' → 'running'`。
6. Booking engine 執行 THSRC 流程(Init → CAPTCHA → S1 → S2 → S3 → S4)。
7. 取得 PNR;寫入 `bookings.pnr_code`,`status='success'`。
8. 寫一筆 `booking_attempts(success=true)`。
9. 若通知開關開啟,LINE 推送成功訊息。

### 替代流程

- **A1 CAPTCHA 解題錯誤** — Solver 回 confidence 過低或答案被 WAF 拒,回到步驟 6 重新取一張 CAPTCHA,直到該次嘗試的內部重試上限後,跳到例外 E1。
- **A2 區間內無剩餘車次** — `selectBestTrain` 找不到符合條件車次,跳例外 E1。

### 例外流程

- **E1 訂票嘗試失敗** — `handleRetry()`:`retry_count++`,若 `< max_retries` 則 `status='pending'`,`scheduled_at = now + 2min`;否則 `status='failed'`。
- **E2 Process crash(`running` 卡住)** — 下輪排程器發現 `running` 且 `updated_at < now - 10min`,重置為 `pending`。
- **E3 LINE 推送失敗** — log warn,不影響訂票結果。

### 商業規則

- `travel_date` 不可早於今天、晚於 28 天後(高鐵開放上限)。
- `time_window_start ≤ desired_time ≤ time_window_end`。
- 同一 user_email 同時間只能 claim 一筆(原子 update 防雙跑)。

---

## UC-02 立即訂票

| 欄位 | 內容 |
|---|---|
| **編號** | UC-02 |
| **主要 Actor** | User |
| **前置條件** | 同 UC-01 |

### 主流程

與 UC-01 相同,差別僅在 `scheduled_at <= now`(立即進入排程候選)。Scheduler 下一輪即觸發。

---

## UC-03 取消預約訂票

| 編號 | UC-03 |
|---|---|
| **主要 Actor** | User |
| **前置條件** | 自己的訂票存在,`status='pending'` |
| **後置條件(成功)** | `status='cancelled'`,排程器不再觸發 |

### 主流程

1. User 在列表點「取消」。
2. UI `POST /v1/bookings/:id/cancel`。
3. Server 確認資源屬於 user 且 `status='pending'`,改為 `cancelled`。
4. 回 200,UI 更新狀態。

### 例外流程

- **E1 已被排程器搶到(`status='running'`)** — Server 回 409 Conflict;UI 顯示「執行中無法取消」。

---

## UC-04 退票

| 編號 | UC-04 |
|---|---|
| **主要 Actor** | User |
| **支援 Actor** | System(scheduler + booking engine 跑 `runRefund()`)、THSRC |
| **前置條件** | `status='success'` 或 `refund_failed` |

### 主流程

1. User 點「退票」。
2. `POST /v1/bookings/:id/refund` → `status='refunding'`。
3. Scheduler 下一輪由 `runRefund()` 執行,登入 THSRC 完成退票表單。
4. 成功:`status='refunded'`;失敗:`refund_failed`。

### 例外

- **E1 退票失敗** — `status='refund_failed'`,使用者可重複觸發。
- **E2 卡住** — 排程器將 `refunding` 卡 10min 者重置(同樣的 `runRefund()` 再跑)。

---

## UC-05 查看訂票嘗試紀錄

| 編號 | UC-05 |
|---|---|
| **主要 Actor** | User |
| **前置條件** | 訂票存在且屬於 user |

### 主流程

1. UI 進入訂票詳情。
2. `GET /v1/bookings/:id/attempts` → 回每次嘗試:時間、success、訊息、選到的車次代碼、耗時。
3. UI 以表格呈現。

---

## UC-06 管理員管理白名單

| 編號 | UC-06 |
|---|---|
| **主要 Actor** | Admin |
| **前置條件** | `role='admin'` |

### 主流程

1. Admin 進入後台頁。
2. `GET /v1/users` 列出。
3. `POST /v1/users { email, role }` 新增;`DELETE /v1/users/:email` 刪除。

### 例外

- **E1 非 admin** — Middleware 回 403。
- **E2 刪除自己** — Service 層阻擋,回 400。

---

## UC-07 管理員調整通知開關

| 編號 | UC-07 |
|---|---|
| **主要 Actor** | Admin |

### 主流程

1. Admin 進入 `admin-settings.html`。
2. `GET /v1/settings/notification` 取得目前 toggle。
3. 切換成功 / 失敗通知開關 → `PUT /v1/settings/notification`。
4. 30s 內(settings cache TTL)生效。

---

## UC-08 管理員暫停 Grafana 告警

| 編號 | UC-08 |
|---|---|
| **主要 Actor** | Admin |
| **支援 Actor** | Grafana Cloud Alerting API |

### 主流程

1. Admin 進入 admin-settings 的「告警規則」section。
2. `GET /v1/alerts/rules`(10s in-process cache;rate limit 60 req/5min)。
3. 點 pause → `POST /v1/alerts/rules/:uid/pause`。
4. Server GET → mutate `isPaused` → PUT 到 Grafana provisioning API(last-writer-wins,不支援 ETag 條件 PUT)。

### 例外

- **E1 Grafana API 失敗** — 回 5xx,UI 顯示重試提示。
- **E2 並發寫入衝突** — last-writer-wins,後到者覆蓋。已知限制,待轉 IaC SoT 時改善。

---

## UC-09 系統卡住恢復

| 編號 | UC-09 |
|---|---|
| **主要 Actor** | System(scheduler) |

### 主流程

1. Scheduler 每 60s 觸發。
2. SQL:`UPDATE bookings SET status='pending' WHERE status='running' AND updated_at < now - 10min`。
3. 下輪重新 claim 並執行。

---

## UC-10 每日 DB 備份

| 編號 | UC-10 |
|---|---|
| **主要 Actor** | System(VM cron) |
| **支援 Actor** | GCS、LINE Messaging API |

### 主流程

1. 19:00 UTC,`/etc/cron.d/thsrc-backup` 觸發 `backup-db.sh`。
2. `docker exec` 進 server,執行 `VACUUM INTO /tmp/backup.sqlite`。
3. `docker cp` 出 container,gzip。
4. `gsutil cp` 上 GCS,bucket `sincere-office-thsrc-db-backup/daily/YYYY-MM-DD.sqlite.gz`。
5. 30 天 lifecycle 自動刪除舊備份。

### 例外

- **E1 VACUUM / cp / gsutil 任一失敗** — 腳本直接以 `curl` 打 LINE push API 告警(不經 server 避免循環依賴)。

---

## UC-11 Grafana 告警 → LINE

| 編號 | UC-11 |
|---|---|
| **主要 Actor** | Grafana Cloud Alerting |
| **支援 Actor** | System(server.alertDispatcher)、LINE |

### 主流程

1. Grafana rule 觸發(firing 或 resolved)。
2. Contact point webhook → `POST /alerts/grafana`(Bearer `ALERT_WEBHOOK_TOKEN`)。
3. `alertDispatcher.handleWebhook()`:對每個 alert 查 `alert_state.last_status` / `last_sent_at`。
4. 30 分鐘 dedup:若狀態未變且 30 分內已推過,skip。
5. 狀態變化(firing↔resolved)立即推。
6. `pushText()` → LINE。

### 例外

- **E1 Token 不符** — 回 401。
- **E2 LINE API 失敗** — log warn,`rollbackClaim` 還原 dedup state 讓下次重試。

---

## UC-12 訂票終態 LINE 通知

| 編號 | UC-12 |
|---|---|
| **主要 Actor** | System(booking engine) |

### 主流程

1. `runBooking()` 進入終態(`success` / `failed`)。
2. 讀 `settingsService` cache 取得對應 toggle。
3. 若 enabled:`pushBookingResult(booking, lastFailedAttempt)`。
4. 訊息組裝(路線、車次、PNR 或 失敗原因);去 PII、去 control char、reason 截 200 字。
5. Fire-and-forget POST LINE Messaging API。

### 例外

- **E1 toggle 關閉** — 不發送。
- **E2 LINE 失敗** — log warn,不影響訂票終態。
