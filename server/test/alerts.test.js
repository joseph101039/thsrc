'use strict';

// /alerts/grafana endpoint + alertDispatcher 的 dedup / 邊緣事件 / race / 失敗回退邏輯測試。
// 不打真的 LINE — 用 require.cache 注入 stub 後再 require dispatcher。

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = 'test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.ALERT_WEBHOOK_TOKEN = 'test-alert-token-987';
process.env.DB_PATH = path.join(__dirname, 'tmp-alerts.db');
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'fake';
process.env.LINE_USER_ID = 'Ufake';

// Stub LINE pushText:用 require.cache 注入,並在 after() 清掉避免污染其他 test file
const pushCalls = [];
let pushFakeOk = true;
const lineNotifierPath = require.resolve('../src/services/lineNotifier');
require.cache[lineNotifierPath] = {
  id: lineNotifierPath,
  filename: lineNotifierPath,
  loaded: true,
  exports: {
    pushText: async (text) => {
      pushCalls.push(text);
      return pushFakeOk ? { ok: true } : { ok: false, reason: 'stub_failure' };
    },
  },
};

const dispatcher = require('../src/services/alertDispatcher');
const alertStateRepo = require('../src/repositories/alertStateRepo');

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
  // 不要洩 stub 到其他 test file
  delete require.cache[lineNotifierPath];
});

beforeEach(() => {
  pushCalls.length = 0;
  pushFakeOk = true;
  const { getDb } = require('../src/db');
  getDb().prepare('DELETE FROM alert_state').run();
});

