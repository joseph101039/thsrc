# UI Subtree Public Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `ui/` 目錄從 private repo `thsrc` 分離為獨立的 public repo `thsrc-booking`，透過 git subtree 維持統一開發流程，並讓前端以 GitHub Pages 公開提供服務。

**Architecture:** `thsrc`（private）保留 `ui/` 目錄，新增 git remote `ui` 指向 `thsrc-booking`（public）。日常在 `thsrc/` 修改前端後，執行 `git subtree push --prefix=ui ui main` 同步到 `thsrc-booking`，GitHub Pages 自動重新部署。

**Tech Stack:** git subtree, GitHub Pages, GitHub CLI (`gh`)

---

### Task 1: 在 GitHub 建立空的 thsrc-booking public repo

**Files:** 無需修改任何本地檔案

- [ ] **Step 1: 建立空的 public repo（不含任何初始化檔案）**

  ```bash
  gh repo create joseph101039/thsrc-booking --public --description "THSRC automated ticket booking UI"
  ```

  Expected output 包含：`✓ Created repository joseph101039/thsrc-booking`

- [ ] **Step 2: 確認 repo 已建立且為 public、空的**

  ```bash
  gh repo view joseph101039/thsrc-booking --json name,visibility,isEmpty
  ```

  Expected:
  ```json
  {
    "name": "thsrc-booking",
    "visibility": "PUBLIC",
    "isEmpty": true
  }
  ```

---

### Task 2: 在 thsrc 加入 remote 並 push ui/ 歷史

**Files:** 無需修改任何本地檔案（僅操作 git config）

- [ ] **Step 1: 加入 remote `ui`**

  ```bash
  git remote add ui git@github.com:joseph101039/thsrc-booking.git
  ```

  無輸出表示成功。

- [ ] **Step 2: 確認 remote 已加入**

  ```bash
  git remote -v
  ```

  Expected 包含：
  ```
  ui	git@github.com:joseph101039/thsrc-booking.git (fetch)
  ui	git@github.com:joseph101039/thsrc-booking.git (push)
  ```

- [ ] **Step 3: 用 subtree push 將 ui/ 歷史推送到 thsrc-booking**

  此步驟需要 split 45 個 commit，可能需要 10–30 秒。

  ```bash
  git subtree push --prefix=ui ui main
  ```

  Expected 最後一行：`To github.com:joseph101039/thsrc-booking.git`  
  以及：`* [new branch]      <sha> -> main`

- [ ] **Step 4: 確認 thsrc-booking main branch 只含前端檔案**

  ```bash
  gh api repos/joseph101039/thsrc-booking/git/trees/main?recursive=1 --jq '.tree[].path' | head -20
  ```

  Expected：只看到 `index.html`、`booking.html`、`js/`、`css/`、`serve.js`、`package.json` 等前端檔案，**不應出現** `server/`、`captcha/`、`docker-compose.yml`。

---

### Task 3: 開啟 GitHub Pages

**Files:** 無需修改任何本地檔案（GitHub 設定）

- [ ] **Step 1: 用 GitHub API 開啟 Pages，來源設為 main branch 根目錄**

  ```bash
  gh api repos/joseph101039/thsrc-booking/pages \
    --method POST \
    --field source='{"branch":"main","path":"/"}' \
    --field build_type=legacy
  ```

  Expected：回傳 JSON 包含 `"status": "queued"` 或 `"url": "https://joseph101039.github.io/thsrc-booking/"`

- [ ] **Step 2: 等待 Pages 部署完成（約 1–2 分鐘），確認網址可存取**

  ```bash
  sleep 60 && curl -s -o /dev/null -w "%{http_code}" https://joseph101039.github.io/thsrc-booking/
  ```

  Expected：`200`

- [ ] **Step 3: 確認頁面內容包含登入表單（非 404）**

  ```bash
  curl -s https://joseph101039.github.io/thsrc-booking/login.html | grep -c "form"
  ```

  Expected：大於 `0`

---

### Task 4: 更新 CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新 Project Overview 的 UI GitHub Pages 網址**

  找到這一行：
  ```
  - **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc/ui/`
  ```

  改為：
  ```
  - **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc-booking/`
  ```

- [ ] **Step 2: 更新 Stage 9 部署指令（前端部分）**

  找到：
  ```bash
  # 推送主分支 + 前端
  git push origin main
  git push origin main:gh-pages
  ```

  改為：
  ```bash
  # 推送主分支
  git push origin main

  # 推送前端到 thsrc-booking（GitHub Pages 自動重新部署）
  git subtree push --prefix=ui ui main
  ```

- [ ] **Step 3: 更新 Architecture 區段的 ui/ 說明**

  找到：
  ```
  ui/                    — GitHub Pages frontend (vanilla HTML/CSS/JS); deployed via git push origin main:gh-pages
  ```

  改為：
  ```
  ui/                    — GitHub Pages frontend (vanilla HTML/CSS/JS); deployed via git subtree push --prefix=ui ui main to joseph101039/thsrc-booking
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add CLAUDE.md
  git commit -m "docs: update CLAUDE.md for thsrc-booking subtree deployment"
  ```

---

### Task 5: 刪除舊的 gh-pages branch

**Files:** 無需修改任何本地檔案

- [ ] **Step 1: 確認 gh-pages branch 存在**

  ```bash
  git branch -r | grep gh-pages
  ```

  Expected：`remotes/origin/gh-pages`

- [ ] **Step 2: 刪除 remote 上的 gh-pages branch**

  ```bash
  git push origin --delete gh-pages
  ```

  Expected：`- [deleted]         gh-pages`

- [ ] **Step 3: 確認 origin 已無 gh-pages**

  ```bash
  git branch -r | grep gh-pages
  ```

  Expected：無輸出

---

### Task 6: 驗收測試

- [ ] **Step 1: 確認 thsrc repo 仍為 private**

  ```bash
  gh repo view joseph101039/thsrc --json visibility --jq '.visibility'
  ```

  Expected：`PRIVATE`

- [ ] **Step 2: 確認 thsrc-booking 為 public**

  ```bash
  gh repo view joseph101039/thsrc-booking --json visibility --jq '.visibility'
  ```

  Expected：`PUBLIC`

- [ ] **Step 3: 確認 GitHub Pages 網址可正常存取 index.html**

  ```bash
  curl -s -o /dev/null -w "%{http_code}" https://joseph101039.github.io/thsrc-booking/index.html
  ```

  Expected：`200`

- [ ] **Step 4: 確認 subtree push 日常流程可執行（dry-run）**

  ```bash
  git subtree push --prefix=ui ui main --dry-run 2>&1 || git subtree push --prefix=ui ui main
  ```

  > 注意：`git subtree` 不支援 `--dry-run`，此步驟直接執行實際 push 以確認流程無誤。如果沒有新 commit，Expected output 包含 `Everything up-to-date`。

- [ ] **Step 5: 確認 git remote 設定正確**

  ```bash
  git remote -v
  ```

  Expected 包含：
  ```
  origin	git@github.com:joseph101039/thsrc.git (fetch)
  origin	git@github.com:joseph101039/thsrc.git (push)
  ui	git@github.com:joseph101039/thsrc-booking.git (fetch)
  ui	git@github.com:joseph101039/thsrc-booking.git (push)
  ```
