# 訂票詳情頁 + 嘗試紀錄 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 點擊訂票紀錄 card 進入詳情頁，顯示每次嘗試的成功/失敗記錄；移除 email 通知；修正 scheduledAt 時間格式為台灣時間。

**Architecture:** 新增 `booking_attempts` SQLite table，`booking_engine.js` 每次嘗試後寫入紀錄；API 新增 `getBookingAttempts` action；前端新增 `booking-detail.html` + `js/booking-detail.js`，`index.js` card 改為可點擊跳轉並修正時間格式。

**Tech Stack:** Node.js/CommonJS、node:sqlite（`DatabaseSync`）、Vanilla HTML/CSS/JS（無框架）、node:test（測試）

---

## 檔案異動總覽

| 動作 | 檔案 | 說明 |
|------|------|------|
| 修改 | `server/src/db.js` | 新增 attempts table、migrate、DB 函式 |
| 修改 | `server/src/api.js` | 新增 `getBookingAttempts` action |
| 修改 | `server/src/booking_engine.js` | 寫入嘗試紀錄、移除 email |
| 修改 | `server/test/thsrc.integration.test.js` | 新增 DB 函式單元測試 |
| 修改 | `ui/js/api.js` | 新增 `getBookingAttempts` |
| 修改 | `ui/js/index.js` | card 可點擊、scheduledAt 格式修正 |
| 新增 | `ui/booking-detail.html` | 詳情頁 HTML |
| 新增 | `ui/js/booking-detail.js` | 詳情頁邏輯 |

---

### Task 1：DB — 新增 booking_attempts table 與函式

**Files:**
- Modify: `server/src/db.js`
- Modify: `server/test/thsrc.integration.test.js`

- [ ] **Step 1：在 `_initSchema()` 加入 booking_attempts table**

在 `server/src/db.js` 的 `_initSchema()` 函式中，`db.exec(...)` 的 SQL 字串最後加上：

```js
function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passengers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      id_number  TEXT NOT NULL,
      type       TEXT NOT NULL,
      email      TEXT NOT NULL,
      phone      TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id            TEXT PRIMARY KEY,
      passenger_id  TEXT NOT NULL,
      from_station  TEXT NOT NULL,
      to_station    TEXT NOT NULL,
      date          TEXT NOT NULL,
      desired_time  TEXT NOT NULL,
      earliest_time TEXT NOT NULL,
      latest_time   TEXT NOT NULL,
      max_retries   INTEGER NOT NULL DEFAULT 10,
      scheduled_at  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      retry_count   INTEGER NOT NULL DEFAULT 0,
      train_no      TEXT,
      ticket_no     TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS booking_attempts (
      id            TEXT PRIMARY KEY,
      booking_id    TEXT NOT NULL,
      attempted_at  TEXT NOT NULL,
      success       INTEGER NOT NULL,
      reason        TEXT
    );
  `);
}
```

- [ ] **Step 2：新增兩個 DB 函式**

在 `server/src/db.js` 的 `getStuckRunningBookings` 函式後面（`module.exports` 之前）加入：

```js
function createBookingAttempt({ bookingId, success, reason }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO booking_attempts (id, booking_id, attempted_at, success, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, bookingId, now, success ? 1 : 0, reason || null);
  return { success: true, id };
}

function getAttemptsByBookingId(bookingId) {
  return getDb().prepare(`
    SELECT * FROM booking_attempts WHERE booking_id = ? ORDER BY attempted_at ASC
  `).all(bookingId).map(_toCamel);
}
```

- [ ] **Step 3：更新 module.exports**

將 `module.exports` 改為：

```js
module.exports = {
  getPassengers, savePassenger, deletePassenger,
  getBookings, createBooking, updateBookingFields, deleteBooking,
  getBookingById, getPassengerById,
  getPendingBookings, getStuckRunningBookings,
  createBookingAttempt, getAttemptsByBookingId,
};
```

- [ ] **Step 4：寫測試**

在 `server/test/thsrc.integration.test.js` 最後加入（`selectBestTrain` 測試後面）：

```js
const db = require('../src/db');

