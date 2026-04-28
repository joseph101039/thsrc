# Node.js Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以 Node.js 取代 GAS 後端，在 `server/` 目錄下實作完整訂票 API + 排程引擎，部署在 GCE VM port 8081。

**Architecture:** Express API server（`api.js`）和獨立 scheduler worker（`scheduler.js`）跑同一個 Docker image，共享 SQLite volume。`docker-compose.yml` 在根目錄統一管理 captcha、server、scheduler、watchtower 四個 service。

**Tech Stack:** Node.js 20, Express, better-sqlite3, node-schedule, node-fetch, nodemailer, Docker (linux/amd64), docker-compose

---

## File Map

| 檔案 | 動作 | 責任 |
|------|------|------|
| `server/package.json` | 新建 | 依賴宣告 |
| `server/src/config.js` | 新建 | 所有常數（stations、status、retry 設定） |
| `server/src/db.js` | 新建 | SQLite schema init + query helpers |
| `server/src/thsrc.js` | 新建 | THSRC 網站 scraping（從 Thsrc.gs 移植） |
| `server/src/mailer.js` | 新建 | Nodemailer Gmail SMTP wrapper |
| `server/src/booking_engine.js` | 新建 | runBooking、handleRetry 邏輯 |
| `server/src/api.js` | 新建 | Express HTTP server，action dispatch |
| `server/src/scheduler.js` | 新建 | node-schedule poller，每分鐘執行 |
| `server/Dockerfile` | 新建 | Node.js 20 slim image |
| `server/deploy-server.sh` | 新建 | build linux/amd64 + push to Docker Hub |
| `docker-compose.yml` | 新建（根目錄） | 統一管理所有 containers |
| `ui/js/api.js` | 修改 | 改 URL 指向 8081 |

---

## Task 1: 初始化 package.json 和 config.js

**Files:**
- Create: `server/package.json`
- Create: `server/src/config.js`

- [ ] **Step 1: 建立 server/package.json**

```json
{
  "name": "thsrc-server",
  "version": "1.0.0",
  "type": "commonjs",
  "main": "src/api.js",
  "scripts": {
    "start": "node src/api.js",
    "scheduler": "node src/scheduler.js"
  },
  "dependencies": {
    "better-sqlite3": "^9.4.3",
    "cors": "^2.8.5",
    "express": "^4.18.3",
    "node-fetch": "^2.7.0",
    "node-schedule": "^2.1.1",
    "nodemailer": "^6.9.13",
    "uuid": "^9.0.1"
  }
}
```

注意：`node-fetch` 用 v2（CommonJS compatible），不用 v3（ESM only）。

- [ ] **Step 2: 建立 server/src/config.js**

```js
'use strict';

const CONFIG = {
  PORT: parseInt(process.env.PORT || '8081', 10),
  DB_PATH: process.env.DB_PATH || './data/thsrc.db',
  CAPTCHA_API_URL: process.env.CAPTCHA_API_URL || 'http://35.212.154.47:8080',
  RETRY_WAIT_MINUTES: 2,
  MAX_RETRIES_DEFAULT: 10,
  STUCK_BOOKING_MINUTES: 10,

  STATIONS: ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'],

  STATION_CODES: {
    '南港': '1', '台北': '2', '板橋': '3', '桃園': '4',
    '新竹': '5', '苗栗': '6', '台中': '7', '彰化': '8',
    '雲林': '9', '嘉義': '10', '台南': '11', '左營': '12',
  },

  PASSENGER_TYPES: {
    adult: '成人',
    student: '學生',
    senior: '敬老',
    disabled: '愛心',
    child: '兒童',
  },

  BOOKING_STATUS: {
    PENDING: 'pending',
    RUNNING: 'running',
    SUCCESS: 'success',
    FAILED: 'failed',
  },
};

module.exports = CONFIG;
```

- [ ] **Step 3: 安裝依賴**

```bash
cd server && npm install
```

Expected: `node_modules/` 產生，無 error。

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json server/src/config.js
git commit -m "feat(server): init package.json and config"
```

---

## Task 2: 實作 db.js（SQLite layer）

**Files:**
- Create: `server/src/db.js`

- [ ] **Step 1: 建立 server/src/db.js**

```js
'use strict';

