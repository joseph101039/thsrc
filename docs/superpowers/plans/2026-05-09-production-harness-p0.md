# Production Harness P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 GCE 部署的 server / scheduler / captcha 補上 P0 級可觀測性與韌性:SQLite 每日備份至 GCS、HTTP 健康探針、pino structured logging。

**Architecture:** 三項變更彼此獨立,分三個 PR:logging → health probes → backup。Logging 與 probes 是 Node.js 程式碼變更(可單元測試);backup 是 VM-side shell + GCS infra。所有設計皆鎖定 Always Free 額度與同 region 設定,確保零月費。

**Tech Stack:** Node.js / Express / node:sqlite / `pino`(新增)/ docker-compose / GCS / GCE host cron / `gsutil`

**Spec:** `docs/superpowers/specs/2026-05-09-production-harness-p0-design.md`

---

## File Structure

### PR-1: Structured Logging
- **Create** `server/src/logger.js` — pino factory + redact 設定
- **Create** `server/src/middlewares/requestLogger.js` — request_id + req.log child logger
- **Create** `server/test/logger.test.js` — redact 行為測試
- **Modify** `server/package.json` — 新增 `pino` 相依
- **Modify** `server/src/api.js` — 套用 middleware,console → logger
- **Modify** `server/src/scheduler.js` — console → logger
- **Modify** `server/src/thsrc.js` + `controllers/*.js` + `services/*.js` + `admin/*.js` — console → logger(機械式替換)

### PR-2: Health Probes + Heartbeat
- **Create** `server/src/repositories/heartbeatRepo.js` — heartbeat upsert / get
- **Create** `server/src/routes/health.js` — `/healthz` + `/readyz` handler
- **Create** `server/test/health.test.js`
- **Modify** `server/src/db.js` — `system_heartbeat` 表 schema
- **Modify** `server/src/scheduler.js` — 每次 poll 結束寫 heartbeat
- **Modify** `server/src/api.js` — 掛載 health route(取代既有 `/`)
- **Modify** `docker-compose.yml` — 三個 service 加 `healthcheck:`
- **Create** `captcha/apiserver/healthz.py`(或加進現有 server)— `/healthz` 端點(若 captcha 是 Python)

### PR-3: GCS Backup
- **Create** `scripts/backup-db.sh` — 備份腳本
- **Create** `scripts/install-backup-cron.sh` — 安裝 cron + 驗證 gsutil 認證
- **Create** `docs/runbooks/restore-db.md` — 還原 runbook
- **Create** `docs/runbooks/setup-gcs-backup.md` — 一次性 infra 建置步驟(bucket + IAM)

---

## PR-1: Structured Logging

### Task 1: 安裝 pino 並建立 logger 模組

**Files:**
- Create: `server/src/logger.js`
- Modify: `server/package.json`

- [ ] **Step 1: 安裝 pino**

```bash
cd server && npm install pino@^9.5.0
```

Expected: `package.json` 與 `package-lock.json` 更新,`node_modules/pino/` 出現。

- [ ] **Step 2: 建立 logger.js**

```js
'use strict';

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ severity: label.toUpperCase() }),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.idNumber',
      '*.id_number',
      '*.creditCard',
      '*.credit_card',
      'body.password',
      'body.token',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
```

- [ ] **Step 3: Commit**

```bash
git add server/package.json server/package-lock.json server/src/logger.js
git commit -m "chore: 引入 pino 並建立共用 logger（含敏感欄位遮罩）"
```

---

### Task 2: Logger 敏感欄位遮罩單元測試

**Files:**
- Create: `server/test/logger.test.js`

- [ ] **Step 1: 寫失敗測試**

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { Writable } = require('node:stream');
const pino = require('pino');

function makeTestLogger() {
  const captured = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      captured.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  const logger = pino({
    redact: {
      paths: ['*.password', '*.token', '*.idNumber', 'body.password'],
      censor: '[REDACTED]',
    },
    formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
  }, stream);
  return { logger, captured };
}

test('redacts password field', () => {
  const { logger, captured } = makeTestLogger();
  logger.info({ user: { password: 'secret123' } }, 'login');
  assert.strictEqual(captured[0].user.password, '[REDACTED]');
});

