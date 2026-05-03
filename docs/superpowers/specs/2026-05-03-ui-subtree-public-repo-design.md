# Design: ui/ 分離為獨立 public repo（git subtree）

**日期：** 2026-05-03  
**狀態：** 已核准

## 目標

將 `ui/` 目錄從 private repo `joseph101039/thsrc` 分離為獨立的 public repo `joseph101039/thsrc-booking`，讓前端可透過 GitHub Pages 公開提供服務，同時避免後端程式碼洩漏。使用 git subtree 維持在 `thsrc/` 統一開發的工作流程。

## 目標狀態

| Repo | 可見性 | 用途 |
|------|--------|------|
| `joseph101039/thsrc` | private | 後端 + 前端統一開發，含完整 git 歷史 |
| `joseph101039/thsrc-booking` | public | 只含前端程式碼，GitHub Pages 服務網址 |

- `thsrc` 新增 git remote `ui` 指向 `thsrc-booking`
- `thsrc-booking` `main` branch 根目錄即為前端根目錄
- GitHub Pages 網址：`https://joseph101039.github.io/thsrc-booking/`

## API URL 注入機制

`ui/js/api.js` 第一行維持 hard-code production URL：

```js
const API_URL = 'https://api.joseph101039.uk';
```

本機 dev 透過 `serve.js` 在 runtime 替換此行（已有實作），不需要額外改動。GitHub Pages 直接提供靜態檔案，第一行即為 production 值，無需 CI/CD 注入。

## 一次性遷移步驟

1. 在 GitHub 建立空的 `joseph101039/thsrc-booking` public repo（不初始化任何檔案）
2. 在 `thsrc` 加入 remote：
   ```bash
   git remote add ui git@github.com:joseph101039/thsrc-booking.git
   ```
3. 用 subtree split 萃取 `ui/` 歷史並 push：
   ```bash
   git subtree push --prefix=ui ui main
   ```
4. 在 `thsrc-booking` GitHub 設定頁開啟 GitHub Pages：
   - Source: `Deploy from a branch`
   - Branch: `main`, 目錄: `/ (root)`
5. 確認 `https://joseph101039.github.io/thsrc-booking/` 可正常存取

## 日常開發流程

```bash
# 正常在 thsrc/ 修改 ui/ 下的檔案並 commit
git add ui/booking.html ui/js/booking.js
git commit -m "feat: 更新訂票頁面"

# 同步前端變更到 thsrc-booking（只推 ui/ 內容）
git subtree push --prefix=ui ui main
```

push 後 GitHub Pages 自動重新部署（通常 1–2 分鐘）。

## 不需要異動的部分

- `ui/js/api.js`：第一行不需要改，production URL 維持 hard-code
- `ui/serve.js`、`ui/package.json`：一起移入 `thsrc-booking`，行為不變
- `docker-compose.yml`：`ui/serve.js` 路徑不變，無需修改
- CLAUDE.md 中的部署指令：`git push origin main:gh-pages` 將改為 `git subtree push --prefix=ui ui main`

## 注意事項

- **初次 subtree push 較慢**：需要 split 整個 `ui/` 歷史，視 commit 數量可能需要數十秒
- **強制 push**：若日後需要修改 `thsrc-booking` 的 commit 歷史（不建議），需要在 `thsrc` 端 rebase 再強推
- **不要直接在 `thsrc-booking` 上 commit**：所有變更應從 `thsrc` 端發起，否則下次 subtree push 會有衝突
- **gh-pages branch 廢棄**：遷移完成後，原本 `thsrc` 的 `gh-pages` branch 可以刪除

## 成功標準

- [ ] `thsrc-booking` 為 public repo，不含任何後端程式碼
- [ ] `https://joseph101039.github.io/thsrc-booking/` 可正常登入、訂票
- [ ] 在 `thsrc/` 修改 `ui/` 並執行 `git subtree push --prefix=ui ui main` 後，GitHub Pages 更新
- [ ] `thsrc` repo 維持 private，後端程式碼未洩漏
