# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC automated ticket-booking agent. Backend is a Node.js/Express server; frontend is vanilla HTML/CSS/JS hosted on GitHub Pages.

- **Server API (HTTPS):** `https://api.joseph101039.uk` (Cloudflare Named Tunnel — stable, survives VM reboots)
- **Server API (direct):** `http://35.212.154.47:8081`
- **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc/ui/`

## Deployment

### Node.js server

```bash
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh
```

Builds `linux/amd64` image and pushes to `joseph50804/thsrc-server:latest`. VM cron job auto-pulls every 5 minutes.

### UI frontend

```bash
git push origin main:gh-pages
```

The `gh-pages` branch serves `ui/` at `https://joseph101039.github.io/thsrc/ui/`.

### Local dev (Docker)

```bash
# Run all services locally (server + scheduler + captcha)
docker-compose up --build
# server → http://localhost:8081, captcha → http://localhost:8080

# Point UI at local server (edit ui/js/api.js GAS_URL → http://localhost:8081), then:
python3 -m http.server 8082 --directory ui
# open http://localhost:8082
```

Requires `.env.local` (git-ignored) with `GMAIL_USER` and `GMAIL_APP_PASSWORD`.

## Architecture

```
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

No automated test runner. Test manually:

```bash
# Health check
curl http://35.212.154.47:8081/

# Local server
cd server && node --experimental-sqlite src/api.js
curl -X POST http://localhost:8081/ -H 'Content-Type: application/json' \
  -d '{"action":"getPassengers"}'
```

## Captcha Solver (`captcha/`)

The `captcha/` directory is part of this monorepo (merged via `git subtree`). See `captcha/CLAUDE.md` for full documentation.

- **Live API:** `http://35.212.154.47:8080`
- **Deploy:** `DOCKERHUB_USER=joseph50804 ./captcha/apiserver/deploy-gce.sh`
- **Integration:** `server/src/config.js` → `CAPTCHA_API_URL`; `server/src/booking_engine.js` → POST `/solve`

## Code Style

- All user-facing strings and comments are in Traditional Chinese (繁體中文)
- Node.js uses CommonJS (`require`/`module.exports`)
- No linter or formatter configured
