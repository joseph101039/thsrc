# Production Harness P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P0 之後三件事:image versioning + rollback、metrics(Grafana Cloud)、alerting(LINE Messaging API + 5min 合併 / 30min 去重 + admin panel 管理)。

**Architecture:** PR-4 image versioning 與 PR-5 metrics 彼此獨立可並行;PR-6 alerting 依賴 PR-5(metrics 必須先上報才能寫 disk/CPU/memory alert rule)。

**Tech Stack:** Bash / docker buildx / git tag / Grafana Cloud(hosted Prometheus + Grafana + Alerting)/ Grafana Alloy / `prom-client` / Express / SQLite / LINE Messaging API

**Spec:** `docs/superpowers/specs/2026-05-10-production-harness-p1-design.md`

---

## File Structure

### PR-4: Image Versioning + Rollback
- **Modify** `server/deploy-server.sh` — 強制 SemVer bump 與雙 tag 推送
- **Create** `docs/runbooks/rollback-server.md` — rollback 流程
- **Create** `docs/runbooks/deploy-server.md` — 新部署流程(取代 README 隨手指令)
- **Create** git annotated tag `v0.1.0`(本 PR 完成時 cut)

### PR-5: Metrics(Grafana Cloud + Alloy + prom-client)
- **Create** `alloy/config.alloy` — Alloy 配置(node_exporter + cAdvisor + scrape server + remote_write)
- **Create** `server/src/middlewares/prometheusMetrics.js` — prom-client middleware
- **Create** `server/src/routes/metrics.js` — `/metrics` 端點(Bearer auth)
- **Create** `docs/runbooks/setup-grafana-cloud.md` — Grafana Cloud stack 申請 + token + dashboard import 步驟
- **Create** `docs/dashboards/thsrc-overview.json` — Grafana dashboard 匯出檔
- **Modify** `docker-compose.yml` — 新增 alloy service
- **Modify** `server/package.json` — 新增 `prom-client`
- **Modify** `server/src/api.js` — 掛載 metrics middleware + route

### PR-6: Alerting(LINE + admin panel + Grafana alert rules)
- **Create** `server/src/services/notifier.js` — LINE Messaging API 客戶端 + 合併 + 去重 buffer
- **Create** `server/src/routes/alerts.js` — `POST /alerts/grafana` webhook 接收
- **Create** `server/src/admin/views/alerts.html` — admin panel 告警管理 UI
- **Create** `server/src/admin/controllers/alertController.js` — `/admin/api/alerts/*` CRUD + sync
- **Create** `server/src/repositories/alertRepo.js` — `alert_settings` + `alert_rules` 讀寫
- **Create** `docs/runbooks/setup-line-bot.md` — LINE Developers Console 既有 channel 取得 token / user_id 流程
- **Create** `docs/runbooks/setup-grafana-alerts.md` — 申請 Grafana service account token、dashboard 匯出 + alert rules 同步流程
- **Modify** `scripts/backup-db.sh` — 失敗時直接 curl LINE push(不依賴 server)
- **Modify** `server/src/db.js` — `alert_settings` + `alert_rules` 表 schema(含初始種子)
- **Modify** `server/src/admin/router.js` — 掛載新頁面與 controller
- **Modify** `server/src/api.js` — 掛載 `/alerts/grafana` route(public,但有 shared secret)

---

## PR-4: Image Versioning + Rollback

### Task 1: 改寫 deploy-server.sh 支援 SemVer

**Files:**
- Modify: `server/deploy-server.sh`

- [ ] **Step 1: 把舊的 deploy script 改寫**

