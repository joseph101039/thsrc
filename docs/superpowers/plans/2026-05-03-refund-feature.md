# 退票功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增退票功能：對已成功訂票的紀錄，前端新增「退票」按鈕，後端自動執行高鐵退票流程，並同步狀態至 UI。同時在訂位代號旁新增複製 icon。

**Architecture:** DB 新增 `refund_status`/`refund_message` 欄位（migration）；`thsrc.js` 新增 `thsrcCancelBooking()`；新建 `refundEngineService.js` 執行非同步退票；後端 `POST /bookings/:id/refund` 立即回 202，背景執行；前端輪詢現有機制自動更新狀態。

**Tech Stack:** Node.js/CommonJS, node:sqlite, node-fetch, Express, vanilla JS/HTML

---

## 檔案異動清單

| 檔案 | 異動類型 |
|------|----------|
| `server/src/db.js` | 修改 — migration 新增 `refund_status`, `refund_message` |
| `server/src/config.js` | 修改 — 新增 `REFUND_STATUS` 常數 |
| `server/src/thsrc.js` | 修改 — 新增 `thsrcCancelBooking()` |
| `server/src/services/refundEngineService.js` | 新增 |
| `server/src/repositories/bookingRepo.js` | 修改 — `colMap` 新增 refund 欄位 |
| `server/src/controllers/bookingController.js` | 修改 — 新增 `refundBooking()` |
| `server/src/routes/v1.js` | 修改 — 新增 `POST /bookings/:id/refund` |
| `server/src/services/bookingService.js` | 修改 — 新增 `getBookingById()` |
| `server/test/bookings.test.js` | 修改 — 新增退票 API 測試 |
| `ui/js/api.js` | 修改 — 新增 `refundBooking()` |
| `ui/js/index.js` | 修改 — 退票按鈕、複製 icon、新狀態 badge |
| `ui/index.html` | 修改 — 新增 `.badge-refunding`, `.badge-refunded` CSS |

---

## Task 1: DB Migration — 新增 refund 欄位

**Files:**
- Modify: `server/src/db.js`

- [ ] **Step 1: 在 `_migrate()` 加入 migration**

開啟 `server/src/db.js`，在 `_migrate()` 函式的結尾（`db.prepare(...INSERT OR IGNORE...).run(...)` 之後）加入：

```javascript
// 退票欄位 migration
const bookingCols = db.prepare('PRAGMA table_info(bookings)').all().map(r => r.name);
if (!bookingCols.includes('refund_status')) {
  db.exec("ALTER TABLE bookings ADD COLUMN refund_status TEXT");
}
if (!bookingCols.includes('refund_message')) {
  db.exec("ALTER TABLE bookings ADD COLUMN refund_message TEXT");
}
```

- [ ] **Step 2: 驗證 migration 不報錯**

```bash
cd server && node --experimental-sqlite -e "require('./src/db').getDb(); console.log('ok')"
```

Expected: `ok`（無錯誤輸出）

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat: add refund_status and refund_message columns to bookings"
```

---

## Task 2: Config 新增 REFUND_STATUS 常數

**Files:**
- Modify: `server/src/config.js`

- [ ] **Step 1: 在 `BOOKING_STATUS` 後面新增 `REFUND_STATUS`**

在 `server/src/config.js` 的 `BOOKING_STATUS: { ... },` 區塊後面（第 32 行之後），加入：

```javascript
  REFUND_STATUS: {
    REFUNDING: 'refunding',
    REFUNDED: 'refunded',
    REFUND_FAILED: 'refund_failed',
  },
```

完整的 config.js 結尾應如下：

```javascript
  BOOKING_STATUS: {
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
  },

  REFUND_STATUS: {
    REFUNDING: 'refunding',
    REFUNDED: 'refunded',
    REFUND_FAILED: 'refund_failed',
  },
};

module.exports = CONFIG;
```

- [ ] **Step 2: Commit**

```bash
git add server/src/config.js
git commit -m "feat: add REFUND_STATUS constants to config"
```

---

## Task 3: bookingRepo 新增 refund 欄位映射

**Files:**
- Modify: `server/src/repositories/bookingRepo.js`

- [ ] **Step 1: 在 `updateFields()` 的 `colMap` 新增 refund 欄位**

將 `updateFields()` 函式（第 27 行）中的 `colMap` 物件：

```javascript
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
  };
```

改為：

```javascript
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
    refundStatus: 'refund_status', refundMessage: 'refund_message',
  };
