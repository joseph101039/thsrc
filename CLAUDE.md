# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC automated ticket-booking agent. Backend is a Node.js/Express server; frontend is vanilla HTML/CSS/JS hosted on GitHub Pages.

- **Server API (HTTPS):** `https://api.joseph101039.uk` (Cloudflare Named Tunnel — stable, survives VM reboots)
- **Server API (direct):** `http://35.212.154.47:8081`
- **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc/ui/`

## Deployment

本地 docker-compose 主要用於開發測試，必須本地整合測試過沒問題才可以部署正式環境。

生產環境部署使用以下流程：

### Node.js server

```bash
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh
```

Builds `linux/amd64` image and pushes to `joseph50804/thsrc-server:latest`. VM cron job auto-pulls every 5 minutes.

### 更新 VM 環境變數（production .env）

VM 的 `.env` 位於 `/home/joseph/.env`，透過 gcloud 存取：

```bash
# 查看目前 .env
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="cat ~/.env"

# 新增或修改變數（追加）
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="echo 'KEY=VALUE' >> ~/.env"

# 重啟 server/scheduler 使新變數生效
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="cd ~ && docker compose up -d server scheduler"
```


### Local dev (Docker)

```bash
# Run all services locally (server + scheduler + captcha)
docker-compose up --build
# server → http://localhost:8081, captcha → http://localhost:8080

# Run UI dev server (injects API_URL via env var, no file edits needed)
cd ui && npm run dev
# open http://localhost:8082
```

`ui/serve.js` injects `API_URL` env var into `api.js` at request time.
Requires `.env.local` (git-ignored) with `GMAIL_USER` and `GMAIL_APP_PASSWORD`.

## Architecture

```
docs/readme.md — system architecture and data flow diagram, 修改流程時請更新此圖
ui/          — vanilla HTML/CSS/JS frontend (GitHub Pages)
server/      — Node.js/Express API + scheduler
  src/
    api.js            — Express HTTP server (port 8081), action-based POST dispatch
    scheduler.js      — node-schedule worker, polls SQLite every minute
    booking_engine.js — runBooking(), handleRetry()
    thsrc.js          — THSRC website scraping (session, trains, captcha, submit)
    db.js             — SQLite via node:sqlite (node --experimental-sqlite required)
    mailer.js         — Nodemailer + Gmail SMTP
    config.js         — constants (stations, status codes, captcha URL)
captcha/     — CRNN+CTC captcha solver (see captcha/CLAUDE.md)
```

**VM:** GCE e2-micro `instance-20260427-141455`, us-west1-b, IP `35.212.154.47`, GCP project `sincere-office-494609-m3`
**docker-compose.yml** (root) manages: captcha (8080), server (8081), scheduler

## Architecture Gotchas

**node:sqlite requires flag:** All `node` invocations must use `--experimental-sqlite`. The `package.json` scripts already include it; the Dockerfile CMD does too.

**Scheduler uses `scheduled_at` field:** No external trigger mechanism. `scheduler.js` polls SQLite every minute for `status='pending' AND scheduled_at <= now`. Retries set `scheduled_at = now + 2min`.

**Stuck booking recovery:** Bookings stuck in `status='running'` for >10 minutes are reset to `pending` by the poller.

**Hard-coded server URL:** `ui/js/api.js` has `https://api.joseph101039.uk` hard-coded. Named tunnel is stable across VM reboots. Only needs updating if the tunnel is recreated.

**CAPTCHA auto-solve:** `booking_engine.js` POSTs base64 image to `CONFIG.CAPTCHA_API_URL + '/solve'` (`http://35.212.154.47:8080`). If the API fails or returns wrong answer, booking falls into `handleRetry`.

**SQLite volume:** Data persists in Docker volume `db-data` mounted at `/app/data`. Both `server` and `scheduler` containers share the same volume.

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

## 重要：高鐵網站的 WAF 防護

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
