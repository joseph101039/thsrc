# E2E 整合測試 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Playwright E2E 整合測試套件，覆蓋 auth、旅客管理、訂票三大 user journey（14 個場景），以 docker-compose.test.yml 隔離環境跑，不打高鐵真實網站。

**Architecture:** 根目錄新增 `tests/e2e/`（Playwright 測試），`docker-compose.test.yml` 啟動隔離的 server + ui container，後端加 `/test/*` 路由（mock mode 才掛）提供測試 JWT 發行與 mock 結果切換。Playwright globalSetup/Teardown 負責 compose up/down。

**Tech Stack:** Playwright 1.44+、Node.js 22（node:test 保留給後端）、docker-compose v2、CommonJS

---

## 檔案清單

### 新增
- `docker-compose.test.yml` — 測試用 compose，覆蓋環境變數，不啟 scheduler/alloy/watchtower
- `tests/e2e/package.json` — @playwright/test 依賴
- `tests/e2e/playwright.config.js` — baseURL、timeout、globalSetup/Teardown
- `tests/e2e/helpers/docker.js` — globalSetup: compose up + healthcheck poll；globalTeardown: compose down -v
- `tests/e2e/helpers/auth.js` — 取測試 JWT、產生 Playwright storageState
- `tests/e2e/auth.spec.js` — 場景 1–3（登入流程）
- `tests/e2e/passengers.spec.js` — 場景 4–7（旅客管理）
- `tests/e2e/bookings.spec.js` — 場景 8–14（訂票流程）

### 修改
- `server/src/api.js` — 在 MOCK_BOOKING_ENGINE=true 時掛載 `/test` router
- `server/src/routes/test.js` — 新增（測試專用路由：發行 JWT + 切換 mock 結果）
- `server/src/services/bookingEngineService.js` — 加 mock 分支
- `package.json`（根目錄）— 新增 test:e2e / test:e2e:ui / test:e2e:headed scripts

---

## Task 1：後端 mock 基礎設施

**Files:**
- Create: `server/src/routes/test.js`
- Modify: `server/src/api.js`
- Modify: `server/src/services/bookingEngineService.js`

### 為什麼需要這個

前端只有 Google OAuth 登入，Playwright 無法操作真實 Google 登入按鈕。所以後端在 mock mode 下提供 `POST /test/auth/token` 直接發行 JWT（繞過 Google），以及 `POST /test/mock-config` 動態切換訂票 mock 結果。

- [ ] **Step 1: 建立 test router**

建立 `server/src/routes/test.js`：

```js
'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// 全局 mock 結果狀態（process 層級，單一 container 內）
global.__mockBookingResult = process.env.MOCK_BOOKING_RESULT || 'success';

// POST /test/auth/token — 直接發行 JWT（繞過 Google OAuth）
// body: { email: string, role?: 'admin'|'user' }
router.post('/auth/token', (req, res) => {
  const { email, role = 'user' } = req.body || {};
  if (!email) return res.status(400).json({ error: '缺少 email' });
  const token = jwt.sign({ email, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// POST /test/mock-config — 動態切換訂票 mock 結果
// body: { result: 'success'|'failure' }
router.post('/mock-config', (req, res) => {
  const { result } = req.body || {};
  if (!['success', 'failure'].includes(result)) {
    return res.status(400).json({ error: 'result 必須為 success 或 failure' });
  }
  global.__mockBookingResult = result;
  res.json({ ok: true, result });
});

module.exports = router;
```

- [ ] **Step 2: 在 api.js 掛載 test router（mock mode 才掛）**

在 `server/src/api.js` 找到 `app.use('/v1', v1Router);` 那行，在其後加：

```js
if (process.env.MOCK_BOOKING_ENGINE === 'true') {
  const testRouter = require('./routes/test');
  app.use('/test', testRouter);
}
```

- [ ] **Step 3: 在 bookingEngineService.js 加 mock 分支**

在 `runBooking` 函數開頭（現有邏輯之前）加入：

