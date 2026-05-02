'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-admin-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const userRepo = require('../src/repositories/userRepo');

test('getAllowedUsers：應回傳所有使用者（至少含預設 admin）', () => {
  const users = userRepo.getAll();
  assert.ok(Array.isArray(users));
  assert.ok(users.some(u => u.email === 'joseph101039@gmail.com' && u.role === 'admin'));
});

test('addAllowedUser：新增使用者後可取得', () => {
  const result = userRepo.add({ email: 'newuser@example.com', role: 'user' });
  assert.strictEqual(result.success, true);
  const users = userRepo.getAll();
  assert.ok(users.some(u => u.email === 'newuser@example.com' && u.role === 'user'));
});

test('addAllowedUser：重複 email 應回傳 success:false', () => {
  userRepo.add({ email: 'dup@example.com', role: 'user' });
  const result = userRepo.add({ email: 'dup@example.com', role: 'admin' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('已存在'));
});

test('deleteAllowedUser：刪除後不應出現在列表', () => {
  userRepo.add({ email: 'todelete@example.com', role: 'user' });
  const result = userRepo.deleteByEmail('todelete@example.com');
  assert.strictEqual(result.success, true);
  const users = userRepo.getAll();
  assert.ok(!users.some(u => u.email === 'todelete@example.com'));
});

test('addAllowedUser：缺少 email 應回傳 success:false', () => {
  const result = userRepo.add({ email: null, role: 'user' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('email'));
});

test('addAllowedUser：email 非字串應回傳 success:false', () => {
  const result = userRepo.add({ email: 123, role: 'user' });
  assert.strictEqual(result.success, false);
});

const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/api');

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
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function deleteReq(server, urlPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method: 'DELETE',
      headers,
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
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
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeToken(role) {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

test('GET /v1/users：admin token 應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/users', { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/users：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await getJson(server, '/v1/users', { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：admin 可新增使用者', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'api-test@example.com', role: 'user' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'x@x.com', role: 'user' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：admin 刪除自己應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('joseph101039@gmail.com'), { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('other@example.com'), { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：無效 role 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { email: 'x@x.com', role: 'superadmin' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/users：缺少 email 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/v1/users', { role: 'user' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/users/:email：case-insensitive 自刪保護', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await deleteReq(server, '/v1/users/' + encodeURIComponent('JOSEPH101039@GMAIL.COM'), { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});
