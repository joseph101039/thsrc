# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC automated ticket-booking agent. Backend is a Node.js/Express server; frontend is vanilla HTML/CSS/JS hosted on GitHub Pages.

- **Server API (HTTPS):** `https://api.joseph101039.uk` (Cloudflare Named Tunnel — stable, survives VM reboots)
- **Server API (direct):** `http://35.212.154.47:8081`
- **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc/ui/`

## Development Flow

Follow [CLAUDE.md](~/.claude/CLAUDE.md) workflow for all development. This project's stage order differs slightly:

**Branch first** — always before touching code:
- Feature: `git checkout -b feat-<name>`
- Bug fix: `git checkout -b fix-<name>`

**Stages 1–4**: same as global (Brainstorm → Plan → Implement → Test)
- 本專案大多是 server 內部小改動，除非涉及 auth/payment/external API，**跳過 Brainstorm + Plan 直接 Stage 3**

**Stage 5 — Review**: `/requesting-copilot-claude-review`；Option 2 (Push + PR) blocked until this completes

**Stage 6 — Local Docker Validation** *(project-specific gate before any push)*:
```bash
docker-compose up --build -d   # captcha:8080, server:8081, scheduler
cd ui && npm run dev            # UI dev server: http://localhost:8082
```
`ui/serve.js` injects `API_URL` at request time. Requires `.env.local` with `GMAIL_USER` + `GMAIL_APP_PASSWORD`.

**Stage 7 — Commit & PR**: `/commit` → ask "Open a PR now?" → `/pr`

**Stage 8 — Deploy** *(after PR approved and merged to main)*:

```bash
# 推送主分支 + 前端
git push origin main
git push origin main:gh-pages

# 後端 Docker image（VM cron 每 5 分鐘自動 pull）
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh

# 如需更新 VM 環境變數
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="echo 'KEY=VALUE' >> ~/.env"
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="cd ~ && docker compose up -d server scheduler"
```

## Architecture

```
docs/readme.md         — system architecture diagram and data flow; update when modifying core workflows
ui/                    — GitHub Pages frontend (vanilla HTML/CSS/JS); deployed via git push origin main:gh-pages
server/                — Node.js/Express backend + job scheduler; deployed to GCE via docker image
  src/
    api.js             — Express entry point (port 8081); mounts middleware, routes, and Swagger UI
    scheduler.js       — node-schedule worker; polls SQLite every 60s for pending bookings (status='pending' AND scheduled_at <= now)
    thsrc.js           — THSRC website automation; handles session init, train search, captcha fetch, booking submission
    db.js              — SQLite wrapper (node:sqlite); shared volume between server and scheduler containers
    config.js          — centralized constants: station codes, booking status enums, captcha solver API URL
    swagger.js         — Swagger/OpenAPI spec generation (swagger-jsdoc)
    routes/
      v1.js            — /api/v1 route definitions; applies auth + adminOnly middleware per endpoint
    controllers/
      authController.js      — login, register, JWT token issuance
      bookingController.js   — create/list/cancel bookings
      passengerController.js — CRUD for saved passenger profiles
      userController.js      — admin user management
    services/
      authService.js         — credential verification, JWT signing
      bookingService.js      — booking business logic (validation, status transitions)
      bookingEngineService.js — runBooking(), handleRetry(); POSTs to captcha solver, submits to THSRC
      passengerService.js    — passenger business logic
      userService.js         — user business logic
    repositories/
      bookingRepo.js    — SQLite queries for bookings table
      passengerRepo.js  — SQLite queries for passengers table
      userRepo.js       — SQLite queries for users table
    models/
      schemas.js        — shared validation constants (e.g. VALID_ROLES)
    middlewares/
      auth.js           — JWT verification middleware
      adminOnly.js      — role-guard middleware (rejects non-admin)
  Dockerfile            — builds linux/amd64 image; includes --experimental-sqlite flag in CMD
captcha/               — CRNN+CTC solver (git subtree); deployed separately; see captcha/CLAUDE.md for details
docker-compose.yml     — orchestrates: captcha (8080), server (8081), scheduler; defines shared db-data volume
.env.local             — (git-ignored) local overrides: GMAIL_USER, GMAIL_APP_PASSWORD
```

**VM:** GCE e2-micro `instance-20260427-141455`, us-west1-b, IP `35.212.154.47`, GCP project `sincere-office-494609-m3` (free tier, 720 hours/month)

## Architecture Gotchas

**node:sqlite requires flag:** All `node` invocations must use `--experimental-sqlite`. The `package.json` scripts already include it; the Dockerfile CMD does too.

**Scheduler uses `scheduled_at` field:** No external trigger mechanism. `scheduler.js` polls SQLite every minute for `status='pending' AND scheduled_at <= now`. Retries set `scheduled_at = now + 2min`.

**Stuck booking recovery:** Bookings stuck in `status='running'` for >10 minutes are reset to `pending` by the poller.

**Hard-coded server URL:** `ui/js/api.js` has `https://api.joseph101039.uk` hard-coded. Named tunnel is stable across VM reboots. Only needs updating if the tunnel is recreated.

