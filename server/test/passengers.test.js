'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-passengers-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const app = require('../src/api');

function makeToken(role = 'user') {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', chunk => b += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(b) }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

test('GET /v1/passengers：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/passengers', null);
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/passengers：有效 token 應回傳陣列', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${makeToken()}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.passengers));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/passengers：新增旅客後可在列表中找到', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const saveRes = await request(server, 'POST', '/v1/passengers', {
      name: '測試旅客', idNumber: 'A123456789', type: 'adult', email: 'p@test.com', phone: '0912345678',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.body.success, true);
    const newId = saveRes.body.id;

    const listRes = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${token}` });
    assert.ok(listRes.body.passengers.some(p => p.id === newId));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/passengers/:id：刪除後不應出現在列表', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const saveRes = await request(server, 'POST', '/v1/passengers', {
      name: '刪除用', idNumber: 'B987654321', type: 'adult', email: 'del@test.com',
    }, { Authorization: `Bearer ${token}` });
    const id = saveRes.body.id;

    const delRes = await request(server, 'DELETE', `/v1/passengers/${id}`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(delRes.status, 200);

    const listRes = await request(server, 'GET', '/v1/passengers', null, { Authorization: `Bearer ${token}` });
    assert.ok(!listRes.body.passengers.some(p => p.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/passengers：身分證格式錯誤應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'user' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(server, 'POST', '/v1/passengers', {
      name: '測試',
      idNumber: 'a123456789',
      type: 'adult',
      email: 'test@example.com',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/passengers：身分證格式正確應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = jwt.sign({ email: 'joseph101039@gmail.com', role: 'user' }, 'test-secret', { expiresIn: '1h' });
    const res = await request(server, 'POST', '/v1/passengers', {
      name: '測試',
      idNumber: 'A123456789',
      type: 'adult',
      email: 'test@example.com',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});