test('createBookingAttempt 和 getAttemptsByBookingId：可寫入並查詢嘗試紀錄', () => {
  // 先建一個假 booking（直接操作 db 底層）
  const bookingId = 'test-booking-' + Date.now();
  const now = new Date().toISOString();
  db.getBookings(); // 確保 DB 已初始化

  // 寫入失敗嘗試
  db.createBookingAttempt({ bookingId, success: false, reason: '無可用班次' });
  // 寫入成功嘗試
  db.createBookingAttempt({ bookingId, success: true, reason: null });

  const attempts = db.getAttemptsByBookingId(bookingId);
  assert.equal(attempts.length, 2, '應有 2 筆嘗試紀錄');
  assert.equal(attempts[0].success, 0, '第一筆應為失敗');
  assert.equal(attempts[0].reason, '無可用班次');
  assert.equal(attempts[1].success, 1, '第二筆應為成功');
  assert.equal(attempts[1].reason, null);
  assert.ok(attempts[0].attemptedAt, '應有 attemptedAt 欄位');
});
```

- [ ] **Step 5：跑測試確認通過**

```bash
cd server && npm test
```

預期：全部 PASS（含新增的 `createBookingAttempt` 測試）

- [ ] **Step 6：Commit**

```bash
git add server/src/db.js server/test/thsrc.integration.test.js
git commit -m "feat: 新增 booking_attempts table 與 DB 函式"
```

---

### Task 2：API — 新增 getBookingAttempts action

**Files:**
- Modify: `server/src/api.js`

- [ ] **Step 1：新增 action**

在 `server/src/api.js` 的 switch 中，`deleteBooking` case 後面加入：

```js
case 'getBookingAttempts': result = { attempts: db.getAttemptsByBookingId(id) }; break;
```

完整 switch 區塊變成：

```js
switch (action) {
  case 'getPassengers':        result = { passengers: db.getPassengers() };            break;
  case 'savePassenger':        result = db.savePassenger(data);                        break;
  case 'deletePassenger':      result = db.deletePassenger(id);                        break;
  case 'getBookings':          result = { bookings: db.getBookings() };                break;
  case 'createBooking':        result = db.createBooking(data);                        break;
  case 'deleteBooking':        result = db.deleteBooking(id);                          break;
  case 'getBookingAttempts':   result = { attempts: db.getAttemptsByBookingId(id) };  break;
  default:
    return res.status(400).json({ error: 'Unknown action: ' + action });
}
```

- [ ] **Step 2：手動驗證 API（本機 server 必須在跑）**

```bash
# 另一個 terminal 跑 server
node --experimental-sqlite src/api.js

# 測試 action（id 用任意字串）
curl -s -X POST http://localhost:8081/ \
  -H 'Content-Type: application/json' \
  -d '{"action":"getBookingAttempts","id":"nonexistent"}' | node -e "process.stdin|0;const d=[];process.stdin.on('data',c=>d.push(c));process.stdin.on('end',()=>console.log(JSON.parse(d.join(''))))"
```

預期回傳：`{ attempts: [] }`

- [ ] **Step 3：Commit**

```bash
git add server/src/api.js
git commit -m "feat: API 新增 getBookingAttempts action"
```

---

### Task 3：booking_engine — 寫入嘗試紀錄、移除 email

**Files:**
- Modify: `server/src/booking_engine.js`

- [ ] **Step 1：移除 mailer import，加入 db 的新函式**

將第 7 行：
```js
const { sendSuccessEmail, sendFailureEmail } = require('./mailer');
```
刪除。

`db` 已經在第 5 行 `require('./db')`，只需確認 `createBookingAttempt` 可從 `db` 直接呼叫（因為 db.js 已 export）。

- [ ] **Step 2：在 `_doBooking()` 成功後寫入 attempt**

找到 `_doBooking()` 中成功區塊：

```js
  if (result.success) {
    db.updateBookingFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
    });
    const updatedBooking = db.getBookingById(bookingId);
    await sendSuccessEmail(passenger.email, updatedBooking, passenger);
    console.log('  [done] 訂票成功：', bookingId, result.ticketNo);
  } else {
    return handleRetry(booking, result.error);
  }
```

改為：

```js
  if (result.success) {
    db.updateBookingFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
    });
    db.createBookingAttempt({ bookingId, success: true, reason: null });
    console.log('  [done] 訂票成功：', bookingId, result.ticketNo);
  } else {
    return handleRetry(booking, result.error);
  }
