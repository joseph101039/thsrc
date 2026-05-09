# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC automated ticket-booking agent. Backend is a Node.js/Express server; frontend is vanilla HTML/CSS/JS hosted on GitHub Pages.

- **Server API (HTTPS):** `https://api.joseph101039.uk` (Cloudflare Named Tunnel — stable, survives VM reboots)
- **Server API (direct):** `http://35.212.154.47:8081`
- **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc-booking/`

## Development Flow

Follow [CLAUDE.md](~/.claude/CLAUDE.md) workflow for all development. This project's stage order differs slightly:

**Branch first** — always before touching code:
- Feature: `git checkout -b feat-<name>`
- Bug fix: `git checkout -b fix-<name>`

**Stages 1–3**: same as global (Brainstorm → Plan → Implement)
- For server-internal changes not involving auth/payment/external API: skip Brainstorm + Plan, start at Stage 3

**Stage 4 — Testing**:

```bash
# Unit tests (no network required)
cd server && npm test

# Integration tests (requires Taiwan IP to reach THSRC website)
cd server && RUN_NETWORK_TESTS=1 npm test

# Local server
cd server && node --experimental-sqlite src/api.js
curl -X POST http://localhost:8081/ -H 'Content-Type: application/json' \
  -d '{"action":"getPassengers"}'

# Frontend: open http://localhost:8082 in browser after docker-compose up -d
```

**Stage 5 — Review**: Run `/requesting-copilot-claude-review`.

**Stage 6 — Commit**: `/commit-commands:commit` with descriptive message

**Stage 7 — Local Docker Validation**:

```bash
docker-compose up -d --build
```

`ui` uses bind mount (`./ui:/app`); changes to HTML/CSS/JS are reflected on browser refresh with no container restart. Only changes to `serve.js` itself require `docker-compose restart ui`. After switching branches, `docker-compose restart` is sufficient — no rebuild needed. Ask the user to verify the changes before proceeding.

**Stage 8 — PR**: ask "Open a PR now?" → `/pr`

**Stage 9 — Production Deploy** *(after PR approved and merged to main)*:

```bash
# 1. Backend Docker image (VM watchtower auto-pulls every 5 minutes)
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh

# 2. Captcha solver image (only if solver needs updating)
DOCKERHUB_USER=joseph50804 ./captcha/apiserver/deploy-gce.sh

# 3. Frontend (GitHub Pages auto-redeploys)
git subtree push --prefix=ui ui main
# If subtree history has diverged (rejected), use:
git subtree split --prefix=ui --branch ui-deploy
git push ui ui-deploy:main --force

# 4. Update VM env vars (if needed)
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="echo 'KEY=VALUE' >> ~/.env"
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="cd ~ && docker compose up -d server scheduler"

# Health check
curl http://35.212.154.47:8081/
```

## Architecture

```
docs/readme.md         — system architecture diagram and data flow; update when modifying core workflows
ui/                    — GitHub Pages frontend (vanilla HTML/CSS/JS); deployed via git subtree push --prefix=ui ui main to joseph101039/thsrc-booking
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
captcha/               — CRNN+CTC solver; deployed separately; see captcha/CLAUDE.md for details
docker-compose.yml     — orchestrates: captcha (8080), server (8081), scheduler; defines shared db-data volume
.env.local             — (git-ignored) local overrides for docker-compose.override.yml (no required variables currently)
```

## Architecture Gotchas

**node:sqlite requires flag:** All `node` invocations must use `--experimental-sqlite`. The `package.json` scripts already include it; the Dockerfile CMD does too.

**Scheduler uses `scheduled_at` field:** No external trigger mechanism. `scheduler.js` polls SQLite every minute for `status='pending' AND scheduled_at <= now`. Retries set `scheduled_at = now + 2min`.

**Stuck booking recovery:** Bookings stuck in `status='running'` for >10 minutes are reset to `pending` by the poller.

**Hard-coded server URL:** `ui/js/api.js` has `https://api.joseph101039.uk` hard-coded. Named tunnel is stable across VM reboots. Only needs updating if the tunnel is recreated.

**CAPTCHA auto-solve:** `bookingEngineService.js` POSTs base64 image to `CONFIG.CAPTCHA_API_URL + '/solve'` (`http://35.212.154.47:8080`). If the API fails or returns wrong answer, booking falls into `handleRetry`.

**SQLite volume:** Data persists in Docker volume `db-data` mounted at `/app/data`. Both `server` and `scheduler` containers share the same volume.

## Node Server Design Patterns

- Follow SOLID principles.
- Use async/await for all asynchronous operations (database, HTTP requests, etc.)
- Use Express middleware for common concerns (e.g. JSON parsing, error handling)
- Layered architecture: controllers → services → repositories → models
- Error handling: API responses should include clear error messages and status codes. Log errors to the console for debugging.
- Use environment variables for configuration that differs between local and production environments.

## Code Style

- All user-facing strings and comments are in Traditional Chinese (繁體中文)
- Node.js uses CommonJS (`require`/`module.exports`)
- No linter or formatter configured
- Each API handler should have error console logs
