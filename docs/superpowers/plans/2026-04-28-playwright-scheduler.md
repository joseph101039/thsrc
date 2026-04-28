# Playwright Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace node-fetch in thsrc.js with Playwright + headful Chromium + Xvfb so the scheduler can bypass Akamai's TLS JA3 fingerprint detection and connect to irs.thsrc.com.tw from Docker.

**Architecture:** thsrc.js exports `createBrowser()` (opens browser+page, patches webdriver) and five scraping functions that each accept a `page` argument. booking_engine.js calls `createBrowser()` once per `runBooking()` and closes it in a `finally` block. A new `Dockerfile.scheduler` builds on the official Playwright image with Xvfb; `docker-compose.override.yml` points the scheduler service at this Dockerfile.

**Tech Stack:** Playwright 1.49.1, mcr.microsoft.com/playwright:v1.49.1-noble, Xvfb, Node.js 20 (bundled in Playwright image), node:sqlite (--experimental-sqlite flag)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `server/src/thsrc.js` | Rewrite | fetch → Playwright page interactions |
| `server/src/booking_engine.js` | Modify | call createBrowser() / browser.close() |
| `server/Dockerfile.scheduler` | Create | Playwright + Xvfb image for scheduler |
| `docker-compose.override.yml` | Modify | scheduler uses Dockerfile.scheduler |
| `server/package.json` | Modify | add playwright@1.49.1 dependency |
| `CLAUDE.md` | Modify | document Playwright scheduler setup |

---

### Task 1: Add playwright dependency and verify install

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Add playwright to package.json**

```json
{
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.3",
    "node-fetch": "^2.7.0",
    "node-schedule": "^2.1.1",
    "nodemailer": "^6.9.13",
    "playwright": "1.49.1",
    "uuid": "^9.0.1"
  }
}
```

- [ ] **Step 2: Install**

```bash
cd server && npm install
```

Expected: `added X packages` — no errors.

- [ ] **Step 3: Verify playwright binary exists**

```bash
ls server/node_modules/playwright/
```

Expected: directory exists with `index.js` inside.

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json
git commit -m "chore: add playwright 1.49.1 dependency"
```

---

### Task 2: Rewrite thsrc.js with Playwright

**Files:**
- Rewrite: `server/src/thsrc.js`

This task replaces the entire file. The exported interface changes:
- **New export:** `createBrowser()` → `{ browser, page }`
- **Changed signatures:** all five functions now accept `page` as first argument
- **Kept unchanged:** `parseTrainOptions()`, `parseBookingResult()`, `selectBestTrain()`, `_timeToMinutes()`

- [ ] **Step 1: Write new thsrc.js**

```js
'use strict';

const { chromium } = require('playwright');
const CONFIG = require('./config');

const THSRC_BASE = 'https://irs.thsrc.com.tw/IMINT';
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || undefined;

async function createBrowser() {
  const browser = await chromium.launch({
    headless: false,
    executablePath: CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-setuid-sandbox',
      '--no-zygote',
    ],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.chrome = { runtime: {} };
  });
  const page = await context.newPage();
  return { browser, page };
}

async function thsrcInit(page) {
  await page.goto(THSRC_BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const token = await page.locator('[name="BookingS1Form\\:hf\\:0"]').getAttribute('value');
  const cookies = await page.context().cookies();
  const jsessionCookie = cookies.find(c => c.name === 'JSESSIONID');
  const sessionId = jsessionCookie ? jsessionCookie.value : '';
  if (!sessionId) throw new Error('無法取得 JSESSIONID');
  if (!token) throw new Error('無法取得 form token');
  return { sessionId, token };
}

async function thsrcQueryTrains(page, { fromStation, toStation, date, earliestTime, latestTime }) {
  await page.selectOption('[id$="selectStartStation"]', CONFIG.STATION_CODES[fromStation]);
  await page.selectOption('[id$="selectDestinationStation"]', CONFIG.STATION_CODES[toStation]);
  await page.fill('[id$="toTimeInputField"]', date);
  // 選擇最早時間對應的 radio（選項值格式為 HH:MM）
  await page.locator(`input[type="radio"][value="${earliestTime}"]`).first().check().catch(() => {
    // 若找不到完全符合的時間，點第一個 radio
    return page.locator('input[type="radio"]').first().check();
  });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('input[type="submit"]').first().click(),
  ]);
  const html = await page.content();
  return parseTrainOptions(html, earliestTime, latestTime);
}

