# Booking Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ticket type quantities, time/train toggle, passenger ownership, ID masking, and ID format validation across booking frontend and backend.

**Architecture:** Backend-first: DB migration → repo → service → controller → thsrc.js. Then frontend: auth helper → booking form → listing/detail → passengers page. Each task is independently testable.

**Tech Stack:** Node.js/Express, node:sqlite, vanilla JS frontend (no framework), node:test for backend tests.

---

## Task 1: DB Migration — 8 new columns on `bookings`

**Files:**
- Modify: `server/src/db.js`

- [ ] **Step 1: Add migrations in `_migrate()`**

In `server/src/db.js`, inside `_migrate()`, add after the existing `retry_wait_unit` block:

```js
  if (!bookingCols.includes('ticket_adult')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_adult INTEGER NOT NULL DEFAULT 1");
  }
  if (!bookingCols.includes('ticket_child')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_child INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_disabled')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_disabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_senior')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_senior INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_student')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_student INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('search_mode')) {
    db.exec("ALTER TABLE bookings ADD COLUMN search_mode TEXT NOT NULL DEFAULT 'time'");
  }
  if (!bookingCols.includes('train_no_target')) {
    db.exec("ALTER TABLE bookings ADD COLUMN train_no_target TEXT");
  }
  if (!bookingCols.includes('owner_email')) {
    db.exec("ALTER TABLE bookings ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''");
  }
```

- [ ] **Step 2: Start server to verify migration runs without error**

```bash
cd server && node --experimental-sqlite src/api.js &
sleep 2 && curl -s http://localhost:8081/ && kill %1
```

Expected: server starts, health check returns OK, no sqlite errors in output.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat: migrate bookings table — add ticket counts, search_mode, train_no_target, owner_email"
```

---

## Task 2: Repo — `bookingRepo.create()` accepts new fields + `colMap` entries

**Files:**
- Modify: `server/src/repositories/bookingRepo.js`

- [ ] **Step 1: Update `create()` to accept and store new fields**

Replace the `create` function signature and INSERT statement:

```js
function create({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt, retryWaitValue, retryWaitUnit, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent, searchMode, trainNoTarget, ownerEmail }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no,
       retry_wait_value, retry_wait_unit,
       ticket_adult, ticket_child, ticket_disabled, ticket_senior, ticket_student,
       search_mode, train_no_target, owner_email,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries ?? 10, scheduledAt ?? null,
         retryWaitValue ?? 2, retryWaitUnit ?? 'minute',
         ticketAdult ?? 1, ticketChild ?? 0, ticketDisabled ?? 0, ticketSenior ?? 0, ticketStudent ?? 0,
         searchMode ?? 'time', trainNoTarget ?? null, ownerEmail ?? '',
         now, now);
  return { success: true, id };
}
```

- [ ] **Step 2: Add new camelCase keys to `colMap` in `updateFields()`**

The `colMap` in `updateFields` already handles most fields. No new fields need `updateFields` support (ticket counts are set at create time and never updated). No change needed here.

- [ ] **Step 3: Run existing tests to confirm nothing broken**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/repositories/bookingRepo.js
git commit -m "feat: bookingRepo.create() accepts ticket counts, searchMode, trainNoTarget, ownerEmail"
```

---

## Task 3: Service — validation for new booking fields

**Files:**
- Modify: `server/src/services/bookingService.js`
- Modify: `server/test/bookings.test.js`

- [ ] **Step 1: Write failing tests**

Append to `server/test/bookings.test.js`:

```js
test('POST /v1/bookings：ticketAdult=0 其他也都是 0 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 0, ticketChild: 0, ticketDisabled: 0, ticketSenior: 0, ticketStudent: 0,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：ticketAdult=11 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 11,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：searchMode=train 且無 trainNoTarget 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      searchMode: 'train',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：ticket counts 和 searchMode 應被儲存並回傳', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 2, ticketChild: 1,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === id);
    assert.strictEqual(booking.ticketAdult, 2);
    assert.strictEqual(booking.ticketChild, 1);
    assert.strictEqual(booking.searchMode, 'time');
    assert.strictEqual(booking.ownerEmail, 'joseph101039@gmail.com');
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test 2>&1 | grep -E "fail|FAIL|pass|PASS|Error" | tail -20
```

Expected: new tests fail (validation not yet implemented).

- [ ] **Step 3: Add validation in `bookingService.createBooking()`**

In `server/src/services/bookingService.js`, update `createBooking`:

```js
function createBooking(data) {
  const { retryWaitUnit, retryWaitValue, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent, searchMode, trainNoTarget } = data;

  // retryWait validation (existing)
  const hasUnit  = retryWaitUnit  !== undefined;
  const hasValue = retryWaitValue !== undefined;
  if (hasUnit !== hasValue) {
    throw Object.assign(new Error('retryWaitUnit 和 retryWaitValue 必須同時提供'), { status: 400 });
  }
  if (hasUnit && !['minute', 'second'].includes(retryWaitUnit)) {
    throw Object.assign(new Error('retryWaitUnit 必須為 minute 或 second'), { status: 400 });
  }
  if (hasValue) {
    const effectiveUnit = retryWaitUnit ?? 'minute';
    const max = effectiveUnit === 'second' ? 300 : 60;
    if (!Number.isInteger(retryWaitValue) || retryWaitValue < 1 || retryWaitValue > max) {
      throw Object.assign(new Error('retryWaitValue 超出允許範圍'), { status: 400 });
    }
  }

  // ticket counts validation
  const tickets = {
    ticketAdult:    ticketAdult    ?? 1,
    ticketChild:    ticketChild    ?? 0,
    ticketDisabled: ticketDisabled ?? 0,
    ticketSenior:   ticketSenior   ?? 0,
    ticketStudent:  ticketStudent  ?? 0,
  };
  for (const [key, val] of Object.entries(tickets)) {
    if (!Number.isInteger(val) || val < 0 || val > 10) {
      throw Object.assign(new Error(`${key} 必須為 0–10 的整數`), { status: 400 });
    }
  }
  const totalTickets = Object.values(tickets).reduce((a, b) => a + b, 0);
  if (totalTickets < 1) {
    throw Object.assign(new Error('至少需要一張票'), { status: 400 });
  }

  // searchMode validation
  const effectiveSearchMode = searchMode ?? 'time';
  if (!['time', 'train'].includes(effectiveSearchMode)) {
    throw Object.assign(new Error('searchMode 必須為 time 或 train'), { status: 400 });
  }
  if (effectiveSearchMode === 'train' && !trainNoTarget) {
    throw Object.assign(new Error('車次搜尋模式必須提供 trainNoTarget'), { status: 400 });
  }

  return bookingRepo.create(data);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/bookingService.js server/test/bookings.test.js
git commit -m "feat: validate ticket counts, searchMode, trainNoTarget in bookingService"
```

