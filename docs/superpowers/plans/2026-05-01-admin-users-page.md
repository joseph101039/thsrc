# Admin 使用者管理頁面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `admin.html` 頁面，讓 admin 使用者可列表查看、新增、刪除 `allowed_users`；底部 nav 動態顯示「使用者」tab（僅 admin 可見）。

**Architecture:** 後端 `db.js` 新增 3 個 DB 函式，`api.js` 新增 3 個 admin-only action（role 檢查在 switch case 內）；前端 `auth.js` 新增 `getRole()`，`index.html`/`passengers.html` nav 加入隱藏的 admin tab，`admin.html` + `admin.js` 為新頁面。

**Tech Stack:** Node.js/Express、SQLite（node:sqlite）、原生 HTML/CSS/JS、JWT（payload 已含 role）

---

## 檔案異動

- Modify: `server/src/db.js` — 新增 `getAllowedUsers`, `addAllowedUser`, `deleteAllowedUser`
- Modify: `server/src/api.js` — 新增 3 個 admin-only switch case
- Create: `server/test/admin.test.js` — admin API 測試
- Modify: `ui/js/auth.js` — 新增 `getRole()`
- Modify: `ui/index.html` — nav 新增 admin tab（hidden）+ inline script 顯示控制
- Modify: `ui/passengers.html` — 同上
- Create: `ui/admin.html` — 使用者管理頁面
- Create: `ui/js/admin.js` — 頁面邏輯

---

### Task 1: DB 函式（getAllowedUsers / addAllowedUser / deleteAllowedUser）

**Files:**
- Modify: `server/src/db.js`
- Test: `server/test/admin.test.js`

- [ ] **Step 1: 新增測試檔 `server/test/admin.test.js`**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-admin-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const db = require('../src/db');

test('getAllowedUsers：應回傳所有使用者（至少含預設 admin）', () => {
  const users = db.getAllowedUsers();
  assert.ok(Array.isArray(users));
  assert.ok(users.some(u => u.email === 'joseph101039@gmail.com' && u.role === 'admin'));
});

test('addAllowedUser：新增使用者後可取得', () => {
  const result = db.addAllowedUser({ email: 'newuser@example.com', role: 'user' });
  assert.strictEqual(result.success, true);
  const users = db.getAllowedUsers();
  assert.ok(users.some(u => u.email === 'newuser@example.com' && u.role === 'user'));
});

