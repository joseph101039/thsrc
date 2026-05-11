# PR-7 — Booking 通知 + 後台設定

## 目的
訂票終態(成功 / 重試耗盡失敗)透過 LINE Messaging API 推送通知,管理員可在
`/admin/settings` 開關獨立的「成功通知」「失敗通知」兩個 toggle。

## 範圍
- **In**:settings 表、settingsRepo/Service、lineNotifier 加 booking helper、
  bookingEngineService 終態插 fire-and-forget push、`/v1/settings/notification`
  GET/PUT、`/admin/settings.html` 頁、單元測試
- **Out**:
  - 退票通知(下個 PR)
  - 中途 attempt 失敗通知(規模太細,每筆訂單噴 N 條訊息洗版)
  - 多 admin 個別偏好(現只一個 admin)
  - 富文本 / Flex Message(純文字夠,省 LINE 200/月配額)
  - PR-6b alert rules 管理(獨立 PR,已分析過跟本 PR 不同抽象層)

## 設計決策(已和使用者對齊)
- **存在 `settings` 表(通用 key-value)**:未來 alert toggle 等也走這。
- **二個獨立開關**:`notification.bookingSuccess` / `notification.bookingFailure`,預設兩個都 on。
- **獨立頁 `/admin/settings.html`**:之後其他 toggle 進同頁。
- **bookingEngineService 直接 push**(fire-and-forget):不走 metric+webhook 繞遠路。
- **不節流**:訂票事件量小,不會打爆 LINE 200/月配額。
- **In-process Map cache,寫入 invalidate**:訂票熱路徑不能每次查 DB。

---

## 任務清單(順序執行)

### T1 — DB schema:settings 表
**檔案**:`server/src/db.js`
- `_initSchema` 加:
  ```sql
  CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  ```
- `_migrate` 結尾加 default rows(用 `INSERT OR IGNORE`,不覆寫使用者已改過的值):
  ```sql
  INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
    ('notification.bookingSuccess', 'true', <ISO now>),
    ('notification.bookingFailure', 'true', <ISO now>);
  ```

### T2 — `repositories/settingsRepo.js`(新檔)
```
get(key) → string | null
set(key, value) → void              -- upsert + updated_at = now
list() → [{ key, value, updated_at }]
```
SQL:`INSERT INTO settings(...) ON CONFLICT(key) DO UPDATE SET value=?, updated_at=?`

### T3 — `services/settingsService.js`(新檔)
```js
const CACHE_TTL_MS = 30_000;
const cache = new Map();   // key → { value, expiresAt }

function _readBool(key, defaultVal) { ... }   // cache → repo → default
function isBookingSuccessNotifyEnabled() { return _readBool('notification.bookingSuccess', true); }
function isBookingFailureNotifyEnabled() { return _readBool('notification.bookingFailure', true); }
function setBookingSuccessNotify(bool) { repo.set(...); cache.set(key, { value: bool, expiresAt: Date.now()+TTL }); }
function setBookingFailureNotify(bool) { repo.set(...); cache.set(key, { value: bool, expiresAt: Date.now()+TTL }); }
function getNotificationToggles() { return { bookingSuccess: ..., bookingFailure: ... }; }
```
**關鍵**:
- `_readBool` 對未知 key 走 default(避免漏 migration 把訂票流程炸掉)
- `set*` **直接寫入新值到 cache**(不是 delete)— 避免「並發 reader 在 repo.set 跟 cache.delete
  之間用舊 DB 值填 cache → 之後 30s 拿到 stale」的 race window。寫入新值蓋過任何 reader 殘留。

### T4 — `services/lineNotifier.js` 加 `pushBookingResult`
**追加 export**:
```js
async function pushBookingResult(booking, lastFailedAttempt = null) {
  const isSuccess = booking.status === CONFIG.BOOKING_STATUS.SUCCESS;
  const lines = isSuccess
    ? [
        '✅ [訂票成功]',
        `路線: ${booking.fromStation} → ${booking.toStation}`,
        `日期: ${booking.date}`,
        booking.trainNo ? `車次: ${booking.trainNo}` : null,
        booking.departTime ? `出發: ${booking.departTime}` : null,
        booking.ticketNo ? `票號: ${booking.ticketNo}` : null,
      ]
    : [
        '❌ [訂票失敗] 重試耗盡',
        `路線: ${booking.fromStation} → ${booking.toStation}`,
        `日期: ${booking.date}`,
        `重試: ${booking.retryCount}/${booking.maxRetries}`,
        lastFailedAttempt?.reason ? `原因: ${lastFailedAttempt.reason}` : null,
      ];
  return pushText(lines.filter(Boolean).join('\n'));
}
```
**不加 passenger 姓名**(隱私 + 訊息已夠長)。

### T5 — `bookingRepo.js` 加 `getLastFailedAttempt(bookingId)`
```sql
SELECT id, attempted_at, reason FROM booking_attempts
WHERE booking_id = ? AND success = 0
ORDER BY attempted_at DESC LIMIT 1
```

