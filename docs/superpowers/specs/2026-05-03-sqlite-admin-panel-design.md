# SQLite Admin Panel — Design Spec

**Date:** 2026-05-03  
**Status:** Approved

---

## Context

The server currently has a user management page (`ui/admin.html`) limited to `allowed_users`. There is no way to directly inspect or modify the other SQLite tables (`passengers`, `bookings`, `booking_attempts`, and any future tables). This panel provides a secure, internal-only admin interface for full CRUD access to all SQLite tables without requiring changes when new tables are added.

---

## Architecture

### Placement

The admin panel lives entirely inside the `server/` container — not on GitHub Pages. Express serves both the HTML and the API. This ensures it is never publicly accessible via the GitHub Pages domain.

### Directory Structure

```
server/src/
  admin/
    router.js               — mounts session auth, serves static HTML, login/logout
    adminApiRouter.js       — /admin/api/* CRUD endpoints
    controllers/
      adminDbController.js  — handlers for table list, schema, CRUD
    views/
      login.html
      dashboard.html
      assets/
        admin.css
        admin.js
```

`api.js` mounts `/admin` router alongside the existing `/v1` router.

---

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Network | `/admin` is only reachable via SSH tunnel or internal Docker network — port not exposed publicly |
| Session | `express-session` with `connect-sqlite3` store; `SESSION_SECRET` env var; `httpOnly: true`, `sameSite: 'strict'` |
| Login | POST `/admin/login` compares against `ADMIN_PASSWORD` env var (bcrypt); 5 attempts/15 min rate-limit |
| Middleware | `requireAdminSession` — all `/admin/api/*` and `/admin` dashboard require valid session; unauthenticated → 302 `/admin/login` |
| SQL injection | Table names validated against `/^[a-zA-Z0-9_]+$/` before interpolation; all values use prepared statements |

Completely independent of the existing JWT system — JWT secret compromise does not affect admin access.

---

## API Endpoints (`/admin/api/*`)

All endpoints require valid session via `requireAdminSession` middleware.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/api/tables` | List all tables from `sqlite_master` with row count |
| GET | `/admin/api/:table/schema` | Return column info via `PRAGMA table_info` |
| GET | `/admin/api/:table` | Paginated rows (`?page=1&limit=50&search=`) |
| GET | `/admin/api/:table/:id` | Single row by PK |
| POST | `/admin/api/:table` | Insert row |
| PUT | `/admin/api/:table/:id` | Update row by PK |
| DELETE | `/admin/api/:table/:id` | Delete row by PK |

**PK detection:** Use first column with `pk=1` from `PRAGMA table_info`; fall back to `rowid` if none.  
**Search:** LIKE across all text columns (`%term%`).  
**Tables:** Dynamically read from `sqlite_master WHERE type='table'` — no hardcoded whitelist.

---

## Frontend UI

### Pages

- `GET /admin/login` — login form (password input)
- `POST /admin/login` — authenticate, redirect to `/admin`
- `GET /admin` — dashboard (requires session)
- `POST /admin/logout` — destroy session, redirect to `/admin/login`

### Dashboard Layout

```
┌─────────────────────────────────────────┐
│  THSRC Admin                   [登出]   │
├─────────────────────────────────────────┤
│  [passengers] [bookings] [booking_      │
│               attempts]  [allowed_users]│
├─────────────────────────────────────────┤
│  搜尋: [____________]          [+ 新增] │
├──────┬──────┬──────┬──────┬─────────────┤
│  id  │ col1 │ col2 │ ...  │  操作       │
├──────┼──────┼──────┼──────┼─────────────┤
│  1   │  ... │  ... │  ... │ [編輯][刪除]│
└──────┴──────┴──────┴──────┴─────────────┘
  < 1  2  3 ... >          共 N 筆
```

### Interactions

- **Tabs:** driven by `sqlite_master` table list; URL hash tracks active tab (`#bookings`)
- **Columns:** dynamically rendered from `/schema` response — no hardcoded field names
- **Add/Edit:** modal with inputs generated from schema; `NOT NULL` columns get `required`
- **Delete:** inline confirm button (two-click: "刪除" → "確定刪除"), no `window.confirm`
- **Pagination:** 50 rows/page default; shows total count
- **Search:** debounced 300 ms; LIKE across all text columns

### Tech

- Vanilla HTML + CSS + JS; no npm build step
- Express `express.static` serves `server/src/admin/views/`
- No CDN dependencies (all assets local, works without internet)

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `express-session` | Session middleware |
| `connect-sqlite3` | Session store (reuse existing SQLite file) |
| `bcrypt` | Password hashing for ADMIN_PASSWORD comparison |
| `express-rate-limit` | Login brute-force protection |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ADMIN_PASSWORD` | Plaintext password for the admin panel; bcrypt comparison done at runtime |
| `SESSION_SECRET` | Random secret for session signing |

---

## Verification

1. `cd server && npm install` — confirm new deps install cleanly
2. Set `ADMIN_PASSWORD` (bcrypt hash) and `SESSION_SECRET` in `.env.local`
3. `node --experimental-sqlite src/api.js` — server starts without error
4. Visit `http://localhost:8081/admin` → redirects to `/admin/login`
5. Login with correct password → dashboard loads, all SQLite tables appear as tabs
6. CRUD: create a row, edit it, delete it in each table
7. Search: enter partial text, verify filtered results
8. Pagination: verify page navigation and total count
9. Wrong password: verify rate-limit kicks in after 5 attempts
10. `npm test` — existing tests pass (no regressions)