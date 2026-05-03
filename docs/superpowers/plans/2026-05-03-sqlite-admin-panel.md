# SQLite Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a password-protected admin panel at `/admin` that provides full CRUD access to all SQLite tables, served directly by Express and completely isolated from the GitHub Pages UI.

**Architecture:** A new `/admin` Express router lives alongside `/v1` in `api.js`. Session-based auth (independent of JWT) guards all `/admin` routes. The frontend is vanilla HTML/JS served as static files; it calls `/admin/api/*` endpoints that query SQLite dynamically via `sqlite_master` and `PRAGMA table_info`.

**Tech Stack:** express-session, connect-sqlite3, bcryptjs, express-rate-limit, vanilla HTML/CSS/JS

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `server/src/admin/router.js` | Session setup, static serve, login/logout routes |
| Create | `server/src/admin/adminApiRouter.js` | `/admin/api/*` CRUD endpoints |
| Create | `server/src/admin/controllers/adminDbController.js` | DB query handlers (tables, schema, CRUD) |
| Create | `server/src/admin/views/login.html` | Login page |
| Create | `server/src/admin/views/dashboard.html` | Main admin dashboard |
| Create | `server/src/admin/views/assets/admin.css` | Admin styles |
| Create | `server/src/admin/views/assets/admin.js` | Frontend logic (tabs, table, modal, pagination) |
| Modify | `server/src/api.js` | Mount `/admin` router |
| Modify | `server/package.json` | Add 4 new dependencies |

---

## Task 1: Install dependencies

**Files:**
- Modify: `server/package.json`

- [ ] **Step 1: Install new packages**

```bash
cd server && npm install express-session connect-sqlite3 bcryptjs express-rate-limit
```

Expected output: 4 packages added, no errors.

- [ ] **Step 2: Verify they appear in package.json**

```bash
grep -E "express-session|connect-sqlite3|bcryptjs|express-rate-limit" server/package.json
```

Expected: 4 lines, each with a version.

---

## Task 2: adminDbController — table list and schema

**Files:**
- Create: `server/src/admin/controllers/adminDbController.js`

- [ ] **Step 1: Write failing test**

Create `server/test/adminDb.test.js`:

```js
'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

// Create in-memory DB with one test table
let db;
before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE test_items (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
});
after(() => db.close());

const { listTables, getSchema, getRows, getRow, insertRow, updateRow, deleteRow } =
  (() => {
    // Temporarily override getDb for unit tests
    const mod = require('../src/admin/controllers/adminDbController');
    mod._setDb(db);
    return mod;
  })();

describe('adminDbController', () => {
  it('listTables returns test_items', () => {
    const tables = listTables();
    assert.ok(tables.some(t => t.name === 'test_items'));
  });

  it('getSchema returns id and name columns', () => {
    const cols = getSchema('test_items');
    assert.deepEqual(cols.map(c => c.name), ['id', 'name']);
  });

  it('insertRow inserts and getRow retrieves', () => {
    insertRow('test_items', { id: '1', name: 'Alpha' });
    const row = getRow('test_items', '1');
    assert.equal(row.name, 'Alpha');
  });

  it('getRows returns paginated results', () => {
    insertRow('test_items', { id: '2', name: 'Beta' });
    const { rows, total } = getRows('test_items', { page: 1, limit: 10, search: '' });
    assert.equal(total, 2);
    assert.equal(rows.length, 2);
  });

  it('getRows search filters by name', () => {
    const { rows } = getRows('test_items', { page: 1, limit: 10, search: 'Alp' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Alpha');
  });

  it('updateRow updates name', () => {
    updateRow('test_items', '1', { name: 'Alpha Updated' });
    const row = getRow('test_items', '1');
    assert.equal(row.name, 'Alpha Updated');
  });

  it('deleteRow removes the row', () => {
    deleteRow('test_items', '1');
    const row = getRow('test_items', '1');
    assert.equal(row, undefined);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```bash
cd server && npm test -- test/adminDb.test.js 2>&1 | tail -5
```

Expected: Error — `Cannot find module '../src/admin/controllers/adminDbController'`

- [ ] **Step 3: Implement adminDbController.js**

Create `server/src/admin/controllers/adminDbController.js`:

```js
'use strict';

const { getDb } = require('../../db');

const TABLE_NAME_RE = /^[a-zA-Z0-9_]+$/;