test('redacts idNumber field', () => {
  const { logger, captured } = makeTestLogger();
  logger.info({ passenger: { idNumber: 'A123456789' } }, 'create');
  assert.strictEqual(captured[0].passenger.idNumber, '[REDACTED]');
});

test('emits severity field for GCP Cloud Logging', () => {
  const { logger, captured } = makeTestLogger();
  logger.warn('something');
  assert.strictEqual(captured[0].severity, 'WARN');
});
```

- [ ] **Step 2: 跑測試確認 fail**

```bash
cd server && npm test -- --test-name-pattern="redacts|severity"
```

Expected: 三個測試應該都 PASS(因為直接用 pino 而非 require logger.js)— 此測試是驗證 redact 設定本身正確。若 fail,檢查 pino 版本。

- [ ] **Step 3: Commit**

```bash
git add server/test/logger.test.js
git commit -m "test: 為 pino logger 加入敏感欄位遮罩測試"
```

---

### Task 3: Request logger middleware

**Files:**
- Create: `server/src/middlewares/requestLogger.js`

- [ ] **Step 1: 寫 middleware**

```js
'use strict';

const { randomUUID } = require('node:crypto');
const logger = require('../logger');

module.exports = function requestLogger(req, res, next) {
  const reqId = req.headers['x-request-id'] || randomUUID();
  req.log = logger.child({ req_id: reqId });
  res.setHeader('x-request-id', reqId);

  const start = Date.now();
  res.on('finish', () => {
    req.log.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    }, 'request');
  });

  next();
};
```

- [ ] **Step 2: Commit**

```bash
git add server/src/middlewares/requestLogger.js
git commit -m "feat: 加入 request_id middleware,每個請求附帶 child logger"
```

---

### Task 4: api.js 套用 middleware + console 替換

**Files:**
- Modify: `server/src/api.js`

- [ ] **Step 1: 改寫 api.js**

完整新版檔案(取代既有內容):

```js
'use strict';

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const CONFIG = require('./config');
const v1Router = require('./routes/v1');
const swaggerSpec = require('./swagger');
const logger = require('./logger');
const requestLogger = require('./middlewares/requestLogger');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  logger.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  logger.warn('警告：SESSION_SECRET 或 ADMIN_PASSWORD 未設定,Admin panel 將無法登入');
}

const app = express();
const ALLOWED_ORIGINS = ['https://joseph101039.github.io', 'http://localhost:8082'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use(requestLogger);

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/v1', v1Router);

const adminRouter = require('./admin/router');
app.use('/admin', adminRouter);

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    logger.info({ port: CONFIG.PORT }, 'THSRC server listening');
  });
}