const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const CONFIG = require('./config');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dbPath = path.resolve(CONFIG.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _initSchema(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passengers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      id_number  TEXT NOT NULL,
      type       TEXT NOT NULL,
      email      TEXT NOT NULL
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
  `);
}

// ── Passengers ──────────────────────────────────────────────

function getPassengers() {
  return getDb().prepare('SELECT * FROM passengers').all();
}

function savePassenger({ id, name, idNumber, type, email }) {
  const db = getDb();
  const now = new Date().toISOString();
  if (id) {
    db.prepare(
      'UPDATE passengers SET name=?, id_number=?, type=?, email=? WHERE id=?'
    ).run(name, idNumber, type, email, id);
    return { success: true, id };
  }
  const newId = uuidv4();
  db.prepare(
    'INSERT INTO passengers (id, name, id_number, type, email) VALUES (?, ?, ?, ?, ?)'
  ).run(newId, name, idNumber, type, email);
  return { success: true, id: newId };
}

function deletePassenger(id) {
  getDb().prepare('DELETE FROM passengers WHERE id=?').run(id);
  return { success: true };
}

// ── Bookings ─────────────────────────────────────────────────

function getBookings() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY created_at DESC').all();
}

function createBooking({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt }) {
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

function updateBookingFields(id, fields) {
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

function getBookingById(id) {
  return getDb().prepare('SELECT * FROM bookings WHERE id=?').get(id);
}

function getPassengerById(id) {
  return getDb().prepare('SELECT * FROM passengers WHERE id=?').get(id);
}

function getPendingBookings() {
  return getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(new Date().toISOString());
}

function getStuckRunningBookings() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings WHERE status = 'running' AND updated_at < ?
  `).all(cutoff);
}

module.exports = {
  getPassengers, savePassenger, deletePassenger,
  getBookings, createBooking, updateBookingFields,
  getBookingById, getPassengerById,
  getPendingBookings, getStuckRunningBookings,
};
```

- [ ] **Step 2: 手動驗證 db.js 可正常初始化**

```bash
cd server && node -e "
const db = require('./src/db');
console.log('passengers:', db.getPassengers());
const r = db.savePassenger({ name: '測試', idNumber: 'A123456789', type: 'adult', email: 'test@test.com' });
console.log('saved:', r);
console.log('list:', db.getPassengers());
db.deletePassenger(r.id);
console.log('after delete:', db.getPassengers());
"
```

Expected output:
```
passengers: []
saved: { success: true, id: '<uuid>' }
list: [ { id: '<uuid>', name: '測試', id_number: 'A123456789', type: 'adult', email: 'test@test.com' } ]
after delete: []
```

- [ ] **Step 3: 清除測試產生的 db 檔**

```bash
rm -f server/data/thsrc.db
```

- [ ] **Step 4: Commit**

```bash
git add server/src/db.js
git commit -m "feat(server): add SQLite db layer"
```

---

## Task 3: 實作 thsrc.js（THSRC scraping）

**Files:**
- Create: `server/src/thsrc.js`

從 `gas/Thsrc.gs` 直譯，`UrlFetchApp.fetch` → `node-fetch`，`Utilities.base64Encode` → `Buffer.from(...).toString('base64')`。

- [ ] **Step 1: 建立 server/src/thsrc.js**

```js
'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');

const THSRC_BASE = 'https://irs.thsrc.com.tw/IMINT';

async function thsrcInit() {
  const res = await fetch(THSRC_BASE + '/', { redirect: 'follow' });
  const html = await res.text();
  const cookieHeader = res.headers.raw()['set-cookie'] || [];
  const cookies = cookieHeader.join('; ');

  const tokenMatch = html.match(/name="BookingS1Form:hf:0"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const sessionMatch = cookies.match(/JSESSIONID=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';

  return { sessionId, token };
}

async function thsrcGetCaptcha(sessionId) {
  const res = await fetch(THSRC_BASE + '/CheckCode.jsp', {
    headers: { Cookie: 'JSESSIONID=' + sessionId },
  });
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

async function thsrcQueryTrains(sessionId, token, { fromStation, toStation, date, earliestTime, latestTime }) {
  const payload = new URLSearchParams({
    'BookingS1Form:hf:0': token,
    selectStartStation: CONFIG.STATION_CODES[fromStation],
    selectDestinationStation: CONFIG.STATION_CODES[toStation],
    toTimeInputField: date,
    toTimeTable: earliestTime,
    bookingMethod: '1',
  });

  const res = await fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
    redirect: 'follow',
  });
  const html = await res.text();
  return parseTrainOptions(html, earliestTime, latestTime);
}

function parseTrainOptions(html, earliestTime, latestTime) {
  const trains = [];
  const regex = /value="([^"]+)"\s[^>]*>[\s\S]*?<label[^>]*>([^<]+)<\/label>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const value = match[1];
    const label = match[2].trim();
    const timeMatch = label.match(/(\d{2}:\d{2})/g);
    if (!timeMatch || timeMatch.length < 2) continue;
    const departTime = timeMatch[0];
    const arriveTime = timeMatch[1];
    if (departTime >= earliestTime && departTime <= latestTime) {
      trains.push({ trainNo: value, departTime, arriveTime, label });
    }
  }
  return trains;
}