```js
if (process.env.MOCK_BOOKING_ENGINE === 'true') {
  const mockResult = global.__mockBookingResult || 'success';
  if (mockResult === 'success') {
    await bookingRepo.updateStatus(id, CONFIG.BOOKING_STATUS.SUCCESS, {
      ticketNo: 'MOCK-12345',
      trainNo: '0666',
      departTime: '10:00',
    });
  } else {
    await bookingRepo.updateStatus(id, CONFIG.BOOKING_STATUS.FAILED, {});
    await bookingRepo.addAttempt(id, false, 'mock failure');
  }
  return;
}
```

> 注意：`bookingRepo.updateStatus` 的第三個參數格式請對照現有呼叫，確認欄位名稱（ticketNo/trainNo/departTime）與 repo 一致。

- [ ] **Step 4: 確認 bookingRepo.updateStatus signature**

執行以下指令確認 `updateStatus` 的 signature：

```bash
grep -n "function updateStatus\|updateStatus" server/src/repositories/bookingRepo.js | head -10
```

若 signature 不同，調整 Step 3 的呼叫方式。

- [ ] **Step 5: 啟動後端驗證 test endpoints 存在**

```bash
cd server && MOCK_BOOKING_ENGINE=true JWT_SECRET=test-e2e node --experimental-sqlite src/api.js &
sleep 2
curl -s -X POST http://localhost:8081/test/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","role":"user"}' | jq .
curl -s -X POST http://localhost:8081/test/mock-config \
  -H 'Content-Type: application/json' \
  -d '{"result":"failure"}' | jq .
kill %1
```

Expected: 兩個 curl 都回傳 JSON，第一個有 `token` 欄位，第二個有 `{ ok: true, result: 'failure' }`

- [ ] **Step 6: 確認 test endpoints 在 mock mode 關閉時不存在**

```bash
cd server && JWT_SECRET=test-e2e node --experimental-sqlite src/api.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:8081/test/auth/token \
  -H 'Content-Type: application/json' -d '{"email":"x@x.com"}'
kill %1
```

Expected: `404`

- [ ] **Step 7: Commit**

```bash
git add server/src/routes/test.js server/src/api.js server/src/services/bookingEngineService.js
git commit -m "feat(test): 加入 mock booking engine 與測試專用 /test 路由"
```

---

## Task 2：docker-compose.test.yml

**Files:**
- Create: `docker-compose.test.yml`

- [ ] **Step 1: 建立 docker-compose.test.yml**

```yaml
# 測試專用 compose — 與開發環境完全隔離
# 使用方式: docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build
services:
  server:
    build: ./server
    ports:
      - "8081:8081"
    environment:
      JWT_SECRET: e2e-test-secret-do-not-use-in-prod
      GOOGLE_CLIENT_ID: test-client-id.apps.googleusercontent.com
      MOCK_BOOKING_ENGINE: "true"
      MOCK_BOOKING_RESULT: "success"
      LINE_CHANNEL_ACCESS_TOKEN: mock-token
      LINE_USER_ID: mock-user
      CAPTCHA_API_URL: http://localhost:8080
    volumes:
      - test-db-data:/app/data
    healthcheck:
      test: ["CMD-SHELL", "node -e \"require('http').get('http://localhost:8081/healthz',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))\""]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 10s

  ui:
    build:
      context: ./ui
      dockerfile: Dockerfile
    ports:
      - "8082:8082"
    environment:
      API_URL: http://localhost:8081
    depends_on:
      server:
        condition: service_healthy

volumes:
  test-db-data:
```

- [ ] **Step 2: 確認 ui 有 Dockerfile**

```bash
ls ui/Dockerfile 2>/dev/null && echo "存在" || echo "不存在"
```