```bash
#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-joseph50804}"
IMAGE="${DOCKERHUB_USER}/thsrc-server"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# 解析 --bump=patch|minor|major(預設 patch)
BUMP="${1:-patch}"
case "${BUMP}" in
  patch|minor|major) ;;
  *) echo "Usage: $0 [patch|minor|major]" >&2; exit 1 ;;
esac

# 強制 working tree clean(避免推未提交的程式)
if ! git -C "${REPO_ROOT}" diff --quiet || ! git -C "${REPO_ROOT}" diff --cached --quiet; then
  echo "ERROR: working tree has uncommitted changes" >&2
  exit 1
fi

# 取最新 SemVer tag,計算下一個
LATEST="$(git -C "${REPO_ROOT}" tag -l 'v*' | sort -V | tail -1 || echo 'v0.0.0')"
LATEST="${LATEST#v}"
IFS='.' read -r MAJ MIN PAT <<<"${LATEST}"
case "${BUMP}" in
  patch) NEXT="v${MAJ}.${MIN}.$((PAT+1))" ;;
  minor) NEXT="v${MAJ}.$((MIN+1)).0" ;;
  major) NEXT="v$((MAJ+1)).0.0" ;;
esac

echo "[部署] 從 v${LATEST} bump ${BUMP} → ${NEXT}"

# Build + push 兩個 tag
docker buildx build \
  --platform linux/amd64 \
  -t "${IMAGE}:${NEXT}" \
  -t "${IMAGE}:latest" \
  --push \
  "${SCRIPT_DIR}"

# Push git tag
git -C "${REPO_ROOT}" tag -a "${NEXT}" -m "deploy: $(git -C "${REPO_ROOT}" log -1 --format='%s')"
git -C "${REPO_ROOT}" push origin "${NEXT}"

echo "[完成] ${IMAGE}:${NEXT} 與 :latest 已推送"
echo "       Watchtower 將在 5 分鐘內拉新 latest"
```

- [ ] **Step 2: syntax check**

```bash
bash -n server/deploy-server.sh && echo "ok"
```

- [ ] **Step 3: 在 main 上 cut 第一個 tag v0.1.0(代表 P0 已完成的狀態)**

```bash
git checkout main && git pull
git tag -a v0.1.0 -m "P0 production harness complete (logging + probes + backup)"
git push origin v0.1.0
```

注意:**v0.1.0 在 commit 本 PR 之前就先打**,這樣本 PR 自己 deploy 時會 bump 成 v0.2.0。

---

### Task 2: 寫 rollback runbook

**Files:**
- Create: `docs/runbooks/rollback-server.md`

- [ ] **Step 1: 內容**

```markdown
# Rollback server image

> 適用情境:剛部署的版本壞了,需要回到上一版。captcha image 用 `apiserver/deploy-gce.sh` 走另一條路線,本 runbook 不涵蓋。

## 1. 找出要回到的版本

\`\`\`bash
# 列出最近 10 個 tag
git tag -l 'v*' | sort -V | tail -10
# 或直接從 Docker Hub 看
gcloud auth print-access-token  # 若需 docker login
docker search joseph50804/thsrc-server
\`\`\`

## 2. 把目標 tag 重新標成 latest 推回

\`\`\`bash
TARGET="v0.2.0"  # 改成你要回到的版本
docker pull joseph50804/thsrc-server:${TARGET}
docker tag joseph50804/thsrc-server:${TARGET} joseph50804/thsrc-server:latest
docker push joseph50804/thsrc-server:latest
\`\`\`

## 3. 立即生效(等不到 watchtower 5 分鐘)

\`\`\`bash
gcloud compute ssh instance-20260427-141455 --zone=us-west1-b --project=sincere-office-494609-m3 \\
  --command="cd ~ && docker compose pull server && docker compose up -d server"
\`\`\`

## 4. 驗證

\`\`\`bash
curl https://api.joseph101039.uk/healthz
curl https://api.joseph101039.uk/readyz
\`\`\`

## 5. 清理(視情況)

如果要把壞掉的 tag 從 Docker Hub 移除,在 Docker Hub UI 操作。Git tag 通常保留作為紀錄。
```

- [ ] **Step 2: Commit**

---

### Task 3: 寫 deploy runbook(取代 README 隨手指令)

**Files:**
- Create: `docs/runbooks/deploy-server.md`

- [ ] **Step 1: 內容大綱**

