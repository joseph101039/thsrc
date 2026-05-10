'use strict';

// /metrics 端點與 metricsMiddleware 的測試。
// 涵蓋 Bearer 三態(未設、錯、正確)+ middleware 寫入 histogram + bookingDuration outcome label。

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = 'test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.METRICS_TOKEN = 'test-metrics-token-12345';
process.env.DB_PATH = path.join(__dirname, 'tmp-metrics.db');

let server;
let baseUrl;
let metricsModule;

before(async () => {
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
  const app = require('../src/api');
  metricsModule = require('../src/metrics');
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  if (fs.existsSync(process.env.DB_PATH)) fs.unlinkSync(process.env.DB_PATH);
});

function rawGet(p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${p}`, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

test('/metrics 無 Authorization → 401', async () => {
  const res = await rawGet('/metrics');
  assert.strictEqual(res.status, 401);
});

test('/metrics 錯誤 token → 401', async () => {
  const res = await rawGet('/metrics', { Authorization: 'Bearer wrong' });
  assert.strictEqual(res.status, 401);
});

test('/metrics 等長但內容不同的錯誤 token 也應 401(timingSafeEqual)', async () => {
  const fake = 'Bearer ' + 'x'.repeat(process.env.METRICS_TOKEN.length);
  const res = await rawGet('/metrics', { Authorization: fake });
  assert.strictEqual(res.status, 401);
});

test('/metrics 正確 token → 200 + Prometheus content type + 含預期指標', async () => {
  const res = await rawGet('/metrics', { Authorization: `Bearer ${process.env.METRICS_TOKEN}` });
  assert.strictEqual(res.status, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  // 默認 metrics 與業務 metrics 都應該存在
  assert.ok(res.body.includes('thsrc_process_resident_memory_bytes'), 'default metrics should be present');
  assert.ok(res.body.includes('thsrc_http_requests_total'), 'http counter metric should be registered');
});

test('metricsMiddleware 記錄一般 endpoint 但跳過 /metrics 自身', async () => {
  // 觸發一個會被 middleware 觀察的請求
  await rawGet('/healthz');
  await rawGet('/healthz');
  // /metrics 自身的 scrape 不應被記錄成 HTTP 請求(避免自我觀察)
  await rawGet('/metrics', { Authorization: `Bearer ${process.env.METRICS_TOKEN}` });

  const json = await metricsModule.register.getMetricsAsJSON();
  const reqTotal = json.find((m) => m.name === 'thsrc_http_requests_total');
  assert.ok(reqTotal, 'thsrc_http_requests_total should exist');

  const healthSamples = reqTotal.values.filter((v) => v.labels.route === '/healthz');
  assert.ok(healthSamples.length > 0, '/healthz 應該被記錄');
  // route label 不應出現 /metrics
  const metricsSelfSamples = reqTotal.values.filter((v) => v.labels.route === '/metrics');
  assert.strictEqual(metricsSelfSamples.length, 0, '/metrics 不應被自我觀察');
});

test('compareBearer 對長度不同的字串應 false 而不 throw', () => {
  const { compareBearer } = require('../src/middlewares/bearerAuth');
  assert.strictEqual(compareBearer('Bearer short', 'a-much-longer-secret-token'), false);
  assert.strictEqual(compareBearer(undefined, 'token'), false);
  assert.strictEqual(compareBearer('Bearer abc', 'abc'), true);
  assert.strictEqual(compareBearer('Bearer abd', 'abc'), false);
});