### T6 — `bookingEngineService.js` 終態插入 fire-and-forget
- **L156 之後**(success 分支內,`return true` 之前):
  ```js
  if (settingsService.isBookingSuccessNotifyEnabled()) {
    const fresh = bookingRepo.getById(bookingId);
    lineNotifier.pushBookingResult(fresh).then(r => {
      if (!r.ok) log.warn({ reason: r.reason }, '訂票成功通知 push 失敗');
    }).catch(err => log.error({ err: err.message }, '訂票成功通知 unexpected error'));
  }
  ```
- **L173 之後**(handleRetry 失敗終態,`childLog.warn` 之前):
  ```js
  if (settingsService.isBookingFailureNotifyEnabled()) {
    const fresh = bookingRepo.getById(booking.id);
    const lastAttempt = bookingRepo.getLastFailedAttempt(booking.id);
    lineNotifier.pushBookingResult(fresh, lastAttempt).then(r => {
      if (!r.ok) childLog.warn({ reason: r.reason }, '訂票失敗通知 push 失敗');
    }).catch(err => childLog.error({ err: err.message }, '訂票失敗通知 unexpected error'));
  }
  ```
**為什麼 re-fetch**:status 才剛 update,記憶體中 booking 是舊值,要用最新 row。

**為什麼用 `.then` 檢查 `r.ok` 而非靠 `.catch`**:現行 `lineNotifier.pushText` 內部已 try/catch
所有錯誤,**不會 reject** — 失敗時 return `{ ok: false, reason }`。靠 `.catch` 等於什麼都不
處理。`.then` 檢查 `ok` 才能在 LINE 失敗時留 log,出問題時看得到。`.catch` 仍保留處理「萬
一未來改成會 throw」的防線。

### T7 — Routes:`server/src/routes/settings.js`(新檔)
```
GET  /v1/settings/notification          → { bookingSuccess: bool, bookingFailure: bool }
PUT  /v1/settings/notification  body { bookingSuccess?: bool, bookingFailure?: bool }
                                        → 200 { ok: true, current: {...} }
```
- `verifyJwt + adminOnly`
- PUT 驗 body 兩個欄位都是 boolean(undefined 跳過,不更動)
- 422 for invalid body

掛到 `routes/v1.js`:
```js
const settingsRouter = require('./settings');
router.use('/settings', settingsRouter);   // verifyJwt + adminOnly 在 settings.js 內套用,避免雙層
```
**Swagger / OpenAPI**:在 `routes/settings.js` 加 JSDoc swagger annotation,跟其他 routes 一致。

**T1 migration ISO timestamp**:`INSERT OR IGNORE` 用 `prepare(...).run(key, value, isoNow)`
parameter binding,不可字串插值。

### T8 — Frontend:`ui/admin-settings.html` + `ui/js/admin-settings.js`
- 兩個 `<input type="checkbox" role="switch">` toggle
- 載入時 GET 一次填值
- onChange 觸發 PUT 對應欄位,顯示「已儲存」 toast(2s 後消失)
- `admin.html` header / nav 加連結到 `admin-settings.html`

### T9 — 測試:`server/test/settings.test.js`(新檔)
- `settingsRepo` set/get/list 基本 CRUD
- `settingsService` cache:首次 hit DB,30s 內 cache hit,`set*` 後立即拿到新值
- `lineNotifier.pushBookingResult` 成功/失敗 format match `/✅.*訂票成功/s` 與 `/❌.*重試耗盡/s`
- `bookingEngineService` 終態(stub `pushText`):
  - success 開關 on → push 被呼叫;off → 不呼叫
  - failed 開關 on → push 被呼叫,訊息含 reason;off → 不呼叫
- `routes/settings`:無 token 401、admin GET 200、PUT 改值再 GET 確認。
- **Stale-booking re-fetch 驗證**:stub `bookingRepo.getById` 回 `{ status:'success', ticketNo:'X' }`,
  確認 `pushBookingResult` 收到的 booking 是 fresh row 而非閉包裡的舊值。
- **LINE-down 不破壞訂票**:stub `pushText` 回 `{ ok: false, reason: 'http_500' }`,跑完整 success
  分支,assert booking.status === 'success'(訂票流程完成),assert log 有 warn。

---

## 風險與決策原因
- **fire-and-forget catch**:LINE timeout 5s,若沒 catch 會把訂票終態 promise reject,
  可能讓 scheduler poll 認為這筆 booking 「失敗」,引發狀態不一致。
- **30s cache**:訂票熱路徑(每次 attempt)若每次查 DB,WAL 寫鎖小但累積無謂讀。
  Set 後 invalidate 確保 admin 切換立即生效。
- **re-fetch booking**:T6 兩處呼叫前現拉一次 row。`updateFields` 後記憶體 booking
  的 status / ticketNo / departTime 是 stale 的,直接傳會洩錯資訊到 LINE。
- **訊息不含旅客姓名**:passenger PII;管理員若需要可從 booking_id 反查。

## 範圍確認後的工作流
1. 開分支 `feat-booking-notification`
2. 依 T1 → T9 順序實作(無平行依賴)
3. 跑 `cd server && npm test`
4. `/requesting-copilot-claude-review`
5. 修 Critical / Important
6. `/commit-commands:commit`
7. local docker 啟動 + UI 操作 toggle 驗證 + 真打一筆訂票看 LINE 收訊
8. 開 PR