```markdown
# Deploy server image

## 前置條件
- working tree clean
- `git pull origin main` 已同步
- 你有 Docker Hub push 權限 + git push 權限

## 部署
\`\`\`bash
# patch bump (default,bug fix / docs / refactor)
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh

# minor bump (新功能)
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh minor

# major bump (breaking change)
DOCKERHUB_USER=joseph50804 bash server/deploy-server.sh major
\`\`\`

## SemVer 規則
- MAJOR — Breaking change(API 異動、DB schema 不向後相容、env var 改名)
- MINOR — 新功能
- PATCH — Bug fix / docs / refactor / 觀測性

## 部署後
- watchtower 5 分鐘內自動 pull,或執行 \`docker compose pull && up -d server\` 立即生效
- 驗證 \`/healthz\` 與 \`/readyz\` 回 200
- 看 server log 確認啟動正常

## Rollback
見 \`rollback-server.md\`。
```

- [ ] **Step 2: Commit**

---

### Task 4: PR-4 開 PR

- [ ] **Step 1: Push + 開 PR**

```bash
git push -u origin feat-image-versioning
gh pr create --title "feat: P1 image versioning + rollback (PR-4)" --body "..."
```

PR description 要點:SemVer 規則、Rollback 流程連結到 runbook、首個 tag v0.1.0 已 cut。

---

## PR-5: Metrics(Grafana Cloud + Alloy + prom-client)

### Task 5: 申請 Grafana Cloud stack(由 user 操作)

**Files:**
- Create: `docs/runbooks/setup-grafana-cloud.md`

- [ ] **Step 1: 寫 setup runbook**

涵蓋:
- 註冊 grafana.com → Free tier(no credit card)
- 建 stack(region us-east)
- 取得 Prometheus remote_write endpoint URL + username + token(從 Stack → Connections → Hosted Prometheus → Grafana Agent)
- 取得 Loki / Grafana 對應資訊(本 PR 不送 log,可略過)
- 把 endpoint / username / token 寫入 VM 上 `~/alloy.env`(0600,git ignore)

```env
GRAFANA_PROM_URL=https://prometheus-prod-...grafana.net/api/prom/push
GRAFANA_PROM_USER=12345
GRAFANA_PROM_TOKEN=glc_xxxxxxxx
```

- [ ] **Step 2: 由 user 在實際帳號上跑 runbook**(本步驟不在 agent 範圍)
- [ ] **Step 3: Commit runbook**

---

### Task 6: 安裝 prom-client + 建 metrics middleware

**Files:**
- Modify: `server/package.json`
- Create: `server/src/middlewares/prometheusMetrics.js`
- Create: `server/src/routes/metrics.js`

- [ ] **Step 1: 安裝**

```bash
cd server && npm install prom-client@^15
```

- [ ] **Step 2: middleware 內容**

```js
// server/src/middlewares/prometheusMetrics.js
'use strict';
const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({ register });

const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'],
  buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

const bookingsTotal = new client.Counter({
  name: 'bookings_total',
  help: 'Total booking attempts by outcome',
  labelNames: ['outcome'],   // 'success' | 'retry' | 'failed'
  registers: [register],
});

const captchaSolverDuration = new client.Histogram({
  name: 'captcha_solver_duration_seconds',
  help: 'Captcha solver POST /solve duration',
  buckets: [0.05, 0.1, 0.3, 1, 3, 10],
  registers: [register],
});

function middleware(req, res, next) {
  const end = httpRequestDuration.startTimer({ method: req.method, route: req.route?.path || req.path });
  res.on('finish', () => {
    const route = req.route?.path || req.path;
    httpRequestsTotal.inc({ method: req.method, route, status_code: res.statusCode });
    end({ method: req.method, route });
  });
  next();
}

module.exports = { middleware, register, bookingsTotal, captchaSolverDuration };
```

- [ ] **Step 3: route 內容(`/metrics` 端點 + Bearer auth)**

```js
// server/src/routes/metrics.js
'use strict';
const express = require('express');
const { register } = require('../middlewares/prometheusMetrics');
const router = express.Router();

const TOKEN = process.env.METRICS_BEARER_TOKEN;
if (!TOKEN) {
  throw new Error('METRICS_BEARER_TOKEN env var required');
}

router.get('/metrics', async (req, res) => {
  if (req.headers.authorization !== `Bearer ${TOKEN}`) {
    return res.status(401).send('unauthorized');
  }
  res.set('Content-Type', register.contentType);
  res.send(await register.metrics());
});

module.exports = router;
```