```

- [ ] **Step 2: Commit**

```bash
git add server/src/repositories/bookingRepo.js
git commit -m "feat: add refundStatus/refundMessage to bookingRepo colMap"
```

---

## Task 4: bookingService 新增 getBookingById

**Files:**
- Modify: `server/src/services/bookingService.js`

- [ ] **Step 1: 新增 `getBookingById()`**

在 `server/src/services/bookingService.js` 的 `getAttempts()` 之後，新增：

```javascript
function getBookingById(id) {
  return bookingRepo.getById(id);
}
```

並更新 `module.exports`：

```javascript
module.exports = { listBookings, createBooking, deleteBooking, getAttempts, getBookingById };
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/bookingService.js
git commit -m "feat: add getBookingById to bookingService"
```

---

## Task 5: thsrc.js 新增 thsrcCancelBooking

**Files:**
- Modify: `server/src/thsrc.js`

退票流程（根據 HAR）：
1. GET History 頁（同 `thsrcInit` 兩段式，但目標 URL 不同）→ 取得 `HistoryForm` action + captcha URL
2. GET captcha → solve
3. POST HistoryForm（帶身分證 + 訂位代號 + captcha）→ 302 → GET 訂單明細頁
4. 從 HTML 解析 `CancelSeatsButton` ILinkListener URL
5. GET CancelSeatsButton URL → 302 → GET 取消確認頁
6. 從 HTML 解析 `HistoryDetailsCancelForm` action URL
7. POST HistoryDetailsCancelForm（`agree=on`, `SubmitButton=下一步`）→ 302 → GET 結果頁
8. 解析結果頁是否含「取消訂位成功」

- [ ] **Step 1: 在 `thsrc.js` 新增 `thsrcCancelBooking()` 函式**

在 `parseBookingResult()` 函式之後（第 385 行之前），插入以下程式碼：

```javascript
// passenger: { idNumber }
// 退票流程：History 頁初始化 → 查詢訂單 → 點擊取消 → 確認取消 → 解析結果
async function thsrcCancelBooking(ticketNo, passenger) {
  const HISTORY_URL = THSRC_BASE + '/IMINT/?wicket:bookmarkablePage=:tw.com.mitac.webapp.thsr.viewer.History';
  const NAV_HEADERS = {
    ...BROWSER_HEADERS,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  // [1/6] 初始化 session（兩段式，同 thsrcInit）
  console.log('  [退票 1/6] thsrcCancelBooking init session...');
  const res1 = await fetchWithTimeout(HISTORY_URL, { redirect: 'manual', headers: NAV_HEADERS });
  const cookies1 = res1.headers.raw()['set-cookie'] || [];
  const cookieJar1 = cookies1.map(c => c.split(';')[0].trim()).join('; ');

  const res2 = await fetchWithTimeout(HISTORY_URL, {
    redirect: 'follow',
    headers: { ...NAV_HEADERS, 'Cookie': cookieJar1 },
  });
  const cookies2 = res2.headers.raw()['set-cookie'] || [];
  const historyHtml = await res2.text();

  const cookieMap = new Map();
  for (const c of [...cookies1, ...cookies2]) {
    const kv = c.split(';')[0].trim();
    const key = kv.split('=')[0];
    cookieMap.set(key, kv);
  }
  let cookieJar = Array.from(cookieMap.values()).join('; ');

  // 解析 HistoryForm action（含 jsessionid）
  const historyFormMatch = historyHtml.match(/action="(\/IMINT\/[^"]*HistoryForm[^"]*)"/);
  if (!historyFormMatch) throw new Error('找不到 HistoryForm action');
  const historyFormAction = THSRC_BASE + historyFormMatch[1];
  console.log('  [退票 1/6] done — historyFormAction=', historyFormAction.slice(0, 80) + '...');

  // [2/6] 取 captcha
  console.log('  [退票 2/6] 取驗證碼...');
  const captchaUrlMatch = historyHtml.match(/src="(\/IMINT\/[^"]*passCode[^"]*)"/);
  if (!captchaUrlMatch) throw new Error('找不到 History 頁驗證碼 URL');
  const captchaUrl = THSRC_BASE + captchaUrlMatch[1];
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);

  const fetch = require('node-fetch');
  const CONFIG = require('./config');
  console.log('  [退票 2/6] solving captcha...');
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const captchaJson = await captchaRes.json();
  if (!captchaJson.answer) throw new Error('驗證碼辨識失敗：' + JSON.stringify(captchaJson));
  const captchaAnswer = captchaJson.answer;
  console.log('  [退票 2/6] done — answer=', captchaAnswer);

  // [3/6] POST HistoryForm 查詢訂單
  console.log('  [退票 3/6] POST 查詢訂單', ticketNo, '...');
  const POST_HEADERS = (jar) => ({
    ...BROWSER_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cache-Control': 'max-age=0',
    'Cookie': jar,
    'Referer': HISTORY_URL,
    'Origin': THSRC_BASE,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
  });

  const historyPayload = new URLSearchParams({
    'HistoryForm:hf:0': '',
    typesofid: '0',
    rocId: passenger.idNumber,
    orderId: ticketNo,
    'divCaptcha:securityCode': captchaAnswer,
    SubmitButton: '查詢',
  });

  const { html: detailHtml, cookieJar: jar3 } = await _postAndFollow(
    historyFormAction, cookieJar, historyPayload.toString(), POST_HEADERS, null
  );
  cookieJar = jar3;
  console.log('  [退票 3/6] done — detailHtml len=', detailHtml.length);

  // [4/6] 解析並 GET CancelSeatsButton ILinkListener
  console.log('  [退票 4/6] 點擊取消訂位按鈕...');
  const cancelBtnMatch = detailHtml.match(/href="(\/IMINT\/[^"]*CancelSeatsButton[^"]*)"/);
  if (!cancelBtnMatch) throw new Error('找不到取消訂位按鈕連結（訂單可能無法退票）');
  const cancelBtnUrl = THSRC_BASE + cancelBtnMatch[1];

  const cancelBtnRes = await fetchWithTimeout(cancelBtnUrl, {
    redirect: 'manual',
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  const cancelBtnCookies = cancelBtnRes.headers.raw()['set-cookie'] || [];
  const cancelBtnRedirect = cancelBtnRes.headers.get('location');

  // 合併 cookie
  const cmapBtn = new Map();
  for (const c of cookieJar.split(';')) { const kv = c.trim(); const key = kv.split('=')[0]; if (key) cmapBtn.set(key, kv); }
  for (const c of cancelBtnCookies) { const kv = c.split(';')[0].trim(); const key = kv.split('=')[0]; cmapBtn.set(key, kv); }
  cookieJar = Array.from(cmapBtn.values()).join('; ');

  const cancelConfirmUrl = cancelBtnRedirect
    ? (cancelBtnRedirect.startsWith('http') ? cancelBtnRedirect : THSRC_BASE + cancelBtnRedirect)
    : cancelBtnUrl;

  // [5/6] GET 取消確認頁，解析 HistoryDetailsCancelForm action
  console.log('  [退票 5/6] 取消確認頁...');
  const confirmRes = await fetchWithTimeout(cancelConfirmUrl, {
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'follow',
  });
  const confirmHtml = await confirmRes.text();
  console.log('  [退票 5/6] done — confirmHtml len=', confirmHtml.length);

  const cancelFormMatch = confirmHtml.match(/action="(\/IMINT\/[^"]*HistoryDetailsCancelForm[^"]*)"/);
  if (!cancelFormMatch) throw new Error('找不到取消確認表單 action');
  const cancelFormAction = THSRC_BASE + cancelFormMatch[1];

  // [6/6] POST 確認取消
  console.log('  [退票 6/6] POST 確認取消...');
  const cancelPayload = new URLSearchParams({
    'HistoryDetailsCancelForm:hf:0': '',
    agree: 'on',
    SubmitButton: '下一步',
  });

  const { html: resultHtml } = await _postAndFollow(
    cancelFormAction, cookieJar, cancelPayload.toString(), POST_HEADERS, null
  );
  console.log('  [退票 6/6] done — resultHtml len=', resultHtml.length, 'has 取消訂位成功=', resultHtml.includes('取消訂位成功'));

  if (resultHtml.includes('取消訂位成功')) {
    return { success: true, message: '取消訂位成功' };
  }
  // 嘗試擷取錯誤訊息
  const errMatch = resultHtml.match(/class="[^"]*error[^"]*"[^>]*>([^<]{3,100})</);
  const message = errMatch ? errMatch[1].trim() : '退票失敗（未知原因）';
  return { success: false, message };
}
```

- [ ] **Step 2: 將 `thsrcCancelBooking` 加入 `module.exports`**

將最後一行：

```javascript
module.exports = { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain, parseTrainOptions };
```

改為：

```javascript
module.exports = { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, thsrcCancelBooking, selectBestTrain, parseTrainOptions };
```

- [ ] **Step 3: 移除函式內 `require` 重複宣告**

注意 `thsrcCancelBooking` 函式內用了 `require('node-fetch')` 和 `require('./config')`，但這些已在檔案頂部宣告。需將函式內這兩行刪除（它們只是備忘用）：

```javascript
  const fetch = require('node-fetch');
  const CONFIG = require('./config');
```

確認 `thsrc.js` 頂部已有：
- `const fetch = require('node-fetch');`（第 3 行）
- `const CONFIG = require('./config');`（第 4 行）

刪除 `thsrcCancelBooking` 函式內的這兩行。

- [ ] **Step 4: Commit**

```bash
git add server/src/thsrc.js
git commit -m "feat: add thsrcCancelBooking() for THSRC cancellation flow"
```

---

## Task 6: 新增 refundEngineService.js

**Files:**
- Create: `server/src/services/refundEngineService.js`

- [ ] **Step 1: 新增 `server/src/services/refundEngineService.js`**

```javascript
'use strict';

const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcCancelBooking } = require('../thsrc');

const REFUND_TIMEOUT_MS = 120000;

async function runRefund(bookingId) {
  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  bookingRepo.updateFields(bookingId, { refundStatus: CONFIG.REFUND_STATUS.REFUNDING });
  console.log('runRefund start:', bookingId, booking.ticketNo);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('退票逾時（120秒）')), REFUND_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doRefund(bookingId, booking), timeout]);
  } catch (err) {
    console.error('runRefund error:', err.message);
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: err.message,
    });
  }
}

