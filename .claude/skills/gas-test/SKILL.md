---
name: gas-test
description: Run GAS test functions manually. Use when the user wants to test backend logic after changes.
disable-model-invocation: true
---

## How to Run GAS Tests

There is no automated test runner. All `test_*` functions must be run manually.

### Option A: GAS Editor (easiest)
1. Open https://script.google.com/home/projects/1_vh44nd0AjNMYm3czo-XXUM6rB_BF42sWsLY95TMmuc1asw_terZmpL8
2. Select the test function from the dropdown at the top
3. Click Run
4. View output in Execution log

### Option B: clasp run (requires OAuth)
```bash
cd gas
clasp run test_createBooking
```
Note: `clasp run` requires the GAS project to have the Apps Script API enabled and OAuth credentials configured.

## Available Test Functions

| Function | File | Tests |
|---|---|---|
| `test_createBooking` | `Bookings.gs` | Creates a booking and reads it back |
| `test_mailer` | `Mailer.gs` | Sends test emails (captcha, success, failure) |
| `test_handleRetry` | `BookingEngine.gs` | Tests retry scheduling logic |

Check each `.gs` file for additional `test_*` functions added since this was written.

## After Pushing Code

Always `clasp push --force` before running tests in the GAS Editor — the editor runs the deployed code, not your local files:
```bash
cd gas && clasp push --force
```