- [ ] **Step 4: 掛到 api.js**

```js
const metricsRouter = require('./routes/metrics');
const { middleware: metricsMiddleware } = require('./middlewares/prometheusMetrics');

app.use(metricsMiddleware);    // 必須在路由之前以涵蓋全部請求
app.use('/', metricsRouter);   // /metrics 端點
```

- [ ] **Step 5: bookingEngineService 內 emit metric**

成功 / retry / failed 各 emit 一次 `bookingsTotal.inc({ outcome })`。

- [ ] **Step 6: 啟動 server,驗證**

```bash
JWT_SECRET=t GOOGLE_CLIENT_ID=t METRICS_BEARER_TOKEN=test \
  node --experimental-sqlite server/src/api.js &
curl -H "Authorization: Bearer test" http://localhost:8081/metrics | grep http_requests_total
```

預期看到 prom-format 輸出。

---

### Task 7: 加 alloy service 到 docker-compose

**Files:**
- Create: `alloy/config.alloy`
- Modify: `docker-compose.yml`

- [ ] **Step 1: alloy/config.alloy 內容**

```alloy
// node_exporter:host metrics
prometheus.exporter.unix "host" {
  rootfs_path = "/host/rootfs"
  procfs_path = "/host/proc"
  sysfs_path  = "/host/sys"
}

prometheus.scrape "host" {
  targets    = prometheus.exporter.unix.host.targets
  forward_to = [prometheus.remote_write.grafana.receiver]
}

// cAdvisor: container metrics
prometheus.exporter.cadvisor "containers" {
  docker_host = "unix:///var/run/docker.sock"
}

prometheus.scrape "containers" {
  targets    = prometheus.exporter.cadvisor.containers.targets
  forward_to = [prometheus.remote_write.grafana.receiver]
}

// Server application metrics
prometheus.scrape "server" {
  targets = [{
    __address__ = "server:8081",
    __metrics_path__ = "/metrics",
    job = "server",
  }]
  authorization {
    type        = "Bearer"
    credentials = sys.env("SERVER_METRICS_TOKEN")
  }
  forward_to = [prometheus.remote_write.grafana.receiver]
}

prometheus.remote_write "grafana" {
  endpoint {
    url = sys.env("GRAFANA_PROM_URL")
    basic_auth {
      username = sys.env("GRAFANA_PROM_USER")
      password = sys.env("GRAFANA_PROM_TOKEN")
    }
  }
}
```

- [ ] **Step 2: docker-compose.yml 加 alloy service**

```yaml
alloy:
  image: grafana/alloy:latest
  volumes:
    - /:/host/rootfs:ro,rslave
    - /sys:/host/sys:ro,rslave
    - /proc:/host/proc:ro,rslave
    - /var/run/docker.sock:/var/run/docker.sock:ro
    - ./alloy/config.alloy:/etc/alloy/config.alloy:ro
  env_file: alloy.env
  command: run /etc/alloy/config.alloy --server.http.listen-addr=0.0.0.0:12345
  restart: unless-stopped
  mem_limit: 128m
```

- [ ] **Step 3: 本地 docker compose up alloy 驗證**

```bash
GRAFANA_PROM_URL=https://prometheus-...net/api/prom/push \
GRAFANA_PROM_USER=12345 \
GRAFANA_PROM_TOKEN=glc_test \
SERVER_METRICS_TOKEN=test \
docker compose up -d alloy

docker logs thsrc-alloy-1 | grep -E "ready|listen"
```

預期 alloy 成功啟動;remote_write 若 token 假會看到 401 但 alloy 本身 healthy。

---

### Task 8: 匯出 Grafana dashboard JSON 並 commit

**Files:**
- Create: `docs/dashboards/thsrc-overview.json`

- [ ] **Step 1: 在 Grafana Cloud UI 建 dashboard**

涵蓋面板:
- Host:CPU、RAM、Disk、Network I/O
- Containers:per-container RAM(captcha / server / scheduler / alloy)
- Server:RPS、p50/p95/p99 latency、5xx count、bookings success rate
- Scheduler:heartbeat age