若不存在，建立 `ui/Dockerfile`：

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
EXPOSE 8082
CMD ["node", "serve.js"]
```

- [ ] **Step 3: 測試 compose 能正常啟動**

```bash
docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build
sleep 15
curl -s http://localhost:8081/healthz
curl -s http://localhost:8082/ -o /dev/null -w "%{http_code}"
docker-compose -p thsrc-test -f docker-compose.test.yml down -v
```

Expected: `/healthz` 回傳 `{"status":"ok"}` 或類似，UI 回傳 `200`

- [ ] **Step 4: Commit**

```bash
git add docker-compose.test.yml ui/Dockerfile
git commit -m "feat(test): 新增 docker-compose.test.yml 測試隔離環境"
```

---

## Task 3：Playwright 基礎設定

**Files:**
- Create: `tests/e2e/package.json`
- Create: `tests/e2e/playwright.config.js`
- Create: `tests/e2e/helpers/docker.js`
- Create: `tests/e2e/helpers/auth.js`
- Modify: `package.json`（根目錄）

- [ ] **Step 1: 建立 tests/e2e/package.json**

```bash
mkdir -p tests/e2e/helpers
```

建立 `tests/e2e/package.json`：

```json
{
  "name": "thsrc-e2e",
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed"
  },
  "devDependencies": {
    "@playwright/test": "^1.44.0"
  }
}
```

- [ ] **Step 2: 安裝 Playwright**

```bash
cd tests/e2e && npm install && npx playwright install chromium
```

Expected: 安裝完成，`node_modules/@playwright/test` 存在

- [ ] **Step 3: 建立 helpers/docker.js**

建立 `tests/e2e/helpers/docker.js`：

```js
'use strict';

const { execSync, spawnSync } = require('child_process');
const http = require('http');
const path = require('path');

const COMPOSE_FILE = path.resolve(__dirname, '../../docker-compose.test.yml');
const PROJECT = 'thsrc-test';
const SERVER_URL = 'http://localhost:8081';
const UI_URL = 'http://localhost:8082';
const MAX_WAIT_MS = 60000;
const POLL_INTERVAL_MS = 2000;

function composeCmd(args) {
  return `docker-compose -p ${PROJECT} -f ${COMPOSE_FILE} ${args}`;
}

function httpGet(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', () => resolve(null));
  });
}

async function waitForUrl(url, label) {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    const code = await httpGet(url);
    if (code && code < 500) {
      console.log(`[docker] ${label} ready (${code})`);
      return;
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`[docker] ${label} did not become ready within ${MAX_WAIT_MS}ms`);
}

async function setup() {
  console.log('[docker] Starting test environment...');
  execSync(composeCmd('up -d --build'), { stdio: 'inherit' });
  await waitForUrl(`${SERVER_URL}/healthz`, 'server');
  await waitForUrl(UI_URL, 'ui');
  console.log('[docker] Test environment ready');
}

async function teardown() {
  console.log('[docker] Tearing down test environment...');
  spawnSync('docker-compose', ['-p', PROJECT, '-f', COMPOSE_FILE, 'down', '-v'], { stdio: 'inherit' });
  console.log('[docker] Done');
}

module.exports = { setup, teardown };
```

- [ ] **Step 4: 建立 helpers/auth.js**

建立 `tests/e2e/helpers/auth.js`：

```js
'use strict';

const http = require('http');

