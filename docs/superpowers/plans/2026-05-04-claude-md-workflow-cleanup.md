# CLAUDE.md Workflow Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 `~/.claude/CLAUDE.md` 中三處過時或不準確的流程描述，讓 AI 在此 project 執行時有正確的工具與指令參考。

**Architecture:** 純文件修改，無程式碼異動。兩個檔案：global `~/.claude/CLAUDE.md`（跨 project 通用）與 project `CLAUDE.md`（本專案覆寫）。每項修正獨立，互不依賴。

**Tech Stack:** Markdown only

---

## Files to Modify

| File | 修改原因 |
|------|---------|
| `~/.claude/CLAUDE.md` | Stage 4 Testing 的 `npm run dev` 指令在此 project 不存在；Debugging Workflow Step 6 缺少 prod logs pointer |
| `/Users/joseph/projects/nodejs/thsrc/CLAUDE.md` | 無需修改（project 層已正確） |

---

### Task 1: 修正 global CLAUDE.md — Stage 4 Testing frontend 指令

**問題：** `~/.claude/CLAUDE.md` Stage 4 寫 `npm run dev` (verify locally)，但此 project 用 `docker-compose up`，沒有 `npm run dev`。

**Files:**
- Modify: `~/.claude/CLAUDE.md`（Stage 4 Testing 區塊）

- [ ] **Step 1: 讀取當前內容確認行號**

  ```bash
  grep -n "npm run dev\|Frontend" ~/.claude/CLAUDE.md
  ```

  Expected output（行號可能略有不同）:
  ```
  32:    - Frontend: `npm run dev` (verify locally)
  ```

- [ ] **Step 2: 將 Frontend 測試指令改為 project-agnostic**

  將：
  ```
      - Frontend: `npm run dev` (verify locally)
  ```
  改為：
  ```
      - Frontend: run local dev server per project instructions (e.g. `docker-compose up -d --build` for this project); verify in browser
  ```

- [ ] **Step 3: 確認修改結果**

  ```bash
  grep -A2 -B2 "Frontend" ~/.claude/CLAUDE.md
  ```

  Expected: 新內容出現，`npm run dev` 不再出現。

- [ ] **Step 4: Commit**

  ```bash
  cd ~ && git -C ~/.claude add CLAUDE.md && git -C ~/.claude commit -m "fix: replace npm run dev with project-agnostic frontend test instruction"
  ```

  （若 `~/.claude` 不是 git repo，跳過 commit，僅確認檔案已儲存。）

---

### Task 2: 修正 global CLAUDE.md — Debugging Workflow Step 6 加 prod logs pointer

**問題：** Debugging Workflow Step 6「Deploy — Local validation if needed」沒有告知 AI 在 prod issue 時要先看 logs 再部署，這串 session 就因此浪費了一次盲目 redeploy。

**Files:**
- Modify: `~/.claude/CLAUDE.md`（Debugging Workflow Step 6 區塊）

- [ ] **Step 1: 讀取當前內容確認行號**

  ```bash
  grep -n "Local validation\|Deploy" ~/.claude/CLAUDE.md
  ```

  Expected（Debugging section）:
  ```
  64:6. **Deploy** — Local validation if needed
  ```

- [ ] **Step 2: 在 Step 6 補充 prod logs 指引**

  將：
  ```
  6. **Deploy** — Local validation if needed
  ```
  改為：
  ```
  6. **Deploy** — For prod issues: check logs first (`docs/data_flow.md#production-logs`), confirm root cause, then redeploy. For local issues: `docker-compose up -d --build`.
  ```

- [ ] **Step 3: 確認修改結果**

  ```bash
  grep -A1 "Deploy" ~/.claude/CLAUDE.md | grep -A1 "prod issues"
  ```

  Expected: 新內容出現。

- [ ] **Step 4: Commit**

  ```bash
  git -C ~/.claude add CLAUDE.md && git -C ~/.claude commit -m "fix: debugging step 6 — check prod logs before redeploying"
  ```

  （若 `~/.claude` 不是 git repo，跳過 commit。）

---

## Self-Review

**Spec coverage:**
- ✅ Task 1 修正 `npm run dev`
- ✅ Task 2 補 prod logs pointer

**Placeholder scan:** 無 TBD / TODO。

**Type consistency:** 純文件，無 type 問題。
