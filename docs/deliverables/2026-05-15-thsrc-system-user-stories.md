# User Stories — THSRC 自動訂票代理系統

| 項目 | 內容 |
|---|---|
| 文件類型 | User Stories |
| 版本 | 1.0(現況回顧) |
| 撰寫日期 | 2026-05-15 |
| 對應 PRD | `2026-05-15-thsrc-system-prd.md` |

> 格式:`As a <role>, I want <goal>, so that <reason>.` 每則附驗收標準(Acceptance Criteria, AC)。
> 角色:**訪客(Guest)**、**一般使用者(User)**、**管理員(Admin)**、**系統(System)**。

---

## Epic 1:身份驗證

### US-1.1 Google SSO 登入

> 作為一位**訪客**,我想使用 Google 帳號登入,以便快速取得使用權限,而不必另外註冊密碼。

**AC**
- 點擊「Google 登入」可成功取得 JWT。
- 非白名單 email 登入,系統回 403 並顯示「未授權」訊息。
- 登入 7 天內不需重新登入;Token 過期後自動導回登入頁。

### US-1.2 自動登出

> 作為**使用者**,我想在 token 過期時系統自動將我登出,以避免我以為仍在登入卻送出失敗請求。

**AC**
- API 收到過期 token 回 401,前端清除 localStorage 並重導登入。

---

## Epic 2:乘客資料管理

### US-2.1 新增乘客

> 作為**使用者**,我想新增常用乘客資料(姓名、身分證、電話、Email),以便訂票時不需重打。

**AC**
- 可儲存多筆;同一身分證重複時提示。
- 身分證 / 電話 / Email 格式錯誤時不可儲存。
- 可標記其中一筆為「預設乘客」,訂票表單自動帶入。

### US-2.2 刪除乘客

> 作為**使用者**,我想刪除不再使用的乘客資料,以便清理個資。

**AC**
- 點擊刪除須二次確認。
- 若已被訂票紀錄關聯,仍可刪除(訂票紀錄保留乘客欄位 snapshot 或外鍵 NULL)。

---

## Epic 3:訂票

### US-3.1 立即訂票

> 作為**使用者**,我想對已開放訂票的車次立即下單,以便馬上拿到 PNR。

**AC**
- 填入出發/目的地、日期、期望時間、區間後送出。
- 系統於 ≤ 60s 內開始執行,狀態由 `pending` 轉 `running`。
- 成功時顯示 PNR 與選到的車次。

### US-3.2 預約搶票

> 作為**使用者**,我想設定未來時間(例如 高鐵開放訂票當下),讓系統自動於該時間幫我搶票。

**AC**
- 可指定 `scheduled_at`(必須晚於現在、早於 28 天後)。
- 預約建立後狀態 `pending`,時間未到前不執行。
- 排程器於 ≤ 60s 內觸發。

### US-3.3 指定允許區間

> 作為**使用者**,我想設定可接受的「最早 / 最晚」搭乘時間,以便不只執著於單一車次。

**AC**
- 系統挑選 `time_window_start ≤ 出發 ≤ time_window_end` 範圍內,離 `desired_time` 最近的車次。
- 區間內全部售罄則重試,直到達 max_retries。

### US-3.4 自動重試

> 作為**使用者**,我希望搶不到票時系統自動再試,直到票買到或達上限。

**AC**
- 失敗時 `retry_count++`,2 分鐘後重試。
- 達 `max_retries`(預設可設)後標記 `failed`。
- 每次嘗試一筆 `booking_attempts`,使用者可查看。

### US-3.5 查看訂票清單與詳情

> 作為**使用者**,我想查看自己所有訂票及每次嘗試紀錄,以便了解進度。

**AC**
- 列出所有狀態,排序依 `created_at desc`。
- 詳情頁顯示嘗試紀錄(時間、結果、訊息、選到的車次)。
- 僅顯示自己的訂票;呼叫他人 ID 回 404。

### US-3.6 取消預約訂票

