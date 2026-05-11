'use strict';

// 通用 key-value 設定 repo;value 一律 TEXT,呼叫端自行 parse(boolean → 'true'/'false')。
const { getDb } = require('../db');

function get(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function set(key, value) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), now);
}

function list() {
  const db = getDb();
  return db.prepare('SELECT key, value, updated_at FROM settings ORDER BY key').all();
}

module.exports = { get, set, list };