- [ ] **Step 2: 從 Dashboard settings → JSON model 匯出整份 JSON**
- [ ] **Step 3: Commit 到 `docs/dashboards/thsrc-overview.json`**

---

### Task 9: PR-5 開 PR

- [ ] **Step 1: Push + 開 PR(包含 setup runbook + dashboard JSON + alloy config + server changes)**

PR description 要點:Free tier 用量、import dashboard 流程、本地驗證結果、VM 部署需 user 提供 alloy.env。

---

## PR-6: Alerting(LINE + admin panel + Grafana alert rules)

### Task 10: alert_settings + alert_rules schema

**Files:**
- Modify: `server/src/db.js`
- Create: `server/src/repositories/alertRepo.js`

- [ ] **Step 1: db.js 加 schema 與初始種子**

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS alert_settings (
    id                          INTEGER PRIMARY KEY CHECK (id = 1),
    enabled                     INTEGER NOT NULL DEFAULT 1,
    aggregation_window_seconds  INTEGER NOT NULL DEFAULT 300,
    dedup_window_seconds        INTEGER NOT NULL DEFAULT 1800,
    monthly_quota               INTEGER NOT NULL DEFAULT 180,
    last_synced_at              TEXT,
    updated_at                  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alert_rules (
    name           TEXT PRIMARY KEY,
    enabled        INTEGER NOT NULL DEFAULT 1,
    threshold_json TEXT,
    updated_at     TEXT NOT NULL
  );

  INSERT OR IGNORE INTO alert_settings (id, updated_at) VALUES (1, datetime('now'));
  INSERT OR IGNORE INTO alert_rules (name, threshold_json, updated_at) VALUES
    ('backup_failed', NULL,                       datetime('now')),
    ('backup_stale',  '{"hours":24}',             datetime('now')),
    ('disk_high',     '{"percent":85}',           datetime('now')),
    ('memory_low',    '{"available_mb":100}',     datetime('now')),
    ('cpu_high',      '{"percent":90,"minutes":10}', datetime('now')),
    ('readyz_down',   '{"minutes":5}',            datetime('now'));
`);
```

- [ ] **Step 2: alertRepo.js 提供 CRUD**

提供:`getSettings()`、`updateSettings(partial)`、`listRules()`、`updateRule(name, partial)`、`bumpLastSyncedAt()`、`getMonthlyPushCount()`(從 SQLite query 統計;見 Task 11 的 `alert_push_log` 表)。

---

### Task 11: notifier 服務(LINE + 合併 + 去重)

**Files:**
- Create: `server/src/services/notifier.js`
- Modify: `server/src/db.js`(加 `alert_push_log` 表用於統計月度)

- [ ] **Step 1: db.js 加表**

```sql
CREATE TABLE IF NOT EXISTS alert_push_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_name  TEXT NOT NULL,
  pushed_at   TEXT NOT NULL,
  message     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alert_push_log_pushed_at ON alert_push_log (pushed_at);
```

- [ ] **Step 2: notifier.js 結構**

```js
'use strict';
const fetch = require('node-fetch');
const logger = require('../logger').child({ component: 'notifier' });
const alertRepo = require('../repositories/alertRepo');

const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

// in-memory state
const pending = new Map();   // alert_name → { messages: [...], firstAt, timer }
const lastPushedAt = new Map(); // alert_name → epoch ms

async function fire({ alert_name, severity, message }) {
  const settings = alertRepo.getSettings();
  const rule = alertRepo.getRule(alert_name);

  if (!settings.enabled) {
    logger.warn({ alert_name }, 'alerts globally disabled, skipping');
    return;
  }
  if (!rule || !rule.enabled) {
    logger.warn({ alert_name }, 'rule disabled, skipping');
    return;
  }

  // Dedup window
  const last = lastPushedAt.get(alert_name) || 0;
  if (Date.now() - last < settings.dedup_window_seconds * 1000) {
    logger.info({ alert_name }, 'within dedup window, append to pending');
    appendToPending(alert_name, severity, message, settings);
    return;
  }

  // Aggregation
  appendToPending(alert_name, severity, message, settings);
}

function appendToPending(alert_name, severity, message, settings) {
  if (!pending.has(alert_name)) {
    pending.set(alert_name, { messages: [], firstAt: Date.now(), timer: null });
  }
  const slot = pending.get(alert_name);
  slot.messages.push({ severity, message, at: new Date().toISOString() });

  if (!slot.timer) {
    slot.timer = setTimeout(() => flush(alert_name), settings.aggregation_window_seconds * 1000);
  }
}

async function flush(alert_name) {
  const slot = pending.get(alert_name);
  if (!slot) return;
  pending.delete(alert_name);

  const settings = alertRepo.getSettings();
  const monthly = alertRepo.getMonthlyPushCount();
  if (monthly >= settings.monthly_quota) {
    logger.error({ alert_name, monthly, quota: settings.monthly_quota }, 'MONTHLY QUOTA EXCEEDED, dropping push');
    return;
  }

  const text = formatLineMessage(alert_name, slot.messages);
  await sendLine(text);
  lastPushedAt.set(alert_name, Date.now());
  alertRepo.logPush(alert_name, text);
}

function formatLineMessage(alert_name, messages) {
  const header = `🚨 [${alert_name}] ${messages.length} 個事件 (${new Date().toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})})`;
  const body = messages.map(m => `• [${m.severity}] ${m.message}`).join('\n');
  return `${header}\n${body}`;
}

async function sendLine(text) {
  const token = process.env.LINE_CHANNEL_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId) {
    logger.error('LINE_CHANNEL_TOKEN / LINE_USER_ID not set');
    return;
  }
  const res = await fetch(LINE_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text }] }),
  });
  if (!res.ok) {
    logger.error({ status: res.status, body: await res.text() }, 'LINE push failed');
  }
}

module.exports = { fire };
```