function post(p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${baseUrl}${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
    }, (res) => {
      let resp = '';
      res.on('data', (c) => (resp += c));
      res.on('end', () => resolve({ status: res.statusCode, body: resp }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

const sampleFiringPayload = {
  status: 'firing',
  alerts: [{
    status: 'firing',
    fingerprint: 'abc123',
    labels: { alertname: 'HighErrorRate', severity: 'warning' },
    annotations: { summary: 'Error rate 高於 5%' },
    valueString: '0.087',
  }],
};

const sampleResolvedPayload = {
  status: 'resolved',
  alerts: [{
    status: 'resolved',
    fingerprint: 'abc123',
    labels: { alertname: 'HighErrorRate', severity: 'warning' },
    annotations: { summary: 'Error rate 高於 5%' },
  }],
};

test('/alerts/grafana 無 token → 401', async () => {
  const r = await post('/alerts/grafana', sampleFiringPayload);
  assert.strictEqual(r.status, 401);
});

test('/alerts/grafana 錯 token → 401', async () => {
  const r = await post('/alerts/grafana', sampleFiringPayload, { Authorization: 'Bearer wrong' });
  assert.strictEqual(r.status, 401);
});

test('/alerts/grafana 正確 token + firing → 200 + LINE pushed', async () => {
  const r = await post('/alerts/grafana', sampleFiringPayload, { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(pushCalls.length, 1);
  assert.match(pushCalls[0], /Firing.*HighErrorRate/s);
});

test('/alerts/grafana 空 alerts 陣列 → 200 processed:0', async () => {
  const r = await post('/alerts/grafana', { status: 'firing', alerts: [] }, { Authorization: `Bearer ${process.env.ALERT_WEBHOOK_TOKEN}` });
  assert.strictEqual(r.status, 200);
  assert.match(r.body, /"processed":0/);
  assert.strictEqual(pushCalls.length, 0);
});

test('handleWebhook: 同 alert 30min 內第二次 firing → dedup 不再 push', async () => {
  const now = Date.now();
  await dispatcher.handleWebhook(sampleFiringPayload, now);
  assert.strictEqual(pushCalls.length, 1);
  await dispatcher.handleWebhook(sampleFiringPayload, now + 5 * 60 * 1000);
  assert.strictEqual(pushCalls.length, 1, 'dedup 視窗內不應再 push');
});

test('handleWebhook: 29min 邊界仍 dedup', async () => {
  const now = Date.now();
  await dispatcher.handleWebhook(sampleFiringPayload, now);
  await dispatcher.handleWebhook(sampleFiringPayload, now + 29 * 60 * 1000);
  assert.strictEqual(pushCalls.length, 1);
});

test('handleWebhook: 過了 30min dedup 視窗 → 重推', async () => {
  const now = Date.now();
  await dispatcher.handleWebhook(sampleFiringPayload, now);
  assert.strictEqual(pushCalls.length, 1);
  await dispatcher.handleWebhook(sampleFiringPayload, now + 31 * 60 * 1000);
  assert.strictEqual(pushCalls.length, 2, '過 dedup 視窗應重推');
});

test('handleWebhook: firing → resolved 邊緣事件即時推', async () => {
  const now = Date.now();
  await dispatcher.handleWebhook(sampleFiringPayload, now);
  await dispatcher.handleWebhook(sampleResolvedPayload, now + 30 * 1000);
  assert.strictEqual(pushCalls.length, 2);
  assert.match(pushCalls[1], /Resolved.*HighErrorRate/s);
});

test('handleWebhook: firing → resolved → firing round-trip 都即時推(狀態邊緣)', async () => {
  const now = Date.now();
  await dispatcher.handleWebhook(sampleFiringPayload, now);
  await dispatcher.handleWebhook(sampleResolvedPayload, now + 60 * 1000);
  await dispatcher.handleWebhook(sampleFiringPayload, now + 120 * 1000);
  assert.strictEqual(pushCalls.length, 3);
});

test('handleWebhook: 多個不同 fingerprint 並行 push', async () => {
  const multiPayload = {
    status: 'firing',
    alerts: [
      { ...sampleFiringPayload.alerts[0], fingerprint: 'k1', labels: { alertname: 'A1' } },
      { ...sampleFiringPayload.alerts[0], fingerprint: 'k2', labels: { alertname: 'A2' } },
    ],
  };
  await dispatcher.handleWebhook(multiPayload, Date.now());
  assert.strictEqual(pushCalls.length, 2);
});

test('handleWebhook: pushText 失敗時 last_sent_at 仍為 null,下次 webhook 會重試', async () => {
  pushFakeOk = false;
  const now = Date.now();
  const r1 = await dispatcher.handleWebhook(sampleFiringPayload, now);
  assert.strictEqual(r1.failed, 1, 'first push failed');
  assert.strictEqual(r1.pushed, 0);
  // 確認 last_sent_at 仍未寫入
  const row = alertStateRepo.getByKey('abc123');
  assert.strictEqual(row.last_sent_at, null, 'failed push 不應留下 last_sent_at');
  // 下次重試應再嘗試 push(因為沒過 dedup,但 last_sent_at IS NULL → 視為從未推過)
  pushFakeOk = true;
  const r2 = await dispatcher.handleWebhook(sampleFiringPayload, now + 60 * 1000);
  assert.strictEqual(r2.pushed, 1, 'recovered push 應成功');
});

test('handleWebhook: 沒 fingerprint 走 labels-hash fallback,e2e 一致 dedup', async () => {
  const now = Date.now();
  const noFpPayload = {
    status: 'firing',
    alerts: [{
      status: 'firing',
      labels: { alertname: 'NoFp', severity: 'info' },
      annotations: { summary: 'no fingerprint' },
    }],
  };
  await dispatcher.handleWebhook(noFpPayload, now);
  await dispatcher.handleWebhook(noFpPayload, now + 60 * 1000);
  assert.strictEqual(pushCalls.length, 1, 'labels-hash 應產生穩定 key 觸發 dedup');
});

test('alertKeyOf: fingerprint 優先,沒 fingerprint 用 labels canonical hash', () => {
  assert.strictEqual(dispatcher.alertKeyOf({ fingerprint: 'fp1' }), 'fp1');
  // labels 順序不同但內容相同 → 應產生相同 key(canonical sort)
  const k1 = dispatcher.alertKeyOf({ labels: { a: '1', b: '2' } });
  const k2 = dispatcher.alertKeyOf({ labels: { b: '2', a: '1' } });
  assert.strictEqual(k1, k2, 'label key 順序不應影響 hash');
  const k3 = dispatcher.alertKeyOf({ labels: { a: '1', b: '3' } });
  assert.notStrictEqual(k1, k3);
});

test('formatAlert: 含 emoji + tag + summary', () => {
  const text = dispatcher.formatAlert(sampleFiringPayload.alerts[0], 'firing');
  assert.match(text, /🔥/);
  assert.match(text, /Firing/);
  assert.match(text, /HighErrorRate/);
  assert.match(text, /Error rate/);
});

test('alertStateRepo.tryClaim: 並發 caller 只一個 wins', () => {
  const now = '2026-05-11T00:00:00Z';
  const c1 = alertStateRepo.tryClaim({ alertKey: 'race', expectedLastSentAt: null, newLastStatus: 'firing', nowIso: now });
  const c2 = alertStateRepo.tryClaim({ alertKey: 'race', expectedLastSentAt: null, newLastStatus: 'firing', nowIso: now });
  assert.strictEqual(c1, true, 'first claim should succeed');
  assert.strictEqual(c2, false, 'second claim with same expectedLastSentAt=null should fail');
});

test('alertStateRepo.rollbackClaim: 失敗推送後可還原讓下次重試', () => {
  const now = '2026-05-11T00:00:00Z';
  alertStateRepo.tryClaim({ alertKey: 'rb', expectedLastSentAt: null, newLastStatus: 'firing', nowIso: now });
  alertStateRepo.rollbackClaim('rb', null);
  const row = alertStateRepo.getByKey('rb');
  assert.strictEqual(row.last_sent_at, null);
  // 下次 caller 應能再 claim
  const c2 = alertStateRepo.tryClaim({ alertKey: 'rb', expectedLastSentAt: null, newLastStatus: 'firing', nowIso: '2026-05-11T00:01:00Z' });
  assert.strictEqual(c2, true);
});
