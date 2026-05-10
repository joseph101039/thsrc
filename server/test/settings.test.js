'use strict';

// 設定 toggle 與訂票通知測試。
// 不打真的 LINE — 用 require.cache 注入 lineNotifier stub。

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

process.env.JWT_SECRET = 'test';
process.env.GOOGLE_CLIENT_ID = 'test';
process.env.DB_PATH = path.join(__dirname, 'tmp-settings.db');
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'fake';
process.env.LINE_USER_ID = 'Ufake';

// Stub 只攔 pushText,保留真實 pushBookingResult — 確保 production format 邏輯被測到
// (review fix:之前整個 module override 等於只測 stub)
const pushCalls = [];
let pushFakeOk = true;
const lineNotifier = require('../src/services/lineNotifier');
const _origPushText = lineNotifier.pushText;
lineNotifier.pushText = async (text) => {
  pushCalls.push(text);
  return pushFakeOk ? { ok: true } : { ok: false, reason: 'stub_failure' };
};

const settingsRepo = require('../src/repositories/settingsRepo');
const settingsService = require('../src/services/settingsService');

function _cleanDb() {
  for (const ext of ['', '-shm', '-wal']) {
    const p = process.env.DB_PATH + ext;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

before(() => {
  _cleanDb();
  // 強制初始化 DB schema
  require('../src/db').getDb();
});

after(() => {
  _cleanDb();
  // 還原 monkey-patch,避免污染其他 test file
  lineNotifier.pushText = _origPushText;
});

beforeEach(() => {
  pushCalls.length = 0;
  pushFakeOk = true;
  settingsService._clearCache();
});

// ─── settingsRepo ─────────────────────────────────────────

test('settingsRepo: migration 預設值 bookingSuccess/bookingFailure 都是 true', () => {
  assert.strictEqual(settingsRepo.get('notification.bookingSuccess'), 'true');
  assert.strictEqual(settingsRepo.get('notification.bookingFailure'), 'true');
});

test('settingsRepo.set 是 upsert,既有 key 會更新', () => {
  settingsRepo.set('test.key1', 'val1');
  assert.strictEqual(settingsRepo.get('test.key1'), 'val1');
  settingsRepo.set('test.key1', 'val2');
  assert.strictEqual(settingsRepo.get('test.key1'), 'val2');
});

test('settingsRepo.get 對未知 key 回 null', () => {
  assert.strictEqual(settingsRepo.get('nonexistent.key'), null);
});

test('settingsRepo.list 回完整列表含 updated_at', () => {
  const all = settingsRepo.list();
  assert.ok(all.length >= 2);
  const keys = all.map(r => r.key);
  assert.ok(keys.includes('notification.bookingSuccess'));
  assert.ok(all.every(r => typeof r.updated_at === 'string'));
});

// ─── settingsService cache ─────────────────────────────────

test('settingsService: 預設兩個 toggle 都 true', () => {
  assert.strictEqual(settingsService.isBookingSuccessNotifyEnabled(), true);
  assert.strictEqual(settingsService.isBookingFailureNotifyEnabled(), true);
});

test('settingsService.set* 立即生效(下一次 read 撈 DB)', () => {
  settingsService.setBookingSuccessNotify(false);
  // _writeBool delete cache;下次 isXxxEnabled 撈 DB 拿到新值
  assert.strictEqual(settingsService.isBookingSuccessNotifyEnabled(), false);
  // DB 確實有更新
  assert.strictEqual(settingsRepo.get('notification.bookingSuccess'), 'false');
});

test('settingsService cache hit:外部繞過 service 改 DB,30s 內 service 仍回舊 cache 值', () => {
  // 先觸發一次讀取 → cache populate
  assert.strictEqual(settingsService.isBookingFailureNotifyEnabled(), true);
  // 繞過 service 直接改 DB
  settingsRepo.set('notification.bookingFailure', 'false');
  // service 仍從 cache 拿到 true(這是預期行為,30s 後或顯式 _clearCache 才會更新)
  assert.strictEqual(settingsService.isBookingFailureNotifyEnabled(), true);
  settingsService._clearCache();
  assert.strictEqual(settingsService.isBookingFailureNotifyEnabled(), false);
});

test('settingsService.getNotificationToggles 回兩個欄位', () => {
  settingsService._clearCache();
  settingsService.setBookingSuccessNotify(true);
  settingsService.setBookingFailureNotify(false);
  const t = settingsService.getNotificationToggles();
  assert.deepStrictEqual(t, { bookingSuccess: true, bookingFailure: false });
});

// ─── lineNotifier.pushBookingResult 格式 ──────────────────────
// 用真實 helper(不過 stub),把 cache 中的 stub module 暫時還原來測 format

test('pushBookingResult format: 成功訊息含 ✅ 路線 票號', async () => {
  // 用真正的 lineNotifier 邏輯;但 pushText 仍是 stub(會被收到 pushCalls)
  await lineNotifier.pushBookingResult({
    status: 'success',
    fromStation: '南港', toStation: '左營',
    date: '2026-05-15',
    trainNo: '0123', departTime: '14:30', ticketNo: 'T1234',
  });
  assert.strictEqual(pushCalls.length, 1);
  assert.match(pushCalls[0], /✅.*訂票成功/s);
  assert.match(pushCalls[0], /南港.*左營/s);
  assert.match(pushCalls[0], /T1234/);
});

test('pushBookingResult format: 失敗訊息含 ❌ 重試耗盡 reason', async () => {
  await lineNotifier.pushBookingResult(
    {
      status: 'failed',
      fromStation: '南港', toStation: '左營',
      date: '2026-05-15',
      retryCount: 10, maxRetries: 10,
    },
    { reason: '訂位額滿' }
  );
  assert.strictEqual(pushCalls.length, 1);
  assert.match(pushCalls[0], /❌.*重試耗盡/s);
  assert.match(pushCalls[0], /訂位額滿/);
  assert.match(pushCalls[0], /10\/10/);
});

// ─── Settings HTTP routes ─────────────────────────────────
// 直接呼叫 controller layer(不啟整個 server),確認 service 邏輯與 422 驗證

const settingsController = require('../src/controllers/settingsController');

function fakeReqRes(body) {
  let _status = 200;
  let _payload = null;
  return {
    req: { body, log: { error: () => {} } },
    res: {
      status(c) { _status = c; return this; },
      json(p) { _payload = p; return this; },
      _get() { return { status: _status, body: _payload }; },
    },
  };
}

test('GET /settings/notification 回兩 toggle', () => {
  settingsService._clearCache();
  settingsService.setBookingSuccessNotify(true);
  settingsService.setBookingFailureNotify(true);
  const { req, res } = fakeReqRes({});
  settingsController.getNotification(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 200);
  assert.deepStrictEqual(out.body, { bookingSuccess: true, bookingFailure: true });
});

test('PUT /settings/notification 更新單一欄位', () => {
  settingsService.setBookingSuccessNotify(true);
  settingsService.setBookingFailureNotify(true);
  const { req, res } = fakeReqRes({ bookingSuccess: false });
  settingsController.putNotification(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.ok, true);
  assert.strictEqual(out.body.current.bookingSuccess, false);
  assert.strictEqual(out.body.current.bookingFailure, true, '未提供欄位不應被改');
});

test('PUT /settings/notification 422 if 欄位非 boolean', () => {
  const { req, res } = fakeReqRes({ bookingSuccess: 'yes' });
  settingsController.putNotification(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
});

test('PUT /settings/notification 422 if 空 body', () => {
  const { req, res } = fakeReqRes({});
  settingsController.putNotification(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
  assert.match(out.body.error, /required/);
});

test('PUT /settings/notification 422 if 未知欄位', () => {
  const { req, res } = fakeReqRes({ bookingSuccess: true, foo: 'bar' });
  settingsController.putNotification(req, res);
  const out = res._get();
  assert.strictEqual(out.status, 422);
  assert.match(out.body.error, /unknown fields.*foo/);
});

// ─── bookingEngineService 終態通知 wiring(端到端,真實 handleRetry) ─────
// 直接呼叫 handleRetry 跑完整 wiring:toggle 檢查 → re-fetch booking → getLastFailedAttempt → push

const bookingRepo = require('../src/repositories/bookingRepo');
const passengerRepo = require('../src/repositories/passengerRepo');
const bookingEngine = require('../src/services/bookingEngineService');

function makeFailedBooking(reason = 'TEST_REASON_X') {
  const passenger = { id: 'p-' + Date.now(), name: 'T', idNumber: 'A1', type: 'adult', email: 't@e.com', phone: '' };
  passengerRepo.upsert(passenger);
  const r = bookingRepo.create({
    passengerId: passenger.id, fromStation: '0', toStation: '1',
    date: '2026-05-15', desiredTime: '14:30',
    earliestTime: '14:00', latestTime: '15:00',
    maxRetries: 1, scheduledAt: null,
  });
  // 預先寫一筆失敗 attempt(模擬已重試一次失敗)
  bookingRepo.createAttempt({ bookingId: r.id, success: false, reason });
  // retryCount 回 0,maxRetries 1 — handleRetry 會 +1 達標進入 FAILED 終態
  return bookingRepo.getById(r.id);
}

test('handleRetry 終態 + toggle on:整條 wiring push 收到 reason 且 booking status 已 update', async () => {
  settingsService.setBookingFailureNotify(true);
  pushCalls.length = 0;
  const booking = makeFailedBooking('TEST_REASON_END_TO_END');
  bookingEngine.handleRetry(booking, 'TEST_REASON_END_TO_END');
  // fire-and-forget 是 Promise — 等 microtask flush
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pushCalls.length, 1);
  assert.match(pushCalls[0], /❌.*重試耗盡/s);
  assert.match(pushCalls[0], /TEST_REASON_END_TO_END/);
  // 確認 status 真的被 update 成 failed
  assert.strictEqual(bookingRepo.getById(booking.id).status, 'failed');
});

test('handleRetry 終態 + toggle off:不 push 但 status 仍 update', async () => {
  settingsService.setBookingFailureNotify(false);
  pushCalls.length = 0;
  const booking = makeFailedBooking();
  bookingEngine.handleRetry(booking, 'whatever');
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pushCalls.length, 0);
  assert.strictEqual(bookingRepo.getById(booking.id).status, 'failed');
});

test('handleRetry LINE-down:push 失敗不 throw,booking status 仍 success-path 不受影響', async () => {
  settingsService.setBookingFailureNotify(true);
  pushFakeOk = false;
  pushCalls.length = 0;
  const booking = makeFailedBooking();
  // 不應 throw
  bookingEngine.handleRetry(booking, 'reason');
  await new Promise(r => setImmediate(r));
  assert.strictEqual(pushCalls.length, 1, 'push 仍被呼叫但 stub 回失敗');
  assert.strictEqual(bookingRepo.getById(booking.id).status, 'failed', 'booking 流程不受 LINE 失敗影響');
});

test('LINE-down 不破壞:pushBookingResult 失敗時只回 ok:false 不 throw', async () => {
  pushFakeOk = false;
  const r = await lineNotifier.pushBookingResult({
    status: 'success', fromStation: 'A', toStation: 'B', date: '2026-01-01', ticketNo: 'X'
  });
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /stub_failure/);
});

test('pushBookingResult: reason 含 control char 會被 sanitize,超長會被截斷', async () => {
  pushFakeOk = true;
  pushCalls.length = 0;
  const longReason = '失敗' + '\x00\x01' + 'X'.repeat(300);
  await lineNotifier.pushBookingResult(
    { status: 'failed', fromStation: 'A', toStation: 'B', date: '2026-01-01', retryCount: 1, maxRetries: 1 },
    { reason: longReason }
  );
  assert.strictEqual(pushCalls.length, 1);
  // reason 那行不應含 control chars(整個訊息有 \n 分行 — 排除 \x0a/\x0d)
  const reasonLine = pushCalls[0].split('\n').find(l => l.startsWith('原因:'));
  assert.ok(reasonLine, 'should have 原因 line');
  assert.ok(!/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f]/.test(reasonLine), 'control chars 應被 sanitize');
  // 應被截到 200 字 + 結尾的 …
  assert.match(pushCalls[0], /…/);
});
