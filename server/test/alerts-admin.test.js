'use strict';

// PR-6b /v1/alerts/rules controller 測試。
// 用 monkey-patch 把 grafanaApi 換成 stub,不打真的 Grafana。

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = 'test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.DB_PATH = path.join(__dirname, 'tmp-alerts-admin.db');
process.env.GRAFANA_API_URL = 'https://grafana.test';
process.env.GRAFANA_API_TOKEN = 'fake';

const grafanaApi = require('../src/services/grafanaApi');
const alertsController = require('../src/controllers/alertsController');

// Stub Grafana API
let listOutcome = { ok: true, rules: [] };
let pauseOutcome = { ok: true, uid: '', isPaused: false };
let listCalls = 0;
let pauseCalls = [];

const _origList = grafanaApi.listAlertRules;
const _origPause = grafanaApi.pauseAlertRule;
grafanaApi.listAlertRules = async () => { listCalls++; return listOutcome; };
grafanaApi.pauseAlertRule = async (uid, paused) => { pauseCalls.push({ uid, paused }); return pauseOutcome; };

function _cleanDb() {
  for (const ext of ['', '-shm', '-wal']) {
    const p = process.env.DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

before(() => {
  _cleanDb();
  require('../src/db').getDb();
});

after(() => {
  _cleanDb();
  grafanaApi.listAlertRules = _origList;
  grafanaApi.pauseAlertRule = _origPause;
});

beforeEach(() => {
  listCalls = 0;
  pauseCalls = [];
  listOutcome = { ok: true, rules: [] };
  pauseOutcome = { ok: true, uid: '', isPaused: false };
  alertsController._clearCache();
});

function fakeReqRes(opts = {}) {
  let _status = 200;
  let _payload = null;
  return {
    req: { params: opts.params || {}, body: opts.body || {}, log: { error: () => {} } },
    res: {
      status(c) { _status = c; return this; },
      json(p) { _payload = p; return this; },
      _get() { return { status: _status, body: _payload }; },
    },
  };
}

// ─── listRules ─────────────────────────────────────────

test('GET rules: 回精簡 slim fields(uid/title/isPaused/severity/...)', async () => {
  listOutcome = {
    ok: true, rules: [
      { uid: 'u1', title: 'r1', isPaused: false, labels: { severity: 'warning' }, annotations: { summary: 'foo' }, folderUID: 'f1', ruleGroup: 'g1', for: '2m' },
      { uid: 'u2', title: 'r2', isPaused: true,  labels: {} }
    ],
  };
  const { req, res } = fakeReqRes();
  await alertsController.listRules(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.rules.length, 2);
  assert.deepStrictEqual(out.body.rules[0], {
    uid: 'u1', title: 'r1', isPaused: false, ruleGroup: 'g1',
    severity: 'warning', forDuration: '2m', summary: 'foo',
  });
  // folderUID 不應在 slim 輸出(UI 用不到,review M5)
  assert.strictEqual(out.body.rules[0].folderUID, undefined);
  assert.strictEqual(out.body.rules[1].severity, null, '無 severity 應 fallback null');
  assert.strictEqual(out.body.cached, false);
});

test('GET rules: 10s cache hit,Grafana API 不會被重複呼叫', async () => {
  listOutcome = { ok: true, rules: [{ uid: 'u1', title: 'r1', isPaused: false }] };
  const r1 = fakeReqRes();
  await alertsController.listRules(r1.req, r1.res);
  const r2 = fakeReqRes();
  await alertsController.listRules(r2.req, r2.res);
  assert.strictEqual(listCalls, 1, 'cache hit:第二次不應 call Grafana');
  assert.strictEqual(r2.res._get().body.cached, true);
});

test('GET rules: Grafana 失敗回 502', async () => {
  listOutcome = { ok: false, reason: 'http_500' };
  const { req, res } = fakeReqRes();
  await alertsController.listRules(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 502);
  assert.match(out.body.error, /http_500/);
});

// ─── pauseRule ─────────────────────────────────────────

test('POST pause: paused=true 呼叫 Grafana 傳對 uid + invalidate cache', async () => {
  // 先 populate cache
  listOutcome = { ok: true, rules: [{ uid: 'u1', title: 'r1', isPaused: false }] };
  await alertsController.listRules(fakeReqRes().req, fakeReqRes().res);

  pauseOutcome = { ok: true, uid: 'u1', isPaused: true };
  const { req, res } = fakeReqRes({ params: { uid: 'u1' }, body: { paused: true } });
  await alertsController.pauseRule(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.isPaused, true);
  assert.strictEqual(pauseCalls.length, 1);
  assert.deepStrictEqual(pauseCalls[0], { uid: 'u1', paused: true });

  // cache invalidated:下次 list 又會 call Grafana
  listCalls = 0;
  await alertsController.listRules(fakeReqRes().req, fakeReqRes().res);
  assert.strictEqual(listCalls, 1, 'pause 後應 invalidate cache');
});

test('POST pause: paused 漏帶 → 422 with required message', async () => {
  const { req, res } = fakeReqRes({ params: { uid: 'u1' }, body: {} });
  await alertsController.pauseRule(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
  assert.match(out.body.error, /required/);
});

test('POST pause: 非 boolean → 422 with type message', async () => {
  const { req, res } = fakeReqRes({ params: { uid: 'u1' }, body: { paused: 'yes' } });
  await alertsController.pauseRule(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
  assert.match(out.body.error, /boolean/);
});

test('POST pause: uid 含特殊字元 → 422', async () => {
  const { req, res } = fakeReqRes({ params: { uid: '../etc' }, body: { paused: true } });
  await alertsController.pauseRule(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
  assert.match(out.body.error, /invalid uid/);
  assert.strictEqual(pauseCalls.length, 0, 'invalid uid 不應到 Grafana');
});

test('POST pause: Grafana 失敗回 502', async () => {
  pauseOutcome = { ok: false, reason: 'http_403' };
  const { req, res } = fakeReqRes({ params: { uid: 'u1' }, body: { paused: true } });
  await alertsController.pauseRule(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 502);
  assert.match(out.body.error, /http_403/);
});

// ─── grafanaApi missing credentials ────────────────────

test('grafanaApi 沒設 GRAFANA_API_TOKEN 時回 missing_credentials', async () => {
  const realToken = process.env.GRAFANA_API_TOKEN;
  delete process.env.GRAFANA_API_TOKEN;
  // 還原 stub 改用真的 fn 來測 env 判斷
  grafanaApi.listAlertRules = _origList;
  const r = await grafanaApi.listAlertRules();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'missing_credentials');
  // 還原
  process.env.GRAFANA_API_TOKEN = realToken;
  grafanaApi.listAlertRules = async () => { listCalls++; return listOutcome; };
});