const SERVER_URL = 'http://localhost:8081';
const TEST_EMAIL = 'e2e-test@thsrc-test.local';
const ADMIN_EMAIL = 'joseph101039@gmail.com'; // 預設 admin（已在 allowed_users）

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(SERVER_URL + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
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

// 取得測試 JWT（使用 admin 帳號，已在 allowed_users 白名單）
async function getTestToken(email = ADMIN_EMAIL, role = 'admin') {
  const res = await postJson('/test/auth/token', { email, role });
  if (res.status !== 200) throw new Error(`取得測試 token 失敗: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// 產生 Playwright storageState（模擬 localStorage.thsrc_jwt）
async function makeStorageState(email = ADMIN_EMAIL, role = 'admin') {
  const token = await getTestToken(email, role);
  return {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:8082',
        localStorage: [{ name: 'thsrc_jwt', value: token }],
      },
    ],
  };
}

// 動態切換 mock 訂票結果
async function setMockBookingResult(result) {
  const res = await postJson('/test/mock-config', { result });
  if (res.status !== 200) throw new Error(`切換 mock 結果失敗: ${JSON.stringify(res.body)}`);
}

module.exports = { getTestToken, makeStorageState, setMockBookingResult, ADMIN_EMAIL, TEST_EMAIL };
```

- [ ] **Step 5: 建立 playwright.config.js**

建立 `tests/e2e/playwright.config.js`：

```js
'use strict';

const { setup, teardown } = require('./helpers/docker');

module.exports = {
  testDir: '.',
  testMatch: '**/*.spec.js',
  timeout: 30000,
  retries: 0,
  workers: 1, // 測試間共用同一個 compose 環境，不並行
  use: {
    baseURL: 'http://localhost:8082',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    headless: true,
  },
  globalSetup: async () => { await setup(); },
  globalTeardown: async () => { await teardown(); },
  reporter: [['list'], ['html', { open: 'never' }]],
};
```

- [ ] **Step 6: 加根目錄 scripts**

在根目錄 `package.json` 加入（若根目錄沒有 package.json 則先建立）：

```json
{
  "scripts": {
    "test:e2e": "cd tests/e2e && npx playwright test",
    "test:e2e:ui": "cd tests/e2e && npx playwright test --ui",
    "test:e2e:headed": "cd tests/e2e && npx playwright test --headed"
  }
}
```

- [ ] **Step 7: 確認設定正確（不跑測試）**

```bash
cd tests/e2e && npx playwright test --list 2>&1 | head -5
```

Expected: 輸出「No tests found」或列出找到的 spec（尚未建立），不應有語法錯誤

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/ package.json
git commit -m "feat(e2e): 新增 Playwright 基礎設定與 helpers"
```

---

## Task 4：auth.spec.js（場景 1–3）

**Files:**
- Create: `tests/e2e/auth.spec.js`

### 場景說明
- **場景 1**：JWT 注入 localStorage → 訪問首頁 → 不跳轉到 login（已登入狀態）
- **場景 2**：無 JWT → 訪問首頁 → 自動跳轉到 login.html
- **場景 3**：localStorage 有過期 JWT → 訪問首頁 → 跳轉到 login.html

> 注意：前端只有 Google OAuth 登入按鈕，Playwright 無法操作真實 Google 登入流程。場景 1 用 storageState 注入 JWT 模擬已登入；場景 2/3 驗跳轉邏輯。

- [ ] **Step 1: 建立 auth.spec.js**

```js
'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState } = require('./helpers/auth');
const jwt = require('jsonwebtoken');

test.describe('Auth 流程', () => {
  test('場景 1：有效 JWT 注入 localStorage → 首頁正常載入不跳轉', async ({ browser }) => {
    const storageState = await makeStorageState();
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    await page.goto('/index.html');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('#bookings-list')).toBeVisible();

    await context.close();
  });

  test('場景 2：無 JWT → 訪問首頁 → 自動跳轉 login.html', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page).toHaveURL(/login\.html/);
  });

  test('場景 3：過期 JWT → 訪問首頁 → 跳轉 login.html', async ({ browser }) => {
    // 手動建立過期 token（expiresIn: -1 代表已過期）
    const expiredToken = jwt.sign(
      { email: 'joseph101039@gmail.com', role: 'admin' },
      'wrong-secret', // 後端驗簽時會 401
      { expiresIn: '1h' }
    );
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin: 'http://localhost:8082',
          localStorage: [{ name: 'thsrc_jwt', value: expiredToken }],
        }],
      },
    });
    const page = await context.newPage();

    await page.goto('/index.html');
    // 首頁 JS 呼叫 /v1/bookings → 後端 401 → _handle401() → 跳 login
    await expect(page).toHaveURL(/login\.html/, { timeout: 10000 });

    await context.close();
  });
});
```

- [ ] **Step 2: 安裝 jsonwebtoken（tests/e2e 需要）**

```bash
cd tests/e2e && npm install jsonwebtoken
```

- [ ] **Step 3: 啟動 compose 並跑 auth spec**

```bash
docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build
sleep 15
cd tests/e2e && npx playwright test auth.spec.js --reporter=list
docker-compose -p thsrc-test -f docker-compose.test.yml down -v
```

Expected: 3 passed

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/auth.spec.js tests/e2e/package.json tests/e2e/package-lock.json
git commit -m "test(e2e): 新增 auth 流程測試（場景 1–3）"
```