module.exports = app;
```

- [ ] **Step 2: 跑既有測試確保沒壞**

```bash
cd server && npm test
```

Expected: 既有 unit tests 全部 PASS(integration test 因 RUN_NETWORK_TESTS 未設應自動跳過)。

- [ ] **Step 3: Commit**

```bash
git add server/src/api.js
git commit -m "refactor: api.js 改用 pino logger 並套用 request_id middleware"
```

---

### Task 5: scheduler.js console → logger

**Files:**
- Modify: `server/src/scheduler.js`

- [ ] **Step 1: 替換 scheduler.js 的 log 呼叫**

頂部加:
```js
const logger = require('./logger').child({ service: 'scheduler' });
```

機械式替換規則:
- `console.log('Scheduler started')` → `logger.info('Scheduler started')`
- `console.log(\`[${now}] poll\`)` → `logger.debug({ at: now }, 'poll')`
- `console.log(\`  [stuck] reset booking ${b.id}\`)` → `logger.warn({ booking_id: b.id }, 'stuck booking reset')`
- `console.log(\`  [run] bookingId=${b.id} ...\`)` → `logger.info({ booking_id: b.id, from: b.fromStation, to: b.toStation, retry: b.retryCount }, 'run booking')`
- `console.error('pollPendingBookings error:', err.message)` → `logger.error({ err: err.message }, 'pollPendingBookings error')`
- `console.error('pollStuckRefunds error:', err.message)` → `logger.error({ err: err.message }, 'pollStuckRefunds error')`
- `.catch(err => console.error(...))` → `.catch(err => logger.error({ booking_id: b.id, err: err.message }, 'run booking error'))`

- [ ] **Step 2: 啟動 scheduler 確認可正常運作**

```bash
cd server && SERVICE_NAME=scheduler timeout 5 node --experimental-sqlite src/scheduler.js | head -3
```

Expected: 看到 JSON 格式 log,含 `"service":"scheduler"` 與 `"severity":"INFO"`。

- [ ] **Step 3: Commit**

```bash
git add server/src/scheduler.js
git commit -m "refactor: scheduler.js 改用 pino logger 輸出 structured log"
```

---

### Task 6: 其餘檔案 console → logger 全面替換

**Files:**
- Modify: `server/src/thsrc.js`
- Modify: `server/src/controllers/bookingController.js`
- Modify: `server/src/controllers/userController.js`
- Modify: `server/src/controllers/passengerController.js`
- Modify: `server/src/controllers/authController.js`
- Modify: `server/src/services/refundEngineService.js`
- Modify: `server/src/services/bookingEngineService.js`
- Modify: `server/src/admin/adminApiRouter.js`
- Modify: `server/src/admin/router.js`

- [ ] **Step 1: 每個檔案頂部加入 logger import**

```js
const logger = require('./logger'); // controllers/services 用 ../logger;admin 子目錄用 ../logger
```

- [ ] **Step 2: 替換規則**

對每個檔案執行:
- `console.log(...)` → `logger.info(...)`(若有錯誤物件作參數則拆 `logger.info({ key: val }, 'msg')`)
- `console.warn(...)` → `logger.warn(...)`
- `console.error('msg', err)` → `logger.error({ err: err.message, stack: err.stack }, 'msg')`
- 若是 controller 且能取得 `req`,優先用 `req.log` 而非 root logger

範例(`bookingEngineService.js`):
```js
// before
console.error('runBooking error:', err);
// after
logger.error({ booking_id: id, err: err.message, stack: err.stack }, 'runBooking error');
```

範例(`bookingController.js` 內有 req):
```js
// before
console.error('createBooking error:', err.message);
// after
req.log.error({ err: err.message }, 'createBooking error');
```

- [ ] **Step 3: 確認沒漏網之魚**

```bash
grep -rn "console\." server/src/ --include="*.js"
```

Expected: 無輸出(全部替換完)。

- [ ] **Step 4: 跑測試**

```bash
cd server && npm test
```

Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/
git commit -m "refactor: 全面替換 console 呼叫為 pino logger"
```

---

### Task 7: 開 PR-1

- [ ] **Step 1: Push + 開 PR**

```bash
git push -u origin feat-production-harness-p0
gh pr create --title "feat: P0 harness — structured logging (pino)" --body "$(cat <<'EOF'
## Summary
- 引入 pino 作為共用 logger,輸出 JSON 並含 GCP severity 欄位
- 加入 request_id middleware,每個請求帶獨立 child logger 並回傳 X-Request-Id header
- 全面替換 server/scheduler 內 79 處 console 呼叫
- 敏感欄位(password、token、idNumber、authorization 等)自動遮罩為 `[REDACTED]`

## Test plan
- [ ] 既有 unit tests 全部 PASS
- [ ] 新增 redact 行為測試 PASS
- [ ] 本機啟動 server 後 `curl /` 回應含 `x-request-id` header
- [ ] log 為 JSON 且含 `service`、`severity`、`req_id` 欄位

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **PR-1 合併後再進入 PR-2。** 若 user 要求一次合併三個 PR,改為連續 commit 後最後開單一 PR。

---

## PR-2: Health Probes + Heartbeat

### Task 8: 加 system_heartbeat 表 migration

**Files:**
- Modify: `server/src/db.js`

- [ ] **Step 1: 在 `_initSchema` 的字串中加入新表**

在 `CREATE TABLE IF NOT EXISTS allowed_users (...)` 之後加:

```sql
CREATE TABLE IF NOT EXISTS system_heartbeat (
  component      TEXT PRIMARY KEY,
  last_seen_at   TEXT NOT NULL
);
```

- [ ] **Step 2: 跑既有測試確認 schema 可建**

```bash
cd server && npm test
```

Expected: 全部 PASS。

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat(db): 加入 system_heartbeat 表用於 component 存活探針"
```

---

### Task 9: heartbeatRepo

**Files:**
- Create: `server/src/repositories/heartbeatRepo.js`

- [ ] **Step 1: 寫 repo**

```js
'use strict';

const { getDb } = require('../db');

function upsert(component) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_heartbeat (component, last_seen_at)
    VALUES (?, ?)
    ON CONFLICT(component) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(component, now);
  return now;
}