```

- [ ] **Step 3：在 `handleRetry()` 寫入失敗 attempt，移除 failure email**

找到 `handleRetry()` 函式：

```js
function handleRetry(booking, reason) {
  const newRetryCount = (booking.retryCount || 0) + 1;
  db.updateBookingFields(booking.id, { retryCount: newRetryCount });

  if (newRetryCount >= booking.maxRetries) {
    db.updateBookingFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    const passenger = db.getPassengerById(booking.passengerId);
    if (passenger) {
      const updatedBooking = db.getBookingById(booking.id);
      sendFailureEmail(passenger.email, updatedBooking, passenger, reason).catch(console.error);
    }
    console.log('Booking failed after max retries:', booking.id);
  } else {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
    db.updateBookingFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    console.log('Scheduled retry', newRetryCount, '/', booking.maxRetries, 'for booking:', booking.id);
  }
}
```

改為：

```js
function handleRetry(booking, reason) {
  const newRetryCount = (booking.retryCount || 0) + 1;
  db.updateBookingFields(booking.id, { retryCount: newRetryCount });
  db.createBookingAttempt({ bookingId: booking.id, success: false, reason });

  if (newRetryCount >= booking.maxRetries) {
    db.updateBookingFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    console.log('Booking failed after max retries:', booking.id);
  } else {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
    db.updateBookingFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    console.log('Scheduled retry', newRetryCount, '/', booking.maxRetries, 'for booking:', booking.id);
  }
}
```

- [ ] **Step 4：跑測試確認無 regression**

```bash
cd server && npm test
```

預期：全部 PASS

- [ ] **Step 5：Commit**

```bash
git add server/src/booking_engine.js
git commit -m "feat: 訂票嘗試結果寫入 DB，移除 email 通知"
```

---

### Task 4：前端 API + index.js 修改

**Files:**
- Modify: `ui/js/api.js`
- Modify: `ui/js/index.js`

- [ ] **Step 1：`api.js` 新增 getBookingAttempts**

在 `ui/js/api.js` 的 `api` 物件中加入：

```js
const api = {
  getPassengers:      ()     => gasCall('getPassengers'),
  savePassenger:      (data) => gasCall('savePassenger', { data }),
  deletePassenger:    (id)   => gasCall('deletePassenger', { id }),
  getBookings:        ()     => gasCall('getBookings'),
  createBooking:      (data) => gasCall('createBooking', { data }),
  deleteBooking:      (id)   => gasCall('deleteBooking', { id }),
  getBookingAttempts: (id)   => gasCall('getBookingAttempts', { id }),
};
```

- [ ] **Step 2：`index.js` 加入 formatTW helper**

在 `ui/js/index.js` 最頂部（`const STATUS_LABEL` 前）加入：

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

- [ ] **Step 3：`index.js` 修改 bookingCard()**

將 `bookingCard()` 函式完整替換為：

```js
function bookingCard(b) {
  const s = STATUS_LABEL[b.status] || { text: b.status, cls: '' };
  const scheduledInfo = b.scheduledAt
    ? `<div class="card-sub">預約時間：${formatTW(b.scheduledAt)}</div>`
    : '';
  const canDelete = b.status === 'success' || b.status === 'failed';
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger" style="padding:6px 14px;font-size:13px" onclick="event.stopPropagation();deleteBooking('${b.id}')">刪除</button>`
    : '';
  return `
    <div class="card" id="booking-${b.id}" style="cursor:pointer" onclick="location.href='booking-detail.html?id=${b.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${b.fromStation} → ${b.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      <div class="card-sub">日期：${b.date}　期望：${b.desiredTime}</div>
      <div class="card-sub">允許區間：${b.earliestTime} ~ ${b.latestTime}</div>
      ${scheduledInfo}
      <div class="card-sub">嘗試次數：${b.retryCount || 0} / ${b.maxRetries}</div>
      ${b.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${b.ticketNo}</div>` : ''}
      ${deleteBtn ? `<div class="card-actions">${deleteBtn}</div>` : ''}
    </div>
  `;
}
```

- [ ] **Step 4：本機驗證（dev server 必須在跑）**

```bash
cd ui && npm run dev
# 開啟 http://localhost:8082
# 確認：card 可點擊、scheduledAt 顯示台灣時間格式（若有預約時間的訂單）
```

- [ ] **Step 5：Commit**

```bash
git add ui/js/api.js ui/js/index.js
git commit -m "feat: 前端 card 可點擊跳轉詳情頁，scheduledAt 顯示台灣時間"
```

---

### Task 5：新增 booking-detail.html + booking-detail.js

**Files:**
- Create: `ui/booking-detail.html`
- Create: `ui/js/booking-detail.js`

- [ ] **Step 1：建立 `ui/booking-detail.html`**

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>訂票詳情</title>
  <link rel="stylesheet" href="css/style.css">
  <style>
    .attempt-list { list-style: none; padding: 0; }
    .attempt-item {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
    }
    .attempt-item:last-child { border-bottom: none; }
    .attempt-icon { font-size: 20px; flex-shrink: 0; line-height: 1.4; }
    .attempt-body { flex: 1; }
    .attempt-seq { font-size: 12px; color: var(--text-muted); margin-bottom: 2px; }
    .attempt-time { font-size: 13px; color: var(--text-muted); }
    .attempt-reason { font-size: 14px; color: var(--danger); margin-top: 2px; }
    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin: 20px 0 10px;
    }
  </style>
