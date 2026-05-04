# Booking Enhancements Design

**Date:** 2026-05-04  
**Status:** Approved

## Overview

Five enhancements to the booking system, split into two areas:
- **Area A** — Booking form expansion (features 1–3)
- **Area B** — Ownership, permissions, and ID masking (features 4–5)

---

## Area A: Booking Form Expansion

### Feature 1 — Passenger Dropdown Ordering

**What:** In the new-booking form, sort the passenger dropdown so the passenger whose notification email matches the logged-in user's email appears first. All others follow in their original order.

**Where:** `ui/js/booking.js` — `loadPassengers()` sorts the array before rendering `<option>` elements.

**Logic:** Compare each passenger's `email` with the decoded JWT email from `window.__auth`. No backend changes needed.

---

### Feature 2 — Ticket Type Quantities (± Buttons)

**What:** Replace the implicit "1 adult ticket" hardcoded in `thsrc.js` with per-booking ticket counts configurable in the form.

**Ticket types (matching THSRC field codes):**
| Label | Code | DB column | Default |
|-------|------|-----------|---------|
| 全票 | F | `ticket_adult` | 1 |
| 孩童票 | H | `ticket_child` | 0 |
| 愛心票 | W | `ticket_disabled` | 0 |
| 敬老票 | E | `ticket_senior` | 0 |
| 大學生票 | P | `ticket_student` | 0 |

**UI:** `± button` style (A option from brainstorming). Each ticket type row shows label + minus button + count + plus button. Minimum per type: 0. Maximum per type: 10. Total must be ≥ 1.

**Backend — DB migration** (`db.js` `_migrate()`): Add 5 INTEGER columns to `bookings` table with defaults matching the table above.

**Backend — `bookingRepo.create()`**: Accept and store the 5 new fields.

**Backend — `bookingService.createBooking()`**: Validate total ticket count ≥ 1, each value 0–10 integer.

**Backend — `thsrc.js`**: `thsrcSearchTrains()` and `thsrcSubmitBooking()` read ticket counts from the booking object instead of the current hardcoded values. Build `ticketPanel:rows:N:ticketAmount` and `ticketTypeNum` dynamically.

**Display:** Booking detail page (`booking-detail.js`) shows a ticket summary line, e.g. `全票×2, 孩童×1` (only show types with count > 0).

---

### Feature 3 — Time / Train Number Toggle

**What:** The booking form gains a segmented control (B option from brainstorming) next to the time section label, toggling between **時間** and **車次** modes.

**Time mode (default):** Shows 期望時間, 允許最早, 允許最晚 fields (existing behavior).

**Train number mode:** Hides the three time fields; shows a single text input 「車次號碼」. The user enters a train number (e.g. `0106`).

**Backend — DB migration**: Add two columns to `bookings`:
- `search_mode TEXT NOT NULL DEFAULT 'time'` — `'time'` or `'train'`
- `train_no_target TEXT` — nullable, target train number when `search_mode = 'train'`

**Backend — `bookingRepo.create()`**: Accept and store `searchMode`, `trainNoTarget`.

**Backend — `bookingService.createBooking()`**: Validate: if `searchMode = 'train'`, `trainNoTarget` must be non-empty. If `searchMode = 'time'`, `desiredTime`, `earliestTime`, `latestTime` must be present (already validated today).

**Backend — `thsrc.js`**: `thsrcSearchTrains()` checks `booking.searchMode`:
- `'time'` → use `toTimeTable` (existing)
- `'train'` → set `toTrainIDInputField = booking.trainNoTarget`, `bookingMethod = 'radio32'` (train number search), clear time fields

**Display:** Booking detail page shows either `期望時間: 09:00` or `車次: 0106`.

---

## Area B: Ownership, Permissions, and ID Masking

### Feature 4 — Booking Ownership and Operation Permissions

