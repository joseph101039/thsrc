# Server Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `server/src/` from a GAS-style single-endpoint RPC into a proper controllers/services/repositories/models layered architecture with `/v1/*` REST routes, Swagger docs, and updated frontend.

**Architecture:** Three-layer server: repositories (pure SQL) → services (business logic) → controllers (HTTP). Middlewares handle cross-cutting auth/role concerns. Frontend `ui/js/api.js` replaces the single `gasCall` dispatcher with per-method REST helpers.

**Tech Stack:** Node.js, Express 4, node:sqlite, jsonwebtoken, google-auth-library, swagger-jsdoc, swagger-ui-express, node:test

---

## File Map

### New files (server)
- `server/src/models/schemas.js` — `VALID_ROLES` constant
- `server/src/repositories/passengerRepo.js` — passenger SQL
- `server/src/repositories/bookingRepo.js` — booking + attempt SQL
- `server/src/repositories/userRepo.js` — allowed_user SQL
- `server/src/services/authService.js` — Google verify + JWT sign
- `server/src/services/passengerService.js` — passenger business logic
- `server/src/services/bookingService.js` — booking business logic
- `server/src/services/userService.js` — user business logic
- `server/src/services/bookingEngineService.js` — rename of booking_engine.js, DB calls → repos
- `server/src/middlewares/auth.js` — `verifyJwt` middleware
- `server/src/middlewares/adminOnly.js` — `adminOnly` middleware
- `server/src/controllers/authController.js` — googleAuth handler
- `server/src/controllers/passengerController.js` — passenger CRUD handlers
- `server/src/controllers/bookingController.js` — booking CRUD + attempts handlers
- `server/src/controllers/userController.js` — user management handlers
- `server/src/routes/v1.js` — mounts all /v1/* sub-routers
- `server/src/swagger.js` — swagger-jsdoc config + spec export
- `server/test/passengers.test.js` — passenger CRUD tests
- `server/test/bookings.test.js` — booking CRUD + attempts tests

### Modified files (server)
- `server/src/db.js` — strip all query functions; keep only `getDb()` + schema init + migration
- `server/src/api.js` — strip all route handlers; mount routes/v1.js + swagger
- `server/src/scheduler.js` — update import from `./booking_engine` → `./services/bookingEngineService`
- `server/package.json` — add `swagger-jsdoc`, `swagger-ui-express`; add `swagger` script
- `server/test/auth.test.js` — update routes `POST /` → `POST /v1/auth/google`
- `server/test/admin.test.js` — update routes to `/v1/users/*`

### Deleted files (server)
- `server/src/booking_engine.js` — replaced by `services/bookingEngineService.js`
- `server/src/mailer.js` — dead code (not imported anywhere)

### Modified files (frontend)
- `ui/js/api.js` — replace `gasCall` with `getJson`/`postJson`/`deleteJson` REST helpers
- `ui/js/admin.js` — update `adminApi` calls to use `api.*` methods

---

## Task 1: Create branch and install new dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Create feature branch**

```bash
git checkout -b feat-server-refactor
```

- [ ] **Step 2: Install new dependencies**

```bash
cd server && npm install swagger-jsdoc swagger-ui-express
```

- [ ] **Step 3: Verify package.json updated**

```bash
grep -E "swagger" server/package.json
```

Expected output:
```
"swagger-jsdoc": "^6.x.x",
"swagger-ui-express": "^5.x.x"
```

- [ ] **Step 4: Add swagger npm script to package.json**

Edit `server/package.json` scripts section to add:
```json
"swagger": "node src/swagger.js"
```

Full scripts section should be:
```json
"scripts": {
  "start": "node --experimental-sqlite src/api.js",
  "scheduler": "node --experimental-sqlite src/scheduler.js",
  "test": "node --experimental-sqlite --test test/*.test.js",
  "swagger": "node src/swagger.js"
}
```

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: 安裝 swagger-jsdoc 與 swagger-ui-express"
```

---

## Task 2: Create models/schemas.js

**Files:**
- Create: `server/src/models/schemas.js`

- [ ] **Step 1: Create models directory and schemas.js**

```bash
mkdir -p server/src/models
```

Create `server/src/models/schemas.js`:
```js
'use strict';

const VALID_ROLES = ['user', 'admin'];

module.exports = { VALID_ROLES };
```

- [ ] **Step 2: Verify it loads**

```bash
cd server && node --experimental-sqlite -e "const s = require('./src/models/schemas'); console.log(s.VALID_ROLES)"
```

Expected: `[ 'user', 'admin' ]`

- [ ] **Step 3: Commit**

```bash
git add server/src/models/schemas.js
git commit -m "feat: 新增 models/schemas.js（VALID_ROLES）"
```

---

## Task 3: Slim down db.js — connection + schema only

**Files:**
- Modify: `server/src/db.js`

This task removes all query functions from `db.js`. They will be added to repos in Tasks 4–6. The file must export only `getDb()`.

- [ ] **Step 1: Rewrite db.js**

Replace the entire contents of `server/src/db.js` with:

```js
'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const CONFIG = require('./config');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dbPath = path.resolve(CONFIG.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _initSchema(_db);
  _migrate(_db);
  return _db;
}

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

    CREATE TABLE IF NOT EXISTS allowed_users (
      email       TEXT PRIMARY KEY COLLATE NOCASE,
      role        TEXT NOT NULL DEFAULT 'user',
      created_at  TEXT NOT NULL
    );
  `);
}

function _migrate(db) {
  const cols = db.prepare('PRAGMA table_info(passengers)').all().map(r => r.name);
  if (!cols.includes('phone')) {
    db.exec("ALTER TABLE passengers ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  db.prepare(`
    INSERT OR IGNORE INTO allowed_users (email, role, created_at)
    VALUES (?, 'admin', ?)
  `).run('joseph101039@gmail.com', new Date().toISOString());
}

function _toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

module.exports = { getDb, _toCamel };
```

Note: `_toCamel` is exported so repos can import it without duplicating the function.

- [ ] **Step 2: Verify db.js loads and opens DB**

```bash
cd server && node --experimental-sqlite -e "
process.env.DB_PATH='/tmp/test-slim-db.db';
const { getDb } = require('./src/db');
const db = getDb();
console.log('ok', typeof db.prepare);
"
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "refactor: db.js 精簡為純連線與 schema 初始化"
```

---

## Task 4: Create repositories

**Files:**
- Create: `server/src/repositories/passengerRepo.js`
- Create: `server/src/repositories/bookingRepo.js`
- Create: `server/src/repositories/userRepo.js`

- [ ] **Step 1: Create repositories directory**

```bash
mkdir -p server/src/repositories
```

- [ ] **Step 2: Create passengerRepo.js**

Create `server/src/repositories/passengerRepo.js`:
```js
'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM passengers').all().map(_toCamel);
}

function getById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM passengers WHERE id=?').get(id));
}

function upsert({ id, name, idNumber, type, email, phone }) {
  const db = getDb();
  const phoneVal = phone || '';
  if (id) {
    db.prepare(
      'UPDATE passengers SET name=?, id_number=?, type=?, email=?, phone=? WHERE id=?'
    ).run(name, idNumber, type, email, phoneVal, id);
    return { success: true, id };
  }
  const newId = uuidv4();
  db.prepare(
    'INSERT INTO passengers (id, name, id_number, type, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId, name, idNumber, type, email, phoneVal);
  return { success: true, id: newId };
}

function deleteById(id) {
  getDb().prepare('DELETE FROM passengers WHERE id=?').run(id);
  return { success: true };
}

module.exports = { getAll, getById, upsert, deleteById };
```

- [ ] **Step 3: Create bookingRepo.js**

Create `server/src/repositories/bookingRepo.js`:
```js
'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY created_at DESC').all().map(_toCamel);
}

function getById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM bookings WHERE id=?').get(id));
}

function create({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries || 10, scheduledAt || null, now, now);
  return { success: true, id };
}

function updateFields(id, fields) {
  const now = new Date().toISOString();
  const allFields = { ...fields, updatedAt: now };
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
  };
  const setClauses = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => `${colMap[k]} = ?`).join(', ');
  const values = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => allFields[k]);
  getDb().prepare(`UPDATE bookings SET ${setClauses} WHERE id = ?`).run(...values, id);
}

function deleteById(id) {
  getDb().prepare('DELETE FROM bookings WHERE id=?').run(id);
  return { success: true };
}

function getPending() {
  return _toCamel(getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(new Date().toISOString()));
}

function getStuckRunning() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings WHERE status = 'running' AND updated_at < ?
  `).all(cutoff).map(_toCamel);
}

function createAttempt({ bookingId, success, reason }) {
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

module.exports = {
  getAll, getById, create, updateFields, deleteById,
  getPending, getStuckRunning,
  createAttempt, getAttemptsByBookingId,
};
```

- [ ] **Step 4: Create userRepo.js**

Create `server/src/repositories/userRepo.js`:
```js
'use strict';

const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM allowed_users ORDER BY created_at ASC').all().map(_toCamel);
}

function getByEmail(email) {
  return _toCamel(getDb().prepare('SELECT * FROM allowed_users WHERE email = ?').get(email.toLowerCase()));
}

function isAllowed(email) {
  const row = getDb().prepare('SELECT 1 FROM allowed_users WHERE email = ?').get(email.toLowerCase());
  return !!row;
}

function add({ email, role }) {
  if (!email || typeof email !== 'string') return { success: false, error: '缺少 email' };
  const existing = getDb().prepare('SELECT 1 FROM allowed_users WHERE email = ?').get(email.toLowerCase());
  if (existing) return { success: false, error: '帳號已存在' };
  getDb().prepare(
    'INSERT INTO allowed_users (email, role, created_at) VALUES (?, ?, ?)'
  ).run(email.toLowerCase(), role, new Date().toISOString());
  return { success: true };
}

function deleteByEmail(email) {
  getDb().prepare('DELETE FROM allowed_users WHERE email = ?').run(email.toLowerCase());
  return { success: true };
}

module.exports = { getAll, getByEmail, isAllowed, add, deleteByEmail };
```

- [ ] **Step 5: Verify repos load**

```bash
cd server && node --experimental-sqlite -e "
process.env.DB_PATH='/tmp/test-repos.db';
const p = require('./src/repositories/passengerRepo');
const b = require('./src/repositories/bookingRepo');
const u = require('./src/repositories/userRepo');
console.log('passengers:', p.getAll().length);
console.log('bookings:', b.getAll().length);
console.log('users allowed:', u.isAllowed('joseph101039@gmail.com'));
"
```

Expected:
```
passengers: 0
bookings: 0
users allowed: true
```

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/
git commit -m "feat: 新增 repositories 層（passenger / booking / user）"
```

---

## Task 5: Create services

**Files:**
- Create: `server/src/services/authService.js`
- Create: `server/src/services/passengerService.js`
- Create: `server/src/services/bookingService.js`
- Create: `server/src/services/userService.js`
- Create: `server/src/services/bookingEngineService.js`

- [ ] **Step 1: Create services directory**

```bash
mkdir -p server/src/services
```

- [ ] **Step 2: Create authService.js**

Create `server/src/services/authService.js`:
```js
'use strict';

const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return { email: payload.email, emailVerified: payload.email_verified };
}

function signJwt(email, role) {
  return jwt.sign({ email, role }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { verifyGoogleCredential, signJwt };
```

- [ ] **Step 3: Create passengerService.js**

Create `server/src/services/passengerService.js`:
```js
'use strict';

const passengerRepo = require('../repositories/passengerRepo');

function listPassengers() {
  return passengerRepo.getAll();
}

function savePassenger(data) {
  return passengerRepo.upsert(data);
}

function deletePassenger(id) {
  return passengerRepo.deleteById(id);
}

module.exports = { listPassengers, savePassenger, deletePassenger };
```

- [ ] **Step 4: Create bookingService.js**

Create `server/src/services/bookingService.js`:
```js
'use strict';

const bookingRepo = require('../repositories/bookingRepo');

function listBookings() {
  return bookingRepo.getAll();
}

function createBooking(data) {
  return bookingRepo.create(data);
}

function deleteBooking(id) {
  return bookingRepo.deleteById(id);
}

function getAttempts(bookingId) {
  return bookingRepo.getAttemptsByBookingId(bookingId);
}

module.exports = { listBookings, createBooking, deleteBooking, getAttempts };
```

- [ ] **Step 5: Create userService.js**

Create `server/src/services/userService.js`:
```js
'use strict';

const userRepo = require('../repositories/userRepo');
const { VALID_ROLES } = require('../models/schemas');

function listUsers() {
  return userRepo.getAll();
}

function addUser({ email, role }) {
  if (!VALID_ROLES.includes(role)) return { success: false, error: '無效的角色' };
  return userRepo.add({ email, role });
}

function deleteUser(email, requestorEmail) {
  if (email.toLowerCase() === requestorEmail.toLowerCase()) {
    return { success: false, error: '不能刪除自己' };
  }
  return userRepo.deleteByEmail(email);
}

function isAllowedUser(email) {
  return userRepo.isAllowed(email);
}

function getUser(email) {
  return userRepo.getByEmail(email);
}

module.exports = { listUsers, addUser, deleteUser, isAllowedUser, getUser };
```

- [ ] **Step 6: Create bookingEngineService.js**

Create `server/src/services/bookingEngineService.js` (rename + rewire of `booking_engine.js`):
```js
'use strict';

const fetch = require('node-fetch');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('../thsrc');

const BOOKING_TIMEOUT_MS = 120000;

async function runBooking(bookingId) {
  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  bookingRepo.updateFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('訂票逾時（60秒）')), BOOKING_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doBooking(bookingId, booking), timeout]);
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, err.message);
  }
}

async function _doBooking(bookingId, booking) {
  console.log('  [1/5] thsrcInit...');
  const { cookieJar, formAction, captchaUrl, bookingMethod } = await thsrcInit();
  console.log(`  [1/5] done — bookingMethod=${bookingMethod} formAction=${formAction.slice(0, 60)}...`);

  console.log('  [2/5] thsrcGetCaptcha...');
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);
  console.log(`  [2/5] done — base64 length=${captchaBase64.length}`);

  console.log(`  [3/5] solving captcha via ${CONFIG.CAPTCHA_API_URL}/solve ...`);
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const captchaJson = await captchaRes.json();
  if (!captchaJson.answer) throw new Error('驗證碼辨識失敗：' + (captchaJson.detail || JSON.stringify(captchaJson)));
  const captchaAnswer = captchaJson.answer;
  console.log(`  [3/5] done — answer=${captchaAnswer} confidence=${captchaJson.confidence ? captchaJson.confidence.map(c => c.toFixed(2)).join(',') : 'n/a'}`);

  console.log(`  [4/5] thsrcQueryTrains ${booking.fromStation}→${booking.toStation} ${booking.date} ${booking.earliestTime}~${booking.latestTime}...`);
  const { trains, s2FormAction, cookieJar: queryCookieJar } = await thsrcQueryTrains(cookieJar, formAction, {
    fromStation: booking.fromStation,
    toStation: booking.toStation,
    date: booking.date,
    earliestTime: booking.earliestTime,
    latestTime: booking.latestTime,
    captcha: captchaAnswer,
    bookingMethod,
  });
  console.log(`  [4/5] done — ${trains.length} trains found, s2FormAction=${s2FormAction ? s2FormAction.slice(0, 60) + '...' : 'null'}`);
  trains.forEach(t => console.log(`    班次 ${t.trainNo} ${t.departTime}→${t.arriveTime} (${t.radioValue})`));

  if (trains.length === 0) {
    return handleRetry(booking, '無可用班次');
  }

  const bestTrain = selectBestTrain(trains, booking.desiredTime);
  console.log(`  [4/5] selected — 車次 ${bestTrain.trainNo} ${bestTrain.departTime}→${bestTrain.arriveTime} (desired=${booking.desiredTime})`);
  bookingRepo.updateFields(bookingId, { trainNo: bestTrain.trainNo });

  const passenger = passengerRepo.getById(booking.passengerId);
  console.log(`  [5/5] thsrcSubmitBooking trainNo=${bestTrain.trainNo} radioValue=${bestTrain.radioValue} passenger.idNumber=${passenger?.idNumber?.slice(0, 3)}... phone=${passenger?.phone} email=${passenger?.email}`);
  const result = await thsrcSubmitBooking(queryCookieJar, s2FormAction, {
    trainNo: bestTrain.radioValue,
    captcha: captchaAnswer,
    passenger: { idNumber: passenger.idNumber, phone: passenger.phone || '', email: passenger.email },
  });
  console.log(`  [5/5] done — success=${result.success} ticketNo=${result.ticketNo} error=${result.error}`);

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
    });
    bookingRepo.createAttempt({ bookingId, success: true, reason: null });
    console.log('  [done] 訂票成功：', bookingId, result.ticketNo);
  } else {
    return handleRetry(booking, result.error);
  }
}

function handleRetry(booking, reason) {
  const newRetryCount = (booking.retryCount || 0) + 1;
  bookingRepo.updateFields(booking.id, { retryCount: newRetryCount });
  bookingRepo.createAttempt({ bookingId: booking.id, success: false, reason });

  if (newRetryCount >= booking.maxRetries) {
    bookingRepo.updateFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    console.log('Booking failed after max retries:', booking.id);
  } else {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
    bookingRepo.updateFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    console.log('Scheduled retry', newRetryCount, '/', booking.maxRetries, 'for booking:', booking.id);
  }
}

module.exports = { runBooking, handleRetry };
```

- [ ] **Step 7: Commit**

```bash
git add server/src/services/
git commit -m "feat: 新增 services 層（auth / passenger / booking / user / bookingEngine）"
```

---

## Task 6: Create middlewares

**Files:**
- Create: `server/src/middlewares/auth.js`
- Create: `server/src/middlewares/adminOnly.js`

- [ ] **Step 1: Create middlewares directory**

```bash
mkdir -p server/src/middlewares
```

- [ ] **Step 2: Create auth.js middleware**

Create `server/src/middlewares/auth.js`:
```js
'use strict';

const jwt = require('jsonwebtoken');
const userService = require('../services/userService');

const JWT_SECRET = process.env.JWT_SECRET;

function verifyJwt(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未授權' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!userService.isAllowedUser(req.user.email)) {
      return res.status(403).json({ error: '帳號已被移除' });
    }
    next();
  } catch {
    return res.status(401).json({ error: '未授權' });
  }
}

module.exports = { verifyJwt };
```

- [ ] **Step 3: Create adminOnly.js middleware**

Create `server/src/middlewares/adminOnly.js`:
```js
'use strict';

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
  next();
}

module.exports = { adminOnly };
```

- [ ] **Step 4: Commit**

```bash
git add server/src/middlewares/
git commit -m "feat: 新增 middlewares（verifyJwt / adminOnly）"
```

---

## Task 7: Create controllers

**Files:**
- Create: `server/src/controllers/authController.js`
- Create: `server/src/controllers/passengerController.js`
- Create: `server/src/controllers/bookingController.js`
- Create: `server/src/controllers/userController.js`

- [ ] **Step 1: Create controllers directory**

```bash
mkdir -p server/src/controllers
```

- [ ] **Step 2: Create authController.js**

Create `server/src/controllers/authController.js`:
```js
'use strict';

const authService = require('../services/authService');
const userService = require('../services/userService');

/**
 * @swagger
 * /v1/auth/google:
 *   post:
 *     summary: Google OAuth 登入
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [credential]
 *             properties:
 *               credential:
 *                 type: string
 *                 description: Google ID token
 *     responses:
 *       200:
 *         description: 登入成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       400:
 *         description: 缺少 credential
 *       401:
 *         description: 無效的 Google token
 *       403:
 *         description: 帳號無權限
 */
