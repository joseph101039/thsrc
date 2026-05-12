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
  retryWaitValue: 30,
  retryWaitUnit: 'second',
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

test('POST /v1/bookings：retryWaitValue/Unit 應被儲存並回傳', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === id);
    assert.ok(booking, '應能找到剛建立的訂單');
    assert.strictEqual(booking.retryWaitValue, 30);
    assert.strictEqual(booking.retryWaitUnit, 'second');
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：無效 retryWaitUnit 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      retryWaitUnit: 'hour',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：retryWaitValue 超出範圍應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      retryWaitValue: 0,
      retryWaitUnit: 'minute',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：只提供 retryWaitUnit 不提供 retryWaitValue 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const { retryWaitValue: _, ...fixtureWithoutValue } = BOOKING_FIXTURE;
    const res = await request(server, 'POST', '/v1/bookings', {
      ...fixtureWithoutValue,
      retryWaitUnit: 'second',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：ticketAdult=0 其他也都是 0 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 0, ticketChild: 0, ticketDisabled: 0, ticketSenior: 0, ticketStudent: 0,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：ticketAdult=11 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 11,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：searchMode=train 且無 trainNoTarget 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      searchMode: 'train',
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings：ticket counts 和 searchMode 應被儲存並回傳', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const createRes = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      ticketAdult: 2, ticketChild: 1,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === id);
    assert.strictEqual(booking.ticketAdult, 2);
    assert.strictEqual(booking.ticketChild, 1);
    assert.strictEqual(booking.searchMode, 'time');
    assert.strictEqual(booking.ownerEmail, 'joseph101039@gmail.com');
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings: concurrency=2 + scheduledAt 應被儲存', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      scheduledAt: '2026-06-01T01:00:00Z',
      concurrency: 2,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 200);
    const listRes = await request(server, 'GET', '/v1/bookings', null, { Authorization: `Bearer ${token}` });
    const booking = listRes.body.bookings.find(b => b.id === res.body.id);
    assert.strictEqual(booking.concurrency, 2);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings: concurrency=6 超出上限應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      scheduledAt: '2026-06-01T01:00:00Z',
      concurrency: 6,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings: immediate=true + concurrency>1 應回傳 400(服務端強制)', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      immediate: true,
      scheduledAt: '2099-12-31T00:00:00Z',  // 即使帶 scheduledAt 也應擋
      concurrency: 3,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings: concurrency>1 + scheduledAt 過去時間應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      scheduledAt: '2020-01-01T00:00:00Z',
      concurrency: 2,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings: concurrency>1 但無 scheduledAt 應回傳 400', async () => {
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const token = makeToken();
    const res = await request(server, 'POST', '/v1/bookings', {
      ...BOOKING_FIXTURE,
      concurrency: 3,
    }, { Authorization: `Bearer ${token}` });
    assert.strictEqual(res.status, 400);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('bookingRepo.setRetryFromRunning CAS: status 已非 running 時 changes=0(防 late winner 被覆寫)', async () => {
  const bookingRepo = require('../src/repositories/bookingRepo');
  const { getDb } = require('../src/db');
  const created = bookingRepo.create({ ...BOOKING_FIXTURE });
  // 模擬 late winner 已寫入 success
  getDb().prepare("UPDATE bookings SET status='success', ticket_no='TKT-X' WHERE id=?").run(created.id);
  // 此時 handleRetry 嘗試覆寫應 no-op
  const ok = bookingRepo.setRetryFromRunning(created.id, { status: 'pending', scheduledAt: '2026-12-01T00:00:00Z', retryCount: 5 });
  assert.strictEqual(ok, false);
  const fresh = bookingRepo.getById(created.id);
  assert.strictEqual(fresh.status, 'success');
  assert.strictEqual(fresh.ticketNo, 'TKT-X');
});

test('bookingRepo.claimWinner CAS: 兩次連續呼叫只有第一次 changes=1', async () => {
  const bookingRepo = require('../src/repositories/bookingRepo');
  const { getDb } = require('../src/db');
  // 建立一筆 booking 並手動進 running 狀態
  const created = bookingRepo.create({ ...BOOKING_FIXTURE, concurrency: 2 });
  getDb().prepare("UPDATE bookings SET status='running' WHERE id=?").run(created.id);

  const w1 = bookingRepo.claimWinner(created.id, { ticketNo: 'TKT-A', trainNo: '101', departTime: null });
  const w2 = bookingRepo.claimWinner(created.id, { ticketNo: 'TKT-B', trainNo: '102', departTime: null });
  assert.strictEqual(w1, true);
  assert.strictEqual(w2, false);
  const fresh = bookingRepo.getById(created.id);
  assert.strictEqual(fresh.status, 'success');
  assert.strictEqual(fresh.ticketNo, 'TKT-A');
});

function makeTokenFor(email, role = 'user') {
  return jwt.sign({ email, role }, 'test-secret', { expiresIn: '1h' });
}

function seedUser(email, role = 'user') {
  const userRepo = require('../src/repositories/userRepo');
  try { userRepo.add({ email, role }); } catch { /* already exists */ }
}

test('DELETE /v1/bookings/:id：user 刪除他人的訂票應回傳 403', async () => {
  seedUser('owner@example.com'); seedUser('other@example.com');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner@example.com');
    const otherToken = makeTokenFor('other@example.com');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    assert.strictEqual(createRes.status, 200);
    const id = createRes.body.id;

    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${ownerToken}` });

    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${otherToken}` });
    assert.strictEqual(delRes.status, 403);

    // 清理
    await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${ownerToken}` });
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/cancel：user 取消他人的訂票應回傳 403', async () => {
  seedUser('owner2@example.com'); seedUser('other2@example.com');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner2@example.com');
    const otherToken = makeTokenFor('other2@example.com');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    const id = createRes.body.id;

    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${otherToken}` });
    assert.strictEqual(cancelRes.status, 403);

    // 清理
    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${ownerToken}` });
    await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${ownerToken}` });
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('admin 可以刪除他人的訂票', async () => {
  seedUser('owner3@example.com');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner3@example.com');
    const adminToken = makeTokenFor('joseph101039@gmail.com', 'admin');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    const id = createRes.body.id;

    const cancelRes = await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(cancelRes.status, 200);

    const delRes = await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${adminToken}` });
    assert.strictEqual(delRes.status, 200);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('POST /v1/bookings/:id/refund：user 退票他人訂票應回傳 403', async () => {
  seedUser('owner4@example.com'); seedUser('other4@example.com');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, r));
  try {
    const ownerToken = makeTokenFor('owner4@example.com');
    const otherToken = makeTokenFor('other4@example.com');

    const createRes = await request(server, 'POST', '/v1/bookings', BOOKING_FIXTURE, { Authorization: `Bearer ${ownerToken}` });
    const id = createRes.body.id;

    const refundRes = await request(server, 'POST', `/v1/bookings/${id}/refund`, null, { Authorization: `Bearer ${otherToken}` });
    assert.strictEqual(refundRes.status, 403);

    // 清理
    await request(server, 'POST', `/v1/bookings/${id}/cancel`, null, { Authorization: `Bearer ${ownerToken}` });
    await request(server, 'DELETE', `/v1/bookings/${id}`, null, { Authorization: `Bearer ${ownerToken}` });
  } finally {
    await new Promise(r => server.close(r));
  }
});
