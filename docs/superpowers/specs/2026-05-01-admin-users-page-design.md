# Admin 使用者管理頁面設計文件

**目標：** 新增 `admin.html` 頁面，讓 admin 使用者可列表查看、新增、刪除 `allowed_users`。底部 nav 動態顯示第三個「使用者」tab（僅 admin 可見）。

**架構：** 前端新增 `admin.html` + `admin.js`；後端 `api.js` 新增 3 個 admin-only action；`db.js` 新增對應 DB 函式。Admin 身份驗證在後端透過 `req.user.role === 'admin'` 判斷，前端僅做 UI 層的顯示控制。

**Tech Stack：** 原生 HTML/CSS/JS、SQLite（已有 `allowed_users` 表）、JWT（`role` 欄位已在 payload 中）

---

## 資料模型

`allowed_users` 表（已存在）：
```sql
email      TEXT PRIMARY KEY COLLATE NOCASE
role       TEXT NOT NULL DEFAULT 'user'   -- 'admin' | 'user'
created_at TEXT NOT NULL
```

---

## 後端 API

### 新增 DB 函式（`server/src/db.js`）

```js
function getAllowedUsers()
// SELECT * FROM allowed_users ORDER BY created_at ASC
// 回傳 camelCase 陣列：[{ email, role, createdAt }, ...]

function addAllowedUser({ email, role })
// INSERT OR IGNORE INTO allowed_users (email, role, created_at)
// VALUES (?, ?, ?)
// email 已存在時回傳 { success: false, error: '帳號已存在' }
// 成功回傳 { success: true }

function deleteAllowedUser(email)
// DELETE FROM allowed_users WHERE email = ?
// 回傳 { success: true }
```

匯出：新增 `getAllowedUsers`、`addAllowedUser`、`deleteAllowedUser` 到 `module.exports`。

### 新增 API Actions（`server/src/api.js`）

在 switch 加入 3 個 case，**每個 case 先驗證 `req.user.role === 'admin'`，否則回 403**：

```
case 'getAllowedUsers':
  if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
  result = { users: db.getAllowedUsers() };
  break;

case 'addAllowedUser':
  if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
  result = db.addAllowedUser(data);   // data = { email, role }
  break;

case 'deleteAllowedUser':
  if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
  if (id === req.user.email) return res.status(400).json({ error: '不能刪除自己' });
  result = db.deleteAllowedUser(id);  // id = email
  break;
```

---

## 前端

### `ui/auth.js` 修改

新增 `getRole()` 函式，解析 JWT payload 取得 role，並加入 `window.__auth`：

```js
function getRole() {
  const token = getToken();
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split('.')[1])).role;
  } catch { return null; }
}

window.__auth = { getToken, logout, getRole };
```

### 底部 Nav Tab（所有頁面）

修改 `index.html` 和 `passengers.html` 的底部 nav：加入隱藏的第三個 tab，由 JS 根據 role 動態顯示。

Nav HTML 新增（預設 `hidden`）：
```html
<a href="admin.html" class="nav-item" id="nav-admin" hidden>
  <span class="nav-icon">👥</span>
  <span>使用者</span>
</a>
```

每頁的 JS 在 DOMContentLoaded 後執行：
```js
if (window.__auth.getRole() === 'admin') {
  const el = document.getElementById('nav-admin');
  if (el) el.hidden = false;
}
```

### `ui/admin.html`

- Header：`<h1>使用者管理</h1>` + 登出按鈕（同其他頁面）
- 底部 nav：同 index.html（含 admin tab，預設 hidden，由 JS 控制）
- 列表區：`<div id="users-list">` 動態渲染使用者行
- FAB 按鈕（右下角）：開啟新增 modal
- Modal：email 輸入欄、role 下拉選單（admin/user）、確認/取消按鈕

### `ui/js/admin.js`

頁面載入後：
1. 檢查 `window.__auth.getRole() === 'admin'`，否則跳回 `index.html`（前端防護）
2. 呼叫 `gasCall('getAllowedUsers')` 取得列表，渲染到 `#users-list`
3. 每行顯示：email、role badge、刪除按鈕（自己那筆顯示「（你）」且無刪除按鈕）
4. 刪除按鈕：`confirm('確定刪除 xxx？')` → 確認後呼叫 `gasCall('deleteAllowedUser', null, email)`
5. FAB 開啟 modal；modal 確認後呼叫 `gasCall('addAllowedUser', { email, role })` → 成功後重新整理列表

`gasCall` 使用現有 `ui/js/api.js` 的 `gasCall(action, data, id)` 介面。

---

## 安全考量

- **後端** 每個 admin action 都檢查 `req.user.role === 'admin'`（主要防線）
- **前端** `admin.js` 進入時檢查 role，非 admin 直接跳轉（UX 防護，非安全防線）
- **刪除自己**：後端檢查 `id === req.user.email`，回 400；前端不顯示刪除按鈕（雙重防護）
- **email 輸入**：後端 SQLite prepared statement 防 injection；前端做基本 email 格式驗證（`type="email"`）

---

## 測試

新增測試到 `server/test/auth.test.js`（或新建 `server/test/admin.test.js`）：

1. `getAllowedUsers`：admin token → 200，回傳陣列；user token → 403；無 token → 401
2. `addAllowedUser`：admin 新增 → 成功；重複 email → `{ success: false, error: '帳號已存在' }`；user token → 403
3. `deleteAllowedUser`：admin 刪除他人 → 成功；admin 刪自己 → 400；user token → 403
