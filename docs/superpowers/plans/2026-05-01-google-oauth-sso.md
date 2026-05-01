# Google OAuth SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 THSRC 系統加入 Google OAuth SSO，前端每頁檢查 JWT，後端每個 API 要求 Bearer token，只有 `allowed_users` 表中的 Google 帳號可登入。

**Architecture:** 前端用 Google GSI library 取得 ID token，POST 到後端 `/auth/google` 換取自簽 JWT（7天效期），存入 localStorage。前端 `auth.js` 每頁載入時檢查 JWT 有效性，`api.js` 的所有請求自動帶 Bearer header，後端 `authMiddleware` 驗證 JWT。資料庫新增 `allowed_users` 表，預設包含 `joseph101039@gmail.com`。

**Tech Stack:** Node.js/Express、`google-auth-library`、`jsonwebtoken`、Google GSI library (`accounts.google.com/gsi/client`)、SQLite（現有 `node:sqlite`）、vanilla JS 前端

---

## 前置作業：Google Cloud Console 設定

> **注意：** 這步驟需要手動完成，不能自動化。

- [ ] **Step 1: 建立 Google OAuth Client ID**

  前往 Google Cloud Console → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID

  - Application type: **Web application**
  - Name: `thsrc`
  - Authorized JavaScript origins:
    - `https://joseph101039.github.io`
    - `http://localhost:8082`
  - （不需要 Authorized redirect URIs）

  建立後記下 **Client ID**（格式：`xxxxxx.apps.googleusercontent.com`）

- [ ] **Step 2: 產生 JWT_SECRET**

  ```bash
  node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
  ```

  記下輸出值，稍後填入環境變數。

---

## File Map

| 檔案 | 動作 | 說明 |
|------|------|------|
| `server/src/db.js` | 修改 | 新增 `allowed_users` 表、migration 插入預設 admin、新增 `isAllowedUser` 函數 |
| `server/src/api.js` | 修改 | 新增 `authMiddleware`、新增 `POST /auth/google` endpoint |
| `server/package.json` | 修改 | 新增 `google-auth-library`、`jsonwebtoken` 依賴 |
| `server/test/auth.test.js` | 新增 | `authMiddleware` 與 `allowed_users` 邏輯的單元測試 |
| `ui/login.html` | 新增 | Google 登入頁，含 GSI 按鈕 |
| `ui/js/auth.js` | 新增 | JWT 檢查、redirect 邏輯 |
| `ui/js/api.js` | 修改 | 所有請求帶 Bearer header，401 時 redirect |
| `ui/index.html` | 修改 | 載入 `auth.js` |
| `ui/booking.html` | 修改 | 載入 `auth.js` |
| `ui/passengers.html` | 修改 | 載入 `auth.js` |
| `ui/booking-detail.html` | 修改 | 載入 `auth.js` |
| `ui/captcha.html` | 修改 | 載入 `auth.js` |

---

## Task 1: 安裝後端依賴套件

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: 安裝套件**

  ```bash
  cd server && npm install google-auth-library jsonwebtoken
  ```

- [ ] **Step 2: 確認 package.json 已更新**

  ```bash
  cat server/package.json | grep -E 'google-auth|jsonwebtoken'
  ```

  期望輸出包含：
  ```
  "google-auth-library": "^9.x.x",
  "jsonwebtoken": "^9.x.x"
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add server/package.json server/package-lock.json
  git commit -m "chore: 新增 google-auth-library 與 jsonwebtoken 依賴"
  ```

---

## Task 2: 資料庫新增 allowed_users 表

**Files:**
- Modify: `server/src/db.js`
- Test: `server/test/auth.test.js`