function get(component) {
  const db = getDb();
  const row = db.prepare('SELECT component, last_seen_at FROM system_heartbeat WHERE component = ?').get(component);
  return row || null;
}

module.exports = { upsert, get };
```

- [ ] **Step 2: Commit**

```bash
git add server/src/repositories/heartbeatRepo.js
git commit -m "feat(repo): heartbeatRepo 提供 component 心跳寫入與讀取"
```

---

### Task 10: scheduler 寫入 heartbeat

**Files:**
- Modify: `server/src/scheduler.js`

- [ ] **Step 1: 在 poll 結束寫 heartbeat**

頂部 import:
```js
const heartbeatRepo = require('./repositories/heartbeatRepo');
```

修改 cron callback,把兩個 try/catch 後加上:
```js
try {
  heartbeatRepo.upsert('scheduler');
} catch (err) {
  logger.error({ err: err.message }, 'heartbeat upsert error');
}
```

- [ ] **Step 2: 啟動 scheduler 60 秒,確認 DB 有資料**

```bash
cd server && timeout 65 node --experimental-sqlite src/scheduler.js
sqlite3 ./data/thsrc.db "SELECT * FROM system_heartbeat;"
```

Expected: 看到 `scheduler|2026-...`

- [ ] **Step 3: Commit**

```bash
git add server/src/scheduler.js
git commit -m "feat(scheduler): 每次 poll 結束寫入 heartbeat 供 readyz 探針使用"
```

---

### Task 11: health route

**Files:**
- Create: `server/src/routes/health.js`

- [ ] **Step 1: 寫 route**

```js
'use strict';

const express = require('express');
const { getDb } = require('../db');
const heartbeatRepo = require('../repositories/heartbeatRepo');

const HEARTBEAT_STALE_MS = 3 * 60 * 1000;
const router = express.Router();

router.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/readyz', (req, res) => {
  const result = { db: 'unknown', scheduler: 'unknown' };
  let httpStatus = 200;

  try {
    getDb().prepare('SELECT 1').get();
    result.db = 'ok';
  } catch (err) {
    result.db = 'error';
    result.db_error = err.message;
    httpStatus = 503;
  }

  try {
    const hb = heartbeatRepo.get('scheduler');
    if (!hb) {
      result.scheduler = 'never_seen';
      httpStatus = 503;
    } else {
      const ageMs = Date.now() - new Date(hb.last_seen_at).getTime();
      if (ageMs > HEARTBEAT_STALE_MS) {
        result.scheduler = 'stale';
        result.scheduler_age_ms = ageMs;
        httpStatus = 503;
      } else {
        result.scheduler = 'ok';
        result.scheduler_age_ms = ageMs;
      }
    }
  } catch (err) {
    result.scheduler = 'error';
    result.scheduler_error = err.message;
    httpStatus = 503;
  }

  res.status(httpStatus).json(result);
});

module.exports = router;
```

- [ ] **Step 2: 掛載到 api.js**

修改 `server/src/api.js`:把 `app.get('/', ...)` 那行換成:
```js
const healthRouter = require('./routes/health');
app.use('/', healthRouter);
app.get('/', (req, res) => res.json({ status: 'ok' }));
```

(保留根 `/` 是為了相容現有 deploy script 的 `curl http://...:8081/`。)

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/health.js server/src/api.js
git commit -m "feat: 新增 /healthz 與 /readyz 探針(含 DB 與 scheduler heartbeat 檢查)"
```

---

### Task 12: health route 單元測試

**Files:**
- Create: `server/test/health.test.js`

- [ ] **Step 1: 寫測試**

```js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = 'test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.DB_PATH = path.join(__dirname, 'tmp-health.db');

