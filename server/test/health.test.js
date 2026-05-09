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
