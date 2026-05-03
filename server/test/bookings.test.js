'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const http = require('http');
const jwt = require('jsonwebtoken');

process.env.DB_PATH = path.join(os.tmpdir(), `thsrc-bookings-test-${Date.now()}.db`);
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

const BOOKING_FIXTURE = {
  passengerId: 'test-passenger-id',
  fromStation: '台北',
  toStation: '左營',
  date: '2026-06-01',
  desiredTime: '09:00',
  earliestTime: '08:00',
  latestTime: '10:00',
  maxRetries: 3,
};

test('GET /v1/bookings：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/bookings', null);
    assert.strictEqual(res.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/bookings：有效 token 應回傳陣列', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const res = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${makeToken()}` });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.body.bookings));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：新增後可在列表中找到', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    assert.strictEqual(createRes.body.success, true);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    assert.ok(listRes.body.bookings.some(b => b.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/bookings/:id：刪除後不應出現在列表', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    // 先取消（pending → cancelled），才能刪除
    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(cancelRes.status, 200);

    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(delRes.status, 200);

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    assert.ok(!listRes.body.bookings.some(b => b.id === id));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/cancel：取消 pending 訂票應成功並寫入嘗試紀錄', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(cancelRes.status, 200);
    assert.strictEqual(cancelRes.body.success, true);

    // 確認狀態為 cancelled
    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === id);
    assert.strictEqual(booking.status, 'cancelled');

    // 確認嘗試紀錄含取消原因
    const attemptsRes = await request(server, 'GET', `/v1/bookings/${id}/attempts`, null, { Authorization: `Bearer ${token}` });
    assert.ok(attemptsRes.body.attempts.some(a => a.reason === '使用者取消'));

    // 再次取消應回傳 400
    const cancelAgainRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(cancelAgainRes.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('DELETE /v1/bookings/:id：pending 狀態應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(delRes.status, 400);

    // 清理
    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${token}` });
    await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${token}` });
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：無 token 應回傳 401', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const refundRes = await request(server, 'POST', '/v1/bookings/some-id/refund', null);
    assert.strictEqual(refundRes.status, 401);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：不存在的 id 應回傳 404', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const refundRes = await request(server, 'POST', '/v1/bookings/nonexistent-id/refund', null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(refundRes.status, 404);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：非 success 狀態應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const refundRes = await request(server, 'POST', `/v1/bookings/${id}/refund`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(refundRes.status, 400);
    assert.ok(refundRes.body.error);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('GET /v1/bookings/:id/attempts：應回傳空陣列（新訂票無嘗試）', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    const id = createRes.body.id;

    const attemptsRes = await request(server, 'GET', `/v1/bookings/${id}/attempts`, null, { Authorization: `Bearer ${token}` });
    assert.strictEqual(attemptsRes.status, 200);
    assert.ok(Array.isArray(attemptsRes.body.attempts));
    assert.strictEqual(attemptsRes.body.attempts.length, 0);
  } finally {
    await new Promise(r => server.close(r));
  }
});