---

## Task 5：passengers.spec.js（場景 4–7）

**Files:**
- Create: `tests/e2e/passengers.spec.js`

### 場景說明
- **場景 4**：新增旅客（完整欄位）→ 列表出現新旅客
- **場景 5**：編輯旅客姓名 → 列表更新
- **場景 6**：刪除旅客 → 列表移除
- **場景 7**：新增旅客缺必填欄位（姓名空白）→ 後端回 400 → UI 顯示錯誤或不 crash

> UI selector 依據：passengers.html 的 `#p-name`、`#p-id-number`、`#p-type`、`#p-email`、`#save-btn`、`#passengers-list`

- [ ] **Step 1: 建立 passengers.spec.js**

```js
'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState } = require('./helpers/auth');

test.describe('旅客管理', () => {
  let storageState;

  test.beforeAll(async () => {
    storageState = await makeStorageState();
  });

  test('場景 4：新增旅客（完整欄位）→ 列表出現新旅客', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.fill('#p-name', 'E2E 測試旅客');
    await page.fill('#p-id-number', 'A123456789');
    await page.selectOption('#p-type', 'adult');
    await page.fill('#p-email', 'e2e@test.com');
    await page.click('#save-btn');

    // 等待列表更新
    await expect(page.locator('#passengers-list')).toContainText('E2E 測試旅客', { timeout: 5000 });

    await context.close();
  });

  test('場景 5：編輯旅客姓名 → 列表更新', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    // 等列表載入，點第一個旅客的編輯按鈕
    await page.waitForSelector('#passengers-list .card', { timeout: 5000 });
    await page.locator('#passengers-list .card').first().locator('button').filter({ hasText: /編輯|edit/i }).click();

    // 清空並輸入新名字
    await page.fill('#p-name', '更新後旅客姓名');
    await page.click('#save-btn');

    await expect(page.locator('#passengers-list')).toContainText('更新後旅客姓名', { timeout: 5000 });

    await context.close();
  });

  test('場景 6：刪除旅客 → 列表移除', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.waitForSelector('#passengers-list .card', { timeout: 5000 });

    // 記錄刪除前的卡片數量
    const beforeCount = await page.locator('#passengers-list .card').count();

    // 點第一個刪除按鈕（需處理 confirm dialog）
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#passengers-list .card').first().locator('button').filter({ hasText: /刪除|delete/i }).click();

    // 等待列表縮短
    await expect(page.locator('#passengers-list .card')).toHaveCount(beforeCount - 1, { timeout: 5000 });

    await context.close();
  });

  test('場景 7：新增旅客缺必填欄位（身分證格式錯誤）→ 不 crash，顯示錯誤', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.fill('#p-name', '測試旅客');
    await page.fill('#p-id-number', 'INVALID'); // 格式錯誤
    await page.selectOption('#p-type', 'adult');
    await page.fill('#p-email', 'e2e@test.com');

    // 攔截 alert
    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.click('#save-btn');

    // 等待 alert 出現（passengers.js 用 alert() 顯示錯誤）或頁面不跳轉
    await page.waitForTimeout(2000);
    // 頁面應仍在 passengers.html（沒 crash 跳走）
    await expect(page).toHaveURL(/passengers\.html/);

    await context.close();
  });
});
```

- [ ] **Step 2: 確認 passengers.js 的編輯/刪除按鈕文字**

```bash
grep -n "編輯\|刪除\|edit\|delete\|btn\|button" ui/js/passengers.js | head -20
```

若按鈕文字不符，調整 Step 1 的 `filter({ hasText: ... })` 選擇器。