- [ ] **Step 3: notifier 單元測試(mock fetch + fake timers)**

`server/test/notifier.test.js` 涵蓋:
- 第一筆訊息進 pending,5 min 後 flush(用 `node:test` mock timers)
- 30 min 內第二筆同名 alert 不立即 push,合進 pending
- 30 min 後第二筆 alert 觸發 flush,符合預期格式
- 月度 quota 超出時不送
- enabled=false 時不進 pending

---

### Task 12: `/alerts/grafana` webhook route

**Files:**
- Create: `server/src/routes/alerts.js`
- Modify: `server/src/api.js`

- [ ] **Step 1: route 內容**

```js
'use strict';
const express = require('express');
const notifier = require('../services/notifier');
const router = express.Router();

const SECRET = process.env.ALERT_WEBHOOK_SECRET;
if (!SECRET) {
  throw new Error('ALERT_WEBHOOK_SECRET env var required');
}

router.post('/alerts/grafana', express.json(), (req, res) => {
  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    return res.status(401).send('unauthorized');
  }

  const { alerts = [] } = req.body || {};
  for (const a of alerts) {
    notifier.fire({
      alert_name: a.labels?.alertname || 'unknown',
      severity:   a.labels?.severity   || 'warning',
      message:    a.annotations?.summary || a.annotations?.description || JSON.stringify(a),
    });
  }
  res.json({ accepted: alerts.length });
});

module.exports = router;
```

- [ ] **Step 2: 掛到 api.js**

```js
const alertsRouter = require('./routes/alerts');
app.use('/', alertsRouter);
```

- [ ] **Step 3: 整合測試**

```bash
curl -X POST http://localhost:8081/alerts/grafana \
  -H "Authorization: Bearer ${ALERT_WEBHOOK_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"alerts":[{"labels":{"alertname":"disk_high","severity":"warning"},"annotations":{"summary":"disk 90%"}}]}'
```

預期 200 + LINE 收到一則訊息(若已設好 LINE env)。

---

### Task 13: backup-db.sh 失敗時 LINE push

**Files:**
- Modify: `scripts/backup-db.sh`

- [ ] **Step 1: 在現有 script 結尾加 trap**