- [ ] **Step 1: 寫失敗測試**

  建立 `server/test/auth.test.js`：

  ```js
  'use strict';

  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const path = require('path');
  const os = require('os');

  // 用暫存 DB 避免污染正式資料
  process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-test-${Date.now()}.db`);

  const db = require('../src/db');

  test('isAllowedUser：預設 admin 帳號應被允許', () => {
    assert.strictEqual(db.isAllowedUser('joseph101039@gmail.com'), true);
  });

  test('isAllowedUser：不存在的帳號應被拒絕', () => {
    assert.strictEqual(db.isAllowedUser('stranger@example.com'), false);
  });

  test('isAllowedUser：大小寫不敏感', () => {
    assert.strictEqual(db.isAllowedUser('Joseph101039@Gmail.COM'), true);
  });
  ```

- [ ] **Step 2: 執行測試確認失敗**

  ```bash
  cd server && npm test -- test/auth.test.js
  ```

  期望：FAIL，`isAllowedUser is not a function`

- [ ] **Step 3: 修改 db.js，新增 allowed_users 表與 isAllowedUser**

  在 `_initSchema` 的 `db.exec(...)` 中，在最後加入（現有 `booking_attempts` 表之後）：

  ```js
  // 在現有 CREATE TABLE IF NOT EXISTS booking_attempts (...); 後加入：

    CREATE TABLE IF NOT EXISTS allowed_users (
      email       TEXT PRIMARY KEY COLLATE NOCASE,
      role        TEXT NOT NULL DEFAULT 'user',
      created_at  TEXT NOT NULL
    );
  ```

  在 `_migrate` 函數末尾加入：

  ```js
  // 插入預設 admin（若已存在則忽略）
  db.prepare(`
    INSERT OR IGNORE INTO allowed_users (email, role, created_at)
    VALUES (?, 'admin', ?)
  `).run('joseph101039@gmail.com', new Date().toISOString());
  ```

  在 `module.exports` 之前加入新函數：

  ```js
  // ── Auth ─────────────────────────────────────────────────

  function isAllowedUser(email) {
    const row = getDb().prepare(
      'SELECT 1 FROM allowed_users WHERE email = ?'
    ).get(email.toLowerCase());
    return !!row;
  }
  ```

  在 `module.exports` 中加入 `isAllowedUser`：

  ```js
  module.exports = {
    getPassengers, savePassenger, deletePassenger,
    getBookings, createBooking, updateBookingFields, deleteBooking,
    getBookingById, getPassengerById,
    getPendingBookings, getStuckRunningBookings,
    createBookingAttempt, getAttemptsByBookingId,
    isAllowedUser,
  };
  ```

  > **注意：** `COLLATE NOCASE` 讓 DB 層大小寫不敏感，但 `isAllowedUser` 也做 `.toLowerCase()` 雙重保障。

- [ ] **Step 4: 執行測試確認通過**

  ```bash
  cd server && npm test -- test/auth.test.js
  ```

  期望：3 tests PASS

- [ ] **Step 5: Commit**

  ```bash
  git add server/src/db.js server/test/auth.test.js
  git commit -m "feat: 新增 allowed_users 表，預設 admin joseph101039@gmail.com"
  ```

---

## Task 3: 後端 authMiddleware 與 /auth/google endpoint

**Files:**
- Modify: `server/src/api.js`
- Test: `server/test/auth.test.js`（擴充）

- [ ] **Step 1: 擴充測試**

  在 `server/test/auth.test.js` 末尾加入：

  ```js
  const jwt = require('jsonwebtoken');

  const TEST_SECRET = 'test-secret-key-for-unit-tests';
  process.env.JWT_SECRET = TEST_SECRET;
  process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

  // 動態 require api 以確保環境變數已設定
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

  test('authMiddleware：無 token 時 POST / 應回傳 401', async () => {
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    try {
      const res = await postJson(server, '/', { action: 'getPassengers' });
      assert.strictEqual(res.status, 401);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  test('authMiddleware：有效 token 時 POST / 應成功', async () => {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: '7d' });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    try {
      const res = await postJson(server, '/', { action: 'getPassengers' }, { Authorization: `Bearer ${token}` });
      assert.strictEqual(res.status, 200);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  test('authMiddleware：過期 token 應回傳 401', async () => {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: -1 });
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    try {
      const res = await postJson(server, '/', { action: 'getPassengers' }, { Authorization: `Bearer ${token}` });
      assert.strictEqual(res.status, 401);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
  ```

- [ ] **Step 2: 執行測試確認失敗**

  ```bash
  cd server && npm test -- test/auth.test.js
  ```

  期望：前 3 個 PASS，新的 3 個 FAIL（`authMiddleware` 不存在、API 回 200 而非 401）

- [ ] **Step 3: 修改 api.js，加入 authMiddleware 與 /auth/google**

  在 `server/src/api.js` 最上方的 require 區加入：

  ```js
  const jwt = require('jsonwebtoken');
  const { OAuth2Client } = require('google-auth-library');
  ```

  在 `app.use(express.json());` 之後，`app.get('/')` 之前，加入：

  ```js
  const JWT_SECRET = process.env.JWT_SECRET;
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

  // POST /auth/google — 不需驗證，公開 endpoint
  app.post('/auth/google', async (req, res) => {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: '缺少 credential' });
    }
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      const { email } = ticket.getPayload();
      if (!db.isAllowedUser(email)) {
        console.error('登入被拒：', email);
        return res.status(403).json({ error: '帳號無權限' });
      }
      const row = db.getAllowedUser(email);
      const token = jwt.sign(
        { email, role: row.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ token });
    } catch (err) {
      console.error('Google token 驗證失敗：', err.message);
      res.status(401).json({ error: '無效的 Google token' });
    }
  });

  // JWT 驗證 middleware（套用於 POST /）
  function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: '未授權' });
    }
    try {
      req.user = jwt.verify(token, JWT_SECRET);
      next();
    } catch {
      return res.status(401).json({ error: '未授權' });
    }
  }
  ```

  將 `app.get('/', ...)` 保持不變（健康檢查不需驗證）。

  將 `app.post('/', ...)` 改為：

  ```js
  app.post('/', authMiddleware, (req, res) => {
  ```

  同時在 `db.js` 新增 `getAllowedUser`（`/auth/google` 需要取得 role）：

  在 `db.js` 的 `isAllowedUser` 函數後加入：

  ```js
  function getAllowedUser(email) {
    return _toCamel(getDb().prepare(
      'SELECT * FROM allowed_users WHERE email = ?'
    ).get(email.toLowerCase()));
  }
  ```

  並加入 `module.exports`：

  ```js
  module.exports = {
    // ... 現有匯出
    isAllowedUser, getAllowedUser,
  };
  ```

- [ ] **Step 4: 執行測試確認全部通過**

  ```bash
  cd server && npm test -- test/auth.test.js
  ```

  期望：6 tests PASS

- [ ] **Step 5: 執行全部測試確認無回歸**

  ```bash
  cd server && npm test
  ```

  期望：所有測試 PASS（網路測試會 skip，這是正常的）

- [ ] **Step 6: Commit**

  ```bash
  git add server/src/api.js server/src/db.js server/test/auth.test.js
  git commit -m "feat: 新增 authMiddleware 與 POST /auth/google endpoint"
  ```

---

## Task 4: 前端 auth.js 與 login.html

**Files:**
- Create: `ui/js/auth.js`
- Create: `ui/login.html`

- [ ] **Step 1: 建立 ui/js/auth.js**

  ```js
  (function () {
    const JWT_KEY = 'thsrc_jwt';

    function getToken() {
      return localStorage.getItem(JWT_KEY);
    }

    function isTokenValid(token) {
      if (!token) return false;
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 > Date.now();
      } catch {
        return false;
      }
    }

    function logout() {
      localStorage.removeItem(JWT_KEY);
      sessionStorage.setItem('returnUrl', location.href);
      location.href = 'login.html';
    }

    const token = getToken();
    if (!isTokenValid(token)) {
      sessionStorage.setItem('returnUrl', location.href);
      location.href = 'login.html';
    }

    window.__auth = { getToken, logout };
  })();
  ```

- [ ] **Step 2: 建立 ui/login.html**

  將 `YOUR_GOOGLE_CLIENT_ID` 替換為實際 Client ID（格式：`xxxxxx.apps.googleusercontent.com`）：

  ```html
  <!DOCTYPE html>
  <html lang="zh-TW">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>登入 — 高鐵訂票</title>
    <link rel="stylesheet" href="css/style.css">
    <style>
      .login-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 70vh;
        gap: 24px;
      }
      .login-title { font-size: 1.4rem; color: #333; }
      .login-error { color: #c62828; font-size: 0.9rem; display: none; }
    </style>
  </head>
  <body>
    <header class="page-header">
      <h1>高鐵訂票</h1>
    </header>
    <main class="page-content">
      <div class="login-container">
        <p class="login-title">請使用 Google 帳號登入</p>
        <div id="g_id_onload"
             data-client_id="YOUR_GOOGLE_CLIENT_ID"
             data-callback="handleCredentialResponse"
             data-auto_prompt="false">
        </div>
        <div class="g_id_signin"
             data-type="standard"
             data-size="large"
             data-theme="outline"
             data-text="sign_in_with"
             data-shape="rectangular"
             data-logo_alignment="left">
        </div>
        <p class="login-error" id="login-error"></p>
      </div>
    </main>
    <script src="https://accounts.google.com/gsi/client" async defer></script>
    <script src="js/api.js"></script>
    <script>
      async function handleCredentialResponse(response) {
        const errEl = document.getElementById('login-error');
        errEl.style.display = 'none';
        try {
          const data = await fetch(window.__API_URL || 'https://api.joseph101039.uk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'googleAuth', credential: response.credential }),
          }).then(r => r.json());

          if (data.error) throw new Error(data.error);
          localStorage.setItem('thsrc_jwt', data.token);
          const returnUrl = sessionStorage.getItem('returnUrl') || 'index.html';
          sessionStorage.removeItem('returnUrl');
          location.href = returnUrl;
        } catch (err) {
          errEl.textContent = err.message === '帳號無權限'
            ? '此 Google 帳號無使用權限'
            : '登入失敗，請稍後再試';
          errEl.style.display = 'block';
        }
      }
    </script>
  </body>
  </html>
  ```

  > **注意：** `login.html` 直接呼叫後端，不透過 `gasCall()`，因為此時還沒有 JWT。URL 使用 `window.__API_URL`（由 `api.js` 設定）或 fallback 到硬碼值。

- [ ] **Step 3: 確認 login.html 中已有正確的 Client ID**

  ```bash
  grep 'data-client_id' ui/login.html
  ```

  應顯示實際 Client ID，不是 `YOUR_GOOGLE_CLIENT_ID`。

- [ ] **Step 4: Commit**

  ```bash
  git add ui/js/auth.js ui/login.html
  git commit -m "feat: 新增前端 auth.js 與 login.html"
  ```

---

## Task 5: 修改 api.js — Bearer token 與 401 處理

**Files:**
- Modify: `ui/js/api.js`

- [ ] **Step 1: 修改 ui/js/api.js**

  將現有 `gasCall` 函數改為：

  ```js
  const GAS_URL = 'https://api.joseph101039.uk';
  window.__API_URL = GAS_URL;

  async function gasCall(action, payload = {}) {
    const token = localStorage.getItem('thsrc_jwt');
    const res = await fetch(GAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ action, ...payload }),
    });
    if (res.status === 401) {
      localStorage.removeItem('thsrc_jwt');
      sessionStorage.setItem('returnUrl', location.href);
      location.href = 'login.html';
      throw new Error('未授權，請重新登入');
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
  ```

  同時修改後端 `api.js`，讓 `POST /` 的 switch 支援 `googleAuth` action（作為 `/auth/google` 的別名，方便前端統一用 `fetch GAS_URL`）：

  > **注意：** `login.html` 直接用 fetch 呼叫後端，action 為 `googleAuth`。因此後端需要在 `authMiddleware` 之前處理這個 action，或是在 `/auth/google` endpoint 另外接收。

  更好的做法是在後端 `api.js` 讓 `POST /` 在進 `authMiddleware` 之前先判斷 `action === 'googleAuth'`：

  在後端 `api.js`，將：

  ```js
  app.post('/', authMiddleware, (req, res) => {
  ```

  改為：

  ```js
  app.post('/', async (req, res, next) => {
    if ((req.body || {}).action === 'googleAuth') {
      // 轉交給 /auth/google 邏輯
      req.body = { credential: req.body.credential };
      return googleAuthHandler(req, res);
    }
    return authMiddleware(req, res, next);
  }, (req, res) => {
  ```

  並將 `/auth/google` 的 handler 抽成具名函數 `googleAuthHandler`：

  ```js
  async function googleAuthHandler(req, res) {
    const { credential } = req.body || {};
    if (!credential) {
      return res.status(400).json({ error: '缺少 credential' });
    }
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      const { email } = ticket.getPayload();
      if (!db.isAllowedUser(email)) {
        console.error('登入被拒：', email);
        return res.status(403).json({ error: '帳號無權限' });
      }
      const row = db.getAllowedUser(email);
      const token = jwt.sign(
        { email, role: row.role },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      res.json({ token });
    } catch (err) {
      console.error('Google token 驗證失敗：', err.message);
      res.status(401).json({ error: '無效的 Google token' });
    }
  }

  app.post('/auth/google', googleAuthHandler);
  ```

- [ ] **Step 2: 執行全部後端測試確認無回歸**

  ```bash
  cd server && npm test
  ```

  期望：所有測試 PASS

- [ ] **Step 3: Commit**

  ```bash
  git add ui/js/api.js server/src/api.js
  git commit -m "feat: api.js 帶 Bearer header，401 時跳轉登入頁"
  ```

---

## Task 6: 所有 HTML 頁面載入 auth.js

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/booking.html`
- Modify: `ui/passengers.html`
- Modify: `ui/booking-detail.html`
- Modify: `ui/captcha.html`

- [ ] **Step 1: 在每個 HTML 的 script 區最前面加入 auth.js**

  在以下每個檔案中，找到 `<script src="js/api.js">` 這行，在它之前插入：

  ```html
  <script src="js/auth.js"></script>
  ```

  需修改的檔案：
  - `ui/index.html`
  - `ui/booking.html`
  - `ui/passengers.html`
  - `ui/booking-detail.html`
  - `ui/captcha.html`

  修改後每個檔案的 script 區應如下：

  ```html
  <script src="js/auth.js"></script>
  <script src="js/api.js"></script>
  <script src="js/[page-specific].js"></script>
  ```

- [ ] **Step 2: 確認所有頁面都有 auth.js**

  ```bash
  grep -l 'auth.js' ui/*.html
  ```

  期望輸出（5 個檔案，不含 login.html）：
  ```
  ui/booking-detail.html
  ui/booking.html
  ui/captcha.html
  ui/index.html
  ui/passengers.html
  ```

  確認 login.html 沒有 auth.js（避免循環跳轉）：

  ```bash
  grep 'auth.js' ui/login.html
  ```

  期望：無輸出

- [ ] **Step 3: Commit**

  ```bash
  git add ui/index.html ui/booking.html ui/passengers.html ui/booking-detail.html ui/captcha.html
  git commit -m "feat: 所有前端頁面加入 auth.js 登入保護"
  ```

---

## Task 7: 設定環境變數與本地測試

**Files:**
- Modify: `docker-compose.yml`（加入新環境變數）

- [ ] **Step 1: 查看現有 docker-compose.yml**

  ```bash
  cat docker-compose.yml
  ```

- [ ] **Step 2: 在 server 與 scheduler service 加入環境變數**

  在 `docker-compose.yml` 的 `server` 與 `scheduler` service 的 `environment` 區塊加入：

  ```yaml
  - JWT_SECRET=${JWT_SECRET}
  - GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}
  ```

- [ ] **Step 3: 在 .env.local 加入新變數（本地開發用）**

  ```bash
  # 確認 .env.local 已在 .gitignore
  grep '.env.local' .gitignore
  ```

  在 `.env.local` 加入（替換為實際值）：

  ```bash
  JWT_SECRET=<Step 2 產生的 64 字元 hex 值>
  GOOGLE_CLIENT_ID=<從 Google Cloud Console 取得的 Client ID>
  ```

- [ ] **Step 4: 本地啟動測試**

  ```bash
  # 啟動後端
  docker-compose up --build server

  # 另開終端，啟動前端
  cd ui && API_URL=http://localhost:8081 npm run dev
  ```

  用瀏覽器開啟 `http://localhost:8082/index.html`，應自動跳轉到 `login.html`。

  點擊 Google 登入按鈕，以 `joseph101039@gmail.com` 登入，應跳回 `index.html` 並正常顯示訂票列表。

- [ ] **Step 5: Commit docker-compose 變更**

  ```bash
  git add docker-compose.yml
  git commit -m "chore: docker-compose 加入 JWT_SECRET 與 GOOGLE_CLIENT_ID 環境變數"
  ```

---

## Task 8: 部署

- [ ] **Step 1: 部署後端**

  ```bash
  DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh
  ```

  等待 VM cron 拉取新 image（最多 5 分鐘）。

- [ ] **Step 2: 健康檢查**

  ```bash
  curl http://35.212.154.47:8081/
  ```

  期望：`{"status":"ok"}`

  確認沒有 JWT 時 POST / 回傳 401：

  ```bash
  curl -s -o /dev/null -w "%{http_code}" -X POST http://35.212.154.47:8081/ \
    -H 'Content-Type: application/json' \
    -d '{"action":"getPassengers"}'
  ```

  期望：`401`

- [ ] **Step 3: 部署前端**

  ```bash
  git push origin main:gh-pages
  ```

- [ ] **Step 4: 端對端驗證**

  開啟 `https://joseph101039.github.io/thsrc/ui/index.html`，應跳轉到 `login.html`，Google 登入後正常使用。
