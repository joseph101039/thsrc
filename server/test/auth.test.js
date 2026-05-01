'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

// 用暫存 DB 避免污染正式資料
process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-test-${Date.now()}.db`);

const db = require('../src/db');

test('isAllowedUser：預設 admin 帳號應被允許', () => {
  assert.strictEqual(db.isAllowedUser('joseph101039@gmail.com'), true);
});

test('isAllowedUser：不存在的帳號應被拒絕', () => {
  assert.strictEqual(db.isAllowedUser('stranger@example.com'), false);
});

test('isAllowedUser：大小寫不敏感', () => {
  assert.strictEqual(db.isAllowedUser('Joseph101039@Gmail.COM'), true);
});

const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-secret-key-for-unit-tests';
process.env.JWT_SECRET = TEST_SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const app = require('../src/api');
const http = require('http');

function postJson(server, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

test('authMiddleware：無 token 時 POST / 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getPassengers' });
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('authMiddleware：有效 token 時 POST / 應成功', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: '7d' });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getPassengers' }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('authMiddleware：過期 token 應回傳 401', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: -1 });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getPassengers' }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST / action=googleAuth 無 JWT 應進入 auth handler（缺少 credential 回 400）', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'googleAuth' });
    // 沒有 credential → googleAuthHandler 回 400，而非 authMiddleware 的 401
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('credential'));
  } finally {
    await new Promise(r => server.close(r));
  }
});