```bash
on_failure() {
  local exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    local hostname="$(hostname)"
    local message="🚨 [backup_failed] backup-db.sh exited ${exit_code} on ${hostname} at $(date -u +%FT%TZ)"
    if [ -n "${LINE_CHANNEL_TOKEN:-}" ] && [ -n "${LINE_USER_ID:-}" ]; then
      curl -sS -X POST https://api.line.me/v2/bot/message/push \
        -H "Authorization: Bearer ${LINE_CHANNEL_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg to "${LINE_USER_ID}" --arg t "${message}" \
              '{to:$to, messages:[{type:"text",text:$t}]}')" >/dev/null || true
    fi
  fi
}
trap on_failure EXIT
```

注意:**獨立於 server,不依賴 server 在線**。LINE token 從 cron 環境變數讀(install-backup-cron.sh 加 EnvironmentFile)。

- [ ] **Step 2: 修改 install-backup-cron.sh 注入 LINE env**

cron file 的環境變數段加上:

```
LINE_CHANNEL_TOKEN=...   # 由 install 時從外部 env 讀,不寫死在 script
LINE_USER_ID=...
```

實作上 install script 從 user 環境變數複製到 cron file:

```bash
LINE_CHANNEL_TOKEN="${LINE_CHANNEL_TOKEN:?LINE_CHANNEL_TOKEN env required}"
LINE_USER_ID="${LINE_USER_ID:?LINE_USER_ID env required}"

sudo tee "${CRON_FILE}" >/dev/null <<EOF
SHELL=/bin/bash
PATH=...:/snap/bin:${GSUTIL_DIR}
LINE_CHANNEL_TOKEN=${LINE_CHANNEL_TOKEN}
LINE_USER_ID=${LINE_USER_ID}
MAILTO=""

0 19 * * * ${RUN_USER} ${SCRIPT_PATH} >> ${LOG_PATH} 2>&1
EOF
```

- [ ] **Step 3: 故意觸發失敗測試 LINE push**

把 BACKUP_DB_PATH 改成不存在的路徑跑一次,確認 LINE 收到訊息。

---

### Task 14: admin panel 告警管理頁面

**Files:**
- Create: `server/src/admin/views/alerts.html`
- Create: `server/src/admin/controllers/alertController.js`
- Modify: `server/src/admin/router.js`

- [ ] **Step 1: alertController.js**

提供 endpoints:
- `GET  /admin/api/alerts/settings` — 全域設定
- `PUT  /admin/api/alerts/settings` — 更新全域(body: 部分 update)
- `GET  /admin/api/alerts/rules` — 規則 list(含本月觸發次數,從 alert_push_log 統計)
- `PUT  /admin/api/alerts/rules/:name` — 更新單一規則(enabled / threshold_json)
- `POST /admin/api/alerts/sync` — 同步 alert rules 到 Grafana Cloud(見 Task 16)
- `POST /admin/api/alerts/test` — 觸發一次 test push 驗證 LINE 連通

權限:延用既有 admin session middleware。

- [ ] **Step 2: alerts.html UI**

依 spec 中 ASCII mockup 實作。Vanilla JS,不引入 framework。

- [ ] **Step 3: 掛載**

```js
// admin/router.js 內
router.get('/alerts', requireSession, (req, res) => res.sendFile('alerts.html', { root: __dirname + '/views' }));
router.use('/api/alerts', requireSession, alertController);
```

- [ ] **Step 4: 整合測試**(瀏覽器手動)

走一遍:打開頁面、改 disk 閾值為 80、按 sync、看 Grafana Cloud rule 變動、按 test 看 LINE 收到。

---

### Task 15: Grafana alert rules + 同步 endpoint

**Files:**
- Create: `docs/runbooks/setup-grafana-alerts.md`
- Modify: `server/src/admin/controllers/alertController.js`(`/admin/api/alerts/sync` 實作)

- [ ] **Step 1: 寫 runbook**

涵蓋:
- 在 Grafana Cloud 建 service account + token(`Alerts: Editor`)
- 在 Grafana → Alerting → Contact points 建一個 webhook contact point 指向 `https://api.joseph101039.uk/alerts/grafana`,header 加 `Authorization: Bearer ${ALERT_WEBHOOK_SECRET}`
- 在 Notification policies 把所有規則 default route 到此 contact point
- 把 service account token + alert API URL 寫進 server `.env`(`GRAFANA_API_URL`、`GRAFANA_SA_TOKEN`)