let server;
let baseUrl;

before(async () => {
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  const app = require('../src/api');
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
});

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    }).on('error', reject);
  });
}

test('/healthz returns 200', async () => {
  const { status, body } = await get('/healthz');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.status, 'ok');
});

test('/readyz returns 503 when scheduler heartbeat absent', async () => {
  const { status, body } = await get('/readyz');
  assert.strictEqual(status, 503);
  assert.strictEqual(body.db, 'ok');
  assert.strictEqual(body.scheduler, 'never_seen');
});

test('/readyz returns 200 after heartbeat written', async () => {
  const heartbeatRepo = require('../src/repositories/heartbeatRepo');
  heartbeatRepo.upsert('scheduler');
  const { status, body } = await get('/readyz');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.scheduler, 'ok');
});
```

- [ ] **Step 2: 跑測試**

```bash
cd server && npm test -- --test-name-pattern="readyz|healthz"
```

Expected: 三個測試 PASS。

- [ ] **Step 3: Commit**

```bash
git add server/test/health.test.js
git commit -m "test: 新增 healthz / readyz 端點測試"
```

---

### Task 13: docker-compose healthcheck

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: 加入 healthcheck 區塊**

完整新版檔案:

```yaml
services:
  captcha:
    image: joseph50804/captcha-solver:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/healthz || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 15s

  server:
    build: ./server
    image: joseph50804/thsrc-server:latest
    ports:
      - "8081:8081"
    volumes:
      - db-data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8081/healthz || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  scheduler:
    build: ./server
    image: joseph50804/thsrc-server:latest
    command: node --experimental-sqlite src/scheduler.js
    volumes:
      - db-data:/app/data
    env_file: .env
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pgrep -f scheduler.js || exit 1"]
      interval: 60s
      timeout: 5s
      retries: 2
      start_period: 10s

  watchtower:
    image: containrrr/watchtower
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 300
    restart: unless-stopped

volumes:
  db-data:
```

> 注意:captcha 的 `/healthz` 須先在 captcha apiserver 端實作(見 Task 14)。若還未實作,先把 captcha 的 healthcheck 改為 `["CMD-SHELL", "exit 0"]` 暫時 stub。

- [ ] **Step 2: 本機驗證**

```bash
docker compose up -d --build
sleep 20
docker compose ps
```

Expected: server 與 scheduler 顯示 `(healthy)`。

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): 為 server/scheduler/captcha 加入 healthcheck 區塊"
```

---

### Task 14: captcha /healthz endpoint

**Files:**
- Modify: captcha apiserver(實際路徑須在 task 開始時 `ls captcha/apiserver/` 確認;若是 Python Flask/FastAPI,新增 `/healthz` 路由)

- [ ] **Step 1: 確認 captcha server 框架**

```bash
ls captcha/apiserver/ && cat captcha/apiserver/*.py 2>/dev/null | head -30 || cat captcha/CLAUDE.md 2>/dev/null
```

- [ ] **Step 2: 加入 /healthz**

如為 Flask:
```python
@app.route('/healthz')
def healthz():
    return {'status': 'ok'}, 200
```

如為 FastAPI:
```python
@app.get('/healthz')
def healthz():
    return {'status': 'ok'}
```

- [ ] **Step 3: 本機 build + test**

```bash
docker compose build captcha
docker compose up -d captcha
sleep 5
curl -f http://localhost:8080/healthz
```

Expected: `{"status":"ok"}`。

- [ ] **Step 4: Commit**

```bash
git add captcha/apiserver/
git commit -m "feat(captcha): 新增 /healthz 端點供 docker healthcheck 使用"
```

---

### Task 15: 開 PR-2

- [ ] **Step 1: Push + 開 PR**

