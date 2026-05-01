'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-admin-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const db = require('../src/db');

test('getAllowedUsers：應回傳所有使用者（至少含預設 admin）', () => {
  const users = db.getAllowedUsers();
  assert.ok(Array.isArray(users));
  assert.ok(users.some(u => u.email === 'joseph101039@gmail.com' && u.role === 'admin'));
});

test('addAllowedUser：新增使用者後可取得', () => {
  const result = db.addAllowedUser({ email: 'newuser@example.com', role: 'user' });
  assert.strictEqual(result.success, true);
  const users = db.getAllowedUsers();
  assert.ok(users.some(u => u.email === 'newuser@example.com' && u.role === 'user'));
});

test('addAllowedUser：重複 email 應回傳 success:false', () => {
  db.addAllowedUser({ email: 'dup@example.com', role: 'user' });
  const result = db.addAllowedUser({ email: 'dup@example.com', role: 'admin' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('已存在'));
});

test('deleteAllowedUser：刪除後不應出現在列表', () => {
  db.addAllowedUser({ email: 'todelete@example.com', role: 'user' });
  const result = db.deleteAllowedUser('todelete@example.com');
  assert.strictEqual(result.success, true);
  const users = db.getAllowedUsers();
  assert.ok(!users.some(u => u.email === 'todelete@example.com'));
});

test('addAllowedUser：缺少 email 應回傳 success:false', () => {
  const result = db.addAllowedUser({ email: null, role: 'user' });
  assert.strictEqual(result.success, false);
  assert.ok(result.error.includes('email'));
});

test('addAllowedUser：email 非字串應回傳 success:false', () => {
  const result = db.addAllowedUser({ email: 123, role: 'user' });
  assert.strictEqual(result.success, false);
});

const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('../src/api');

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
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function makeToken(role) {
  return jwt.sign({ email: 'joseph101039@gmail.com', role }, 'test-secret', { expiresIn: '1h' });
}

test('getAllowedUsers：admin token 應成功', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getAllowedUsers' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.users));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('getAllowedUsers：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'getAllowedUsers' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：admin 可新增使用者', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { email: 'api-test@example.com', role: 'user' } }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { email: 'x@x.com', role: 'user' } }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('deleteAllowedUser：admin 刪除自己應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'deleteAllowedUser', id: 'joseph101039@gmail.com' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('deleteAllowedUser：user token 應回傳 403', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'deleteAllowedUser', id: 'other@example.com' }, { Authorization: `Bearer ${makeToken('user')}` });
    assert.strictEqual(res.status, 403);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：無效 role 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { email: 'x@x.com', role: 'superadmin' } }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('addAllowedUser：缺少 email 應回傳 success:false', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'addAllowedUser', data: { role: 'user' } }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, false);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('deleteAllowedUser：case-insensitive 自刪保護', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await postJson(server, '/', { action: 'deleteAllowedUser', id: 'JOSEPH101039@GMAIL.COM' }, { Authorization: `Bearer ${makeToken('admin')}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});