function selectBestTrain(trains, desiredTime) {
  if (trains.length === 0) return null;
  return trains.reduce((best, t) => {
    const diff = Math.abs(_timeToMinutes(t.departTime) - _timeToMinutes(desiredTime));
    const bestDiff = Math.abs(_timeToMinutes(best.departTime) - _timeToMinutes(desiredTime));
    return diff < bestDiff ? t : best;
  });
}

function _timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function thsrcSubmitBooking(sessionId, token, { trainNo, captcha }) {
  const payload = new URLSearchParams({
    'BookingS2Form:hf:0': token,
    'TrainQueryDataViewPanel:TrainGroup': trainNo,
    passengerCount: '1F',
    toPayment: '確認訂位',
    'homeCaptcha:securityCode': captcha,
  });

  const res = await fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
    redirect: 'follow',
  });
  const html = await res.text();
  return parseBookingResult(html);
}

function parseBookingResult(html) {
  const ticketMatch = html.match(/訂位代號[：:]\s*([A-Z0-9]+)/);
  if (ticketMatch) {
    return { success: true, ticketNo: ticketMatch[1], error: null };
  }
  const errorMatch = html.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</);
  return {
    success: false,
    ticketNo: null,
    error: errorMatch ? errorMatch[1].trim() : '訂票失敗（未知原因）',
  };
}

module.exports = { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain, parseTrainOptions };
```

- [ ] **Step 2: 驗證 module 可載入無語法錯誤**

```bash
cd server && node -e "require('./src/thsrc'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/src/thsrc.js
git commit -m "feat(server): add THSRC scraping module"
```

---

## Task 4: 實作 mailer.js

**Files:**
- Create: `server/src/mailer.js`

- [ ] **Step 1: 建立 server/src/mailer.js**

```js
'use strict';

const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendSuccessEmail(toEmail, booking, passenger) {
  const subject = '【高鐵訂票】訂票成功！';
  const text = [
    '您的高鐵票已成功訂購！',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.from_station + ' → ' + booking.to_station,
    '日期：' + booking.date,
    '車次：' + booking.train_no,
    '訂位代號：' + booking.ticket_no,
    '嘗試次數：' + booking.retry_count,
    '',
    '請記得在發車前至超商或車站取票付款。',
  ].join('\n');

  await transporter.sendMail({ from: process.env.GMAIL_USER, to: toEmail, subject, text });
}

async function sendFailureEmail(toEmail, booking, passenger, reason) {
  const subject = '【高鐵訂票】訂票失敗';
  const text = [
    '很抱歉，您的高鐵訂票未能成功。',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.from_station + ' → ' + booking.to_station,
    '日期：' + booking.date,
    '期望時間：' + booking.desired_time,
    '嘗試次數：' + booking.retry_count,
    '失敗原因：' + reason,
    '',
    '請手動前往高鐵官網訂票：https://irs.thsrc.com.tw/IMINT/',
  ].join('\n');

  await transporter.sendMail({ from: process.env.GMAIL_USER, to: toEmail, subject, text });
}

module.exports = { sendSuccessEmail, sendFailureEmail };
```

- [ ] **Step 2: 驗證 module 可載入**

```bash
cd server && node -e "require('./src/mailer'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/src/mailer.js
git commit -m "feat(server): add nodemailer Gmail wrapper"
```

---

## Task 5: 實作 booking_engine.js

**Files:**
- Create: `server/src/booking_engine.js`

- [ ] **Step 1: 建立 server/src/booking_engine.js**

```js
'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');
const db = require('./db');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('./thsrc');
const { sendSuccessEmail, sendFailureEmail } = require('./mailer');