**What:** Each booking is owned by the user who created it. `user` role can only view and mutate their own bookings; `admin` can access all.

**Backend — DB migration**: Add `owner_email TEXT NOT NULL DEFAULT ''` to `bookings` table.

**Backend — `bookingRepo.create()`**: Accept and store `ownerEmail`.

**Backend — `bookingController.createBooking()`**: Pass `req.user.email` as `ownerEmail`.

**Backend — `bookingRepo.getAll()`**: Accepts optional `ownerEmail` filter. When provided, adds `WHERE owner_email = ?`.

**Backend — `bookingController.listBookings()`**: If `req.user.role === 'admin'`, call `getAll()` with no filter. Otherwise call `getAll(req.user.email)`.

**Backend — delete / cancel / refund**: Before executing, check `booking.ownerEmail === req.user.email || req.user.role === 'admin'`. If not, return 403.

**Display:** Booking card and detail page show a passenger line: `乘客：王小明（A12*****89）` using masked ID (see Feature 5).

---

### Feature 5 — ID Number Masking

**Rule:** Keep first 3 characters + last 2 characters; replace middle characters with `*`. The number of `*` equals the number of hidden characters (e.g. 10-char ID → 5 stars: `A12*****89`).

**Own ID definition:** A passenger's ID is considered "own" if `passenger.email === currentUserEmail` (notification email matches login email). Own IDs are never masked.

**Shared helper** (`ui/js/api.js` or a new `ui/js/utils.js`): 
```js
function maskId(idNumber, passengerEmail, myEmail) {
  if (passengerEmail === myEmail) return idNumber;
  const mid = idNumber.length - 5;
  if (mid <= 0) return idNumber;
  return idNumber.slice(0, 3) + '*'.repeat(mid) + idNumber.slice(-2);
}
```

**Apply to:**
1. **Booking form passenger dropdown** (`booking.js`): `王小明（A12*****89）`
2. **Booking list cards** (`index.js`): passenger line with masked ID
3. **Booking detail page** (`booking-detail.js`): passenger line with masked ID
4. **Passenger settings page** (`passengers.js`): card shows masked ID for other passengers; own passenger shows full ID

**`myEmail` source:** `JSON.parse(atob(token.split('.')[1])).email` from the JWT — already decoded in `auth.js`. Expose as `window.__auth.getEmail()`.

---

## Data Model Summary

### `bookings` table — new columns

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `ticket_adult` | INTEGER | 1 | 全票 |
| `ticket_child` | INTEGER | 0 | 孩童票 |
| `ticket_disabled` | INTEGER | 0 | 愛心票 |
| `ticket_senior` | INTEGER | 0 | 敬老票 |
| `ticket_student` | INTEGER | 0 | 大學生票 |
| `search_mode` | TEXT | `'time'` | `'time'` or `'train'` |
| `train_no_target` | TEXT | NULL | target train number |
| `owner_email` | TEXT | `''` | booking owner |

All added via `_migrate()` with `ALTER TABLE … ADD COLUMN`.

---

## Files Changed

### Backend
- `server/src/db.js` — migration for 8 new columns
- `server/src/repositories/bookingRepo.js` — `create()`, `getAll()` with owner filter
- `server/src/services/bookingService.js` — validation for ticket counts and search mode
- `server/src/controllers/bookingController.js` — pass `ownerEmail`; role-based filter; 403 guard on mutate
- `server/src/thsrc.js` — dynamic ticket fields; train-number search mode

### Frontend
- `ui/js/auth.js` — expose `getEmail()` on `window.__auth`
- `ui/js/booking.js` — passenger sort; ticket type ± UI; time/train toggle; send new fields
- `ui/booking.html` — ticket type section; segmented toggle markup
- `ui/js/index.js` — passenger line with masked ID on booking cards
- `ui/js/booking-detail.js` — passenger line; ticket summary; search mode display
- `ui/js/passengers.js` — masked ID in passenger cards