let _testDb = null;
function _setDb(db) { _testDb = db; }
function db() { return _testDb || getDb(); }

function _assertTableName(table) {
  if (!TABLE_NAME_RE.test(table)) throw new Error(`無效的資料表名稱: ${table}`);
}

function listTables() {
  const rows = db().prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all();
  return rows.map(r => {
    const count = db().prepare(`SELECT COUNT(*) as c FROM "${r.name}"`).get();
    return { name: r.name, rowCount: count.c };
  });
}

function getSchema(table) {
  _assertTableName(table);
  return db().prepare(`PRAGMA table_info("${table}")`).all();
}

function _pkColumn(table) {
  const cols = getSchema(table);
  const pk = cols.find(c => c.pk === 1);
  return pk ? pk.name : 'rowid';
}

function _textColumns(table) {
  return getSchema(table)
    .filter(c => /TEXT|CHAR|CLOB/i.test(c.type) || c.type === '')
    .map(c => c.name);
}

function getRows(table, { page = 1, limit = 50, search = '' } = {}) {
  _assertTableName(table);
  const offset = (page - 1) * limit;
  let where = '';
  let params = [];
  if (search) {
    const textCols = _textColumns(table);
    if (textCols.length > 0) {
      where = 'WHERE ' + textCols.map(c => `"${c}" LIKE ?`).join(' OR ');
      params = textCols.map(() => `%${search}%`);
    }
  }
  const total = db().prepare(`SELECT COUNT(*) as c FROM "${table}" ${where}`).get(...params).c;
  const rows = db().prepare(
    `SELECT * FROM "${table}" ${where} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { rows, total };
}

function getRow(table, id) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  return db().prepare(`SELECT * FROM "${table}" WHERE "${pk}" = ?`).get(id);
}

function insertRow(table, data) {
  _assertTableName(table);
  const keys = Object.keys(data);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  db().prepare(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`).run(...Object.values(data));
}

function updateRow(table, id, data) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  const keys = Object.keys(data);
  const set = keys.map(k => `"${k}" = ?`).join(', ');
  db().prepare(`UPDATE "${table}" SET ${set} WHERE "${pk}" = ?`).run(...Object.values(data), id);
}

function deleteRow(table, id) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  db().prepare(`DELETE FROM "${table}" WHERE "${pk}" = ?`).run(id);
}

module.exports = { listTables, getSchema, getRows, getRow, insertRow, updateRow, deleteRow, _setDb };
```

- [ ] **Step 4: Run test — expect pass**

```bash
cd server && npm test -- test/adminDb.test.js 2>&1 | tail -10
```

Expected: `7 passing`

---

## Task 3: adminApiRouter — HTTP endpoints

**Files:**
- Create: `server/src/admin/adminApiRouter.js`

- [ ] **Step 1: Create adminApiRouter.js**

```js
'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('./controllers/adminDbController');

function requireSession(req, res, next) {
  if (req.session && req.session.adminAuthed) return next();
  res.status(401).json({ error: '未登入' });
}

router.use(requireSession);