---

## Task 4: Controller — pass `ownerEmail` + 403 guard on mutate

**Files:**
- Modify: `server/src/controllers/bookingController.js`
- Modify: `server/test/bookings.test.js`

- [ ] **Step 1: Write failing tests**

Append to `server/test/bookings.test.js`:

```js
function makeTokenFor(email, role = 'user') {
  return jwt.sign({ email, role }, 'test-secret', { expiresIn: '1h' });
}

test('DELETE /v1/bookings/:id：user 刪除他人的訂票應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner@example.com');
    const otherToken = makeTokenFor('other@example.com');

    // owner 建立訂票
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    // 先取消（才能刪除），用 owner token
    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${ownerToken}` });

    // other user 嘗試刪除
    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${otherToken}` });
    assert.strictEqual(delRes.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/cancel：user 取消他人的訂票應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner2@example.com');
    const otherToken = makeTokenFor('other2@example.com');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    const id = createRes.body.id;

    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${otherToken}` });
    assert.strictEqual(cancelRes.status, 403);

    // 清理
    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${ownerToken}` });
    await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${ownerToken}` });
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('admin 可以刪除他人的訂票', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner3@example.com');
    const adminToken = makeTokenFor('admin@example.com', 'admin');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    const id = createRes.body.id;

    // admin 取消
    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(cancelRes.status, 200);

    // admin 刪除
    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(delRes.status, 200);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npm test 2>&1 | grep -E "fail|403" | tail -10
```

Expected: new 403 tests fail.

- [ ] **Step 3: Update `bookingController.js`**

```js
function createBooking(req, res) {
  try {
    const result = bookingService.createBooking({ ...req.body, ownerEmail: req.user.email });
    if (req.body.immediate && result.id) {
      runBooking(result.id).catch(err => console.error('createBooking immediate runBooking error:', err.message));
    }
    res.json(result);
  } catch (err) {
    console.error('createBooking error:', err.message);
    const status = [400, 401, 403, 404, 409].includes(err.status) ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
}

function _checkOwner(booking, user) {
  if (!booking) return;
  if (user.role === 'admin') return;
  if (booking.ownerEmail !== user.email) {
    throw Object.assign(new Error('無權限操作他人的訂票'), { status: 403 });
  }
}

function deleteBooking(req, res) {
  try {
    const booking = bookingService.getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: '找不到訂票紀錄' });
    _checkOwner(booking, req.user);
    res.json(bookingService.deleteBooking(req.params.id));
  } catch (err) {
    console.error('deleteBooking error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}

function cancelBooking(req, res) {
  try {
    const booking = bookingService.getBookingById(req.params.id);
    if (!booking) return res.status(404).json({ error: '找不到訂票紀錄' });
    _checkOwner(booking, req.user);
    res.json(bookingService.cancelBooking(req.params.id));
  } catch (err) {
    console.error('cancelBooking error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}

function refundBooking(req, res) {
  try {
    const booking = bookingService.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: '找不到訂票紀錄' });
    }
    _checkOwner(booking, req.user);
    if (booking.status !== 'success') {
      return res.status(400).json({ error: '只有成功訂票才能退票' });
    }
    if (booking.refundStatus === 'refunding' || booking.refundStatus === 'refunded') {
      return res.status(400).json({ error: '該訂票已在退票中或已完成退票' });
    }
    bookingRepo.updateFields(req.params.id, { refundStatus: 'refunding' });
    runRefund(req.params.id).catch(err => console.error('refundBooking background error:', err.message));
    res.status(202).json({ success: true });
  } catch (err) {
    console.error('refundBooking error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}
```

Keep `listBookings`, `getAttempts`, imports and `module.exports` unchanged.

- [ ] **Step 4: Run tests**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/controllers/bookingController.js server/test/bookings.test.js
git commit -m "feat: pass ownerEmail on create; 403 guard on delete/cancel/refund for non-owner"
```

---

## Task 5: Passenger service — ID format validation

**Files:**
- Modify: `server/src/services/passengerService.js`
- Modify: `server/test/passengers.test.js`

- [ ] **Step 1: Check existing passenger tests**

```bash
cd server && cat test/passengers.test.js | head -60
```

- [ ] **Step 2: Write failing test**

Append to `server/test/passengers.test.js`:

```js
test('POST /v1/passengers：身分證格式錯誤應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'user' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(server, 'POST', '/v1/passengers', {
      name: '測試',
      idNumber: 'a123456789',  // lowercase — invalid
      type: 'adult',
      email: 'test@example.com',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/passengers：身分證格式正確應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'user' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(server, 'POST', '/v1/passengers', {
      name: '測試',
      idNumber: 'A123456789',
      type: 'adult',
      email: 'test@example.com',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd server && npm test 2>&1 | grep -E "身分證|fail" | tail -10
```

Expected: ID format test fails (no validation yet).

- [ ] **Step 4: Add validation in `passengerService.js`**

```js
'use strict';

const passengerRepo = require('../repositories/passengerRepo');

const ID_NUMBER_RE = /^[A-Z]\d{9}$/;

function listPassengers() {
  return passengerRepo.getAll();
}

function savePassenger(data) {
  if (data.idNumber && !ID_NUMBER_RE.test(data.idNumber)) {
    throw Object.assign(new Error('身分證格式錯誤，應為一個大寫英文字母加 9 位數字'), { status: 400 });
  }
  return passengerRepo.upsert(data);
}

function deletePassenger(id) {
  return passengerRepo.deleteById(id);
}

module.exports = { listPassengers, savePassenger, deletePassenger };
```

- [ ] **Step 5: Update `passengerController.js` to propagate status**

In `server/src/controllers/passengerController.js`, update `savePassenger`:

```js
function savePassenger(req, res) {
  try {
    res.json(passengerService.savePassenger(req.body));
  } catch (err) {
    console.error('savePassenger error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}
```

- [ ] **Step 6: Run tests**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/src/services/passengerService.js server/src/controllers/passengerController.js server/test/passengers.test.js
git commit -m "feat: validate passenger ID number format /^[A-Z]\\d{9}$/"
```

---

## Task 6: `thsrc.js` — dynamic ticket fields + train-number search mode

**Files:**
- Modify: `server/src/thsrc.js`

- [ ] **Step 1: Update `thsrcQueryTrains()` to accept ticket counts and search mode**

In `thsrcQueryTrains`, the function signature currently accepts `{ fromStation, toStation, date, earliestTime, latestTime, captcha, bookingMethod }`. Update to accept the full booking object fields:

Replace the hardcoded ticket lines and add train-mode support. Find the `payload` block (around line 131) and replace it:

```js
async function thsrcQueryTrains(cookieJar, formAction, { fromStation, toStation, date, earliestTime, latestTime, captcha, bookingMethod, searchMode, trainNoTarget, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent }) {
  const dateFormatted = date.replace(/-/g, '/');
  const timeTableValue = TIME_TABLE_VALUES[earliestTime] || earliestTime;

  const adultCount    = ticketAdult    ?? 1;
  const childCount    = ticketChild    ?? 0;
  const disabledCount = ticketDisabled ?? 0;
  const seniorCount   = ticketSenior   ?? 0;
  const studentCount  = ticketStudent  ?? 0;

  const effectiveSearchMode = searchMode ?? 'time';
  const effectiveBookingMethod = effectiveSearchMode === 'train' ? 'radio32' : (bookingMethod || 'radio31');

  const payload = new URLSearchParams({
    'BookingS1Form:hf:0': '',
    'trainCon:trainRadioGroup': '0',
    'tripCon:typesoftrip': '0',
    'seatCon:seatRadioGroup': '0',
    bookingMethod: effectiveBookingMethod,
    selectStartStation: CONFIG.STATION_CODES[fromStation],
    selectDestinationStation: CONFIG.STATION_CODES[toStation],
    toTimeInputField: dateFormatted,
    backTimeInputField: dateFormatted,
    toTimeTable: effectiveSearchMode === 'time' ? timeTableValue : '',
    toTrainIDInputField: effectiveSearchMode === 'train' ? (trainNoTarget || '') : '',
    backTimeTable: '',
    backTrainIDInputField: '',
    'ticketPanel:rows:0:ticketAmount': `${adultCount}F`,
    'ticketPanel:rows:1:ticketAmount': `${childCount}H`,
    'ticketPanel:rows:2:ticketAmount': `${disabledCount}W`,
    'ticketPanel:rows:3:ticketAmount': `${seniorCount}E`,
    'ticketPanel:rows:4:ticketAmount': `${studentCount}P`,
    ticketTypeNum: `${adultCount}F,${childCount}H,${disabledCount}W,${seniorCount}E,${studentCount}P`,
    'homeCaptcha:securityCode': captcha || '',
    SubmitButton: '開始查詢',
    portalTag: 'false',
    isShowTeenager: '0',
    isTicketAmount: 'false',
  });
```

- [ ] **Step 2: Update `thsrcSubmitBooking()` S2 payload to use dynamic ticket counts**

Find the `s2Payload` block (around line 277) and replace hardcoded ticket lines:

```js
async function thsrcSubmitBooking(cookieJar, s2FormAction, { trainNo, captcha, passenger, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent }) {
  // ... existing POST_HEADERS setup unchanged ...

  const adultCount    = ticketAdult    ?? 1;
  const childCount    = ticketChild    ?? 0;
  const disabledCount = ticketDisabled ?? 0;
  const seniorCount   = ticketSenior   ?? 0;
  const studentCount  = ticketStudent  ?? 0;

  const s2Payload = new URLSearchParams({
    'BookingS2Form:hf:0': '',
    'TrainQueryDataViewPanel:TrainGroup': trainNo,
    'ticketPanel:rows:0:ticketAmount': `${adultCount}F`,
    'ticketPanel:rows:1:ticketAmount': `${childCount}H`,
    'ticketPanel:rows:2:ticketAmount': `${disabledCount}W`,
    'ticketPanel:rows:3:ticketAmount': `${seniorCount}E`,
    'ticketPanel:rows:4:ticketAmount': `${studentCount}P`,
    toPayment: '確認訂位',
    'homeCaptcha:securityCode': captcha,
  });
```

- [ ] **Step 3: Update `bookingEngineService.js` to pass ticket counts to thsrc calls**

In `server/src/services/bookingEngineService.js`, update `_doBooking`:

In the `thsrcQueryTrains` call (around line 55), add booking ticket fields:

```js
  const { trains, s2FormAction, cookieJar: queryCookieJar } = await thsrcQueryTrains(cookieJar, formAction, {
    fromStation: booking.fromStation,
    toStation: booking.toStation,
    date: booking.date,
    earliestTime: booking.earliestTime,
    latestTime: booking.latestTime,
    captcha: captchaAnswer,
    bookingMethod,
    searchMode: booking.searchMode,
    trainNoTarget: booking.trainNoTarget,
    ticketAdult: booking.ticketAdult,
    ticketChild: booking.ticketChild,
    ticketDisabled: booking.ticketDisabled,
    ticketSenior: booking.ticketSenior,
    ticketStudent: booking.ticketStudent,
  });
```

In the `thsrcSubmitBooking` call (around line 78), add ticket fields:

```js
  const result = await thsrcSubmitBooking(queryCookieJar, s2FormAction, {
    trainNo: bestTrain.radioValue,
    captcha: captchaAnswer,
    passenger: { idNumber: passenger.idNumber, phone: passenger.phone || '', email: passenger.email },
    ticketAdult: booking.ticketAdult,
    ticketChild: booking.ticketChild,
    ticketDisabled: booking.ticketDisabled,
    ticketSenior: booking.ticketSenior,
    ticketStudent: booking.ticketStudent,
  });
```

- [ ] **Step 4: Run tests**

```bash
cd server && npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/thsrc.js server/src/services/bookingEngineService.js
git commit -m "feat: thsrc dynamic ticket counts; train-number search mode (radio32)"
```

---

## Task 7: Frontend — expose `getEmail()` in `auth.js`

**Files:**
- Modify: `ui/js/auth.js`

- [ ] **Step 1: Add `getEmail()` to `window.__auth`**

In `ui/js/auth.js`, inside the IIFE, add after `getRole`:

```js
  function getEmail() {
    const token = getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1])).email || null;
    } catch { return null; }
  }
```

And update the export line:

```js
  window.__auth = { getToken, logout, getRole, getEmail };
```

- [ ] **Step 2: Commit**

```bash
git add ui/js/auth.js
git commit -m "feat: expose getEmail() on window.__auth"
```

---

## Task 8: Frontend — `utils.js` with `maskId` helper

**Files:**
- Create: `ui/js/utils.js`

- [ ] **Step 1: Create `ui/js/utils.js`**

```js
function maskId(idNumber, passengerEmail, myEmail) {
  if (passengerEmail === myEmail) return idNumber;
  if (!idNumber || idNumber.length <= 5) return idNumber;
  const mid = idNumber.length - 5;
  return idNumber.slice(0, 3) + '*'.repeat(mid) + idNumber.slice(-2);
}
```

- [ ] **Step 2: Add `<script src="js/utils.js"></script>` to all pages that need it**

Add before the page-specific script in each of these HTML files:
- `ui/booking.html`
- `ui/index.html`
- `ui/booking-detail.html`
- `ui/passengers.html`

- [ ] **Step 3: Commit**

```bash
git add ui/js/utils.js ui/booking.html ui/index.html ui/booking-detail.html ui/passengers.html
git commit -m "feat: add maskId helper in utils.js; include in all booking pages"
```

---

## Task 9: Frontend — booking form (ticket counts + time/train toggle + passenger sort)

**Files:**
- Modify: `ui/booking.html`
- Modify: `ui/js/booking.js`

- [ ] **Step 1: Update `ui/booking.html` — add ticket section and time/train toggle**

Replace the time section (the two `form-row` divs for 期望時間 and 允許最早/最晚, approximately lines 36–55) with:

```html
    <div class="form-group">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <label style="margin:0">搜尋條件</label>
        <div id="search-mode-toggle" style="display:flex;border:1px solid #4A90E2;border-radius:6px;overflow:hidden;font-size:13px">
          <button id="btn-mode-time" style="padding:4px 14px;background:#4A90E2;color:#fff;border:none;cursor:pointer" onclick="setSearchMode('time')">時間</button>
          <button id="btn-mode-train" style="padding:4px 14px;background:#fff;color:#4A90E2;border:none;cursor:pointer" onclick="setSearchMode('train')">車次</button>
        </div>
      </div>
    </div>

    <div id="time-fields">
      <div class="form-row">
        <div class="form-group">
          <label>乘車日期</label>
          <input type="date" id="b-date">
        </div>
        <div class="form-group">
          <label>期望時間</label>
          <input type="time" id="b-desired-time" value="09:00">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>允許最早</label>
          <input type="time" id="b-earliest">
        </div>
        <div class="form-group">
          <label>允許最晚</label>
          <input type="time" id="b-latest">
        </div>
      </div>
    </div>

    <div id="train-fields" style="display:none">
      <div class="form-row">
        <div class="form-group">
          <label>乘車日期</label>
          <input type="date" id="b-date-train">
        </div>
        <div class="form-group">
          <label>車次號碼</label>
          <input type="text" id="b-train-no-target" placeholder="例：0106" maxlength="10">
        </div>
      </div>
    </div>
```

Add ticket type section after the max-retries field (before 重試間隔):

```html
    <div class="form-group">
      <label>票種</label>
      <div id="ticket-types" style="display:flex;flex-direction:column;gap:8px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span>全票</span>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('adult',-1)">−</button>
            <span id="ticket-adult-val" style="min-width:20px;text-align:center">1</span>
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('adult',1)">＋</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span>孩童票</span>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('child',-1)">−</button>
            <span id="ticket-child-val" style="min-width:20px;text-align:center">0</span>
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('child',1)">＋</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span>愛心票</span>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('disabled',-1)">−</button>
            <span id="ticket-disabled-val" style="min-width:20px;text-align:center">0</span>
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('disabled',1)">＋</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span>敬老票</span>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('senior',-1)">−</button>
            <span id="ticket-senior-val" style="min-width:20px;text-align:center">0</span>
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('senior',1)">＋</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span>大學生票</span>
          <div style="display:flex;align-items:center;gap:8px">
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('student',-1)">−</button>
            <span id="ticket-student-val" style="min-width:20px;text-align:center">0</span>
            <button type="button" class="btn btn-ghost" style="padding:2px 12px;font-size:16px" onclick="changeTicket('student',1)">＋</button>
          </div>
        </div>
      </div>
    </div>
```

Add `<script src="js/utils.js"></script>` before `<script src="js/booking.js"></script>`.

- [ ] **Step 2: Update `ui/js/booking.js`**

Replace the entire file:

```js
const STATIONS = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];

let bookingMode = 'immediate';
let searchMode = 'time';

const ticketCounts = { adult: 1, child: 0, disabled: 0, senior: 0, student: 0 };

function setMode(mode) {
  bookingMode = mode;
  document.getElementById('btn-immediate').classList.toggle('active', mode === 'immediate');
  document.getElementById('btn-scheduled').classList.toggle('active', mode === 'scheduled');
  document.getElementById('scheduled-fields').style.display = mode === 'scheduled' ? 'grid' : 'none';
}

function setSearchMode(mode) {
  searchMode = mode;
  document.getElementById('btn-mode-time').style.background = mode === 'time' ? '#4A90E2' : '#fff';
  document.getElementById('btn-mode-time').style.color = mode === 'time' ? '#fff' : '#4A90E2';
  document.getElementById('btn-mode-train').style.background = mode === 'train' ? '#4A90E2' : '#fff';
  document.getElementById('btn-mode-train').style.color = mode === 'train' ? '#fff' : '#4A90E2';
  document.getElementById('time-fields').style.display = mode === 'time' ? '' : 'none';
  document.getElementById('train-fields').style.display = mode === 'train' ? '' : 'none';
}

function changeTicket(type, delta) {
  const newVal = Math.max(0, Math.min(10, ticketCounts[type] + delta));
  ticketCounts[type] = newVal;
  document.getElementById(`ticket-${type}-val`).textContent = newVal;
}

function swapStations() {
  const from = document.getElementById('b-from');
  const to   = document.getElementById('b-to');
  const tmp  = from.value;
  from.value = to.value;
  to.value   = tmp;
}

function initStationSelects() {
  const fromEl = document.getElementById('b-from');
  const toEl   = document.getElementById('b-to');
  STATIONS.forEach((s, i) => {
    fromEl.add(new Option(s, s, false, i === 1));
    toEl.add(new Option(s, s, false, i === 6));
  });
}

async function loadPassengers() {
  const sel = document.getElementById('b-passenger');
  const myEmail = window.__auth.getEmail();
  try {
    const { passengers } = await api.getPassengers();
    if (!passengers || passengers.length === 0) {
      sel.innerHTML = '<option value="">請先至「乘客設定」新增乘客</option>';
      return;
    }
    const sorted = [
      ...passengers.filter(p => p.email === myEmail),
      ...passengers.filter(p => p.email !== myEmail),
    ];
    sel.innerHTML = sorted
      .map(p => `<option value="${p.id}">${p.name}（${maskId(p.idNumber, p.email, myEmail)}）</option>`)
      .join('');
  } catch (err) {
    sel.innerHTML = '<option value="">載入失敗</option>';
  }
}

async function submitBooking() {
  const passengerId  = document.getElementById('b-passenger').value;
  const fromStation  = document.getElementById('b-from').value;
  const toStation    = document.getElementById('b-to').value;
  const maxRetries     = parseInt(document.getElementById('b-max-retries').value);
  const retryWaitValue = parseInt(document.getElementById('b-retry-wait-value').value);
  const retryWaitUnit  = document.getElementById('b-retry-wait-unit').value;

  if (!passengerId)              { alert('請選擇乘客'); return; }
  if (fromStation === toStation) { alert('出發站與到達站不能相同'); return; }

  const totalTickets = Object.values(ticketCounts).reduce((a, b) => a + b, 0);
  if (totalTickets < 1) { alert('至少需要一張票'); return; }

  const maxWait = retryWaitUnit === 'minute' ? 60 : 300;
  if (!retryWaitValue || retryWaitValue < 1 || retryWaitValue > maxWait) {
    alert(`重試間隔：分鐘請填 1–60，秒請填 1–300`);
    return;
  }

  let date, desiredTime, earliestTime, latestTime, trainNoTarget;

  if (searchMode === 'time') {
    date         = document.getElementById('b-date').value;
    desiredTime  = document.getElementById('b-desired-time').value;
    earliestTime = document.getElementById('b-earliest').value;
    latestTime   = document.getElementById('b-latest').value;
    if (!date)                        { alert('請選擇乘車日期'); return; }
    if (!desiredTime)                 { alert('請選擇期望時間'); return; }
    if (!earliestTime || !latestTime) { alert('請選擇允許時間區間'); return; }
    if (earliestTime >= latestTime)   { alert('最早時間必須早於最晚時間'); return; }
  } else {
    date          = document.getElementById('b-date-train').value;
    trainNoTarget = document.getElementById('b-train-no-target').value.trim();
    desiredTime   = '00:00';
    earliestTime  = '00:00';
    latestTime    = '23:59';
    if (!date)          { alert('請選擇乘車日期'); return; }
    if (!trainNoTarget) { alert('請輸入車次號碼'); return; }
  }

  let scheduledAt = null;
  if (bookingMode === 'scheduled') {
    const schedDate = document.getElementById('b-schedule-date').value;
    const schedTime = document.getElementById('b-schedule-time').value;
    if (!schedDate || !schedTime) { alert('請填寫預約日期和時間'); return; }
    scheduledAt = new Date(schedDate + 'T' + schedTime + ':00').toISOString();
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '送出中...';

  try {
    await api.createBooking({
      passengerId, fromStation, toStation, date,
      desiredTime, earliestTime, latestTime,
      maxRetries, scheduledAt,
      retryWaitValue, retryWaitUnit,
      ticketAdult:    ticketCounts.adult,
      ticketChild:    ticketCounts.child,
      ticketDisabled: ticketCounts.disabled,
      ticketSenior:   ticketCounts.senior,
      ticketStudent:  ticketCounts.student,
      searchMode,
      trainNoTarget: trainNoTarget || null,
      immediate: bookingMode === 'immediate',
    });
    location.href = 'index.html';
  } catch (err) {
    alert('送出失敗：' + err.message);
    btn.disabled = false;
    btn.textContent = '確認送出';
  }
}

// 日期預設為明天
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().slice(0, 10);
document.getElementById('b-date').value = tomorrowStr;
document.getElementById('b-date-train').value = tomorrowStr;
document.getElementById('b-schedule-date').value = tomorrowStr;

function updateTimeRange() {
  const desired = document.getElementById('b-desired-time').value;
  if (!desired) return;
  const [h, m] = desired.split(':').map(Number);
  const mStr = m.toString().padStart(2, '0');
  const earliestH = Math.max(0, h - 2).toString().padStart(2, '0');
  const latestH   = Math.min(23, h + 2).toString().padStart(2, '0');
  document.getElementById('b-earliest').value = `${earliestH}:${mStr}`;
  document.getElementById('b-latest').value   = `${latestH}:${mStr}`;
}

document.getElementById('b-desired-time').addEventListener('change', updateTimeRange);
updateTimeRange();

initStationSelects();
loadPassengers();
```

- [ ] **Step 3: Start dev server and manually verify**

```bash
cd ui && npm run dev
```

Open http://localhost:8082/booking.html. Verify:
- Passenger dropdown shows own passenger first (if email matches)
- ± ticket buttons adjust counts, total can't go below 1
- Toggle between 時間 / 車次 hides/shows correct fields

- [ ] **Step 4: Commit**

```bash
git add ui/booking.html ui/js/booking.js
git commit -m "feat: booking form — ticket counts ± UI, time/train toggle, passenger sort + ID mask"
```

---

## Task 10: Frontend — booking list `index.js` — passenger line with masked ID

**Files:**
- Modify: `ui/js/index.js`

- [ ] **Step 1: Update `bookingCard()` to fetch and display passenger info**

The current `index.js` receives bookings but not passenger details. The booking object has `passengerId` but not passenger name/idNumber. We need to either:
- Fetch passengers once and join client-side (preferred — avoids N+1 calls)

Update `loadBookings()` and `bookingCard()`:

```js
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTW(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

const STATUS_LABEL = {
  pending:       { text: '等待中',  cls: 'badge-pending'   },
  running:       { text: '搶票中',  cls: 'badge-running'   },
  success:       { text: '成功',    cls: 'badge-success'   },
  failed:        { text: '失敗',    cls: 'badge-failed'    },
  cancelled:     { text: '已取消',  cls: 'badge-cancelled' },
  refunding:     { text: '退票中',  cls: 'badge-refunding' },
  refunded:      { text: '已退票',  cls: 'badge-refunded'  },
  refund_failed: { text: '退票失敗', cls: 'badge-failed'   },
};

function bookingCard(b, passengerMap, myEmail) {
  const statusKey = b.refundStatus === 'refunding' ? 'refunding'
    : b.refundStatus === 'refunded' ? 'refunded'
    : b.refundStatus === 'refund_failed' ? 'refund_failed'
    : b.status;
  const s = STATUS_LABEL[statusKey] || { text: statusKey, cls: '' };
  const scheduledInfo = b.scheduledAt
    ? `<div class="card-sub">預約時間：${formatTW(b.scheduledAt)}</div>`
    : '';
  const updatedInfo = b.updatedAt
    ? `<div class="card-sub">最後更新：${formatTW(b.updatedAt)}</div>`
    : '';

  const canDelete = (b.status === 'success' || b.status === 'failed' || b.status === 'cancelled' || b.refundStatus === 'refund_failed')
    && b.refundStatus !== 'refunding';
  const isOwner = b.ownerEmail === myEmail;
  const isAdmin = window.__auth.getRole() === 'admin';
  const canMutate = isOwner || isAdmin;

  const deleteBtn = canDelete && canMutate
    ? `<button class="btn btn-danger" style="padding:6px 14px;font-size:13px" onclick="event.stopPropagation();deleteBooking('${b.id}')">刪除</button>`
    : '';
  const canRefund = b.status === 'success' && (!b.refundStatus || b.refundStatus === 'refund_failed');
  const refundBtn = canRefund && canMutate
    ? `<button class="btn btn-warning" style="padding:6px 14px;font-size:13px;margin-right:6px" onclick="event.stopPropagation();refundBooking('${b.id}')">退票</button>`
    : '';
  const canCancel = b.status === 'pending';
  const cancelBtn = canCancel && canMutate
    ? `<button class="btn btn-secondary" style="padding:6px 14px;font-size:13px;margin-right:6px" onclick="event.stopPropagation();cancelBooking('${b.id}')">取消</button>`
    : '';

  const copyIcon = b.ticketNo
    ? `<span onclick="event.stopPropagation();copyTicketNo('${b.ticketNo}')" title="複製訂位代號" style="cursor:pointer;margin-left:6px;opacity:0.7">📋</span>`
    : '';

  const refundMsg = b.refundMessage
    ? `<div class="card-sub" style="color:var(--danger)">${escapeHtml(b.refundMessage)}</div>`
    : '';

  const passenger = passengerMap[b.passengerId];
  const passengerLine = passenger
    ? `<div class="card-sub">乘客：${escapeHtml(passenger.name)}（${escapeHtml(maskId(passenger.idNumber, passenger.email, myEmail))}）</div>`
    : '';

  return `
    <div class="card" id="booking-${b.id}" style="cursor:pointer" onclick="location.href='booking-detail.html?id=${b.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${b.fromStation} → ${b.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      ${passengerLine}
      <div class="card-sub">日期：${b.date}　期望：${b.desiredTime}</div>
      <div class="card-sub">允許區間：${b.earliestTime} ~ ${b.latestTime}</div>
      ${scheduledInfo}
      <div class="card-sub">嘗試次數：${b.retryCount || 0} / ${b.maxRetries}</div>
      ${b.ticketNo && b.trainNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">車次：${escapeHtml(b.trainNo)}　出發：${escapeHtml(b.departTime || '—')}</div>` : ''}
      ${b.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${b.ticketNo}${copyIcon}</div>` : ''}
      ${refundMsg}
      ${updatedInfo}
      ${(cancelBtn || refundBtn || deleteBtn) ? `<div class="card-actions">${cancelBtn}${refundBtn}${deleteBtn}</div>` : ''}
    </div>
  `;
}

async function deleteBooking(id) {
  if (!confirm('確定刪除這筆訂票紀錄？')) return;
  try {
    await api.deleteBooking(id);
    document.getElementById('booking-' + id).remove();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function cancelBooking(id) {
  if (!confirm('確定要取消這筆訂票？')) return;
  try {
    await api.cancelBooking(id);
    await loadBookings();
  } catch (err) {
    alert('取消失敗：' + err.message);
  }
}

async function refundBooking(id) {
  if (!confirm('確定要退票？退票後無法復原。')) return;
  try {
    await api.refundBooking(id);
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

async function loadBookings() {
  const el = document.getElementById('bookings-list');
  const myEmail = window.__auth.getEmail();
  try {
    const [{ bookings }, { passengers }] = await Promise.all([
      api.getBookings(),
      api.getPassengers(),
    ]);
    const passengerMap = {};
    (passengers || []).forEach(p => { passengerMap[p.id] = p; });

    if (!bookings || bookings.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎫</div>
          <div>尚無訂票紀錄</div>
          <div style="font-size:13px;margin-top:8px">點右下角 + 開始訂票</div>
        </div>`;
      return;
    }
    el.innerHTML = bookings.map(b => bookingCard(b, passengerMap, myEmail)).join('');
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadBookings();

setInterval(() => {
  const hasPending = document.querySelector('.badge-running, .badge-pending, .badge-refunding');
  if (hasPending) loadBookings();
}, 30000);
```

- [ ] **Step 2: Verify in browser**

```bash
cd ui && npm run dev
```

Open http://localhost:8082/index.html. Verify passenger name + masked ID shows on each booking card. Verify delete/cancel/refund buttons only show for own bookings (when logged in as user role).

- [ ] **Step 3: Commit**

```bash
git add ui/js/index.js
git commit -m "feat: booking list — passenger line with masked ID; mutate buttons respect ownership"
```

---

## Task 11: Frontend — booking detail page

**Files:**
- Modify: `ui/js/booking-detail.js`

- [ ] **Step 1: Update `renderDetail()` to show passenger, ticket summary, search mode**

Replace entire `booking-detail.js`:

```js
function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderAttemptReason(a) {
  if (a.reason) {
    const color = a.success ? 'var(--success)' : 'var(--danger)';
    return `<div class="attempt-reason" style="color:${color}">${escapeHtml(a.reason)}</div>`;
  }
  if (a.success) return '<div class="attempt-reason" style="color:var(--success)">訂票成功</div>';
  return '';
}

const STATUS_LABEL = {
  pending:       { text: '等待中',  cls: 'badge-pending'   },
  running:       { text: '搶票中',  cls: 'badge-running'   },
  success:       { text: '成功',    cls: 'badge-success'   },
  failed:        { text: '失敗',    cls: 'badge-failed'    },
  cancelled:     { text: '已取消',  cls: 'badge-cancelled' },
  refunding:     { text: '退票中',  cls: 'badge-refunding' },
  refunded:      { text: '已退票',  cls: 'badge-refunded'  },
  refund_failed: { text: '退票失敗', cls: 'badge-failed'   },
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

function ticketSummary(booking) {
  const types = [
    { key: 'ticketAdult',    label: '全票' },
    { key: 'ticketChild',    label: '孩童票' },
    { key: 'ticketDisabled', label: '愛心票' },
    { key: 'ticketSenior',   label: '敬老票' },
    { key: 'ticketStudent',  label: '大學生票' },
  ];
  const parts = types.filter(t => (booking[t.key] || 0) > 0).map(t => `${t.label}×${booking[t.key]}`);
  return parts.length ? parts.join('、') : '全票×1';
}

function renderDetail(booking, attempts, passenger, myEmail) {
  const s = STATUS_LABEL[booking.status] || { text: booking.status, cls: '' };

  const attemptsHtml = attempts.length === 0
    ? '<div class="card-sub" style="padding:16px 0">尚無嘗試紀錄</div>'
    : `<ul class="attempt-list">${attempts.map((a, i) => `
        <li class="attempt-item">
          <span class="attempt-icon">${a.success ? '✅' : '❌'}</span>
          <div class="attempt-body">
            <div class="attempt-seq">第 ${i + 1} 次嘗試</div>
            <div class="attempt-time">${formatTW(a.attemptedAt)}</div>
            ${renderAttemptReason(a)}
          </div>
        </li>`).join('')}</ul>`;

  const passengerLine = passenger
    ? `<div class="card-sub">乘客：${escapeHtml(passenger.name)}（${escapeHtml(maskId(passenger.idNumber, passenger.email, myEmail))}）</div>`
    : '';

  const searchLine = booking.searchMode === 'train'
    ? `<div class="card-sub">搜尋車次：${escapeHtml(booking.trainNoTarget || '—')}</div>`
    : `<div class="card-sub">期望時間：${booking.desiredTime}</div>
       <div class="card-sub">允許區間：${booking.earliestTime} ~ ${booking.latestTime}</div>`;

  return `
    <div class="section-title">訂單資訊</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${booking.fromStation} → ${booking.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      ${passengerLine}
      <div class="card-sub">日期：${booking.date}</div>
      ${searchLine}
      <div class="card-sub">票種：${ticketSummary(booking)}</div>
      ${booking.scheduledAt ? `<div class="card-sub">預約時間：${formatTW(booking.scheduledAt)}</div>` : ''}
      <div class="card-sub">嘗試次數：${booking.retryCount || 0} / ${booking.maxRetries}</div>
      <div class="card-sub">嘗試間隔：${booking.retryWaitValue ?? 2} ${(booking.retryWaitUnit ?? 'minute') === 'minute' ? '分' : '秒'}</div>
      ${booking.ticketNo && booking.trainNo ? `<div class="card-sub" style="color:var(--success);font-weight:600;margin-top:8px">車次：${escapeHtml(booking.trainNo)}　出發：${escapeHtml(booking.departTime || '—')}</div>` : ''}
      ${booking.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${booking.ticketNo}</div>` : ''}
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

  const myEmail = window.__auth.getEmail();

  try {
    const [{ bookings }, { attempts }, { passengers }] = await Promise.all([
      api.getBookings(),
      api.getBookingAttempts(bookingId),
      api.getPassengers(),
    ]);

    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) {
      el.innerHTML = '<div class="alert alert-warning">找不到此訂票紀錄</div>';
      return;
    }

    const passenger = (passengers || []).find(p => p.id === booking.passengerId);

    document.getElementById('page-title').textContent =
      `${booking.fromStation} → ${booking.toStation}`;
    el.innerHTML = renderDetail(booking, attempts, passenger, myEmail);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadDetail();
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:8082/booking-detail.html?id=<some-id>. Verify passenger line, ticket summary, and search mode display correctly.

- [ ] **Step 3: Commit**

```bash
git add ui/js/booking-detail.js
git commit -m "feat: booking detail — passenger line, ticket summary, search mode display"
```

---

## Task 12: Frontend — passengers page masked ID + format validation

**Files:**
- Modify: `ui/js/passengers.js`

- [ ] **Step 1: Update `passengers.js`**

Replace entire file:

```js
const TYPE_LABEL = {
  adult: '成人', student: '學生', senior: '敬老', disabled: '愛心', child: '兒童',
};

const ID_NUMBER_RE = /^[A-Z]\d{9}$/;

function passengerCard(p, myEmail) {
  const name      = p.name.replace(/'/g, "\\'");
  const idNumber  = p.idNumber.replace(/'/g, "\\'");
  const email     = p.email.replace(/'/g, "\\'");
  const displayId = maskId(p.idNumber, p.email, myEmail);
  return `
    <div class="card" id="p-card-${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="card-title">${p.name}</div>
          <div class="card-sub">${TYPE_LABEL[p.type] || p.type}　${displayId}</div>
          <div class="card-sub">${p.email}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost" style="font-size:13px;padding:8px 12px"
          onclick="editPassenger('${p.id}','${name}','${idNumber}','${p.type}','${email}')">編輯</button>
        <button class="btn btn-danger" style="font-size:13px;padding:8px 12px"
          onclick="deletePassenger('${p.id}','${name}')">刪除</button>
      </div>
    </div>
  `;
}

async function loadPassengers() {
  const el = document.getElementById('passengers-list');
  const myEmail = window.__auth.getEmail();
  try {
    const { passengers } = await api.getPassengers();
    el.innerHTML = passengers.length
      ? passengers.map(p => passengerCard(p, myEmail)).join('')
      : '<div class="alert alert-info" style="margin-bottom:12px">尚無乘客資料，請新增。</div>';
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

function editPassenger(id, name, idNumber, type, email) {
  document.getElementById('edit-id').value = id;
  document.getElementById('p-name').value = name;
  document.getElementById('p-id-number').value = idNumber;
  document.getElementById('p-type').value = type;
  document.getElementById('p-email').value = email;
  document.getElementById('form-title').textContent = '編輯乘客';
  document.getElementById('passenger-form-card').scrollIntoView({ behavior: 'smooth' });
}

async function deletePassenger(id, name) {
  if (!confirm(`確定刪除「${name}」？`)) return;
  try {
    await api.deletePassenger(id);
    loadPassengers();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function savePassenger() {
  const id       = document.getElementById('edit-id').value;
  const name     = document.getElementById('p-name').value.trim();
  const idNumber = document.getElementById('p-id-number').value.trim();
  const type     = document.getElementById('p-type').value;
  const email    = document.getElementById('p-email').value.trim();

  if (!name || !idNumber || !email) { alert('請填寫所有欄位'); return; }
  if (!ID_NUMBER_RE.test(idNumber)) {
    alert('身分證格式錯誤，應為一個大寫英文字母加 9 位數字');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = '儲存中...';

  try {
    await api.savePassenger({ id: id || undefined, name, idNumber, type, email });
    document.getElementById('edit-id').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-id-number').value = '';
    document.getElementById('p-type').value = 'adult';
    document.getElementById('p-email').value = '';
    document.getElementById('form-title').textContent = '新增乘客';
    loadPassengers();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '儲存乘客';
  }
}

loadPassengers();
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:8082/passengers.html. Verify:
- Own passenger (email matches login) shows full ID
- Other passengers show masked ID
- Saving with invalid ID format shows alert

- [ ] **Step 3: Commit**

```bash
git add ui/js/passengers.js
git commit -m "feat: passengers page — masked ID display; validate ID format before save"
```

---

## Task 13: Run all backend tests + review

- [ ] **Step 1: Run full test suite**

```bash
cd server && npm test 2>&1
```

Expected: all tests pass, no failures.

- [ ] **Step 2: Spot-check Docker**

```bash
docker-compose up --build -d
sleep 5
curl -s http://localhost:8081/ 
```

Expected: server health OK.

- [ ] **Step 3: Final commit if any fixes needed, then tag**

```bash
git add -A
git status
```

Only commit if there are unfixed files. Otherwise proceed to review stage.
