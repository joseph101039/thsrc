# Retry Interval Per-Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓每筆訂單可以自訂 retry 間隔（數字 + 分/秒），取代全域的 `CONFIG.RETRY_WAIT_MINUTES`。

**Architecture:** DB 新增兩欄 `retry_wait_value`（整數）、`retry_wait_unit`（`'minute'`|`'second'`），migration 在 `db.js._migrate()` 中執行（冪等）。`bookingEngineService.handleRetry()` 改用 per-booking 值計算下次執行時間。UI 表單新增對應輸入欄位，`booking.js` 送出時帶上這兩個欄位。

**Tech Stack:** Node.js (CommonJS), node:sqlite, vanilla HTML/JS

---

## File Map

| 動作 | 檔案 |
|------|------|
| Modify | `server/src/db.js` |
| Modify | `server/src/repositories/bookingRepo.js` |
| Modify | `server/src/services/bookingEngineService.js` |
| Modify | `ui/booking.html` |
| Modify | `ui/js/booking.js` |
| Modify | `server/test/bookings.test.js` |

---

### Task 1: DB Migration — 新增 retry_wait_value / retry_wait_unit 欄位

**Files:**
- Modify: `server/src/db.js`

- [ ] **Step 1: 在 `_migrate()` 末尾加入兩行 ALTER TABLE**

開啟 `server/src/db.js`，找到 `_migrate` 函式（約第 67 行），在最後一個 `try/catch` 區塊之後加入：

```js
  try { db.exec("ALTER TABLE bookings ADD COLUMN retry_wait_value INTEGER NOT NULL DEFAULT 2"); } catch {}
  try { db.exec("ALTER TABLE bookings ADD COLUMN retry_wait_unit TEXT NOT NULL DEFAULT 'minute'"); } catch {}
```

- [ ] **Step 2: 啟動 server 確認 migration 無錯誤**

```bash
cd server && node --experimental-sqlite src/api.js &
sleep 2 && curl -s http://localhost:8081/ | head -5
kill %1
```

Expected: server 正常啟動，無 SQLite error。

- [ ] **Step 3: Commit**

```bash
git checkout -b feat-retry-interval
git add server/src/db.js
git commit -m "feat: add retry_wait_value/unit columns to bookings table"
```

---

### Task 2: bookingRepo — create() 支援新欄位

**Files:**
- Modify: `server/src/repositories/bookingRepo.js`

- [ ] **Step 1: 寫失敗測試**

在 `server/test/bookings.test.js` 的 `BOOKING_FIXTURE` 新增兩個欄位：

```js
const BOOKING_FIXTURE = {
  passengerId: 'test-passenger-id',
  fromStation: '台北',
  toStation: '左營',
  date: '2026-06-01',
  desiredTime: '09:00',
  earliestTime: '08:00',
  latestTime: '10:00',
  maxRetries: 3,
  retryWaitValue: 30,
  retryWaitUnit: 'second',
};
```

在檔案末尾新增測試：

```js
test('POST /v1/bookings：retryWaitValue/Unit 應被儲存並回傳', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === id);
    assert.ok(booking, '應能找到剛建立的訂單');
    assert.strictEqual(booking.retryWaitValue, 30);
    assert.strictEqual(booking.retryWaitUnit, 'second');
  } finally {
    await new Promise(r => server.close(r));
  }
});
```

- [ ] **Step 2: 執行測試確認失敗**

```bash
cd server && npm test 2>&1 | grep -E "FAIL|pass|fail|retryWait"
```

Expected: 新測試 FAIL（`retryWaitValue` 為 undefined 或 2）。

- [ ] **Step 3: 修改 `bookingRepo.create()` 接受並存入新欄位**

將 `create()` 函式替換為：

```js
function create({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt, retryWaitValue, retryWaitUnit }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no,
       retry_wait_value, retry_wait_unit, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?, ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries ?? 10, scheduledAt ?? null,
         retryWaitValue ?? 2, retryWaitUnit ?? 'minute',
         now, now);
  return { success: true, id };
}
```

- [ ] **Step 4: 執行測試確認通過**

```bash
cd server && npm test 2>&1 | grep -E "FAIL|pass|fail|retryWait"
```