**CAPTCHA auto-solve:** `booking_engine.js` POSTs base64 image to `CONFIG.CAPTCHA_API_URL + '/solve'` (`http://35.212.154.47:8080`). If the API fails or returns wrong answer, booking falls into `handleRetry`.

**SQLite volume:** Data persists in Docker volume `db-data` mounted at `/app/data`. Both `server` and `scheduler` containers share the same volume.

## Node Server Design Patterns

- Follow SOLID principles.
- Use async/await for all asynchronous operations (database, HTTP requests, etc.)
- Centralize configuration in `config.js`
- Use Express middleware for common concerns (e.g. JSON parsing, error handling)
- controllers, services, repositories, models 分層
- Error handling: API responses should include clear error messages and status codes. Log errors to the console for debugging.
- Use environment variables for sensitive data (e.g. Gmail credentials) and configuration that may differ between local and production environments.

## Testing

```bash
# 邏輯單元測試（不需要網路，本機可跑）
cd server && npm test

# 網路整合測試（需要台灣 IP 才能連高鐵網站）
cd server && RUN_NETWORK_TESTS=1 npm test

# Health check
curl http://35.212.154.47:8081/

# Local server
cd server && node --experimental-sqlite src/api.js
curl -X POST http://localhost:8081/ -H 'Content-Type: application/json' \
  -d '{"action":"getPassengers"}'
```

## 高鐵網站的 WAF 防護

`irs.thsrc.com.tw` 使用 Akamai WAF，需要完整的 Chrome browser headers 才能連線。
`thsrc.js` 已加入 `BROWSER_HEADERS` 常數（User-Agent、sec-ch-ua、Sec-Fetch-*、**Connection: keep-alive** 等），node-fetch 即可正常連線，不需要 Playwright。

**必要 header：** `Connection: keep-alive` 是關鍵，缺少此 header 連線會 timeout（Akamai 不回應）。

**必要 cookie：** `thsrcInit()` 初始連線時，Akamai 會在 `Set-Cookie` 回傳多組防護 cookie（`_abck`、`bm_sz`、`bm_sv`、`ak_bmsc`、`TS01*`、`IRS-SESSION`、`THSRC-IRS` 等）。後續所有請求必須帶**完整 cookie jar**，只帶 `JSESSIONID` 會被 WAF 攔截（回傳 HTML 而非圖片）。

### 驗證高鐵連線是否正常（用 curl）

```bash
curl --location 'https://irs.thsrc.com.tw/IMINT/' \
  --header 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
  --header 'Accept-Language: zh-TW,zh;q=0.9' \
  --header 'Connection: keep-alive' \
  --header 'Sec-Fetch-Dest: document' \
  --header 'Sec-Fetch-Mode: navigate' \
  --header 'Sec-Fetch-Site: none' \
  --header 'Sec-Fetch-User: ?1' \
  --header 'Upgrade-Insecure-Requests: 1' \
  --header 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36' \
  --header 'sec-ch-ua: "Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"' \
  --header 'sec-ch-ua-mobile: ?0' \
  --header 'sec-ch-ua-platform: "macOS"'
```

成功回應會包含 `BookingS1Form` 表單與驗證碼 `<img src="/IMINT/?wicket:interface=...passCode...">` 。

## Captcha Solver (`captcha/`)

The `captcha/` directory is part of this monorepo (merged via `git subtree`). See `captcha/CLAUDE.md` for full documentation.

- **Live API:**  `https://api.joseph101039.uk/` (also http://35.212.154.47:8080)
- **Deploy:** `DOCKERHUB_USER=joseph50804 ./captcha/apiserver/deploy-gce.sh`
- **Integration:** `server/src/config.js` → `CAPTCHA_API_URL`; `server/src/booking_engine.js` → POST `/solve`

## Code Style

- All user-facing strings and comments are in Traditional Chinese (繁體中文)
- Node.js uses CommonJS (`require`/`module.exports`)
- No linter or formatter configured
- each API should have error console logs 