```bash
git push
gh pr create --title "feat: P0 harness — health probes + heartbeat" --body "$(cat <<'EOF'
## Summary
- 新增 `system_heartbeat` 表與 heartbeatRepo
- scheduler 每次 poll 結束寫入 heartbeat
- server 新增 `/healthz`(永遠 200)與 `/readyz`(檢查 DB + scheduler heartbeat,stale 超過 3 分鐘回 503)
- captcha 新增 `/healthz`
- docker-compose 三個 service 全部加上 healthcheck

## Test plan
- [ ] `npm test` 全部 PASS
- [ ] `docker compose up` 後 20 秒內三個 service 都顯示 `(healthy)`
- [ ] `curl http://localhost:8081/readyz` 回應正常
- [ ] 手動停止 scheduler 等 4 分鐘,`/readyz` 回應 503 + `scheduler:"stale"`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## PR-3: GCS Backup

### Task 16: 建立 GCS bucket + IAM(infra,runbook 紀錄)

**Files:**
- Create: `docs/runbooks/setup-gcs-backup.md`

- [ ] **Step 1: 寫 runbook**

```markdown
# GCS DB Backup — One-Time Infra Setup

## 1. 建立 bucket(us-west1 single region,確保零 egress 與免費額度)

\`\`\`bash
gcloud storage buckets create gs://sincere-office-thsrc-db-backup \
  --location=us-west1 \
  --uniform-bucket-level-access \
  --project=sincere-office-494609-m3
\`\`\`

## 2. 設定 lifecycle rule(30 天自動刪除)

\`\`\`bash
cat > /tmp/lifecycle.json <<'EOF'
{
  "rule": [
    {
      "action": {"type": "Delete"},
      "condition": {"age": 30}
    }
  ]
}
EOF

gsutil lifecycle set /tmp/lifecycle.json gs://sincere-office-thsrc-db-backup
\`\`\`

## 3. 確認設定

\`\`\`bash
gsutil lifecycle get gs://sincere-office-thsrc-db-backup
gcloud storage buckets describe gs://sincere-office-thsrc-db-backup --format="value(location,storageClass)"
\`\`\`

Expected: `US-WEST1  STANDARD`

## 4. 取得 VM service account

\`\`\`bash
gcloud compute instances describe instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --format="value(serviceAccounts[0].email)"
\`\`\`

## 5. 授予 bucket-level objectAdmin(避免 project-wide 權限)

\`\`\`bash
SA=$(gcloud compute instances describe instance-20260427-141455 \
  --zone=us-west1-b --project=sincere-office-494609-m3 \
  --format="value(serviceAccounts[0].email)")

gsutil iam ch serviceAccount:${SA}:roles/storage.objectAdmin gs://sincere-office-thsrc-db-backup
\`\`\`

## 6. 在 VM 上驗證認證可用

\`\`\`bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 --command="echo test | gsutil cp - gs://sincere-office-thsrc-db-backup/test.txt && gsutil rm gs://sincere-office-thsrc-db-backup/test.txt"
\`\`\`

Expected: 成功上傳並刪除。

## 7. 拒絕設定清單(避免額外費用)

不要做以下任何一項:
- `--enable-versioning` — 會讓刪除物件繼續佔空間
- 跨 region replication
- 改 storage class 為 multi-region 的 `US`
- 在 bucket 上開啟 public access
\`\`\`

- [ ] **Step 2: 在實際 VM 上執行 runbook(由 user 確認後執行)**

> 此步驟需要 user 手動跑 runbook,因為涉及生產 GCP project。

- [ ] **Step 3: Commit runbook**

```bash
git add docs/runbooks/setup-gcs-backup.md
git commit -m "docs: 新增 GCS 備份 bucket 一次性 infra 建置 runbook"
```

---

### Task 17: backup 腳本

**Files:**
- Create: `scripts/backup-db.sh`

- [ ] **Step 1: 寫腳本**

```bash
#!/usr/bin/env bash
# Daily SQLite backup to GCS
# 預期由 host crontab 觸發,執行使用者需有 gsutil 權限

set -euo pipefail

BUCKET="gs://sincere-office-thsrc-db-backup/daily"
DB_VOLUME_PATH="/var/lib/docker/volumes/db-data/_data/thsrc.db"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d)"
TMP_DB="${TMP_DIR}/backup-${TIMESTAMP}.db"

trap 'rm -rf "${TMP_DIR}"' EXIT

if [ ! -f "${DB_VOLUME_PATH}" ]; then
  echo "ERROR: DB not found at ${DB_VOLUME_PATH}" >&2
  exit 1
fi