async function thsrcGetCaptcha(page) {
  // 抓驗證碼圖片元素截圖
  const captchaImg = page.locator('img[src*="CheckCode"], #BookingS2Form\\:securityCode').first();
  const buffer = await captchaImg.screenshot();
  return buffer.toString('base64');
}

async function thsrcSubmitBooking(page, { trainNo, captcha }) {
  // 選擇車次 radio
  await page.locator(`input[type="radio"][value="${trainNo}"]`).check();
  // 填入驗證碼
  await page.locator('[id$="securityCode"]').fill(captcha);
  // 送出
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }),
    page.locator('input[value="確認訂位"]').click(),
  ]);
  const html = await page.content();
  return parseBookingResult(html);
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

module.exports = { createBrowser, thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain, parseTrainOptions };
```

- [ ] **Step 2: Verify syntax**

```bash
cd server && node -e "require('./src/thsrc')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/src/thsrc.js
git commit -m "feat: rewrite thsrc.js with Playwright page interactions"
```

---

### Task 3: Update booking_engine.js to use createBrowser()

**Files:**
- Modify: `server/src/booking_engine.js`

The only change: import `createBrowser`, call it at the top of `_doBooking()`, pass `page` to each thsrc function, close `browser` in `finally`.

- [ ] **Step 1: Write updated booking_engine.js**

```js
'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');
const db = require('./db');
const { createBrowser, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('./thsrc');
const { sendSuccessEmail, sendFailureEmail } = require('./mailer');

const BOOKING_TIMEOUT_MS = 60000;

async function runBooking(bookingId) {
  const booking = db.getBookingById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  db.updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

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
  let browser;
  try {
    const browserObj = await createBrowser();
    browser = browserObj.browser;
    const page = browserObj.page;

    // Step 1: 載入首頁，取得 session
    await thsrcInit(page);

    // Step 2: 查詢班次
    const trains = await thsrcQueryTrains(page, {
      fromStation: booking.fromStation,
      toStation: booking.toStation,
      date: booking.date,
      earliestTime: booking.earliestTime,
      latestTime: booking.latestTime,
    });

    if (trains.length === 0) {
      return handleRetry(booking, '無可用班次');
    }

    const bestTrain = selectBestTrain(trains, booking.desiredTime);

    // Step 3: 取得驗證碼
    const captchaBase64 = await thsrcGetCaptcha(page);

    const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captchaBase64 }),
    });
    const { answer: captchaAnswer } = await captchaRes.json();
    console.log('驗證碼辨識結果：', captchaAnswer);

    db.updateBookingFields(bookingId, { trainNo: bestTrain.trainNo });

    // Step 4: 送出訂票
    const result = await thsrcSubmitBooking(page, {
      trainNo: bestTrain.trainNo,
      captcha: captchaAnswer,
    });

    if (result.success) {
      db.updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.SUCCESS,
        ticketNo: result.ticketNo,
      });
      const passenger = db.getPassengerById(booking.passengerId);
      const updatedBooking = db.getBookingById(bookingId);
      await sendSuccessEmail(passenger.email, updatedBooking, passenger);
      console.log('訂票成功：', bookingId, result.ticketNo);
    } else {
      return handleRetry(booking, result.error);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

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

module.exports = { runBooking, handleRetry };
```

Note: `thsrcInit` is now called inside `_doBooking` directly on the page (no separate sessionId/token needed as Playwright maintains session state via the browser context).

- [ ] **Step 2: Verify syntax**

```bash
cd server && node -e "require('./src/booking_engine')" && echo "OK"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add server/src/booking_engine.js
git commit -m "feat: update booking_engine to use Playwright browser lifecycle"
```

---

### Task 4: Create Dockerfile.scheduler

**Files:**
- Create: `server/Dockerfile.scheduler`

- [ ] **Step 1: Write Dockerfile.scheduler**

```dockerfile
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /app
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY src/ ./src/
ENV PORT=8081
ENV DB_PATH=/app/data/thsrc.db
ENV CHROMIUM_PATH=/ms-playwright/chromium-1148/chrome-linux/chrome
CMD ["bash", "-c", "Xvfb :99 -screen 0 1280x720x24 -ac & sleep 1 && DISPLAY=:99 node --experimental-sqlite src/scheduler.js"]
```

- [ ] **Step 2: Verify Dockerfile syntax (dry-run build)**

```bash
docker build --platform linux/amd64 -f server/Dockerfile.scheduler server/ --no-cache 2>&1 | tail -5
```

Expected: `Successfully built` or `writing image`

- [ ] **Step 3: Commit**

```bash
git add server/Dockerfile.scheduler
git commit -m "feat: add Dockerfile.scheduler with Playwright + Xvfb"
```

---

### Task 5: Update docker-compose.override.yml

**Files:**
- Modify: `docker-compose.override.yml`

- [ ] **Step 1: Write updated docker-compose.override.yml**

```yaml
# 只供本地測試使用，生產環境不使用
services:
  server:
    build:
      context: ./server
    environment:
      - CAPTCHA_API_URL=http://captcha:8080
    env_file: .env.local

  scheduler:
    build:
      context: ./server
      dockerfile: Dockerfile.scheduler
    environment:
      - CAPTCHA_API_URL=http://captcha:8080
    volumes:
      - db-data:/app/data
    env_file: .env.local

  ui:
    image: node:24-slim
    working_dir: /app
    volumes:
      - ./ui:/app
    ports:
      - "8082:8082"
    environment:
      - API_URL=http://localhost:8081
    command: node serve.js
    restart: unless-stopped

  watchtower:
    profiles: [production]
```

- [ ] **Step 2: Verify compose config**

```bash
docker-compose config 2>&1 | grep -E "scheduler|dockerfile|ERROR" | head -10
```

Expected: shows `dockerfile: Dockerfile.scheduler` under scheduler, no ERROR.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.override.yml
git commit -m "feat: scheduler uses Dockerfile.scheduler with Playwright"
```

---

### Task 6: Build and smoke-test scheduler container

**Files:** none (testing only)

- [ ] **Step 1: Build scheduler image**

```bash
docker-compose build --no-cache scheduler 2>&1 | tail -10
```

Expected: `Successfully built` or `writing image sha256:...`
This will take 3–5 minutes (downloads Playwright image + installs Chromium).

- [ ] **Step 2: Smoke test — verify Xvfb + Chromium starts**

```bash
docker-compose run --rm scheduler bash -c "
  Xvfb :99 -screen 0 1280x720x24 -ac &
  sleep 1
  DISPLAY=:99 node -e \"
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({
    headless: false,
    executablePath: process.env.CHROMIUM_PATH,
    args: ['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-setuid-sandbox','--no-zygote']
  });
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  const p = await ctx.newPage();
  const res = await p.goto('https://irs.thsrc.com.tw/IMINT/', { timeout: 20000, waitUntil: 'domcontentloaded' }).catch(e=>e);
  if (res instanceof Error) { console.error('FAIL:', res.message.slice(0,80)); process.exit(1); }
  console.log('OK status:', res.status(), 'title:', await p.title());
  await b.close();
})();
\"
"
```

Expected output:
```
OK status: 200 title: 台灣高鐵網路訂票
```

- [ ] **Step 3: If smoke test fails**, check:
  - `CHROMIUM_PATH` env var correct: `docker-compose run --rm scheduler bash -c "ls \$CHROMIUM_PATH"`
  - Xvfb running: `docker-compose run --rm scheduler bash -c "Xvfb :99 & sleep 1 && xdpyinfo -display :99 | head -3"`

---

### Task 7: Integration test — full booking flow

**Files:** none (testing only)

- [ ] **Step 1: Start all services**

```bash
docker-compose up -d
sleep 5
curl -s http://localhost:8081/ && echo ""
```

Expected: `{"status":"ok"}`

- [ ] **Step 2: Create a test booking**

```bash
PASSENGER_ID=$(curl -s http://localhost:8081/ -X POST -H 'Content-Type: application/json' \
  -d '{"action":"getPassengers"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['passengers'][0]['id'])")

curl -s http://localhost:8081/ -X POST -H 'Content-Type: application/json' -d "{
  \"action\": \"createBooking\",
  \"data\": {
    \"passengerId\": \"$PASSENGER_ID\",
    \"fromStation\": \"台北\",
    \"toStation\": \"左營\",
    \"date\": \"$(date -v+1d +%Y-%m-%d 2>/dev/null || date -d tomorrow +%Y-%m-%d)\",
    \"desiredTime\": \"10:00\",
    \"earliestTime\": \"09:00\",
    \"latestTime\": \"12:00\",
    \"maxRetries\": 2,
    \"scheduledAt\": null
  }
}" | python3 -m json.tool
```

Expected: `{"success": true, "id": "..."}`

- [ ] **Step 3: Monitor scheduler logs**

```bash
docker-compose logs -f scheduler 2>&1
```

Expected within 2 minutes:
```
Polling: running booking <id>
驗證碼辨識結果：XXXX
訂票成功：<id> <ticketNo>
```
Or if captcha wrong:
```
Scheduled retry 1 / 2 for booking: <id>
```
(retry is normal — captcha solver isn't 100% accurate)

- [ ] **Step 4: Check booking status**

```bash
curl -s http://localhost:8081/ -X POST -H 'Content-Type: application/json' \
  -d '{"action":"getBookings"}' | python3 -m json.tool
```

Expected: `status` is `success` or `pending` (retrying) — NOT `running` (stuck).

---

### Task 8: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update Testing section**

Replace the `重要：高鐵網站封鎖境外 IP` section with:

```markdown
## 重要：高鐵網站的 bot 防護

`irs.thsrc.com.tw` 使用 Akamai WAF，透過 TLS JA3 fingerprint 封鎖 headless HTTP client（curl、node-fetch、headless Chromium 均無效）。

**解法：headful Chromium + Xvfb**
- scheduler 使用 `Dockerfile.scheduler`（Playwright + Xvfb）
- `headless: false` + `DISPLAY=:99`（Xvfb 虛擬 display）
- webdriver property patch 繞過第一層偵測
- 本地 `docker-compose up --build` 即可跑完整 Playwright scheduler

**測試指令：**
```bash
# 邏輯單元測試（不需要網路）
cd server && npm test

# 確認高鐵網站連線（需要台灣 IP）
docker-compose run --rm scheduler bash -c "
  Xvfb :99 -screen 0 1280x720x24 -ac & sleep 1 &&
  DISPLAY=:99 node -e \"
    const {chromium}=require('playwright');
    chromium.launch({headless:false,executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-gpu','--no-zygote']})
      .then(b=>b.newContext().then(c=>c.newPage()).then(p=>p.goto('https://irs.thsrc.com.tw/IMINT/',{timeout:15000})).then(r=>console.log(r.status())).finally(()=>b.close()));
  \"
"
```
```

- [ ] **Step 2: Commit everything**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Playwright scheduler"
git push origin main
```

---

## Verification Checklist

- [ ] `docker-compose build scheduler` succeeds
- [ ] Smoke test returns `OK status: 200 title: 台灣高鐵網路訂票`
- [ ] Booking created → scheduler picks it up → status changes from `running` to `success` or `pending` (retry)
- [ ] `docker-compose logs scheduler` shows `驗證碼辨識結果：` line (proves captcha API call worked)
- [ ] No OOM kill in `docker stats` during scheduler run