</head>
<body>
  <header class="page-header">
    <button class="back-btn" onclick="history.back()">&#8592;</button>
    <h1 id="page-title">訂票詳情</h1>
  </header>

  <main class="page-content">
    <div id="detail-content">
      <div class="loading">載入中...</div>
    </div>
  </main>

  <nav class="bottom-nav">
    <a href="index.html" class="nav-item active">
      <span class="nav-icon">🎫</span>
      <span>訂票紀錄</span>
    </a>
    <a href="passengers.html" class="nav-item">
      <span class="nav-icon">👤</span>
      <span>乘客設定</span>
    </a>
  </nav>

  <script src="js/api.js"></script>
  <script src="js/booking-detail.js"></script>
</body>
</html>
```

- [ ] **Step 2：建立 `ui/js/booking-detail.js`**

```js
const STATUS_LABEL = {
  pending: { text: '等待中', cls: 'badge-pending' },
  running: { text: '搶票中', cls: 'badge-running' },
  success: { text: '成功',   cls: 'badge-success' },
  failed:  { text: '失敗',   cls: 'badge-failed'  },
};

function formatTW(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function renderDetail(booking, attempts) {
  const s = STATUS_LABEL[booking.status] || { text: booking.status, cls: '' };

  const attemptsHtml = attempts.length === 0
    ? '<div class="card-sub" style="padding:16px 0">尚無嘗試紀錄</div>'
    : `<ul class="attempt-list">${attempts.map((a, i) => `
        <li class="attempt-item">
          <span class="attempt-icon">${a.success ? '✅' : '❌'}</span>
          <div class="attempt-body">
            <div class="attempt-seq">第 ${i + 1} 次嘗試</div>
            <div class="attempt-time">${formatTW(a.attemptedAt)}</div>
            ${!a.success && a.reason ? `<div class="attempt-reason">${a.reason}</div>` : ''}
          </div>
        </li>`).join('')}</ul>`;

  return `
    <div class="section-title">訂單資訊</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${booking.fromStation} → ${booking.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      <div class="card-sub">日期：${booking.date}</div>
      <div class="card-sub">期望時間：${booking.desiredTime}</div>
      <div class="card-sub">允許區間：${booking.earliestTime} ~ ${booking.latestTime}</div>
      ${booking.scheduledAt ? `<div class="card-sub">預約時間：${formatTW(booking.scheduledAt)}</div>` : ''}
      <div class="card-sub">嘗試次數：${booking.retryCount || 0} / ${booking.maxRetries}</div>
      ${booking.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600;margin-top:8px">訂位代號：${booking.ticketNo}</div>` : ''}
    </div>

    <div class="section-title">嘗試紀錄</div>
    <div class="card">${attemptsHtml}</div>
  `;
}

async function loadDetail() {
  const params = new URLSearchParams(location.search);
  const bookingId = params.get('id');
  const el = document.getElementById('detail-content');

  if (!bookingId) {
    el.innerHTML = '<div class="alert alert-warning">無效的訂票 ID</div>';
    return;
  }

  try {
    const [{ bookings }, { attempts }] = await Promise.all([
      api.getBookings(),
      api.getBookingAttempts(bookingId),
    ]);

    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) {
      el.innerHTML = '<div class="alert alert-warning">找不到此訂票紀錄</div>';
      return;
    }

    document.getElementById('page-title').textContent =
      `${booking.fromStation} → ${booking.toStation}`;
    el.innerHTML = renderDetail(booking, attempts);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadDetail();
```

- [ ] **Step 3：本機驗證**

```bash
cd ui && npm run dev
# 開啟 http://localhost:8082
# 1. 點擊任一訂票 card → 應跳轉到 booking-detail.html?id=XXX
# 2. 詳情頁顯示訂單資訊與嘗試紀錄（初次可能為空）
# 3. 點左箭頭 ← 應返回 index.html
# 4. 刪除按鈕點擊不應觸發跳轉
```

- [ ] **Step 4：Commit**

```bash
git add ui/booking-detail.html ui/js/booking-detail.js
git commit -m "feat: 新增訂票詳情頁，顯示嘗試紀錄"
```

---

### Task 6：部署確認

- [ ] **Step 1：跑完整測試**

```bash
cd server && npm test
```

預期：全部 PASS

- [ ] **Step 2：部署 server**

```bash
cd /Users/joseph/projects/nodejs/thsrc
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh
```

- [ ] **Step 3：部署前端**

```bash
git push origin main:gh-pages
```

- [ ] **Step 4：線上驗證**

開啟 `https://joseph101039.github.io/thsrc/ui/`：
1. 訂票紀錄 card 可點擊跳轉詳情頁
2. 詳情頁顯示正確資訊與嘗試紀錄
3. 返回按鈕正常
4. `scheduledAt` 顯示台灣時間（若有預約時間訂單）