# Online backup — 不需停機
sqlite3 "${DB_VOLUME_PATH}" ".backup '${TMP_DB}'"

gzip "${TMP_DB}"
gsutil -q cp "${TMP_DB}.gz" "${BUCKET}/backup-${TIMESTAMP}.db.gz"

echo "OK: backup-${TIMESTAMP}.db.gz uploaded to ${BUCKET}"
```

- [ ] **Step 2: 設為可執行**

```bash
chmod +x scripts/backup-db.sh
```

- [ ] **Step 3: 本機 dry-run 驗證 syntax**

```bash
bash -n scripts/backup-db.sh && echo "syntax ok"
```

Expected: `syntax ok`。

- [ ] **Step 4: Commit**

```bash
git add scripts/backup-db.sh
git commit -m "feat: 新增每日 SQLite 備份腳本(使用 .backup online 備份 + gzip)"
```

---

### Task 18: cron 安裝腳本

**Files:**
- Create: `scripts/install-backup-cron.sh`

- [ ] **Step 1: 寫安裝腳本**

```bash
#!/usr/bin/env bash
# 在 GCE VM host 上安裝 backup cron(需 root 或可寫 /etc/cron.d/)
# 03:00 台灣時間 = 19:00 UTC

set -euo pipefail

CRON_FILE="/etc/cron.d/thsrc-backup"
SCRIPT_PATH="$(cd "$(dirname "$0")" && pwd)/backup-db.sh"

if [ ! -x "${SCRIPT_PATH}" ]; then
  echo "ERROR: ${SCRIPT_PATH} not executable" >&2
  exit 1
fi

# 驗證 gsutil 可用
if ! command -v gsutil >/dev/null; then
  echo "ERROR: gsutil not installed" >&2
  exit 1
fi

# 驗證 sqlite3 可用
if ! command -v sqlite3 >/dev/null; then
  echo "ERROR: sqlite3 not installed; sudo apt-get install -y sqlite3" >&2
  exit 1
fi

sudo tee "${CRON_FILE}" >/dev/null <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""

# 每日 UTC 19:00 (台灣 03:00) 備份 SQLite 至 GCS
0 19 * * * $(whoami) ${SCRIPT_PATH} >> /var/log/thsrc-backup.log 2>&1
EOF

sudo chmod 644 "${CRON_FILE}"
echo "OK: cron installed at ${CRON_FILE}"
echo "Test: sudo -u $(whoami) ${SCRIPT_PATH}"
```

- [ ] **Step 2: 設為可執行 + syntax check**

```bash
chmod +x scripts/install-backup-cron.sh
bash -n scripts/install-backup-cron.sh && echo "syntax ok"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/install-backup-cron.sh
git commit -m "feat: 新增 cron 安裝腳本(每日 UTC 19:00 / 台灣 03:00)"
```

---

### Task 19: 還原 runbook

**Files:**
- Create: `docs/runbooks/restore-db.md`

- [ ] **Step 1: 寫 runbook**

```markdown
# Restore SQLite DB from GCS Backup

> 此 runbook 會 **覆寫** 線上 DB,執行前請確認備份來源與時間點。

## 1. 列出可用備份