Expected: 新測試 PASS，所有既有測試不變。

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/bookingRepo.js server/test/bookings.test.js
git commit -m "feat: bookingRepo.create() accepts retryWaitValue/Unit"
```

---

### Task 3: bookingEngineService — handleRetry() 使用 per-booking 間隔

**Files:**
- Modify: `server/src/services/bookingEngineService.js`

- [ ] **Step 1: 修改 `handleRetry()` 的 retryAt 計算邏輯**

找到 `handleRetry` 中第 106 行附近的：

```js
const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
```

替換為：

```js
const waitValue = booking.retryWaitValue ?? CONFIG.RETRY_WAIT_MINUTES;
const waitUnit  = booking.retryWaitUnit  ?? 'minute';
const waitMs    = waitUnit === 'second' ? waitValue * 1000 : waitValue * 60 * 1000;
const retryAt   = new Date(Date.now() + waitMs).toISOString();
```

- [ ] **Step 2: 執行所有測試確認無回歸**

```bash
cd server && npm test 2>&1 | grep -E "FAIL|pass|fail"
```

Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add server/src/services/bookingEngineService.js
git commit -m "feat: handleRetry() uses per-booking retryWaitValue/Unit"
```

---

### Task 4: UI — booking.html 新增 retry 間隔欄位

**Files:**
- Modify: `ui/booking.html`

- [ ] **Step 1: 在「最大重試次數」欄位後插入新欄位**

找到：
```html
    <div class="form-group">
      <label>最大重試次數</label>
      <input type="number" id="b-max-retries" value="10" min="1" max="50">
    </div>
```

在其後插入：

```html
    <div class="form-group">
      <label>重試間隔</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input type="number" id="b-retry-wait-value" value="2" min="1" max="60" style="width:80px">
        <select id="b-retry-wait-unit">
          <option value="minute">分鐘</option>
          <option value="second">秒</option>
        </select>
      </div>
    </div>
```

- [ ] **Step 2: 在瀏覽器目視確認欄位出現**

```bash
cd ui && node serve.js &
```

開啟 `http://localhost:8082/booking.html`（或對應的 local port），確認「重試間隔」欄位在「最大重試次數」下方、有數字框與下拉選單。

- [ ] **Step 3: Commit**

```bash
git add ui/booking.html
git commit -m "feat: add retry interval field to booking form"
```

---

### Task 5: UI — booking.js 送出新欄位並做前端驗證

**Files:**
- Modify: `ui/js/booking.js`

- [ ] **Step 1: 讀取欄位值並加入驗證**

找到 `booking.js` 中讀取 `maxRetries` 的那行（約第 53 行）：

```js
const maxRetries   = parseInt(document.getElementById('b-max-retries').value);
```

在其後插入：

```js
const retryWaitValue = parseInt(document.getElementById('b-retry-wait-value').value);
const retryWaitUnit  = document.getElementById('b-retry-wait-unit').value;
```

- [ ] **Step 2: 加入前端驗證**

找到 `earliestTime >= latestTime` 的驗證區塊後，插入：

```js
const maxWait = retryWaitUnit === 'minute' ? 60 : 59;
if (!retryWaitValue || retryWaitValue < 1 || retryWaitValue > maxWait) {
  alert(`重試間隔：分鐘請填 1–60，秒請填 1–59`);
  return;
}
```

- [ ] **Step 3: 把兩個欄位加入 payload**

找到送出物件（約第 77–79 行）：

```js
      desiredTime, earliestTime, latestTime,
      maxRetries, scheduledAt,
```

改為：

```js
      desiredTime, earliestTime, latestTime,
      maxRetries, scheduledAt,
      retryWaitValue, retryWaitUnit,
```

- [ ] **Step 4: 瀏覽器手動驗證**

1. 留空數字框或填 0 → 應出現 alert
2. 選「秒」並填 60 → 應出現 alert（超出 59）
3. 填 30 秒，送出一筆訂單 → 確認 API response `success: true`
4. 在 GET /v1/bookings 回傳中找到該筆訂單，確認 `retryWaitValue=30`, `retryWaitUnit='second'`

- [ ] **Step 5: Commit**

```bash
git add ui/js/booking.js
git commit -m "feat: send retryWaitValue/Unit from booking form with validation"
```

---

## Verification（端對端）

```bash
# 1. 所有單元測試通過
cd server && npm test

# 2. 啟動 server 本機驗證
cd server && node --experimental-sqlite src/api.js &

# 3. 建立一筆 30 秒 retry 的訂單（需先取得 token）
TOKEN=$(curl -s -X POST http://localhost:8081/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"your@email","password":"your-pw"}' | jq -r .token)

curl -s -X POST http://localhost:8081/v1/bookings \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "passengerId":"<id>","fromStation":"台北","toStation":"左營",
    "date":"2026-08-01","desiredTime":"09:00",
    "earliestTime":"08:00","latestTime":"10:00",
    "maxRetries":3,"retryWaitValue":30,"retryWaitUnit":"second"
  }' | jq .

# 4. 確認欄位存入
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8081/v1/bookings | jq '.bookings[0] | {retryWaitValue, retryWaitUnit}'
# Expected: { "retryWaitValue": 30, "retryWaitUnit": "second" }
```
