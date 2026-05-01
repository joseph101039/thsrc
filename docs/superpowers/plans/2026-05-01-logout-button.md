# 登出按鈕 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在所有前端頁面的 header 右側新增 Material Icons `logout` 圖示按鈕，點擊後呼叫 `window.__auth.logout()` 登出。

**Architecture:** 在 `css/style.css` 新增 `.logout-btn` 樣式；在每個 HTML 頁面的 `<head>` 載入 Material Icons CDN，並在 `<header>` 右側插入登出按鈕。`auth.js` 已有 `window.__auth.logout()` 無需修改。

**Tech Stack:** 原生 HTML/CSS、Material Icons（Google Fonts CDN）

---

## 檔案異動

- Modify: `ui/css/style.css` — 新增 `.logout-btn` 樣式與 header flexbox 調整
- Modify: `ui/index.html` — 加入 CDN + 登出按鈕
- Modify: `ui/passengers.html` — 加入 CDN + 登出按鈕
- Modify: `ui/booking.html` — 加入 CDN + 登出按鈕
- Modify: `ui/booking-detail.html` — 加入 CDN + 登出按鈕
- Modify: `ui/captcha.html` — 加入 CDN + 登出按鈕

---

### Task 1: 新增 CSS 樣式

**Files:**
- Modify: `ui/css/style.css`

目前 `.page-header` 已有 `display: flex; align-items: center; gap: 12px;`，需要讓標題佔滿剩餘空間（`flex: 1`），並新增 `.logout-btn` 樣式。

- [ ] **Step 1: 修改 `ui/css/style.css`**

在 `.page-header h1 { ... }` 這行後面，新增以下 CSS（在 `.page-header .back-btn { ... }` 區塊之前）：

```css
.page-header h1 { font-size: 18px; font-weight: 600; flex: 1; }
.page-header .logout-btn {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  opacity: 0.85;
  margin-left: auto;
}
.page-header .logout-btn:hover { opacity: 1; }
```

注意：原本是 `.page-header h1 { font-size: 18px; font-weight: 600; }`，需要加上 `flex: 1;`。

- [ ] **Step 2: 確認 CSS 結果**

確認 `ui/css/style.css` 中：
1. `.page-header h1` 包含 `flex: 1`
2. `.logout-btn` 樣式存在

- [ ] **Step 3: Commit**

```bash
git add ui/css/style.css
git commit -m "style: header h1 flex:1，新增 logout-btn 樣式"
```

---

### Task 2: index.html 新增登出按鈕

**Files:**
- Modify: `ui/index.html`

目前 `index.html` 的 header：
```html
<header class="page-header">
  <h1>訂票紀錄</h1>
</header>
```

- [ ] **Step 1: 修改 `ui/index.html`**

在 `<head>` 的 `<link rel="stylesheet" ...>` 之後加入 Material Icons CDN：

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

將 header 改為：

```html
  <header class="page-header">
    <h1>訂票紀錄</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>
```

- [ ] **Step 2: Commit**

```bash
git add ui/index.html
git commit -m "feat: index.html header 新增登出按鈕"
```

---

### Task 3: passengers.html 新增登出按鈕

**Files:**
- Modify: `ui/passengers.html`

目前 `passengers.html` 的 header：
```html
<header class="page-header">
  <h1>乘客設定</h1>
</header>
```

- [ ] **Step 1: 修改 `ui/passengers.html`**

在 `<head>` 的 `<link rel="stylesheet" ...>` 之後加入 Material Icons CDN：

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

將 header 改為：

```html
  <header class="page-header">
    <h1>乘客設定</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>
```

- [ ] **Step 2: Commit**

```bash
git add ui/passengers.html
git commit -m "feat: passengers.html header 新增登出按鈕"
```

---

### Task 4: booking.html 新增登出按鈕

**Files:**
- Modify: `ui/booking.html`

目前 `booking.html` 的 header（有 back-btn）：
```html
<header class="page-header">
  <button class="back-btn" onclick="history.back()">&#8592;</button>
  <h1>新增訂票</h1>
</header>
```

- [ ] **Step 1: 修改 `ui/booking.html`**

在 `<head>` 的 `<link rel="stylesheet" ...>` 之後加入 Material Icons CDN：

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

將 header 改為：

```html
  <header class="page-header">
    <button class="back-btn" onclick="history.back()">&#8592;</button>
    <h1>新增訂票</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>
```

- [ ] **Step 2: Commit**

```bash
git add ui/booking.html
git commit -m "feat: booking.html header 新增登出按鈕"
```

---

### Task 5: booking-detail.html 新增登出按鈕

**Files:**
- Modify: `ui/booking-detail.html`

目前 `booking-detail.html` 的 header（有 back-btn）：
```html
<header class="page-header">
  <button class="back-btn" onclick="history.back()">&#8592;</button>
  <h1 id="page-title">訂票詳情</h1>
</header>
```

- [ ] **Step 1: 修改 `ui/booking-detail.html`**

在 `<head>` 的 `<link rel="stylesheet" ...>` 之後加入 Material Icons CDN：

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

將 header 改為：

```html
  <header class="page-header">
    <button class="back-btn" onclick="history.back()">&#8592;</button>
    <h1 id="page-title">訂票詳情</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>
```

- [ ] **Step 2: Commit**

```bash
git add ui/booking-detail.html
git commit -m "feat: booking-detail.html header 新增登出按鈕"
```

---

### Task 6: captcha.html 新增登出按鈕

**Files:**
- Modify: `ui/captcha.html`

目前 `captcha.html` 的 header（有 back-btn）：
```html
<header class="page-header">
  <button class="back-btn" onclick="location.href='index.html'">&#8592;</button>
  <h1>輸入驗證碼</h1>
</header>
```

- [ ] **Step 1: 修改 `ui/captcha.html`**

在 `<head>` 的 `<link rel="stylesheet" ...>` 之後加入 Material Icons CDN：

```html
  <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

將 header 改為：

```html
  <header class="page-header">
    <button class="back-btn" onclick="location.href='index.html'">&#8592;</button>
    <h1>輸入驗證碼</h1>
    <button class="logout-btn" onclick="window.__auth.logout()" title="登出">
      <span class="material-icons">logout</span>
    </button>
  </header>
```

- [ ] **Step 2: Commit**

```bash
git add ui/captcha.html
git commit -m "feat: captcha.html header 新增登出按鈕"
```

---

### Task 7: 本地驗證

- [ ] **Step 1: 啟動 dev server**

```bash
cd ui && npm run dev
```

開啟 `http://localhost:8082`，確認：
1. 登入後各頁面 header 右側有門形 icon
2. 點擊 icon 後清除 localStorage JWT，跳轉到 `login.html`
3. 有 back-btn 的頁面（booking、booking-detail、captcha）：左側 back-btn、中間標題、右側登出 icon 排列正確
4. 沒有 back-btn 的頁面（index、passengers）：左側標題（flex:1）、右側登出 icon