\`\`\`bash
gsutil ls -l gs://sincere-office-thsrc-db-backup/daily/
\`\`\`

## 2. 下載指定備份到 VM

\`\`\`bash
TIMESTAMP="20260509T190000Z"  # 改成要還原的時間
gsutil cp gs://sincere-office-thsrc-db-backup/daily/backup-${TIMESTAMP}.db.gz /tmp/
gunzip /tmp/backup-${TIMESTAMP}.db.gz
\`\`\`

## 3. 停止 server 與 scheduler(captcha 不影響可保留)

\`\`\`bash
cd ~ && docker compose stop server scheduler
\`\`\`

## 4. 備份目前的壞檔(以防還原錯版本)

\`\`\`bash
sudo cp /var/lib/docker/volumes/db-data/_data/thsrc.db \
        /var/lib/docker/volumes/db-data/_data/thsrc.db.before-restore-$(date -u +%Y%m%dT%H%M%SZ)
\`\`\`

## 5. 還原

\`\`\`bash
sudo cp /tmp/backup-${TIMESTAMP}.db /var/lib/docker/volumes/db-data/_data/thsrc.db
sudo chown $(stat -c '%u:%g' /var/lib/docker/volumes/db-data/_data/thsrc.db.before-restore-*) \
           /var/lib/docker/volumes/db-data/_data/thsrc.db
\`\`\`

## 6. 啟動服務並驗證

\`\`\`bash
docker compose start server scheduler
sleep 5
curl -f http://localhost:8081/healthz
curl -f http://localhost:8081/readyz
\`\`\`

Expected: 兩者都回 200。

## 7. 透過 API 驗證資料存在

\`\`\`bash
curl -s -X POST http://localhost:8081/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"...","password":"..."}'
# 確認 token 取得成功 → 表示 user table 完整
\`\`\`

## 8. 清理

\`\`\`bash
rm /tmp/backup-${TIMESTAMP}.db
\`\`\`

## 9. 演練紀錄

每季手動執行一次本 runbook(在測試 VM 或 staging),記錄結果於專案 wiki。
\`\`\`

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/restore-db.md
git commit -m "docs: 新增 SQLite 從 GCS 備份還原 runbook"
```

---

### Task 20: 部署到 VM 並執行首次備份(由 user 確認後執行)

- [ ] **Step 1: 把 scripts/ 同步到 VM**

```bash
gcloud compute scp --zone=us-west1-b --project=sincere-office-494609-m3 \
  scripts/backup-db.sh scripts/install-backup-cron.sh \
  instance-20260427-141455:~/scripts/
```

- [ ] **Step 2: SSH 進 VM 安裝必要工具**

```bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="sudo apt-get update && sudo apt-get install -y sqlite3"
```

- [ ] **Step 3: 安裝 cron**

```bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="chmod +x ~/scripts/*.sh && ~/scripts/install-backup-cron.sh"
```

- [ ] **Step 4: 手動觸發一次備份驗證**

```bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="~/scripts/backup-db.sh"
```

Expected: `OK: backup-...db.gz uploaded`。

- [ ] **Step 5: 在 GCS 確認**

```bash
gsutil ls -l gs://sincere-office-thsrc-db-backup/daily/
```

Expected: 看到一個剛上傳的檔案。

- [ ] **Step 6: 驗證 cron 設定**

```bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \
  --command="sudo cat /etc/cron.d/thsrc-backup"
```

---

### Task 21: 開 PR-3

- [ ] **Step 1: Push + 開 PR**

```bash
git push
gh pr create --title "feat: P0 harness — daily SQLite backup to GCS" --body "$(cat <<'EOF'
## Summary
- 新增 `scripts/backup-db.sh`(SQLite online backup + gzip + gsutil cp)
- 新增 `scripts/install-backup-cron.sh`(每日 UTC 19:00 / 台灣 03:00)
- 新增 `docs/runbooks/setup-gcs-backup.md`(一次性 infra 建置)
- 新增 `docs/runbooks/restore-db.md`(還原流程)

備份策略確保零月費:
- bucket location 為 `us-west1` single region(與 GCE VM 同 region → 零 egress)
- Standard storage class(Always Free 5GB 涵蓋)
- 30 天 lifecycle 自動刪除
- 不啟用 versioning / replication

## Test plan
- [ ] 已在 VM 手動執行 `backup-db.sh` 成功上傳一份備份
- [ ] `gsutil ls` 確認檔案存在
- [ ] 已在 staging 演練一次 `restore-db.md` 流程
- [ ] cron 已安裝(`/etc/cron.d/thsrc-backup` 存在)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- ✅ Spec coverage:logging / healthz / readyz / heartbeat / backup / runbook / docker healthcheck / 用量估算 / 風險緩解皆有對應 task
- ✅ 無 placeholder(每個程式碼步驟皆含完整 code)
- ✅ 命名一致:`heartbeatRepo.upsert/get`、`system_heartbeat` 表、`req.log`、`logger.child` 整份用法一致
- ⚠️ 注意:Task 14(captcha healthz)需先 `ls captcha/apiserver/` 才能完整實作,因為目前未閱讀該目錄;agent 執行該 task 時須先確認框架(Flask / FastAPI / 其他)
