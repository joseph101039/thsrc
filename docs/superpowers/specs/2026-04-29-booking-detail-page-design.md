# 設計文件：訂票詳情頁 + 嘗試紀錄

## 背景

`index.html` 的訂票紀錄 card 目前只顯示靜態摘要，無法查看每次嘗試的結果與失敗原因。`scheduledAt` 預約時間以 ISO8601 原始字串顯示，未轉換為台灣時間。

## 目標

1. 點擊 card 跳到新的詳情頁，顯示訂單資訊與每次嘗試的成功/失敗記錄
2. 詳情頁可返回上一頁
3. 修正 `scheduledAt` 顯示格式為台灣時間（+8）

---

## 資料層

### 新增 `booking_attempts` table

```sql
CREATE TABLE IF NOT EXISTS booking_attempts (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  attempted_at  TEXT NOT NULL,   -- UTC ISO8601
  success       INTEGER NOT NULL, -- 0 = 失敗, 1 = 成功
  reason        TEXT              -- 失敗原因；成功時為 null
);
```

透過 `_migrate()` 在現有 DB 自動建立（`CREATE TABLE IF NOT EXISTS`）。

### 新增 DB 函式（`server/src/db.js`）

- `createBookingAttempt({ bookingId, success, reason })` — 寫入一次嘗試紀錄
- `getAttemptsByBookingId(bookingId)` — 回傳該訂單所有嘗試，按 `attempted_at ASC` 排序

### `booking_engine.js` 修改

- `_doBooking()` 成功後：`createBookingAttempt({ bookingId, success: true, reason: null })`
- `handleRetry()` 時：`createBookingAttempt({ bookingId: booking.id, success: false, reason })`

### API 新增 action（`server/src/api.js`）

```
action: 'getBookingAttempts'
payload: { id: <bookingId> }
response: { attempts: [...] }
```

---

## 前端

### `ui/js/api.js`

新增：
```js
getBookingAttempts: (id) => gasCall('getBookingAttempts', { id }),
```

### 時間格式 helper

在 `index.js` 與 `booking-detail.js` 共用同一個 helper：

```js
function formatTW(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}
```

### `ui/js/index.js` 修改

- `bookingCard()` 中 `scheduledAt` 改用 `formatTW(b.scheduledAt)` 顯示
- card 整體加上 `cursor: pointer`，`onclick="location.href='booking-detail.html?id=${b.id}'"` 
- 刪除按鈕的 `onclick` 加上 `event.stopPropagation()` 防止觸發 card 跳轉

### 新增 `ui/booking-detail.html`

結構：
```
[← header：路線名稱]
[訂單資訊區塊]
  路線、日期、期望時間、允許區間、狀態 badge、訂位代號（成功時）、預約時間（有時）、嘗試次數
[嘗試紀錄區塊]
  時間軸列表，每筆：序號、時間（台灣時區）、成功✅ / 失敗❌、失敗原因
  無紀錄時顯示「尚無嘗試紀錄」
[底部導覽列]
```

### 新增 `ui/js/booking-detail.js`

- 從 `location.search` 取得 `id`
- 同時呼叫 `api.getBookings()` 取單筆（過濾）與 `api.getBookingAttempts(id)`
- 渲染訂單資訊與嘗試時間軸

---

## 其他修改

### 移除 Email 通知（`server/src/booking_engine.js`）

訂票成功與失敗都不寄送 email，移除：
- `_doBooking()` 中的 `await sendSuccessEmail(...)`
- `handleRetry()` 中的 `sendFailureEmail(...).catch(console.error)`
- `require('./mailer')` import

---

## 不在本次範圍

- 每步驟耗時、車次資訊等詳細 log
- 嘗試紀錄的刪除功能
- 分頁（嘗試次數有限，全部顯示即可）