router.get('/tables', (req, res) => {
  try {
    res.json({ tables: ctrl.listTables() });
  } catch (e) {
    console.error('列出資料表失敗', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:table/schema', (req, res) => {
  try {
    res.json({ schema: ctrl.getSchema(req.params.table) });
  } catch (e) {
    console.error('讀取 schema 失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.get('/:table', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const search = req.query.search || '';
    const result = ctrl.getRows(req.params.table, { page, limit, search });
    res.json(result);
  } catch (e) {
    console.error('查詢資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.get('/:table/:id', (req, res) => {
  try {
    const row = ctrl.getRow(req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: '找不到資料' });
    res.json({ row });
  } catch (e) {
    console.error('讀取單筆失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.post('/:table', (req, res) => {
  try {
    ctrl.insertRow(req.params.table, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('新增資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.put('/:table/:id', (req, res) => {
  try {
    ctrl.updateRow(req.params.table, req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('更新資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:table/:id', (req, res) => {
  try {
    ctrl.deleteRow(req.params.table, req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('刪除資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
```

---

## Task 4: admin router — session auth + login/logout

**Files:**
- Create: `server/src/admin/router.js`

- [ ] **Step 1: Create router.js**

```js
'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SqliteStore = require('connect-sqlite3')(session);
const CONFIG = require('../config');
const adminApiRouter = require('./adminApiRouter');

const router = express.Router();

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SESSION_SECRET || !ADMIN_PASSWORD) {
  console.warn('警告：SESSION_SECRET 或 ADMIN_PASSWORD 未設定，Admin panel 將無法使用');
}

router.use(session({
  store: new SqliteStore({ db: 'sessions.db', dir: path.resolve(CONFIG.DB_PATH, '..') }),
  secret: SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '嘗試次數過多，請 15 分鐘後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

const VIEWS = path.join(__dirname, 'views');

router.use('/assets', express.static(path.join(VIEWS, 'assets')));

router.get('/login', (req, res) => {
  if (req.session.adminAuthed) return res.redirect('/admin');
  res.sendFile(path.join(VIEWS, 'login.html'));
});

router.post('/login', loginLimiter, express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    req.session.adminAuthed = true;
    return res.redirect('/admin');
  }
  console.error('管理員登入失敗：密碼錯誤');
  return res.redirect('/admin/login?err=1');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use('/api', adminApiRouter);

router.get('*', (req, res) => {
  if (!req.session.adminAuthed) return res.redirect('/admin/login');
  res.sendFile(path.join(VIEWS, 'dashboard.html'));
});

module.exports = router;
```

---

## Task 5: Mount /admin in api.js

**Files:**
- Modify: `server/src/api.js`

- [ ] **Step 1: Add admin router mount**

In `server/src/api.js`, after the line `app.use('/v1', v1Router);`, add:

```js
const adminRouter = require('./admin/router');
app.use('/admin', adminRouter);
```

Also add `ADMIN_PASSWORD` and `SESSION_SECRET` to the startup env check — replace:

```js
if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  console.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}
```

with:

```js
if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  console.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.warn('警告：SESSION_SECRET 或 ADMIN_PASSWORD 未設定，Admin panel 將無法登入');
}
```

- [ ] **Step 2: Run existing tests to check for regressions**

```bash
cd server && npm test 2>&1 | tail -15
```

Expected: All existing tests pass.

---

## Task 6: login.html

**Files:**
- Create: `server/src/admin/views/login.html`

- [ ] **Step 1: Create login.html**

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THSRC Admin — 登入</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 12px rgba(0,0,0,.12);
      padding: 2rem;
      width: 340px;
    }
    h1 { font-size: 1.25rem; margin-bottom: 1.5rem; color: #333; }
    label { display: block; font-size: .875rem; color: #555; margin-bottom: .25rem; }
    input[type=password] {
      width: 100%; padding: .6rem .75rem; border: 1px solid #ccc;
      border-radius: 4px; font-size: 1rem; margin-bottom: 1rem;
    }
    button {
      width: 100%; padding: .65rem; background: #1976d2; color: #fff;
      border: none; border-radius: 4px; font-size: 1rem; cursor: pointer;
    }
    button:hover { background: #1565c0; }
    .error { color: #c62828; font-size: .875rem; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>THSRC Admin</h1>
    <div id="errorMsg" class="error" style="display:none">密碼錯誤，請再試一次</div>
    <form method="POST" action="/admin/login">
      <label for="password">管理員密碼</label>
      <input type="password" id="password" name="password" autofocus required>
      <button type="submit">登入</button>
    </form>
  </div>
  <script>
    // Show error message if redirected back after 401
    if (document.referrer.includes('/admin/login') || location.search.includes('err')) {
      document.getElementById('errorMsg').style.display = 'block';
    }
  </script>
</body>
</html>
```

---

## Task 7: dashboard.html + admin.css

**Files:**
- Create: `server/src/admin/views/dashboard.html`
- Create: `server/src/admin/views/assets/admin.css`

- [ ] **Step 1: Create admin.css**

Create `server/src/admin/views/assets/admin.css`:

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #333; }

header {
  background: #1976d2; color: #fff; padding: .75rem 1.25rem;
  display: flex; align-items: center; justify-content: space-between;
  position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 4px rgba(0,0,0,.2);
}
header h1 { font-size: 1.1rem; }
header button { background: rgba(255,255,255,.15); border: 1px solid rgba(255,255,255,.4); color: #fff; padding: .4rem .9rem; border-radius: 4px; cursor: pointer; }
header button:hover { background: rgba(255,255,255,.25); }

.tabs { background: #fff; border-bottom: 2px solid #e0e0e0; padding: 0 1rem; display: flex; gap: .25rem; overflow-x: auto; }
.tab-btn { padding: .65rem 1rem; border: none; background: none; cursor: pointer; font-size: .9rem; color: #555; border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap; }
.tab-btn.active { color: #1976d2; border-bottom-color: #1976d2; font-weight: 600; }
.tab-btn:hover:not(.active) { background: #f5f5f5; }

.toolbar { display: flex; align-items: center; gap: .75rem; padding: .75rem 1rem; background: #fff; border-bottom: 1px solid #e0e0e0; }
.toolbar input { flex: 1; padding: .5rem .75rem; border: 1px solid #ccc; border-radius: 4px; font-size: .9rem; }
.toolbar .btn-primary { background: #1976d2; color: #fff; border: none; padding: .5rem 1rem; border-radius: 4px; cursor: pointer; font-size: .9rem; }
.toolbar .btn-primary:hover { background: #1565c0; }

.table-wrap { overflow-x: auto; padding: 1rem; }
table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.08); font-size: .875rem; }
th { background: #f5f5f5; padding: .6rem .75rem; text-align: left; font-weight: 600; border-bottom: 2px solid #e0e0e0; white-space: nowrap; }
td { padding: .55rem .75rem; border-bottom: 1px solid #f0f0f0; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #fafafa; }

.action-cell { display: flex; gap: .4rem; }
.btn-edit { background: #e3f2fd; color: #1565c0; border: none; padding: .3rem .6rem; border-radius: 3px; cursor: pointer; font-size: .8rem; }
.btn-edit:hover { background: #bbdefb; }
.btn-delete, .btn-delete-confirm { background: #ffebee; color: #c62828; border: none; padding: .3rem .6rem; border-radius: 3px; cursor: pointer; font-size: .8rem; }
.btn-delete-confirm { background: #c62828; color: #fff; }
.btn-delete:hover { background: #ffcdd2; }

.pagination { display: flex; align-items: center; gap: .5rem; padding: .75rem 1rem; font-size: .875rem; }
.pagination button { padding: .3rem .65rem; border: 1px solid #ccc; background: #fff; border-radius: 3px; cursor: pointer; }
.pagination button:disabled { opacity: .4; cursor: default; }
.pagination button:not(:disabled):hover { background: #f5f5f5; }
.pagination .total { margin-left: auto; color: #777; }

/* Modal */
.modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,.5); z-index: 200; align-items: center; justify-content: center; }
.modal-overlay.open { display: flex; }
.modal { background: #fff; border-radius: 8px; padding: 1.5rem; width: min(480px, 95vw); max-height: 90vh; overflow-y: auto; }
.modal h2 { font-size: 1rem; margin-bottom: 1rem; }
.modal label { display: block; font-size: .8rem; color: #555; margin-bottom: .2rem; margin-top: .75rem; }
.modal input, .modal select, .modal textarea {
  width: 100%; padding: .45rem .65rem; border: 1px solid #ccc; border-radius: 4px; font-size: .9rem;
}
.modal textarea { min-height: 60px; resize: vertical; }
.modal-actions { display: flex; gap: .75rem; justify-content: flex-end; margin-top: 1.25rem; }
.btn-cancel { background: #f5f5f5; border: 1px solid #ccc; padding: .5rem 1rem; border-radius: 4px; cursor: pointer; }
.btn-save { background: #1976d2; color: #fff; border: none; padding: .5rem 1rem; border-radius: 4px; cursor: pointer; }
.btn-save:hover { background: #1565c0; }
.empty { text-align: center; padding: 2rem; color: #999; }
.loading { text-align: center; padding: 2rem; color: #aaa; }
```

- [ ] **Step 2: Create dashboard.html**

Create `server/src/admin/views/dashboard.html`:

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>THSRC Admin</title>
  <link rel="stylesheet" href="/admin/assets/admin.css">
</head>
<body>
  <header>
    <h1>THSRC Admin</h1>
    <form method="POST" action="/admin/logout" style="margin:0">
      <button type="submit">登出</button>
    </form>
  </header>

  <div class="tabs" id="tabs"></div>

  <div class="toolbar">
    <input type="search" id="searchInput" placeholder="搜尋...">
    <button class="btn-primary" id="btnAdd">+ 新增</button>
  </div>

  <div class="table-wrap">
    <div id="tableContainer" class="loading">載入中...</div>
  </div>

  <div class="pagination" id="pagination"></div>

  <!-- Modal -->
  <div class="modal-overlay" id="modalOverlay">
    <div class="modal">
      <h2 id="modalTitle">新增資料</h2>
      <form id="modalForm"></form>
      <div class="modal-actions">
        <button class="btn-cancel" id="btnCancel" type="button">取消</button>
        <button class="btn-save" id="btnSave" type="button">儲存</button>
      </div>
    </div>
  </div>

  <script src="/admin/assets/admin.js"></script>
</body>
</html>
```

---

## Task 8: admin.js — frontend logic

**Files:**
- Create: `server/src/admin/views/assets/admin.js`

- [ ] **Step 1: Create admin.js**

Create `server/src/admin/views/assets/admin.js`:

```js
'use strict';
(() => {
  const BASE = '/admin/api';
  let currentTable = null;
  let currentSchema = [];
  let currentPage = 1;
  let currentSearch = '';
  let debounceTimer = null;

  async function apiFetch(path, options = {}) {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  async function loadTables() {
    const { tables } = await apiFetch('/tables');
    const tabsEl = document.getElementById('tabs');
    tabsEl.innerHTML = '';
    tables.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.textContent = `${t.name} (${t.rowCount})`;
      btn.dataset.table = t.name;
      btn.onclick = () => selectTable(t.name);
      tabsEl.appendChild(btn);
    });
    const hash = location.hash.slice(1);
    const first = (hash && tables.find(t => t.name === hash)) ? hash : (tables[0] && tables[0].name);
    if (first) selectTable(first);
  }

  async function selectTable(table) {
    currentTable = table;
    currentPage = 1;
    currentSearch = '';
    document.getElementById('searchInput').value = '';
    location.hash = table;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.table === table);
    });
    const { schema } = await apiFetch(`/${table}/schema`);
    currentSchema = schema;
    await renderTable();
  }

  async function renderTable() {
    const container = document.getElementById('tableContainer');
    container.innerHTML = '<div class="loading">載入中...</div>';
    try {
      const params = new URLSearchParams({ page: currentPage, limit: 50, search: currentSearch });
      const { rows, total } = await apiFetch(`/${currentTable}?${params}`);
      if (rows.length === 0) {
        container.innerHTML = '<div class="empty">沒有資料</div>';
        renderPagination(0, 0);
        return;
      }
      const cols = currentSchema.map(c => c.name);
      const pk = (currentSchema.find(c => c.pk === 1) || currentSchema[0]).name;
      let html = '<table><thead><tr>';
      cols.forEach(c => { html += `<th>${c}</th>`; });
      html += '<th>操作</th></tr></thead><tbody>';
      rows.forEach(row => {
        html += '<tr>';
        cols.forEach(c => { html += `<td title="${escHtml(String(row[c] ?? ''))}">${escHtml(String(row[c] ?? ''))}</td>`; });
        const id = escHtml(String(row[pk]));
        html += `<td class="action-cell">
          <button class="btn-edit" onclick="editRow('${id}')">編輯</button>
          <button class="btn-delete" id="del-${id}" onclick="confirmDelete('${id}')">刪除</button>
        </td></tr>`;
      });
      html += '</tbody></table>';
      container.innerHTML = html;
      renderPagination(total, 50);
    } catch (e) {
      container.innerHTML = `<div class="empty">載入失敗：${escHtml(e.message)}</div>`;
    }
  }

  function renderPagination(total, limit) {
    const pages = Math.ceil(total / limit) || 1;
    const el = document.getElementById('pagination');
    el.innerHTML = `
      <button onclick="changePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
      <span>第 ${currentPage} / ${pages} 頁</span>
      <button onclick="changePage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}>›</button>
      <span class="total">共 ${total} 筆</span>
    `;
  }

  window.changePage = function(page) {
    currentPage = page;
    renderTable();
  };

  window.editRow = async function(id) {
    const { row } = await apiFetch(`/${currentTable}/${id}`);
    openModal('編輯資料', row, async (data) => {
      await apiFetch(`/${currentTable}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      renderTable();
    });
  };

  window.confirmDelete = function(id) {
    const btn = document.getElementById(`del-${id}`);
    if (!btn) return;
    if (btn.dataset.confirming) {
      apiFetch(`/${currentTable}/${id}`, { method: 'DELETE' })
        .then(() => renderTable())
        .catch(e => alert('刪除失敗：' + e.message));
    } else {
      btn.dataset.confirming = '1';
      btn.textContent = '確定刪除';
      btn.classList.add('btn-delete-confirm');
      setTimeout(() => {
        if (btn) { btn.textContent = '刪除'; btn.classList.remove('btn-delete-confirm'); delete btn.dataset.confirming; }
      }, 3000);
    }
  };

  function openModal(title, defaults, onSave) {
    document.getElementById('modalTitle').textContent = title;
    const form = document.getElementById('modalForm');
    form.innerHTML = '';
    currentSchema.forEach(col => {
      const label = document.createElement('label');
      label.textContent = col.name + (col.notnull ? ' *' : '');
      const input = document.createElement('input');
      input.name = col.name;
      input.value = defaults ? (defaults[col.name] ?? '') : '';
      if (col.notnull && !defaults) input.required = true;
      form.appendChild(label);
      form.appendChild(input);
    });
    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('btnSave').onclick = async () => {
      const data = {};
      currentSchema.forEach(col => { data[col.name] = form.elements[col.name].value; });
      try {
        await onSave(data);
        closeModal();
      } catch (e) {
        alert('儲存失敗：' + e.message);
      }
    };
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
  }

  document.getElementById('btnCancel').onclick = closeModal;
  document.getElementById('modalOverlay').onclick = (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  };

  document.getElementById('btnAdd').onclick = () => {
    openModal('新增資料', null, async (data) => {
      await apiFetch(`/${currentTable}`, { method: 'POST', body: JSON.stringify(data) });
      renderTable();
    });
  };

  document.getElementById('searchInput').oninput = (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentSearch = e.target.value;
      currentPage = 1;
      renderTable();
    }, 300);
  };

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadTables();
})();
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Add env vars to .env.local**

```bash
echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> server/../.env.local
echo "ADMIN_PASSWORD=admin123" >> server/../.env.local
```

- [ ] **Step 2: Start server locally**

```bash
cd server && SESSION_SECRET=testsecret ADMIN_PASSWORD=admin123 JWT_SECRET=test GOOGLE_CLIENT_ID=test node --experimental-sqlite src/api.js
```

Expected output: `THSRC server listening on port 8081`

- [ ] **Step 3: Verify redirect to login**

```bash
curl -sI http://localhost:8081/admin | head -5
```

Expected: `HTTP/1.1 302` with `Location: /admin/login`

- [ ] **Step 4: Login and get session cookie**

```bash
curl -si -c /tmp/admin_cookies.txt \
  -d "password=admin123" \
  -X POST http://localhost:8081/admin/login | head -5
```

Expected: `HTTP/1.1 302` with `Location: /admin`

- [ ] **Step 5: Access dashboard with cookie**

```bash
curl -s -b /tmp/admin_cookies.txt http://localhost:8081/admin | grep -c "THSRC Admin"
```

Expected: `1`

- [ ] **Step 6: List tables via API**

```bash
curl -s -b /tmp/admin_cookies.txt http://localhost:8081/admin/api/tables | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).tables.map(t=>t.name).join(', '))"
```

Expected: `passengers, bookings, booking_attempts, allowed_users` (order may vary)

- [ ] **Step 7: Test rate limiting**

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "%{http_code}\n" -d "password=wrong" -X POST http://localhost:8081/admin/login
done
```

Expected: first 5 return `302` (redirect to login with err), 6th returns `429`

- [ ] **Step 8: Run all existing tests**

```bash
cd server && npm test 2>&1 | tail -10
```

Expected: All existing tests pass, no regressions.

- [ ] **Step 9: Commit all changes**

```bash
cd server && git add package.json package-lock.json \
  src/admin/controllers/adminDbController.js \
  src/admin/adminApiRouter.js \
  src/admin/router.js \
  src/admin/views/login.html \
  src/admin/views/dashboard.html \
  src/admin/views/assets/admin.css \
  src/admin/views/assets/admin.js \
  src/api.js \
  test/adminDb.test.js
git commit -m "feat: add SQLite admin panel with session auth and full CRUD"
```