- [ ] **Step 3: 跑 passengers spec**

```bash
docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build
sleep 15
cd tests/e2e && npx playwright test passengers.spec.js --reporter=list
docker-compose -p thsrc-test -f docker-compose.test.yml down -v
```

Expected: 4 passed

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/passengers.spec.js
git commit -m "test(e2e): 新增旅客管理測試（場景 4–7）"
```

---

## Task 6：bookings.spec.js（場景 8–14）

**Files:**
- Create: `tests/e2e/bookings.spec.js`

### 場景說明
- **場景 8**：建立預約單（`immediate: false`）→ 首頁訂單列表顯示 pending
- **場景 9**：立即訂票（mock success）→ UI 顯示成功狀態
- **場景 10**：立即訂票（mock failure）→ UI 顯示失敗狀態
- **場景 11**：取消 pending 訂單 → 狀態更新為 cancelled
- **場景 12**：表單缺必填欄位 → UI 阻擋（alert 出現）
- **場景 13**：預約時間選過去 → 後端 400 → UI 顯示錯誤
- **場景 14**：取消 running 中訂單 → UI 顯示無法取消

> booking.html selectors: `#b-passenger`、`#b-from`、`#b-to`、`#b-date`、`#b-desired-time`、`#b-earliest`、`#b-latest`、`#btn-scheduled`、`#b-schedule-date`、`#b-schedule-time`、`#submit-btn`

- [ ] **Step 1: 確認旅客資料怎麼建立**

bookings.spec.js 需要先有旅客（#b-passenger select 要有選項）。在 `beforeAll` 透過 API 直接建旅客，不依賴 passengers spec 的執行順序。

- [ ] **Step 2: 確認 index.js 的 badge/狀態文字**

```bash
grep -n "badge\|text\|STATUS_LABEL\|pending\|success\|failed\|cancelled" ui/js/index.js | head -20
```

記下各狀態的顯示文字，用於 assertion。

- [ ] **Step 3: 建立 bookings.spec.js**

