# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

THSRC automated ticket-booking agent. Backend is Google Apps Script (GAS) V8 runtime; frontend is vanilla HTML/CSS/JS hosted on GitHub Pages. No Node.js, no build step.

- **GAS Script ID:** `1_vh44nd0AjNMYm3czo-XXUM6rB_BF42sWsLY95TMmuc1asw_terZmpL8`
- **Google Sheet ID:** `1oFh2T6MzB7KMokpsBBTThdyLzxbAhT0Xlo4exFXyEuA`
- **GAS Web App URL (current):** `https://script.google.com/macros/s/AKfycbx1uVUZpBU2OgkUUph625275GDvMgHmA724RLUpyFt-v6I-Bju3mPDeGPktSJAgap1gQQ/exec`
- **UI (GitHub Pages):** `https://joseph101039.github.io/thsrc/ui/`

## Deployment

### GAS backend
```bash
cd gas
clasp push --force
```
After pushing, if the Web App URL needs to change or CORS settings need updating, the user must **manually create a new deployment** in the GAS Editor (Deploy → New deployment → Web App → "所有人"). `clasp deploy` cannot set access permissions.

To update an existing deployment without changing the URL:
```bash
clasp deploy --deploymentId "<existing-id>" --description "description"
```

### UI frontend
```bash
# Push to GitHub Pages
git push origin main:gh-pages
```
The `gh-pages` branch serves `ui/` at `https://joseph101039.github.io/thsrc/ui/`.

### Local dev server (required — file:// breaks CORS)
```bash
python3 -m http.server 8080 --directory ui
# Then open http://localhost:8080
```

## Architecture Gotchas

**Async booking execution:** `createBooking` must never call `runBooking()` synchronously in `doPost` — GAS HTTP requests to THSRC will time out the 5-minute execution window. Always use `scheduleBooking(id, new Date(Date.now() + 3000))` for immediate bookings.

**Trigger state via ScriptProperties:** GAS time-based triggers can't pass parameters. `bookingId` is stored in ScriptProperties keyed as `'trigger_' + triggerId` and read by `resumeBookingTrigger()`.

**Hard-coded URLs:** `ui/js/api.js` has the GAS URL hard-coded. `gas/Config.gs` has `CAPTCHA_API_URL` hard-coded. Both must be updated manually and redeployed when endpoints change.

**SpreadsheetApp:** This is a standalone GAS project (not bound to a Sheet). Always use `SpreadsheetApp.openById(SPREADSHEET_ID)` — `getActiveSpreadsheet()` returns null.

**Sheet columns:** `Config.gs` defines `BOOKING_COLS` and `PASSENGER_COLS` arrays. The actual Google Sheet column order must match exactly — there are no migration tools.

**CAPTCHA auto-solve:** `runBooking()` calls `solveCaptcha()` (in `Captcha.gs`) which POSTs the base64 image to `CONFIG.CAPTCHA_API_URL + '/solve'` (`http://35.212.154.47:8080`). The result is used immediately — no email, no user interaction, no session pause. If the API fails or returns a wrong answer, the booking falls into `handleRetry`. The `WAITING_CAPTCHA` status and `captcha.html` UI are no longer used.

**GAS execution limit:** 5 minutes (`CONFIG.MAX_EXECUTION_MS`). Any synchronous HTTP call chain that approaches this will be killed.

## Testing

No automated test runner. Test functions (`test_*`) in each `.gs` file must be run manually:
- In GAS Editor: select function → Run
- Via clasp: `clasp run test_createBooking` (requires OAuth setup)

Available test functions: `test_createBooking`, `test_mailer`, `test_handleRetry` (check each `.gs` file).

## Code Style

- GAS files use `.gs` extension but are plain JavaScript (V8 runtime)
- All user-facing strings and comments are in Traditional Chinese (繁體中文)
- No linter or formatter configured