async function _doRefund(bookingId, booking) {
  const passenger = passengerRepo.getById(booking.passengerId);
  if (!passenger) throw new Error('旅客資料不存在：' + booking.passengerId);

  const result = await thsrcCancelBooking(booking.ticketNo, { idNumber: passenger.idNumber });
  console.log('_doRefund result:', result);

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUNDED,
      refundMessage: result.message,
    });
    console.log('退票成功：', bookingId, booking.ticketNo);
  } else {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: result.message,
    });
    console.log('退票失敗：', bookingId, result.message);
  }
}

module.exports = { runRefund };
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/refundEngineService.js
git commit -m "feat: add refundEngineService with runRefund()"
```

---

## Task 7: 後端 API — refundBooking controller 與 route

**Files:**
- Modify: `server/src/controllers/bookingController.js`
- Modify: `server/src/routes/v1.js`

- [ ] **Step 1: 在 bookingController.js 新增 import 和 `refundBooking()`**

在 `server/src/controllers/bookingController.js` 頂部，在 `const bookingService = require('../services/bookingService');` 之後加入：

```javascript
const { runRefund } = require('../services/refundEngineService');
```

在 `getAttempts()` 函式之後（最後一個函式），加入：

```javascript
function refundBooking(req, res) {
  try {
    const booking = bookingService.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: '找不到訂票紀錄' });
    }
    if (booking.status !== 'success') {
      return res.status(400).json({ error: '只有成功訂票才能退票' });
    }
    if (booking.refundStatus === 'refunding' || booking.refundStatus === 'refunded') {
      return res.status(400).json({ error: '該訂票已在退票中或已完成退票' });
    }
    // 非同步執行退票，不等待
    runRefund(req.params.id).catch(err => console.error('refundBooking background error:', err.message));
    res.status(202).json({ success: true });
  } catch (err) {
    console.error('refundBooking error:', err.message);
    res.status(500).json({ error: err.message });
  }
}
```

更新 `module.exports`（最後一行）：

```javascript
module.exports = { listBookings, createBooking, deleteBooking, getAttempts, refundBooking };
```

- [ ] **Step 2: 在 routes/v1.js 新增 refund 路由**

在 `router.get('/bookings/:id/attempts', ...)` 這行之後，加入：

```javascript
router.post('/bookings/:id/refund',       verifyJwt, bookingController.refundBooking);
```

- [ ] **Step 3: Commit**

```bash
git add server/src/controllers/bookingController.js server/src/routes/v1.js
git commit -m "feat: add POST /bookings/:id/refund endpoint"
```

---

## Task 8: 後端測試 — 退票 API

**Files:**
- Modify: `server/test/bookings.test.js`

- [ ] **Step 1: 寫失敗測試（非成功訂票不能退票）**

在 `server/test/bookings.test.js` 最後，新增：

```javascript
test('POST /v1/bookings/:id/refund：非 success 狀態應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    // 新建 pending 狀態的訂票
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const refundRes = await request(server, 'POST', `/v1/bookings/${id}/refund`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(refundRes.status, 400);
    assert.ok(refundRes.body.error);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：不存在的 id 應回傳 404', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const refundRes = await request(server, 'POST', '/v1/bookings/nonexistent-id/refund', null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(refundRes.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const refundRes = await request(server, 'POST', '/v1/bookings/some-id/refund', null);
    assert.strictEqual(refundRes.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 執行測試確認通過**

```bash
cd server && npm test
```

Expected: 所有測試通過（包含新增的 3 個）

- [ ] **Step 3: Commit**

```bash
git add server/test/bookings.test.js
git commit -m "test: add refund API tests"
```

---

## Task 9: 前端 — api.js 新增 refundBooking

**Files:**
- Modify: `ui/js/api.js`

- [ ] **Step 1: 新增 `refundBooking` 到 api 物件**

在 `ui/js/api.js` 的 `api` 物件中，在 `deleteBooking` 之後新增：

```javascript
  refundBooking:      (id)         => postJson(`/v1/bookings/${id}/refund`, {}),
```

完整的 `api` 物件結尾應如下：

```javascript
const api = {
  googleAuth:         (credential) => postJson('/v1/auth/google', { credential }),
  getPassengers:      ()           => getJson('/v1/passengers'),
  savePassenger:      (data)       => postJson('/v1/passengers', data),
  deletePassenger:    (id)         => deleteJson(`/v1/passengers/${id}`),
  getBookings:        ()           => getJson('/v1/bookings'),
  createBooking:      (data)       => postJson('/v1/bookings', data),
  deleteBooking:      (id)         => deleteJson(`/v1/bookings/${id}`),
  refundBooking:      (id)         => postJson(`/v1/bookings/${id}/refund`, {}),
  getBookingAttempts: (id)         => getJson(`/v1/bookings/${id}/attempts`),
  getAllowedUsers:     ()           => getJson('/v1/users'),
  addAllowedUser:     (data)       => postJson('/v1/users', data),
  deleteAllowedUser:  (email)      => deleteJson(`/v1/users/${encodeURIComponent(email)}`),
};
```

- [ ] **Step 2: Commit**

```bash
git add ui/js/api.js
git commit -m "feat: add refundBooking to api.js"
```

---

## Task 10: 前端 — index.js 退票按鈕、複製 icon、狀態 badge

**Files:**
- Modify: `ui/js/index.js`

- [ ] **Step 1: 更新 `STATUS_LABEL` 加入退票狀態**

將 `STATUS_LABEL` 物件（第 11–16 行）：

```javascript
const STATUS_LABEL = {
  pending: { text: '等待中', cls: 'badge-pending' },
  running: { text: '搶票中', cls: 'badge-running' },
  success: { text: '成功',   cls: 'badge-success' },
  failed:  { text: '失敗',   cls: 'badge-failed'  },
};
```

改為：

```javascript
const STATUS_LABEL = {
  pending:       { text: '等待中', cls: 'badge-pending'   },
  running:       { text: '搶票中', cls: 'badge-running'   },
  success:       { text: '成功',   cls: 'badge-success'   },
  failed:        { text: '失敗',   cls: 'badge-failed'    },
  refunding:     { text: '退票中', cls: 'badge-refunding' },
  refunded:      { text: '已退票', cls: 'badge-refunded'  },
  refund_failed: { text: '退票失敗', cls: 'badge-failed'  },
};
```

- [ ] **Step 2: 更新 `bookingCard()` 加入退票按鈕和複製 icon**

將 `bookingCard(b)` 函式（第 18–41 行）整個替換為：

```javascript
function bookingCard(b) {
  const statusKey = b.refundStatus === 'refunding' ? 'refunding'
    : b.refundStatus === 'refunded' ? 'refunded'
    : b.refundStatus === 'refund_failed' ? 'refund_failed'
    : b.status;
  const s = STATUS_LABEL[statusKey] || { text: statusKey, cls: '' };
  const scheduledInfo = b.scheduledAt
    ? `<div class="card-sub">預約時間：${formatTW(b.scheduledAt)}</div>`
    : '';

  const canDelete = b.status === 'success' || b.status === 'failed';
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger" style="padding:6px 14px;font-size:13px" onclick="event.stopPropagation();deleteBooking('${b.id}')">刪除</button>`
    : '';

  const canRefund = b.status === 'success' && !b.refundStatus;
  const refundBtn = canRefund
    ? `<button class="btn btn-warning" style="padding:6px 14px;font-size:13px;margin-right:6px" onclick="event.stopPropagation();refundBooking('${b.id}')">退票</button>`
    : '';

  const copyIcon = b.ticketNo
    ? `<span onclick="event.stopPropagation();copyTicketNo('${b.ticketNo}')" title="複製訂位代號" style="cursor:pointer;margin-left:6px;opacity:0.7">📋</span>`
    : '';

  const refundMsg = b.refundMessage
    ? `<div class="card-sub" style="color:var(--danger)">${b.refundMessage}</div>`
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
      ${b.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${b.ticketNo}${copyIcon}</div>` : ''}
      ${refundMsg}
      ${(refundBtn || deleteBtn) ? `<div class="card-actions">${refundBtn}${deleteBtn}</div>` : ''}
    </div>
  `;
}
```

- [ ] **Step 3: 新增 `refundBooking()` 和 `copyTicketNo()` 函式**

在 `deleteBooking()` 函式之後（第 51 行之後），新增：

```javascript
async function refundBooking(id) {
  if (!confirm('確定要退票？退票後無法復原。')) return;
  try {
    await api.refundBooking(id);
    // 立即重新載入以反映「退票中」狀態
    await loadBookings();
  } catch (err) {
    alert('退票失敗：' + err.message);
  }
}

function copyTicketNo(ticketNo) {
  navigator.clipboard.writeText(ticketNo).then(() => {
    alert('已複製訂位代號：' + ticketNo);
  }).catch(() => {
    alert('複製失敗，請手動複製：' + ticketNo);
  });
}
```

- [ ] **Step 4: 更新自動輪詢觸發條件，加入 `.badge-refunding`**

將輪詢判斷（第 75–78 行）：

```javascript
setInterval(() => {
  const hasPending = document.querySelector('.badge-running, .badge-pending');
  if (hasPending) loadBookings();
}, 30000);
```

改為：

```javascript
setInterval(() => {
  const hasPending = document.querySelector('.badge-running, .badge-pending, .badge-refunding');
  if (hasPending) loadBookings();
}, 30000);
```

- [ ] **Step 5: Commit**

```bash
git add ui/js/index.js
git commit -m "feat: add refund button, copy icon, and refund status badges to booking card"
```

---

## Task 11: 前端 — 新增 badge CSS 樣式

**Files:**
- Modify: `ui/index.html`

- [ ] **Step 1: 確認現有 badge 樣式**

搜尋 `ui/index.html` 中 `.badge-` 相關 CSS，找到現有樣式區塊。

```bash
grep -n "badge" /Users/joseph/projects/nodejs/thsrc/ui/index.html | head -20
```

- [ ] **Step 2: 新增 `.badge-refunding` 和 `.badge-refunded` 樣式**

在現有 `.badge-failed` 樣式之後，插入：

```css
.badge-refunding { background: #ff9800; color: #fff; }
.badge-refunded  { background: #9e9e9e; color: #fff; }
```

（如果 `.badge-running` 已是橙色，可直接用 `badge-running` 的顏色值；`.badge-refunded` 用灰色表示已完成退票）

- [ ] **Step 3: Commit**

```bash
git add ui/index.html
git commit -m "feat: add badge-refunding and badge-refunded CSS styles"
```

---

## Task 12: 整合驗證

- [ ] **Step 1: 執行後端單元測試**

```bash
cd server && npm test
```

Expected: 全部測試通過，無失敗

- [ ] **Step 2: 本地啟動服務**

```bash
cd /Users/joseph/projects/nodejs/thsrc
docker-compose up --build -d
cd ui && npm run dev
```

Expected: server 在 port 8081，UI dev server 在 port 8082

- [ ] **Step 3: 瀏覽器驗證**

開啟 `http://localhost:8082`：
1. 有已成功訂票的紀錄 → 確認「退票」按鈕出現，「刪除」按鈕仍在
2. 訂位代號旁有 📋 icon → 點擊確認顯示「已複製」提示
3. 點擊退票 → 出現確認對話框 → 確認後狀態立即變「退票中」
4. 等待後端完成（或失敗）→ 輪詢 30 秒後自動更新為「已退票」或「退票失敗」
5. 「退票中」狀態的訂票不再顯示退票按鈕
