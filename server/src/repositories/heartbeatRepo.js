'use strict';

// 提供 component 心跳 upsert 與查詢,供 scheduler 等非 HTTP 元件回報存活,
// 由 server /readyz 探針讀取判斷 staleness。
const { getDb } = require('../db');

function upsert(component) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO system_heartbeat (component, last_seen_at)
    VALUES (?, ?)
    ON CONFLICT(component) DO UPDATE SET last_seen_at = excluded.last_seen_at
  `).run(component, now);
  return now;
}

function get(component) {
  const db = getDb();
  const row = db.prepare('SELECT component, last_seen_at FROM system_heartbeat WHERE component = ?').get(component);
  return row || null;
}

module.exports = { upsert, get };