async function runBooking(bookingId) {
  const booking = db.getBookingById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  db.updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

  try {
    const { sessionId, token } = await thsrcInit();

    const trains = await thsrcQueryTrains(sessionId, token, {
      fromStation: booking.from_station,
      toStation: booking.to_station,
      date: booking.date,
      earliestTime: booking.earliest_time,
      latestTime: booking.latest_time,
    });

    if (trains.length === 0) {
      return handleRetry(booking, '無可用班次');
    }

    const bestTrain = selectBestTrain(trains, booking.desired_time);
    const captchaBase64 = await thsrcGetCaptcha(sessionId);

    const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captchaBase64 }),
    });
    const { answer: captchaAnswer } = await captchaRes.json();
    console.log('驗證碼辨識結果：', captchaAnswer);

    db.updateBookingFields(bookingId, { trainNo: bestTrain.trainNo });

    const result = await thsrcSubmitBooking(sessionId, token, {
      trainNo: bestTrain.trainNo,
      captcha: captchaAnswer,
    });

    if (result.success) {
      db.updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.SUCCESS,
        ticketNo: result.ticketNo,
      });
      const passenger = db.getPassengerById(booking.passenger_id);
      const updatedBooking = db.getBookingById(bookingId);
      await sendSuccessEmail(passenger.email, updatedBooking, passenger);
      console.log('訂票成功：', bookingId, result.ticketNo);
    } else {
      return handleRetry(booking, result.error);
    }
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, err.message);
  }
}

function handleRetry(booking, reason) {
  const newRetryCount = (booking.retry_count || 0) + 1;
  db.updateBookingFields(booking.id, { retryCount: newRetryCount });

  if (newRetryCount >= booking.max_retries) {
    db.updateBookingFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    const passenger = db.getPassengerById(booking.passenger_id);
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
    console.log('Scheduled retry', newRetryCount, '/', booking.max_retries, 'for booking:', booking.id);
  }
}

module.exports = { runBooking, handleRetry };
```

- [ ] **Step 2: 驗證 module 可載入**

```bash
cd server && node -e "require('./src/booking_engine'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add server/src/booking_engine.js
git commit -m "feat(server): add booking engine (runBooking, handleRetry)"
```

---

## Task 6: 實作 api.js（Express server）

**Files:**
- Create: `server/src/api.js`

- [ ] **Step 1: 建立 server/src/api.js**

```js
'use strict';