async function googleAuth(req, res) {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: '缺少 credential' });
  try {
    const { email, emailVerified } = await authService.verifyGoogleCredential(credential);
    if (!emailVerified) return res.status(401).json({ error: '無效的 Google token' });
    if (!userService.isAllowedUser(email)) {
      console.error('登入被拒：', email);
      return res.status(403).json({ error: '帳號無權限' });
    }
    const row = userService.getUser(email);
    const token = authService.signJwt(email, row.role);
    res.json({ token });
  } catch (err) {
    console.error('Google token 驗證失敗：', err.message);
    res.status(401).json({ error: '無效的 Google token' });
  }
}

module.exports = { googleAuth };
```

- [ ] **Step 3: Create passengerController.js**

Create `server/src/controllers/passengerController.js`:
```js
'use strict';

const passengerService = require('../services/passengerService');

/**
 * @swagger
 * /v1/passengers:
 *   get:
 *     summary: 取得所有旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 旅客列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 passengers:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Passenger'
 */
function listPassengers(req, res) {
  try {
    res.json({ passengers: passengerService.listPassengers() });
  } catch (err) {
    console.error('listPassengers error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/passengers:
 *   post:
 *     summary: 新增或更新旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PassengerInput'
 *     responses:
 *       200:
 *         description: 儲存成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 */
function savePassenger(req, res) {
  try {
    res.json(passengerService.savePassenger(req.body));
  } catch (err) {
    console.error('savePassenger error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/passengers/{id}:
 *   delete:
 *     summary: 刪除旅客
 *     tags: [Passengers]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 */
function deletePassenger(req, res) {
  try {
    res.json(passengerService.deletePassenger(req.params.id));
  } catch (err) {
    console.error('deletePassenger error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listPassengers, savePassenger, deletePassenger };
```

- [ ] **Step 4: Create bookingController.js**

Create `server/src/controllers/bookingController.js`:
```js
'use strict';

const bookingService = require('../services/bookingService');

/**
 * @swagger
 * /v1/bookings:
 *   get:
 *     summary: 取得所有訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 訂票列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Booking'
 */
function listBookings(req, res) {
  try {
    res.json({ bookings: bookingService.listBookings() });
  } catch (err) {
    console.error('listBookings error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings:
 *   post:
 *     summary: 建立訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BookingInput'
 *     responses:
 *       200:
 *         description: 建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 */
function createBooking(req, res) {
  try {
    res.json(bookingService.createBooking(req.body));
  } catch (err) {
    console.error('createBooking error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings/{id}:
 *   delete:
 *     summary: 刪除訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 */
function deleteBooking(req, res) {
  try {
    res.json(bookingService.deleteBooking(req.params.id));
  } catch (err) {
    console.error('deleteBooking error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings/{id}/attempts:
 *   get:
 *     summary: 取得訂票嘗試記錄
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 嘗試記錄列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attempts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BookingAttempt'
 */
function getAttempts(req, res) {
  try {
    res.json({ attempts: bookingService.getAttempts(req.params.id) });
  } catch (err) {
    console.error('getAttempts error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listBookings, createBooking, deleteBooking, getAttempts };
```

- [ ] **Step 5: Create userController.js**

Create `server/src/controllers/userController.js`:
```js
'use strict';

const userService = require('../services/userService');

/**
 * @swagger
 * /v1/users:
 *   get:
 *     summary: 取得所有允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 使用者列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AllowedUser'
 */
function listUsers(req, res) {
  try {
    res.json({ users: userService.listUsers() });
  } catch (err) {
    console.error('listUsers error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/users:
 *   post:
 *     summary: 新增允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, role]
 *             properties:
 *               email:
 *                 type: string
 *               role:
 *                 type: string
 *                 enum: [user, admin]
 *     responses:
 *       200:
 *         description: 新增成功或失敗
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 */
function addUser(req, res) {
  try {
    const result = userService.addUser(req.body || {});
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('addUser error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/users/{email}:
 *   delete:
 *     summary: 刪除允許使用者（admin only）
 *     tags: [Users]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 *       400:
 *         description: 不能刪除自己
 */
function deleteUser(req, res) {
  try {
    const result = userService.deleteUser(req.params.email, req.user.email);
    if (!result.success) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    console.error('deleteUser error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listUsers, addUser, deleteUser };
```

- [ ] **Step 6: Commit**

```bash
git add server/src/controllers/
git commit -m "feat: 新增 controllers 層（auth / passenger / booking / user）"
```

---

## Task 8: Create routes/v1.js

**Files:**
- Create: `server/src/routes/v1.js`

- [ ] **Step 1: Create routes directory**

```bash
mkdir -p server/src/routes
```

- [ ] **Step 2: Create v1.js**

Create `server/src/routes/v1.js`:
```js
'use strict';

const { Router } = require('express');
const { verifyJwt } = require('../middlewares/auth');
const { adminOnly } = require('../middlewares/adminOnly');
const authController = require('../controllers/authController');
const passengerController = require('../controllers/passengerController');
const bookingController = require('../controllers/bookingController');
const userController = require('../controllers/userController');

const router = Router();

router.post('/auth/google', authController.googleAuth);

router.get('/passengers',      verifyJwt, passengerController.listPassengers);
router.post('/passengers',     verifyJwt, passengerController.savePassenger);
router.delete('/passengers/:id', verifyJwt, passengerController.deletePassenger);

router.get('/bookings',              verifyJwt, bookingController.listBookings);
router.post('/bookings',             verifyJwt, bookingController.createBooking);
router.delete('/bookings/:id',       verifyJwt, bookingController.deleteBooking);
router.get('/bookings/:id/attempts', verifyJwt, bookingController.getAttempts);

router.get('/users',          verifyJwt, adminOnly, userController.listUsers);
router.post('/users',         verifyJwt, adminOnly, userController.addUser);
router.delete('/users/:email', verifyJwt, adminOnly, userController.deleteUser);

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/
git commit -m "feat: 新增 routes/v1.js（REST /v1/* 路由）"
```

---

## Task 9: Create swagger.js and update api.js

**Files:**
- Create: `server/src/swagger.js`
- Modify: `server/src/api.js`

- [ ] **Step 1: Create swagger.js**

Create `server/src/swagger.js`:
```js
'use strict';

const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'THSRC Booking API',
      version: '1.0.0',
      description: '高鐵自動訂票 API',
    },
    servers: [{ url: 'https://api.joseph101039.uk' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        Passenger: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            idNumber: { type: 'string' },
            type: { type: 'string', enum: ['adult', 'student', 'senior', 'disabled', 'child'] },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        PassengerInput: {
          type: 'object',
          required: ['name', 'idNumber', 'type', 'email'],
          properties: {
            id: { type: 'string', description: '有值時為更新，否則為新增' },
            name: { type: 'string' },
            idNumber: { type: 'string' },
            type: { type: 'string', enum: ['adult', 'student', 'senior', 'disabled', 'child'] },
            email: { type: 'string' },
            phone: { type: 'string' },
          },
        },
        Booking: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            passengerId: { type: 'string' },
            fromStation: { type: 'string' },
            toStation: { type: 'string' },
            date: { type: 'string', example: '2026-05-10' },
            desiredTime: { type: 'string', example: '09:00' },
            earliestTime: { type: 'string', example: '08:00' },
            latestTime: { type: 'string', example: '10:00' },
            maxRetries: { type: 'integer' },
            status: { type: 'string', enum: ['pending', 'running', 'success', 'failed'] },
            retryCount: { type: 'integer' },
            trainNo: { type: 'string' },
            ticketNo: { type: 'string' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
        },
        BookingInput: {
          type: 'object',
          required: ['passengerId', 'fromStation', 'toStation', 'date', 'desiredTime', 'earliestTime', 'latestTime'],
          properties: {
            passengerId: { type: 'string' },
            fromStation: { type: 'string' },
            toStation: { type: 'string' },
            date: { type: 'string', example: '2026-05-10' },
            desiredTime: { type: 'string', example: '09:00' },
            earliestTime: { type: 'string', example: '08:00' },
            latestTime: { type: 'string', example: '10:00' },
            maxRetries: { type: 'integer', default: 10 },
            scheduledAt: { type: 'string', description: 'ISO datetime，null 表示立即執行' },
          },
        },
        BookingAttempt: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            bookingId: { type: 'string' },
            attemptedAt: { type: 'string' },
            success: { type: 'integer', enum: [0, 1] },
            reason: { type: 'string', nullable: true },
          },
        },
        AllowedUser: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
            createdAt: { type: 'string' },
          },
        },
      },
    },
  },
  apis: [path.join(__dirname, 'controllers/**/*.js')],
};

const spec = swaggerJsdoc(options);

if (require.main === module) {
  process.stdout.write(JSON.stringify(spec, null, 2));
}

module.exports = spec;
```

- [ ] **Step 2: Rewrite api.js**

Replace the entire contents of `server/src/api.js` with:
```js
'use strict';

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const CONFIG = require('./config');
const v1Router = require('./routes/v1');
const swaggerSpec = require('./swagger');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  console.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/v1', v1Router);

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    console.log('THSRC server listening on port', CONFIG.PORT);
  });
}

module.exports = app;
```

- [ ] **Step 3: Update scheduler.js import**

In `server/src/scheduler.js`, change line 6:
```js
// Before:
const { runBooking } = require('./booking_engine');
// After:
const { runBooking } = require('./services/bookingEngineService');
```

- [ ] **Step 4: Run the server briefly to confirm it starts**

```bash
cd server && JWT_SECRET=test GOOGLE_CLIENT_ID=test node --experimental-sqlite src/api.js &
sleep 2
curl -s http://localhost:8081/
kill %1
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: Verify /api-docs serves**

```bash
cd server && JWT_SECRET=test GOOGLE_CLIENT_ID=test node --experimental-sqlite src/api.js &
sleep 2
curl -s http://localhost:8081/api-docs/ | head -c 200
kill %1
```

Expected: HTML containing `swagger`

- [ ] **Step 6: Delete dead files**

```bash
rm server/src/booking_engine.js server/src/mailer.js
```

- [ ] **Step 7: Commit**

```bash
git add server/src/api.js server/src/scheduler.js server/src/swagger.js
git rm server/src/booking_engine.js server/src/mailer.js
git commit -m "feat: 重組 api.js 掛載 /v1 路由與 Swagger，刪除 booking_engine.js 與 mailer.js"
```

---

## Task 10: Update existing tests

**Files:**
- Modify: `server/test/auth.test.js`
- Modify: `server/test/admin.test.js`

- [ ] **Step 1: Update auth.test.js routes**

In `server/test/auth.test.js`, update every occurrence of `path: '/'` inside `postJson` calls that handle `googleAuth` and auth middleware tests. The test file uses a shared `postJson` helper — update the `path` arguments:

- For `action: 'googleAuth'` test: change path `'/'` → `'/v1/auth/google'` and remove the `action` field from the body (the new endpoint takes `{ credential }` directly)
- For middleware tests (`getPassengers`, etc.): change path `'/'` → `'/v1/passengers'` and remove `action` from body (GET would be cleaner, but the test uses POST helper — change to use a GET helper instead)

Replace the entire `server/test/auth.test.js` with:
```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-test-${Date.now()}.db`);

const db = require('../src/db');

test('isAllowedUser：預設 admin 帳號應被允許', () => {
  const userRepo = require('../src/repositories/userRepo');
  assert.strictEqual(userRepo.isAllowed('joseph101039@gmail.com'), true);
});

test('isAllowedUser：不存在的帳號應被拒絕', () => {
  const userRepo = require('../src/repositories/userRepo');
  assert.strictEqual(userRepo.isAllowed('stranger@example.com'), false);
});

test('isAllowedUser：大小寫不敏感', () => {
  const userRepo = require('../src/repositories/userRepo');
  assert.strictEqual(userRepo.isAllowed('Joseph101039@Gmail.COM'), true);
});

const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-secret-key-for-unit-tests';
process.env.JWT_SECRET = TEST_SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const app = require('../src/api');
const http = require('http');

function postJson(server, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function getJson(server, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'GET',
      headers,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('verifyJwt：無 token 時 GET /v1/passengers 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers');
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('verifyJwt：有效 token 時 GET /v1/passengers 應成功', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: '7d' });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers', { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('verifyJwt：過期 token 應回傳 401', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: -1 });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers', { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/auth/google 無 credential 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/auth/google', {});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('credential'));
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: Update admin.test.js routes**

Replace the entire `server/test/admin.test.js` with:
```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-admin-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const userRepo = require('../src/repositories/userRepo');

test('getAllowedUsers：應回傳所有使用者（至少含預設 admin）', () => {
  const users = userRepo.getAll();
  assert.ok(Array.isArray(users));
  assert.ok(users.some(u => u.email === 'joseph101039@gmail.com' && u.role === 'admin'));
});

test('addAllowedUser：新增使用者後可取得', () => {
  const result = userRepo.add({ email: 'newuser@example.com', role: 'user' });
  assert.strictEqual(result.success, true);
  const users = userRepo.getAll();
  assert.ok(users.some(u => u.email === 'newuser@example.com' && u.role === 'user'));
});

test('addAllowedUser：重複 email 應回傳 success:false', () => {
  userRepo.add({ email: 'dup@example.com', role: 'user' });
  const result = userRepo.add({ email: 'dup@example.com', role: 'admin' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('已存在'));
});

test('deleteAllowedUser：刪除後不應出現在列表', () => {
  userRepo.add({ email: 'todelete@example.com', role: 'user' });
  const result = userRepo.deleteByEmail('todelete@example.com');
  assert.strictEqual(result.success, true);
  const users = userRepo.getAll();
  assert.ok(!users.some(u => u.email === 'todelete@example.com'));
});

test('addAllowedUser：缺少 email 應回傳 success:false', () => {
  const result = userRepo.add({ email: null, role: 'user' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('email'));
});

test('addAllowedUser：email 非字串應回傳 success:false', () => {
  const result = userRepo.add({ email: 123, role: 'user' });
  assert.strictEqual(result.success, false);
});

const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/api');

function postJson(server, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function deleteReq(server, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'DELETE',
      headers,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function getJson(server, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'GET',
      headers,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeToken(role) {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

test('GET /v1/users：admin token 應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/users', { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/users：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/users', { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：admin 可新增使用者', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'api-test@example.com', role: 'user' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'x@x.com', role: 'user' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：admin 刪除自己應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('joseph101039@gmail.com'), { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('other@example.com'), { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：無效 role 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'x@x.com', role: 'superadmin' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：缺少 email 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { role: 'user' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：case-insensitive 自刪保護', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('JOSEPH101039@GMAIL.COM'), { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 3: Run existing tests**

```bash
cd server && npm test 2>&1
```

Expected: all tests pass. If failures, investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add server/test/auth.test.js server/test/admin.test.js
git commit -m "test: 更新 auth / admin 測試至 /v1/* 路由"
```

---

## Task 11: Add new tests — passengers and bookings

**Files:**
- Create: `server/test/passengers.test.js`
- Create: `server/test/bookings.test.js`

- [ ] **Step 1: Create passengers.test.js**

Create `server/test/passengers.test.js`:
```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-passengers-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const app = require('../src/api');

function makeToken(role = 'user') {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('GET /v1/passengers：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/passengers', null);
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/passengers：有效 token 應回傳陣列', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${makeToken()}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.passengers));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/passengers：新增旅客後可在列表中找到', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const saveRes = await request(server, 'POST', '/v1/passengers', {
      name: '測試旅客', idNumber: 'A123456789', type: 'adult', email: 'p@test.com', phone: '0912345678',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.body.success, true);
    const newId = saveRes.body.id;

    const listRes = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${token}` });
    assert.ok(listRes.body.passengers.some(p => p.id === newId));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/passengers/:id：刪除後不應出現在列表', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const saveRes = await request(server, 'POST', '/v1/passengers', {
      name: '刪除用', idNumber: 'B987654321', type: 'adult', email: 'del@test.com',
    }, { Authorization: `Bearer ${token}` });
    const id = saveRes.body.id;

    const delRes = await request(server, 'DELETE', `/v1/passengers/${id}`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(delRes.status, 200);

    const listRes = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${token}` });
    assert.ok(!listRes.body.passengers.some(p => p.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: Create bookings.test.js**

Create `server/test/bookings.test.js`:
```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-bookings-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const app = require('../src/api');

function makeToken(role = 'user') {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const BOOKING_FIXTURE = {
  passengerId: 'test-passenger-id',
  fromStation: '台北',
  toStation: '左營',
  date: '2026-06-01',
  desiredTime: '09:00',
  earliestTime: '08:00',
  latestTime: '10:00',
  maxRetries: 3,
};

test('GET /v1/bookings：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/bookings', null);
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/bookings：有效 token 應回傳陣列', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${makeToken()}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.bookings));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：新增後可在列表中找到', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.body.success, true);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    assert.ok(listRes.body.bookings.some(b => b.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/bookings/:id：刪除後不應出現在列表', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(delRes.status, 200);

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    assert.ok(!listRes.body.bookings.some(b => b.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/bookings/:id/attempts：應回傳空陣列（新訂票無嘗試）', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    const attemptsRes = await request(server, 'GET', `/v1/bookings/${id}/attempts`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(attemptsRes.status, 200);
    assert.ok(Array.isArray(attemptsRes.body.attempts));
    assert.strictEqual(attemptsRes.body.attempts.length, 0);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 3: Run all tests**

```bash
cd server && npm test 2>&1
```

Expected: all tests pass (auth, admin, passengers, bookings, integration if skipped).

- [ ] **Step 4: Commit**

```bash
git add server/test/passengers.test.js server/test/bookings.test.js
git commit -m "test: 新增 passengers / bookings REST API 測試"
```

---

## Task 12: Update frontend ui/js/api.js and admin.js

**Files:**
- Modify: `ui/js/api.js`
- Modify: `ui/js/admin.js`

- [ ] **Step 1: Rewrite ui/js/api.js**

Replace the entire contents of `ui/js/api.js` with:
```js
const API_URL = 'https://api.joseph101039.uk';
window.__API_URL = API_URL;

function _getToken() {
  return localStorage.getItem('thsrc_jwt');
}

function _authHeaders() {
  const token = _getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function _handle401() {
  localStorage.removeItem('thsrc_jwt');
  sessionStorage.setItem('returnUrl', location.href);
  location.href = 'login.html';
  throw new Error('未授權，請重新登入');
}

async function getJson(path) {
  const res = await fetch(API_URL + path, { headers: _authHeaders() });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function postJson(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function deleteJson(path) {
  const res = await fetch(API_URL + path, { method: 'DELETE', headers: _authHeaders() });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const api = {
  googleAuth:         (credential) => postJson('/v1/auth/google', { credential }),
  getPassengers:      ()           => getJson('/v1/passengers'),
  savePassenger:      (data)       => postJson('/v1/passengers', data),
  deletePassenger:    (id)         => deleteJson(`/v1/passengers/${id}`),
  getBookings:        ()           => getJson('/v1/bookings'),
  createBooking:      (data)       => postJson('/v1/bookings', data),
  deleteBooking:      (id)         => deleteJson(`/v1/bookings/${id}`),
  getBookingAttempts: (id)         => getJson(`/v1/bookings/${id}/attempts`),
  getAllowedUsers:     ()           => getJson('/v1/users'),
  addAllowedUser:     (data)       => postJson('/v1/users', data),
  deleteAllowedUser:  (email)      => deleteJson(`/v1/users/${encodeURIComponent(email)}`),
};
```

- [ ] **Step 2: Update ui/js/admin.js — replace adminApi with api calls**

In `ui/js/admin.js`, replace the `adminApi` object and its usages with `api.*` calls:

Replace:
```js
const adminApi = {
  getUsers:   ()      => gasCall('getAllowedUsers'),
  addUser:    (data)  => gasCall('addAllowedUser', { data }),
  deleteUser: (email) => gasCall('deleteAllowedUser', { id: email }),
};
```

With:
```js
const adminApi = {
  getUsers:   ()      => api.getAllowedUsers(),
  addUser:    (data)  => api.addAllowedUser(data),
  deleteUser: (email) => api.deleteAllowedUser(email),
};
```

- [ ] **Step 3: Also check ui/js/auth.js for any gasCall references**

```bash
grep -n "gasCall\|GAS_URL\|POST.*action" ui/js/auth.js ui/js/booking.js ui/js/passengers.js ui/js/index.js ui/js/booking-detail.js 2>/dev/null
```

If any `gasCall` references remain in other files, replace them with the corresponding `api.*` calls. These files use `api.getPassengers()`, `api.createBooking()` etc., which now use the new REST helpers automatically — no changes needed in those files since the `api` object interface is unchanged.

- [ ] **Step 4: Start dev server and verify UI loads**

```bash
cd ui && API_URL=https://api.joseph101039.uk npm run dev
```

Open `http://localhost:8082` in a browser and confirm the login page loads without JS errors.

- [ ] **Step 5: Commit**

```bash
git add ui/js/api.js ui/js/admin.js
git commit -m "feat: 前端 api.js 改用 REST /v1/* 路由，移除 GAS-style gasCall"
```

---

## Task 13: Generate and commit Swagger YAML

**Files:**
- Create: `docs/swagger.yaml`

- [ ] **Step 1: Generate swagger.yaml**

```bash
cd server && JWT_SECRET=test GOOGLE_CLIENT_ID=test node --experimental-sqlite src/swagger.js > ../docs/swagger.yaml
```

- [ ] **Step 2: Verify the file is valid**

```bash
head -20 docs/swagger.yaml
```

Expected: starts with `{` or `openapi:` — a valid JSON/YAML document.

- [ ] **Step 3: Commit**

```bash
git add docs/swagger.yaml
git commit -m "docs: 新增 Swagger API spec（docs/swagger.yaml）"
```

---

## Task 14: Final verification and PR

- [ ] **Step 1: Run full test suite**

```bash
cd server && npm test 2>&1
```

Expected: all tests pass with no failures.

- [ ] **Step 2: Start server locally and hit /api-docs**

```bash
cd server && JWT_SECRET=test GOOGLE_CLIENT_ID=test node --experimental-sqlite src/api.js &
sleep 2
curl -s http://localhost:8081/ && echo ""
curl -s -o /dev/null -w "%{http_code}" http://localhost:8081/v1/passengers
kill %1
```

Expected:
```
{"status":"ok"}
401
```

- [ ] **Step 3: Confirm deleted files are gone**

```bash
ls server/src/booking_engine.js server/src/mailer.js 2>&1
```

Expected: `No such file or directory` for both.

- [ ] **Step 4: Commit any remaining changes**

```bash
git status
```

If clean, no action needed. If dirty, stage and commit remaining files.

- [ ] **Step 5: Push branch**

```bash
git push origin feat-server-refactor
```

---

## Deploy order reminder

After PR is merged to `main`:
1. `DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh` — push Docker image
2. Wait ~5 minutes for VM cron pull, then verify: `curl http://35.212.154.47:8081/v1/passengers` → 401 (not 404)
3. Only then: `git push origin main:gh-pages` — deploy new frontend