> 作為**使用者**,我想在系統尚未開始執行前取消預約,以便調整行程。

**AC**
- 僅 `status='pending'` 可取消。
- 取消後狀態 `cancelled`,排程器不再觸發。
- 其他狀態點取消,UI 隱藏按鈕、API 回 409。

### US-3.7 退票

> 作為**使用者**,我想對訂票成功的紀錄發起退票,以便不再需要時取回。

**AC**
- 僅 `success` 與 `refund_failed` 可發起退票。
- 退票進入 `refunding`,後續轉 `refunded` 或 `refund_failed`。
- 失敗可再點一次重試。

### US-3.8 刪除訂票

> 作為**使用者**,我想刪除已完成或失敗的紀錄,以便清單乾淨。

**AC**
- 僅終態(`success`/`failed`/`cancelled`/`refunded`/`refund_failed`)可刪除。
- 刪除後完整移除(含 attempts)。

### US-3.9 LINE 終態通知

> 作為**使用者**,我想在訂票成功或最終失敗時收到 LINE 通知,以便不必持續開頁面確認。

**AC**
- 成功:訊息含路線、車次、票號(PNR);不含 PII。
- 失敗:訊息含路線、重試次數、失敗原因(截 200 字、去 control char)。
- 通知失敗只 log,不阻斷訂票主流程。

---

## Epic 4:管理員後台

### US-4.1 管理白名單

> 作為**管理員**,我想新增 / 刪除可登入的 email,以便控制誰能使用系統。

**AC**
- 僅 `role='admin'` 可呼叫 `/v1/users`。
- 刪除自己時須阻擋。

### US-4.2 切換通知開關

> 作為**管理員**,我想分別關閉「訂票成功」與「訂票失敗」通知,以便控制 LINE 200 通/月配額。

**AC**
- `PUT /v1/settings/notification` 可分別 toggle。
- 切換後 30s 內(cache TTL)生效。

### US-4.3 暫停 Grafana 告警規則

> 作為**管理員**,我想暫停噪音告警規則,避免被 LINE 訊息打擾,同時保留規則本身。

**AC**
- 列出所有 rule(`/v1/alerts/rules`)含 uid、name、isPaused。
- pause/unpause 即時生效(下次 evaluate 開始)。
- 60 req / 5 min rate limit。

---

## Epic 5:系統(自動化角色)

### US-5.1 排程觸發

> 作為**系統**,我想每 60s 掃描到期的 `pending` 訂票並執行,以確保不漏訂。

**AC**
- 排程器 heartbeat 每 60s 寫入 `system_heartbeat`。
- `/readyz` 在 heartbeat 超過 3 分鐘未更新時回 503。

### US-5.2 卡住自動恢復

> 作為**系統**,我想自動恢復卡在 `running` / `refunding` 超過 10 分鐘的訂票,以避免 process crash 後永久卡死。

**AC**
- 排程輪詢時將 `running` 超時者轉 `pending`,`refunding` 超時者轉回 `refunding` 重跑。

### US-5.3 每日備份

> 作為**系統**,我想每天自動把 SQLite 備份到 GCS,以便發生資料毀損可還原。

**AC**
- 每天 19:00 UTC(台灣 03:00)執行,成功上傳一份 `.sqlite.gz`。
- 失敗直接走 LINE push 告警(不經 server)。

### US-5.4 觀測指標

> 作為**系統 / 維運**,我想能透過 Grafana 觀察 booking / captcha / HTTP 指標,以便監控健康。

**AC**
- `/metrics` 對外可拉(Bearer)。
- Grafana Dashboard 含 booking pending/running、success/failed rate、captcha latency、HTTP p95。

### US-5.5 告警轉發

> 作為**系統**,我想把 Grafana Alerting 觸發的告警轉成 LINE 訊息,以便第一時間掌握異常。

**AC**
- `/alerts/grafana` 收 webhook,30 分鐘 dedup。
- firing / resolved 狀態變化即時推。