- [ ] **Step 2: sync endpoint 實作**

```js
async function syncToGrafana(req, res) {
  const rules = alertRepo.listRules().filter(r => r.enabled);
  const groups = rules.map(r => buildAlertRuleGroup(r));   // 把每條 rule 轉成 Grafana provisioning JSON
  const url = `${process.env.GRAFANA_API_URL}/api/v1/provisioning/alert-rules`;

  // 先刪除既有 thsrc-* rules,再 PUT 新的(避免刪掉 user 在 UI 加的其他規則)
  // ... 略,參考 Grafana provisioning API docs
  alertRepo.bumpLastSyncedAt();
  res.json({ ok: true, synced: groups.length });
}

function buildAlertRuleGroup(rule) {
  switch (rule.name) {
    case 'disk_high': {
      const { percent } = JSON.parse(rule.threshold_json);
      return {
        title: 'thsrc-disk-high',
        condition: 'C',
        data: [/* PromQL query: 100 - (node_filesystem_avail/size * 100) > percent */],
        // ...
      };
    }
    // ... cpu_high, memory_low, readyz_down, backup_stale
  }
}
```

注意:具體 alert rule JSON schema 需要參考 Grafana Cloud provisioning API 文件,可能在實作時需做一次 GET + 改 + PUT 的 round-trip 確認 schema。

- [ ] **Step 3: Manual sync 驗證**

按 admin panel 「同步」按鈕 → 看 Grafana UI Alerting → Alert rules,有 thsrc-* 規則出現。

---

### Task 16: setup-line-bot.md runbook

**Files:**
- Create: `docs/runbooks/setup-line-bot.md`

- [ ] **Step 1: 內容**

```markdown
# LINE Bot 設定(取得 push 用 token + user_id)

## 1. 在 LINE Developers Console 確認 channel

LINE Developers Console → 既有 channel(Messaging API)→ Basic settings

- 取得 **Channel access token**(Long-lived):Messaging API tab → Channel access token
- 取得 **User ID**:把自己加為 channel 好友後,從 channel 的 webhook event 收到的 user_id 抄出來;或在 LINE Official Account Manager → Settings → Response settings 開啟 webhook + 接收一則訊息

## 2. 寫進 .env

\`\`\`env
LINE_CHANNEL_TOKEN=...
LINE_USER_ID=Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

## 3. 測試 push

\`\`\`bash
curl -X POST https://api.line.me/v2/bot/message/push \\
  -H "Authorization: Bearer ${LINE_CHANNEL_TOKEN}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"to\\":\\"${LINE_USER_ID}\\",\\"messages\\":[{\\"type\\":\\"text\\",\\"text\\":\\"test\\"}]}"
\`\`\`

收到 LINE 即代表 OK。
```

---

### Task 17: PR-6 開 PR

- [ ] **Step 1: Push + 開 PR**

PR description 要點:三個 runbook、admin panel 截圖、單元測試覆蓋率、月度 quota 機制、test push endpoint 用法。

---

## Self-Review Notes

- ✅ Spec coverage:image versioning / metrics / alerting / admin panel / 合併去重 / 月度 quota / 同步按鈕 / runbook 都有對應 task
- ✅ 三個 PR 切分清楚,PR-4 與 PR-5 可並行,PR-6 依賴 PR-5
- ⚠️ Task 15 `buildAlertRuleGroup` 具體 JSON schema 需在實作時參考 Grafana provisioning API 文件,目前 plan 留 placeholder;實作 agent 應先 GET 一次 Grafana 既有 rule 看真實結構再寫
- ⚠️ Task 14 admin UI 用 vanilla JS 不引入 framework — 與既有 sqladmin 風格一致;若實作時發現需要 reactivity,可以選擇加 Alpine.js(輕量 ~10KB)
- ⚠️ Task 13 install-backup-cron.sh 改動會影響 P0 cron;部署時要重跑一次 install
