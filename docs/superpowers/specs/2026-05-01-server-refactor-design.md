# Server Refactor Design — GAS → Node.js SOLID Architecture

Date: 2026-05-01

## Overview

Refactor `server/src/` from a Google Apps Script-style single-endpoint RPC design into a proper Node.js/Express layered architecture following SOLID principles, and migrate the frontend `ui/js/api.js` to consume the new REST API.

Scope: server restructure, REST routes, frontend update, Swagger docs, test updates.

---

## Directory Structure

```
server/src/
  api.js                        ← Express app setup, mounts routes, starts server
  config.js                     ← unchanged
  scheduler.js                  ← unchanged logic, imports bookingEngineService
  db.js                         ← connection + schema init + migration only (no query functions)

  routes/
    v1.js                       ← mounts all /v1/* sub-routers

  middlewares/
    auth.js                     ← verifyJwt middleware (checks JWT + user still in DB)
    adminOnly.js                ← role check middleware (req.user.role === 'admin')

  controllers/
    authController.js           ← googleAuth handler
    passengerController.js      ← list, save, delete
    bookingController.js        ← list, create, delete, getAttempts
    userController.js           ← list, add, delete allowed users

  services/
    authService.js              ← Google token verify + JWT sign
    passengerService.js         ← passenger business logic
    bookingService.js           ← booking business logic
    userService.js              ← allowed-user business logic
    bookingEngineService.js     ← runBooking(), handleRetry() (renamed from booking_engine.js)

  repositories/
    passengerRepo.js            ← all passenger SQL
    bookingRepo.js              ← all booking + booking_attempt SQL
    userRepo.js                 ← all allowed_user SQL

  models/
    schemas.js                  ← VALID_ROLES, station validation constants

  swagger.js                    ← OpenAPI 3.0 spec object (swagger-jsdoc config)

  mailer.js                     ← DELETE (dead code — not imported by any module)
```

### Layer responsibilities

| Layer | Responsibility | Must NOT |
|---|---|---|
| Repository | Pure SQL, returns camelCased plain objects | Contain business logic |
| Service | Business logic, calls repos + external APIs | Touch req/res |
| Controller | Extract req params, call one service method, call res.json() | Contain SQL or business logic |
| Middleware | Cross-cutting concerns (auth, role check) | Contain domain logic |
| Model/schemas | Validation constants (VALID_ROLES, etc.) | Contain runtime state |

---

## REST API Routes (`/v1`)

