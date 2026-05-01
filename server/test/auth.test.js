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