const express = require('express');
const cors = require('cors');
const CONFIG = require('./config');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', (req, res) => {
  const { action, data, id } = req.body || {};
  try {
    let result;
    switch (action) {
      case 'getPassengers':   result = { passengers: db.getPassengers() };         break;
      case 'savePassenger':   result = db.savePassenger(data);                     break;
      case 'deletePassenger': result = db.deletePassenger(id);                     break;
      case 'getBookings':     result = { bookings: db.getBookings() };             break;
      case 'createBooking':   result = db.createBooking(data);                     break;
      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
    res.json(result);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const port = CONFIG.PORT;
app.listen(port, () => {
  console.log('THSRC server listening on port', port);
});

module.exports = app;
```

- [ ] **Step 2: 本地啟動並測試**

```bash
cd server && node src/api.js &
sleep 1

# health check
curl -s http://localhost:8081/ | python3 -m json.tool

# 新增旅客
curl -s -X POST http://localhost:8081/ \
  -H 'Content-Type: application/json' \
  -d '{"action":"savePassenger","data":{"name":"測試者","idNumber":"A123456789","type":"adult","email":"test@example.com"}}' \
  | python3 -m json.tool

# 列出旅客
curl -s -X POST http://localhost:8081/ \
  -H 'Content-Type: application/json' \
  -d '{"action":"getPassengers"}' \
  | python3 -m json.tool

kill %1
```

Expected: `{"status": "ok"}`，然後 savePassenger 回傳 `{"success": true, "id": "<uuid>"}`，getPassengers 回傳一筆資料。

- [ ] **Step 3: 清除測試 db**

```bash
rm -f server/data/thsrc.db
```

- [ ] **Step 4: Commit**

```bash
git add server/src/api.js
git commit -m "feat(server): add Express API server"
```

---

## Task 7: 實作 scheduler.js

**Files:**
- Create: `server/src/scheduler.js`

- [ ] **Step 1: 建立 server/src/scheduler.js**

```js
'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const db = require('./db');
const { runBooking } = require('./booking_engine');

console.log('Scheduler started');

schedule.scheduleJob('* * * * *', async () => {
  try {
    await pollPendingBookings();
  } catch (err) {
    console.error('pollPendingBookings error:', err.message);
  }
});

async function pollPendingBookings() {
  // 重置卡住的 running bookings
  const stuck = db.getStuckRunningBookings();
  for (const b of stuck) {
    console.log('Resetting stuck booking:', b.id);
    db.updateBookingFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
  }

  // 找下一筆可執行的 pending booking
  const next = db.getPendingBookings();
  if (next) {
    console.log('Polling: running booking', next.id);
    await runBooking(next.id);
  }
}
```

- [ ] **Step 2: 驗證 scheduler 可啟動（5 秒後 Ctrl+C）**

```bash
cd server && timeout 5 node src/scheduler.js || true
```

Expected: 印出 `Scheduler started`，無 crash。

- [ ] **Step 3: Commit**

```bash
git add server/src/scheduler.js
git commit -m "feat(server): add scheduler worker"
```

---

## Task 8: 撰寫 Dockerfile 和 deploy-server.sh

**Files:**
- Create: `server/Dockerfile`
- Create: `server/deploy-server.sh`
- Create: `server/.dockerignore`

- [ ] **Step 1: 建立 server/Dockerfile**

```dockerfile
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

- [ ] **Step 2: 建立 server/.dockerignore**

```
node_modules
data
.env
```

- [ ] **Step 3: 建立 server/deploy-server.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-joseph50804}"
IMAGE="${DOCKERHUB_USER}/thsrc-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[部署] 建構並推送 linux/amd64 映像..."
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:latest" \
  --push \
  "$SCRIPT_DIR"

echo "[完成] 已推送 ${IMAGE}:latest"
echo "Watchtower 將在 5 分鐘內自動更新 VM 上的容器。"
```

- [ ] **Step 4: 設定執行權限**

```bash
chmod +x server/deploy-server.sh
```

- [ ] **Step 5: 本地 Docker build 測試（不 push）**

```bash
docker buildx build --platform linux/amd64 -t thsrc-server-test server/
docker run --rm -e PORT=8081 -e DB_PATH=/tmp/test.db -p 8081:8081 thsrc-server-test &
sleep 2
curl -s http://localhost:8081/ | python3 -m json.tool
docker stop $(docker ps -q --filter ancestor=thsrc-server-test)
```

Expected: `{"status": "ok"}`

- [ ] **Step 6: Commit**

```bash
git add server/Dockerfile server/.dockerignore server/deploy-server.sh
git commit -m "feat(server): add Dockerfile and deploy script"
```

---

## Task 9: 建立 docker-compose.yml（根目錄）

**Files:**
- Create: `docker-compose.yml`（根目錄）

- [ ] **Step 1: 建立 docker-compose.yml**

```yaml
services:
  captcha:
    image: joseph50804/captcha-solver:latest
    ports:
      - "8080:8080"
    restart: unless-stopped

  server:
    image: joseph50804/thsrc-server:latest
    ports:
      - "8081:8081"
    volumes:
      - db-data:/app/data
    env_file: .env
    restart: unless-stopped

  scheduler:
    image: joseph50804/thsrc-server:latest
    command: node src/scheduler.js
    volumes:
      - db-data:/app/data
    env_file: .env
    restart: unless-stopped

  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300
    restart: unless-stopped

volumes:
  db-data:
```

- [ ] **Step 2: 建立 .env.example（根目錄，commit 用）**

```bash
cat > .env.example << 'EOF'
GMAIL_USER=your@gmail.com
GMAIL_APP_PASSWORD=your_app_password_here
EOF
```

- [ ] **Step 3: 確認 .env 在 .gitignore 中**

```bash
grep -q '^\.env$' .gitignore || echo '.env' >> .gitignore
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: add docker-compose.yml for all services"
```

---

## Task 10: 更新 ui/js/api.js

**Files:**
- Modify: `ui/js/api.js`

- [ ] **Step 1: 修改 ui/js/api.js**

將第一行從：
```js
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzdtPx4EiNx01o5RDohRVfEHROdlHRBgNRPs28K7-seg899U9hY91Um3g5oz2MTDfkzig/exec';
```
改為：
```js
const GAS_URL = 'http://35.212.154.47:8081';
```

同時將 `gasCall` 中的 `fetch` 呼叫加上 Content-Type header（GAS 不需要，但 Express 需要）：

```js
const GAS_URL = 'http://35.212.154.47:8081';

async function gasCall(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const api = {
  getPassengers:   ()     => gasCall('getPassengers'),
  savePassenger:   (data) => gasCall('savePassenger', { data }),
  deletePassenger: (id)   => gasCall('deletePassenger', { id }),
  getBookings:     ()     => gasCall('getBookings'),
  createBooking:   (data) => gasCall('createBooking', { data }),
};
```

- [ ] **Step 2: 本地測試 UI**

```bash
# server 要在跑
cd server && node src/api.js &
# 啟動 UI dev server
python3 -m http.server 8080 --directory ui
# 開瀏覽器 http://localhost:8080，確認旅客 CRUD 和建立訂票可正常運作
```

- [ ] **Step 3: 停止 server**

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add ui/js/api.js
git commit -m "feat(ui): point API URL to Node.js server on port 8081"
```

---

## Task 11: 部署到 GCE VM

- [ ] **Step 1: 新增 GCP firewall 規則開放 TCP 8081**

```bash
gcloud compute firewall-rules create allow-thsrc-server-8081 \
  --allow tcp:8081 \
  --target-tags captcha-solver \
  --project sincere-office-494609-m3
```

Expected: `Created [https://www.googleapis.com/compute/v1/...].`

- [ ] **Step 2: Build 並 push Docker image**

```bash
DOCKERHUB_USER=joseph50804 ./server/deploy-server.sh
```

Expected: `[完成] 已推送 joseph50804/thsrc-server:latest`

- [ ] **Step 3: 將 docker-compose.yml 上傳到 VM**

```bash
gcloud compute scp docker-compose.yml instance-20260427-141455:~/docker-compose.yml \
  --zone=us-west1-b --project=sincere-office-494609-m3
```

- [ ] **Step 4: 在 VM 上建立 .env 檔**

SSH 進 VM：
```bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3
```

在 VM 上執行：
```bash
cat > ~/thsrc/.env << 'EOF'
GMAIL_USER=joseph101039@gmail.com
GMAIL_APP_PASSWORD=<你的 App Password>
EOF
```

- [ ] **Step 5: 停止現有 captcha container，改用 docker-compose 啟動**

在 VM 上執行：
```bash
# 停止現有 watchtower 和 captcha（若有）
docker stop $(docker ps -q) 2>/dev/null || true

# 切換到放 docker-compose.yml 的目錄
cd ~/

# 啟動所有服務
docker-compose up -d
```

- [ ] **Step 6: 驗證所有服務正常**

```bash
# 在 VM 上
docker-compose ps
docker logs thsrc-server --tail 20
docker logs thsrc-scheduler --tail 20
```

Expected: server 印 `THSRC server listening on port 8081`，scheduler 印 `Scheduler started`，captcha container running。

- [ ] **Step 7: 從本機驗證 API 可連通**

```bash
curl -s http://35.212.154.47:8081/ | python3 -m json.tool
```

Expected: `{"status": "ok"}`

- [ ] **Step 8: Commit 完成狀態**

```bash
git add -A
git commit -m "chore: complete Node.js server deployment"
```

---

## Self-Review

**Spec coverage check:**
- ✅ SQLite 資料層（Task 2）
- ✅ THSRC scraping（Task 3）
- ✅ Nodemailer Gmail（Task 4）
- ✅ Booking engine / runBooking / handleRetry（Task 5）
- ✅ Express API，action-based POST（Task 6）
- ✅ node-schedule scheduler worker（Task 7）
- ✅ Dockerfile + deploy-server.sh（Task 8）
- ✅ docker-compose.yml（Task 9）
- ✅ ui/js/api.js URL 更新 + Content-Type header（Task 10）
- ✅ GCP firewall 規則 + 首次上線步驟（Task 11）

**Type/method consistency check:**
- `db.updateBookingFields` 在 Task 2 定義，Task 5 / Task 7 呼叫 — 欄位名稱（`retryCount`、`scheduledAt`、`trainNo`、`ticketNo`、`status`）一致
- `db.getBookingById` / `db.getPassengerById` 在 Task 2 定義，Task 5 呼叫 — 一致
- `db.getPendingBookings()` 回傳單筆或 undefined，Task 7 用 `if (next)` 判斷 — 正確
- `booking.from_station` / `booking.to_station` 等 snake_case 欄位名：SQLite 存 snake_case，Task 3、5 讀取時用 `booking.from_station` — 一致
- `mailer.js` 中用 `booking.from_station`、`booking.train_no` 等 — 一致