Base path: `/v1`  
Auth: all routes except `POST /v1/auth/google` require `Authorization: Bearer <jwt>` header.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/` | none | Health check — `{ status: 'ok' }` |
| `POST` | `/v1/auth/google` | none | Google OAuth credential → JWT |
| `GET` | `/v1/passengers` | JWT | List all passengers |
| `POST` | `/v1/passengers` | JWT | Create or update passenger (upsert by `id` in body) |
| `DELETE` | `/v1/passengers/:id` | JWT | Delete passenger |
| `GET` | `/v1/bookings` | JWT | List all bookings |
| `POST` | `/v1/bookings` | JWT | Create booking |
| `DELETE` | `/v1/bookings/:id` | JWT | Delete booking |
| `GET` | `/v1/bookings/:id/attempts` | JWT | List attempts for a booking |
| `GET` | `/v1/users` | JWT + admin | List allowed users |
| `POST` | `/v1/users` | JWT + admin | Add allowed user |
| `DELETE` | `/v1/users/:email` | JWT + admin | Delete allowed user |
| `GET` | `/api-docs` | none | Swagger UI |

### Response conventions
- Success: HTTP 200, body is the result object (same shape as current responses)
- Client error: HTTP 400/401/403, body `{ error: "..." }`
- Server error: HTTP 500, body `{ error: "..." }`
- Each API logs errors to console on failure (per CLAUDE.md)

---

## Middleware

### `middlewares/auth.js` — `verifyJwt`
1. Extract Bearer token from `Authorization` header; return 401 if missing
2. `jwt.verify(token, JWT_SECRET)`; return 401 on failure
3. Check `userService.isAllowedUser(req.user.email)`; return 403 `'帳號已被移除'` if not found
4. Call `next()`

### `middlewares/adminOnly.js` — `adminOnly`
1. Check `req.user.role === 'admin'`; return 403 `'無權限'` if not
2. Call `next()`

---

## Services

### `authService.js`
- `verifyGoogleCredential(credential)` → `{ email, emailVerified }`
- `signJwt(email, role)` → JWT string (7d expiry)

### `passengerService.js`
- `listPassengers()` → calls `passengerRepo.getAll()`
- `savePassenger(data)` → calls `passengerRepo.upsert(data)`
- `deletePassenger(id)` → calls `passengerRepo.delete(id)`

### `bookingService.js`
- `listBookings()` → calls `bookingRepo.getAll()`
- `createBooking(data)` → calls `bookingRepo.create(data)`
- `deleteBooking(id)` → calls `bookingRepo.delete(id)`
- `getAttempts(bookingId)` → calls `bookingRepo.getAttemptsByBookingId(bookingId)`

### `userService.js`
- `listUsers()` → calls `userRepo.getAll()`
- `addUser({ email, role })` → validates role against `schemas.VALID_ROLES`, calls `userRepo.add()`
- `deleteUser(email, requestorEmail)` → self-delete guard (case-insensitive), calls `userRepo.delete()`
- `isAllowedUser(email)` → calls `userRepo.isAllowed(email)`
- `getUser(email)` → calls `userRepo.getByEmail(email)`

### `bookingEngineService.js`
- Direct rename of `booking_engine.js`
- All `db.*` calls replaced with `bookingRepo.*` / `passengerRepo.*` calls
- Logic (`runBooking`, `handleRetry`, `_doBooking`) unchanged

---

## Repositories

### `passengerRepo.js`
- `getAll()` — `SELECT * FROM passengers`
- `upsert({ id, name, idNumber, type, email, phone })` — INSERT or UPDATE by id presence
- `getById(id)` — `SELECT * FROM passengers WHERE id=?`
- `delete(id)` — `DELETE FROM passengers WHERE id=?`

### `bookingRepo.js`
- `getAll()` — `SELECT * FROM bookings ORDER BY created_at DESC`
- `create(data)` — INSERT new booking
- `getById(id)` — SELECT by id
- `updateFields(id, fields)` — dynamic SET (same as current `updateBookingFields`)
- `delete(id)` — DELETE by id
- `getPending()` — pending + scheduled_at <= now
- `getStuckRunning()` — running + updated_at < 10min ago
- `createAttempt({ bookingId, success, reason })` — INSERT booking_attempt
- `getAttemptsByBookingId(bookingId)` — SELECT attempts

### `userRepo.js`
- `getAll()` — SELECT all allowed_users
- `getByEmail(email)` — SELECT by email (case-insensitive)
- `isAllowed(email)` — EXISTS check
- `add({ email, role })` — INSERT OR IGNORE + duplicate check
- `delete(email)` — DELETE by email

---

## Models

### `models/schemas.js`
```js
const VALID_ROLES = ['user', 'admin'];
module.exports = { VALID_ROLES };
```
Station constants remain in `config.js` (already well-structured).

---

## Swagger

- New dependencies: `swagger-jsdoc`, `swagger-ui-express` (add to `server/package.json`)
- `src/swagger.js` — exports OpenAPI 3.0 spec object built with `swagger-jsdoc`, scanning `controllers/**/*.js` for `@swagger` JSDoc comments
- Mounted in `api.js` at `GET /api-docs` via `swagger-ui-express`
- Generated spec committed to `docs/swagger.yaml`; add npm script `"swagger": "node src/swagger.js > ../../docs/swagger.yaml"` to regenerate
- All 11 REST endpoints documented with request body schema, response schema, and security (bearerAuth)

---

## Frontend Changes (`ui/js/api.js`)

Replace single `postJson('/', { action, ... })` pattern with method-specific helpers:

```js
async function getJson(path) { ... }        // GET with Bearer token
async function postJson(path, body) { ... } // POST with Bearer token
async function deleteJson(path) { ... }     // DELETE with Bearer token
```

Each existing function maps to its REST equivalent:

| Current | New |
|---|---|
| `googleAuth(credential)` | `POST /v1/auth/google` |
| `getPassengers()` | `GET /v1/passengers` |
| `savePassenger(data)` | `POST /v1/passengers` |
| `deletePassenger(id)` | `DELETE /v1/passengers/${id}` |
| `getBookings()` | `GET /v1/bookings` |
| `createBooking(data)` | `POST /v1/bookings` |
| `deleteBooking(id)` | `DELETE /v1/bookings/${id}` |
| `getBookingAttempts(id)` | `GET /v1/bookings/${id}/attempts` |
| `getAllowedUsers()` | `GET /v1/users` |
| `addAllowedUser(data)` | `POST /v1/users` |
| `deleteAllowedUser(email)` | `DELETE /v1/users/${email}` |

Function signatures and return shapes stay identical — callers in other UI files need no changes.

`DELETE /v1/users/:email` — the frontend must call `encodeURIComponent(email)` when building the URL, since email addresses contain `.` and `@`.

---

## Testing

### Updated existing tests
- `auth.test.js` — update route from `POST /` to `POST /v1/auth/google`; assertions unchanged
- `admin.test.js` → renamed `users.test.js` — update routes to `/v1/users`; assertions unchanged

### New test files
- `passengers.test.js` — CRUD happy paths, 401/403
- `bookings.test.js` — create, list, delete, attempts

### Test strategy
- All tests use temp SQLite DB (`os.tmpdir()`) — no mocking
- Each test file starts its own `http.createServer(app)` on a random port
- Network tests (`RUN_NETWORK_TESTS=1`) remain in `thsrc.integration.test.js`

---

## Migration Path

No DB schema changes. No data migration. The restructure is purely code reorganisation + route renaming.

### Deploy order (critical)

The new frontend calls `/v1/*` routes that the old server container does not know. The new server only exposes `/v1/*` and does not keep the old `POST /` action dispatcher. **Frontend and server must not be live at different versions simultaneously.**

Deploy in this order:
1. Merge PR to `main`
2. `DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh` — build and push new Docker image
3. Wait for VM cron to pull and restart (~5 minutes), then verify: `curl http://35.212.154.47:8081/v1/passengers` returns 401 (not 404)
4. Only after step 3 passes: `git push origin main:gh-pages` — deploy new frontend

If step 3 fails (container not updated), do not push gh-pages. Rollback: push previous image tag or revert and redeploy.
