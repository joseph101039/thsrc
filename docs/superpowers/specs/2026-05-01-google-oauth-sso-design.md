# Google OAuth SSO 設計文件

**日期：** 2026-05-01  
**狀態：** 已核准

## 目標

為 THSRC 前端加入 Google OAuth SSO 登入驗證，前端與後端雙重保護，只有 `allowed_users` 表中的 Google 帳號才能使用系統。

---

## 資料庫

### 新增資料表 `allowed_users`

```sql
CREATE TABLE IF NOT EXISTS allowed_users (
  email       TEXT PRIMARY KEY,
  role        TEXT NOT NULL DEFAULT 'user',
  created_at  TEXT NOT NULL
);

-- 預設 admin，確保至少有一筆可登入帳號
INSERT OR IGNORE INTO allowed_users (email, role, created_at)
VALUES ('joseph101039@gmail.com', 'admin', '<ISO timestamp>');
```

- `email`：Google 帳號 email，primary key
- `role`：`'admin'` 或 `'user'`（預留，目前不做權限差異）
- `created_at`：ISO 8601 timestamp

在 `db.js` 的 `_initSchema()` 加建表語句，`_migrate()` 插入預設 admin。

---

## 後端

### 新增 npm 套件

- `google-auth-library` — 驗證 Google ID token
- `jsonwebtoken` — 簽發與驗證自簽 JWT

### 新增環境變數

| 變數名 | 說明 |
|--------|------|
| `JWT_SECRET` | 自簽 JWT 的 secret key（強隨機字串） |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID（來自 Google Cloud Console） |

### 新增 endpoint：`POST /auth/google`

- **不需驗證 JWT**（公開 endpoint）
- 請求 body：`{ credential: <google_id_token> }`
- 流程：
  1. 用 `google-auth-library` 的 `OAuth2Client.verifyIdToken()` 驗證 credential
  2. 取出 payload 中的 `email`
  3. 查 `allowed_users` 表，不存在 → 回傳 `403 { error: '無權限' }`
  4. 存在 → 用 `jsonwebtoken.sign()` 簽發 JWT，payload `{ email, role }`，過期 `7d`
  5. 回傳 `{ token: <jwt> }`

### 新增 `authMiddleware`

- 掛在 `POST /` 路由之前
- 讀取 `Authorization: Bearer <jwt>` header
- 用 `jsonwebtoken.verify()` 驗證（secret 來自 `JWT_SECRET` 環境變數）
- 無 header、token 無效、token 過期 → 回傳 `401 { error: '未授權' }`
- 驗證通過 → `req.user = { email, role }`，呼叫 `next()`

---

## 前端

### 新增 `ui/login.html`

- 簡單頁面，載入 Google GSI library：
  ```html
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  ```
- 顯示 Google 登入按鈕（`data-client_id` 設為 `GOOGLE_CLIENT_ID`）
- callback 收到 `credential` 後：
  1. POST `{ credential }` 到後端 `/auth/google`
  2. 成功 → 存 `localStorage.setItem('jwt', token)`
  3. 跳回登入前的頁面（`sessionStorage` 存 `returnUrl`，預設 `index.html`）
  4. 失敗（403）→ 顯示「帳號無權限」錯誤訊息

### 新增 `ui/js/auth.js`

每個需要保護的頁面在 `api.js` 之前載入此檔。

```js
// 取出 JWT
// 若無 JWT 或已過期（decode exp 欄位）→ 儲存 returnUrl 到 sessionStorage，跳轉 login.html
// JWT 有效 → 繼續
```

JWT 過期判斷：decode JWT payload（base64 decode，不驗簽）取 `exp` 欄位，與 `Date.now() / 1000` 比較。

### 修改 `ui/js/api.js`

`gasCall()` 加入：
- 請求 header 帶 `Authorization: Bearer <jwt>`
- 收到 `401` response → 清除 localStorage JWT，跳轉 `login.html`

### 修改所有 HTML 頁面

在每個受保護的頁面（`index.html`、`booking.html`、`passengers.html`、`booking-detail.html`、`captcha.html`）的 script 區塊最前面加入：

```html
<script src="js/auth.js"></script>
```

`login.html` 本身不載入 `auth.js`（避免循環跳轉）。

---

## Google Cloud Console 設定

1. 建立 OAuth 2.0 Client ID（Web application）
2. Authorized JavaScript origins 加入：
   - `https://joseph101039.github.io`
   - `http://localhost:8082`（本地開發）
3. 不需要 Authorized redirect URIs（GSI library 使用 popup/one-tap，不做 server-side redirect）

---

## 部署注意事項

- `JWT_SECRET` 與 `GOOGLE_CLIENT_ID` 需加入 VM 的 docker-compose 環境變數或 `.env` 檔
- `ui/login.html` 中的 `data-client_id` 需替換為實際 Client ID（或由 `serve.js` 注入）
- GitHub Pages 部署：`git push origin main:gh-pages` 同上

---

## 檔案異動清單

| 檔案 | 異動類型 |
|------|---------|
| `server/src/db.js` | 修改：新增 `allowed_users` 表、migration |
| `server/src/api.js` | 修改：新增 `/auth/google` endpoint、`authMiddleware` |
| `server/package.json` | 修改：新增 `google-auth-library`、`jsonwebtoken` |
| `ui/login.html` | 新增 |
| `ui/js/auth.js` | 新增 |
| `ui/js/api.js` | 修改：帶 JWT header、處理 401 |
| `ui/index.html` | 修改：載入 auth.js |
| `ui/booking.html` | 修改：載入 auth.js |
| `ui/passengers.html` | 修改：載入 auth.js |
| `ui/booking-detail.html` | 修改：載入 auth.js |
| `ui/captcha.html` | 修改：載入 auth.js |