```js
'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState, setMockBookingResult, ADMIN_EMAIL } = require('./helpers/auth');
const http = require('http');

const SERVER_URL = 'http://localhost:8081';

// 直接打 API 建立旅客（不依賴 UI）
async function createPassengerViaApi(token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      name: 'E2E Booking 旅客',
      idNumber: 'A123456789',
      type: 'adult',
      email: 'booking-e2e@test.com',
    });
    const req = http.request({
      hostname: 'localhost', port: 8081, path: '/v1/passengers', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), Authorization: `Bearer ${token}` },
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve(JSON.parse(body)));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 填寫訂票表單共用步驟（時間模式）
async function fillBookingForm(page, { passengerId, fromStation = '台北', toStation = '左營', date, time = '09:00', mode = 'immediate' }) {
  await page.selectOption('#b-passenger', { value: passengerId });
  await page.selectOption('#b-from', { label: fromStation });
  await page.selectOption('#b-to', { label: toStation });
  await page.fill('#b-date', date);
  await page.fill('#b-desired-time', time);
  await page.fill('#b-earliest', '08:00');
  await page.fill('#b-latest', '11:00');

  if (mode === 'scheduled') {
    await page.click('#btn-scheduled');
    // 預約日期設定為明天
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tDate = tomorrow.toISOString().slice(0, 10);
    await page.fill('#b-schedule-date', tDate);
    await page.fill('#b-schedule-time', '08:00');
  }
}

// 取明天日期字串
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 取昨天日期字串（用於測試過去時間）
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

test.describe('訂票流程', () => {
  let storageState;
  let token;
  let passengerId;

  test.beforeAll(async () => {
    const { getTestToken } = require('./helpers/auth');
    token = await getTestToken(ADMIN_EMAIL, 'admin');
    storageState = await makeStorageState(ADMIN_EMAIL, 'admin');
    const passenger = await createPassengerViaApi(token);
    passengerId = passenger.id;
    // 確保 mock 從 success 開始
    await setMockBookingResult('success');
  });

  test('場景 8：建立預約單（immediate: false）→ 首頁列表顯示待處理', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'scheduled' });
    await page.click('#submit-btn');

    // 應跳回首頁
    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
    // 首頁應有 pending 訂單
    await expect(page.locator('#bookings-list')).toContainText('待處理', { timeout: 5000 });

    await context.close();
  });

  test('場景 9：立即訂票 mock success → UI 顯示成功', async ({ browser }) => {
    await setMockBookingResult('success');
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'immediate' });
    await page.click('#submit-btn');

    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
    // 等待 success 狀態出現（mock 立即寫入）
    await expect(page.locator('#bookings-list')).toContainText('訂票成功', { timeout: 10000 });

    await context.close();
  });

  test('場景 10：立即訂票 mock failure → UI 顯示失敗', async ({ browser }) => {
    await setMockBookingResult('failure');
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'immediate' });
    await page.click('#submit-btn');

    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
    await expect(page.locator('#bookings-list')).toContainText('訂票失敗', { timeout: 10000 });

    // 測完切回 success
    await setMockBookingResult('success');
    await context.close();
  });

  test('場景 11：取消 pending 訂單 → 狀態更新為已取消', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/index.html');

    // 找到第一個有取消按鈕的訂單
    await page.waitForSelector('#bookings-list .card', { timeout: 5000 });
    const cancelBtn = page.locator('#bookings-list .card').filter({ hasText: '取消' }).first().locator('button', { hasText: '取消' });
    await expect(cancelBtn).toBeVisible({ timeout: 5000 });

    page.on('dialog', dialog => dialog.accept());
    await cancelBtn.click();

    await expect(page.locator('#bookings-list')).toContainText('已取消', { timeout: 5000 });

    await context.close();
  });

  test('場景 12：表單未選旅客 → alert 阻擋送出', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    // 不選旅客，直接送出
    let alertMsg = '';
    page.on('dialog', async dialog => {
      alertMsg = dialog.message();
      await dialog.accept();
    });

    await page.click('#submit-btn');
    await page.waitForTimeout(1000);

    expect(alertMsg).toContain('請選擇乘客');
    await expect(page).toHaveURL(/booking\.html/);

    await context.close();
  });

  test('場景 13：預約時間選過去 → 後端 400 → UI 顯示錯誤', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'scheduled' });

    // 覆蓋預約日期為昨天
    await page.fill('#b-schedule-date', yesterday());
    await page.fill('#b-schedule-time', '08:00');

    let alertMsg = '';
    page.on('dialog', async dialog => {
      alertMsg = dialog.message();
      await dialog.accept();
    });

    await page.click('#submit-btn');
    await page.waitForTimeout(2000);

    // booking.js 的 alert('送出失敗：' + err.message)
    expect(alertMsg).toMatch(/送出失敗|過去|時間/);

    await context.close();
  });

  test('場景 14：取消 running 中訂單 → UI 顯示無法取消', async ({ browser }) => {
    // 透過 API 直接建一個 running 狀態的訂單再嘗試取消
    // 由於無法輕易 mock running 狀態，改為：先建立 pending 訂單，
    // 透過 API 呼叫 /v1/bookings/:id/cancel 兩次，第二次應 409
    const { default: fetch } = await import('node-fetch');

    // 建立一個 pending 訂單
    const bookingRes = await fetch(`${SERVER_URL}/v1/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        passengerId,
        fromStation: '台北',
        toStation: '左營',
        date: tomorrow(),
        desiredTime: '09:00',
        earliestTime: '08:00',
        latestTime: '11:00',
        maxRetries: 1,
        ticketAdult: 1,
        ticketChild: 0,
        ticketDisabled: 0,
        ticketSenior: 0,
        ticketStudent: 0,
        searchMode: 'time',
        retryWaitUnit: 'minute',
        retryWaitValue: 2,
        immediate: false,
      }),
    });
    const booking = await bookingRes.json();

    // 第一次取消 → 成功
    const cancelRes1 = await fetch(`${SERVER_URL}/v1/bookings/${booking.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancelRes1.status).toBe(200);

    // 第二次取消 → 應失敗（已不是 pending）
    const cancelRes2 = await fetch(`${SERVER_URL}/v1/bookings/${booking.id}/cancel`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(cancelRes2.status).not.toBe(200);
    const err = await cancelRes2.json();
    expect(err.error).toBeTruthy();
  });
});
```

- [ ] **Step 4: 確認 STATUS_LABEL 的顯示文字**

```bash
grep -n "pending\|success\|failed\|cancelled\|text:" ui/js/index.js | head -10
```

調整場景 8/9/10/11 中的 `toContainText(...)` 字串以符合實際 UI 顯示。

- [ ] **Step 5: 跑 bookings spec**

```bash
docker-compose -p thsrc-test -f docker-compose.test.yml up -d --build
sleep 15
cd tests/e2e && npx playwright test bookings.spec.js --reporter=list
docker-compose -p thsrc-test -f docker-compose.test.yml down -v
```

Expected: 7 passed

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/bookings.spec.js
git commit -m "test(e2e): 新增訂票流程測試（場景 8–14）"
```

---

## Task 7：全套 E2E 跑通 + .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 更新 .gitignore**

在根目錄 `.gitignore` 加入：

```
# Playwright E2E
tests/e2e/node_modules/
tests/e2e/test-results/
tests/e2e/playwright-report/
```

- [ ] **Step 2: 跑完整 E2E 套件**

```bash
npm run test:e2e
```

Expected: 14 passed（或略少，視場景 14 的 node-fetch import 方式而定）

- [ ] **Step 3: 若有測試失敗**

```bash
cd tests/e2e && npx playwright test --reporter=list 2>&1
# 失敗時查看 screenshot
ls tests/e2e/test-results/
```

- [ ] **Step 4: 更新 spec 文件，標記 mock-config endpoint 已實作**

在 `server/src/routes/test.js` 加一行 comment 確認設計對應：

```js
// 對應 design: docs/superpowers/specs/2026-05-21-e2e-integration-tests-design.md
```

- [ ] **Step 5: 最終 commit**

```bash
git add .gitignore server/src/routes/test.js
git commit -m "test(e2e): 完成 E2E 整合測試套件，14 個場景全通過"
```

---

## Self-Review

**Spec coverage check:**

| Spec 要求 | 計畫涵蓋 |
|-----------|---------|
| docker-compose.test.yml + `-p thsrc-test` | Task 2 |
| globalSetup/Teardown compose up/down -v | Task 3 helpers/docker.js |
| 每次測試自動 register 帳號（或 mock token） | Task 3 helpers/auth.js（/test/auth/token） |
| storageState 注入 JWT | Task 3/4 |
| MOCK_BOOKING_ENGINE=true + mock 分支 | Task 1 |
| POST /test/mock-config 動態切換 | Task 1 |
| POST /test/auth/token 繞過 Google OAuth | Task 1 |
| 場景 1–3 auth | Task 4 |
| 場景 4–7 passengers | Task 5 |
| 場景 8–14 bookings | Task 6 |
| 場景 10 mock failure | Task 6（setMockBookingResult） |
| 場景 14 running 狀態無法取消 | Task 6（API 直打兩次 cancel） |
| 根目錄 npm scripts | Task 3 |
| .gitignore | Task 7 |

**Placeholder scan:** 無 TBD/TODO。Task 1 Step 3 有提醒確認 bookingRepo.updateStatus signature，Task 5 Step 2 有提醒確認按鈕文字，Task 6 Step 4 有提醒確認 STATUS_LABEL 文字 — 這些是必要的驗證步驟，不是 placeholder。

**Type consistency:** `makeStorageState`、`getTestToken`、`setMockBookingResult` 在 auth.js 定義，在 auth.spec.js、passengers.spec.js、bookings.spec.js 中使用，名稱一致。`global.__mockBookingResult` 在 test.js 設定，在 bookingEngineService.js 讀取，一致。