test('addAllowedUser：重複 email 應回傳 success:false', () => {
  db.addAllowedUser({ email: 'dup@example.com', role: 'user' });
  const result = db.addAllowedUser({ email: 'dup@example.com', role: 'admin' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('已存在'));
});

test('deleteAllowedUser：刪除後不應出現在列表', () => {
  db.addAllowedUser({ email: 'todelete@example.com', role: 'user' });
  const result = db.deleteAllowedUser('todelete@example.com');
  assert.strictEqual(result.success, true);
  const users = db.getAllowedUsers();
  assert.ok(!users.some(u => u.email === 'todelete@example.com'));
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd server && node --experimental-sqlite --test test/admin.test.js
```

Expected: FAIL（getAllowedUsers is not a function 或類似）

- [ ] **Step 3: 在 `server/src/db.js` 新增 3 個函式**

在 `// ── Auth ─────────────────────────────────────` 區塊之前新增：

```js
// ── Allowed Users ────────────────────────────────────────

function getAllowedUsers() {
  return getDb().prepare(
    'SELECT * FROM allowed_users ORDER BY created_at ASC'
  ).all().map(_toCamel);
}

function addAllowedUser({ email, role }) {
  const existing = getDb().prepare(
    'SELECT 1 FROM allowed_users WHERE email = ?'
  ).get(email.toLowerCase());
  if (existing) return { success: false, error: '帳號已存在' };
  getDb().prepare(
    'INSERT INTO allowed_users (email, role, created_at) VALUES (?, ?, ?)'
  ).run(email.toLowerCase(), role, new Date().toISOString());
  return { success: true };
}

function deleteAllowedUser(email) {
  getDb().prepare('DELETE FROM allowed_users WHERE email = ?').run(email.toLowerCase());
  return { success: true };
}
```

在 `module.exports` 末尾加入這 3 個函式：

```js
module.exports = {
  getPassengers, savePassenger, deletePassenger,
  getBookings, createBooking, updateBookingFields, deleteBooking,
  getBookingById, getPassengerById,
  getPendingBookings, getStuckRunningBookings,
  createBookingAttempt, getAttemptsByBookingId,
  isAllowedUser, getAllowedUser,
  getAllowedUsers, addAllowedUser, deleteAllowedUser,
};
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd server && node --experimental-sqlite --test test/admin.test.js
```

Expected: 4 tests pass

- [ ] **Step 5: 執行全部測試確認無 regression**

```bash
cd server && npm test
```

Expected: 所有測試通過

- [ ] **Step 6: Commit**

```bash
git add server/src/db.js server/test/admin.test.js
git commit -m "feat: db 新增 getAllowedUsers / addAllowedUser / deleteAllowedUser"
```

---

### Task 2: API actions（getAllowedUsers / addAllowedUser / deleteAllowedUser）

**Files:**
- Modify: `server/src/api.js`
- Test: `server/test/admin.test.js`

- [ ] **Step 1: 新增 HTTP 測試到 `server/test/admin.test.js`**

在檔案最後新增（`postJson` helper 已存在於 `auth.test.js`，這裡重新定義）：

```js
const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/api');

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
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function makeToken(role) {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

test('getAllowedUsers：admin token 應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getAllowedUsers' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('getAllowedUsers：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getAllowedUsers' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：admin 可新增使用者', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { email: 'api-test@example.com', role: 'user' } }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { email: 'x@x.com', role: 'user' } }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('deleteAllowedUser：admin 刪除自己應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'deleteAllowedUser', id: 'joseph101039@gmail.com' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('deleteAllowedUser：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'deleteAllowedUser', id: 'other@example.com' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd server && node --experimental-sqlite --test test/admin.test.js
```

Expected: 新增的 6 個 HTTP 測試 FAIL（Unknown action）

- [ ] **Step 3: 在 `server/src/api.js` switch 新增 3 個 case**

在 `case 'getBookingAttempts':` 這行之後、`default:` 之前新增：

```js
      case 'getAllowedUsers':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        result = { users: db.getAllowedUsers() };
        break;
      case 'addAllowedUser':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        result = db.addAllowedUser(data);
        break;
      case 'deleteAllowedUser':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        if (id === req.user.email) return res.status(400).json({ error: '不能刪除自己' });
        result = db.deleteAllowedUser(id);
        break;
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd server && node --experimental-sqlite --test test/admin.test.js
```

Expected: 全部通過（包含 Task 1 的 4 個 DB 測試）

- [ ] **Step 5: 執行全部測試確認無 regression**

```bash
cd server && npm test
```

Expected: 所有測試通過

- [ ] **Step 6: Commit**

```bash
git add server/src/api.js server/test/admin.test.js
git commit -m "feat: api 新增 getAllowedUsers / addAllowedUser / deleteAllowedUser（admin only）"
```

---

### Task 3: auth.js 新增 getRole()

**Files:**
- Modify: `ui/js/auth.js`

目前 `auth.js` 的 `window.__auth = { getToken, logout }`，需要加入 `getRole()`。

- [ ] **Step 1: 修改 `ui/js/auth.js`**

在 `function logout()` 之後、`const token = getToken()` 之前新增：

```js
  function getRole() {
    const token = getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1])).role || null;
    } catch { return null; }
  }
```

將最後一行改為：

```js
  window.__auth = { getToken, logout, getRole };
```

完整結果：

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

  function getRole() {
    const token = getToken();
    if (!token) return null;
    try {
      return JSON.parse(atob(token.split('.')[1])).role || null;
    } catch { return null; }
  }

  const token = getToken();
  if (!isTokenValid(token)) {
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
  }

  window.__auth = { getToken, logout, getRole };
})();
```

- [ ] **Step 2: 確認結果**

確認 `window.__auth` 包含 `getRole` 函式。

- [ ] **Step 3: Commit**

```bash
git add ui/js/auth.js
git commit -m "feat: auth.js 新增 getRole()"
```

---

### Task 4: index.html / passengers.html nav 新增 admin tab

**Files:**
- Modify: `ui/index.html`
- Modify: `ui/passengers.html`

兩個頁面的 nav 都需要新增一個預設隱藏的 admin tab，並在 script 區塊新增控制邏輯。

- [ ] **Step 1: 修改 `ui/index.html` 的 nav**

將 nav 區塊改為：

```html
  <nav class="bottom-nav">
    <a href="index.html" class="nav-item active">
      <span class="nav-icon">🎫</span>
      <span>訂票紀錄</span>
    </a>
    <a href="passengers.html" class="nav-item">
      <span class="nav-icon">👤</span>
      <span>乘客設定</span>
    </a>
    <a href="admin.html" class="nav-item" id="nav-admin" hidden>
      <span class="nav-icon">👥</span>
      <span>使用者</span>
    </a>
  </nav>
```

在 `</body>` 之前（`<script src="js/index.js">` 之後）新增 inline script：

```html
  <script>
    document.addEventListener('DOMContentLoaded', function () {
      if (window.__auth.getRole() === 'admin') {
        var el = document.getElementById('nav-admin');
        if (el) el.hidden = false;
      }
    });
  </script>
```

- [ ] **Step 2: 修改 `ui/passengers.html` 的 nav**

將 nav 區塊改為：

```html
  <nav class="bottom-nav">
    <a href="index.html" class="nav-item">
      <span class="nav-icon">🎫</span>
      <span>訂票紀錄</span>
    </a>
    <a href="passengers.html" class="nav-item active">
      <span class="nav-icon">👤</span>
      <span>乘客設定</span>
    </a>
    <a href="admin.html" class="nav-item" id="nav-admin" hidden>
      <span class="nav-icon">👥</span>
      <span>使用者</span>
    </a>
  </nav>
```

在 `</body>` 之前（`<script src="js/passengers.js">` 之後）新增 inline script：

```html
  <script>
    document.addEventListener('DOMContentLoaded', function () {
      if (window.__auth.getRole() === 'admin') {
        var el = document.getElementById('nav-admin');
        if (el) el.hidden = false;
      }
    });
  </script>
```

- [ ] **Step 3: Commit**

```bash
git add ui/index.html ui/passengers.html
git commit -m "feat: nav 新增 admin tab（僅 admin 可見）"
```

---

### Task 5: admin.html 頁面結構

**Files:**
- Create: `ui/admin.html`

- [ ] **Step 1: 建立 `ui/admin.html`**

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>使用者管理</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
</head>
<body>
  <header class="page-header">
    <h1>使用者管理</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出" aria-label="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>

  <main class="page-content">
    <div id="users-list">
      <div class="loading">載入中...</div>
    </div>
  </main>

  <button class="fab" onclick="openAddModal()" title="新增使用者" aria-label="新增使用者">+</button>

  <nav class="bottom-nav">
    <a href="index.html" class="nav-item">
      <span class="nav-icon">🎫</span>
      <span>訂票紀錄</span>
    </a>
    <a href="passengers.html" class="nav-item">
      <span class="nav-icon">👤</span>
      <span>乘客設定</span>
    </a>
    <a href="admin.html" class="nav-item active" id="nav-admin">
      <span class="nav-icon">👥</span>
      <span>使用者</span>
    </a>
  </nav>

  <!-- 新增使用者 Modal -->
  <div id="add-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:100;display:none;align-items:center;justify-content:center;padding:16px;">
    <div style="background:white;border-radius:12px;padding:24px;width:100%;max-width:400px;">
      <div style="font-size:18px;font-weight:600;margin-bottom:16px;">新增使用者</div>
      <div class="form-group">
        <label>Email</label>
        <input type="email" id="add-email" placeholder="user@example.com">
      </div>
      <div class="form-group">
        <label>角色</label>
        <select id="add-role">
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-ghost" style="flex:1" onclick="closeAddModal()">取消</button>
        <button class="btn btn-primary" style="flex:1" id="add-confirm-btn" onclick="confirmAddUser()">新增</button>
      </div>
    </div>
  </div>

  <script src="js/auth.js"></script>
  <script src="js/api.js"></script>
  <script src="js/admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add ui/admin.html
git commit -m "feat: 新增 admin.html 使用者管理頁面結構"
```

---

### Task 6: admin.js 頁面邏輯

**Files:**
- Create: `ui/js/admin.js`

- [ ] **Step 1: 建立 `ui/js/admin.js`**

```js
// admin-only 頁面：非 admin 跳回首頁
if (window.__auth.getRole() !== 'admin') {
  location.href = 'index.html';
}

const adminApi = {
  getUsers:   ()             => gasCall('getAllowedUsers'),
  addUser:    (data)         => gasCall('addAllowedUser', { data }),
  deleteUser: (email)        => gasCall('deleteAllowedUser', { id: email }),
};

function roleBadge(role) {
  const style = role === 'admin'
    ? 'background:#cce5ff;color:#004085'
    : 'background:#d4edda;color:#155724';
  return `<span style="${style};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">${role}</span>`;
}

function userRow(u, selfEmail) {
  const isSelf = u.email.toLowerCase() === selfEmail.toLowerCase();
  const deleteBtn = isSelf
    ? `<span style="color:#aaa;font-size:13px;">（你）</span>`
    : `<button class="btn btn-danger" style="font-size:13px;padding:6px 10px;"
         onclick="deleteUser('${u.email}')">刪除</button>`;
  return `
    <div class="card" style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:12px 16px;">
      <div style="font-size:14px;word-break:break-all;">${u.email}</div>
      ${roleBadge(u.role)}
      ${deleteBtn}
    </div>`;
}

async function loadUsers() {
  const el = document.getElementById('users-list');
  try {
    const { users } = await adminApi.getUsers();
    const token = window.__auth.getToken();
    const selfEmail = JSON.parse(atob(token.split('.')[1])).email;
    el.innerHTML = users.length
      ? users.map(u => userRow(u, selfEmail)).join('')
      : '<div class="alert alert-info">尚無使用者資料。</div>';
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

function openAddModal() {
  document.getElementById('add-email').value = '';
  document.getElementById('add-role').value = 'user';
  document.getElementById('add-modal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}

async function confirmAddUser() {
  const email = document.getElementById('add-email').value.trim();
  const role  = document.getElementById('add-role').value;
  if (!email) { alert('請輸入 Email'); return; }

  const btn = document.getElementById('add-confirm-btn');
  btn.disabled = true;
  btn.textContent = '新增中...';
  try {
    const result = await adminApi.addUser({ email, role });
    if (!result.success) { alert(result.error || '新增失敗'); return; }
    closeAddModal();
    loadUsers();
  } catch (err) {
    alert('新增失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '新增';
  }
}

async function deleteUser(email) {
  if (!confirm(`確定刪除 ${email}？`)) return;
  try {
    await adminApi.deleteUser(email);
    loadUsers();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

loadUsers();
```

- [ ] **Step 2: Commit**

```bash
git add ui/js/admin.js
git commit -m "feat: 新增 admin.js 使用者管理邏輯"
```

---

### Task 7: 本地驗證

- [ ] **Step 1: 確認測試全部通過**

```bash
cd server && npm test
```

Expected: 全部通過（含 admin.test.js）

- [ ] **Step 2: 啟動 dev server 手動驗證**

```bash
cd ui && npm run dev
```

開啟 `http://localhost:8082`，以 admin 帳號登入後確認：
1. 底部 nav 出現第三個「👥 使用者」tab
2. 點進 `admin.html` 顯示使用者列表
3. 自己那筆顯示「（你）」無刪除按鈕
4. 點 FAB 開啟 modal，填寫 email + role 後可新增
5. 新增後列表更新
6. 點刪除按鈕出現 `confirm` 對話框，確認後刪除

若用 user 角色登入，確認：
- 底部 nav 不顯示「使用者」tab
- 直接瀏覽 `http://localhost:8082/admin.html` 被跳轉回 `index.html`
