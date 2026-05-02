'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-test-${Date.now()}.db`);

const jwt = require('jsonwebtoken');

const TEST_SECRET = 'test-secret-key-for-unit-tests';
process.env.JWT_SECRET = TEST_SECRET;
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const userRepo = require('../src/repositories/userRepo');

test('isAllowedUser：預設 admin 帳號應被允許', () => {
  assert.strictEqual(userRepo.isAllowed('joseph101039@gmail.com'), true);
});

test('isAllowedUser：不存在的帳號應被拒絕', () => {
  assert.strictEqual(userRepo.isAllowed('stranger@example.com'), false);
});

test('isAllowedUser：大小寫不敏感', () => {
  assert.strictEqual(userRepo.isAllowed('Joseph101039@Gmail.COM'), true);
});

const app = require('../src/api');
const http = require('http');

function postJson(server, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
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

function getJson(server, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'GET',
      headers,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('verifyJwt：無 token 時 GET /v1/passengers 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers');
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('verifyJwt：有效 token 時 GET /v1/passengers 應成功', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: '7d' });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers', { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('verifyJwt：過期 token 應回傳 401', async () => {
  const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'admin' }, TEST_SECRET, { expiresIn: -1 });
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/passengers', { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/auth/google 無 credential 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/auth/google', {});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error.includes('credential'));
  } finally {
    await new Promise(r => server.close(r));
  }
});
