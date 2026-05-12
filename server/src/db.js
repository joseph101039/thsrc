'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const CONFIG = require('./config');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dbPath = path.resolve(CONFIG.DB_PATH);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  _db = new DatabaseSync(dbPath);
  _db.exec('PRAGMA journal_mode = WAL');
  _db.exec('PRAGMA busy_timeout = 5000');
  _initSchema(_db);
  _migrate(_db);
  return _db;
}

function _initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS passengers (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      id_number  TEXT NOT NULL,
      type       TEXT NOT NULL,
      email      TEXT NOT NULL,
      phone      TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id              TEXT PRIMARY KEY,
      passenger_id    TEXT NOT NULL,
      from_station    TEXT NOT NULL,
      to_station      TEXT NOT NULL,
      date            TEXT NOT NULL,
      desired_time    TEXT NOT NULL,
      earliest_time   TEXT NOT NULL,
      latest_time     TEXT NOT NULL,
      max_retries     INTEGER NOT NULL DEFAULT 10,
      scheduled_at    TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      retry_count     INTEGER NOT NULL DEFAULT 0,
      train_no        TEXT,
      ticket_no       TEXT,
      depart_time     TEXT,
      refund_status   TEXT,
      refund_message  TEXT,
      retry_wait_value INTEGER NOT NULL DEFAULT 2,
      retry_wait_unit  TEXT NOT NULL DEFAULT 'minute',
      ticket_adult    INTEGER NOT NULL DEFAULT 1,
      ticket_child    INTEGER NOT NULL DEFAULT 0,
      ticket_disabled INTEGER NOT NULL DEFAULT 0,
      ticket_senior   INTEGER NOT NULL DEFAULT 0,
      ticket_student  INTEGER NOT NULL DEFAULT 0,
      search_mode     TEXT NOT NULL DEFAULT 'time',
      train_no_target TEXT,
      owner_email     TEXT NOT NULL DEFAULT '',
      concurrency     INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS booking_attempts (
      id            TEXT PRIMARY KEY,
      booking_id    TEXT NOT NULL,
      attempted_at  TEXT NOT NULL,
      success       INTEGER NOT NULL,
      reason        TEXT
    );

    CREATE TABLE IF NOT EXISTS allowed_users (
      email       TEXT PRIMARY KEY COLLATE NOCASE,
      role        TEXT NOT NULL DEFAULT 'user',
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_heartbeat (
      component      TEXT PRIMARY KEY,
      last_seen_at   TEXT NOT NULL
    );

    -- Alert dispatcher 用 — 對每個 alert_key 記錄上次 firing/resolved 的時間,
    -- 給 30 分鐘 dedup 邏輯使用,server 重啟仍然保持節流狀態。
    -- last_sent_at 兼作 conditional UPDATE 的樂觀鎖(避免並發 webhook 雙推)。
    CREATE TABLE IF NOT EXISTS alert_state (
      alert_key       TEXT PRIMARY KEY,        -- Grafana payload labels 雜湊出的穩定 key
      last_status     TEXT NOT NULL,            -- firing | resolved
      last_seen_at    TEXT NOT NULL,            -- 最後一次收到此 key 的 webhook 時間
      last_sent_at    TEXT                      -- 最後一次 LINE push 成功時間;NULL 表示從未推送
    );

    -- 通用 key-value 設定表 — 後台可改的 toggle / 參數都進這裡
    CREATE TABLE IF NOT EXISTS settings (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
  `);
}

function _migrate(db) {
  const cols = db.prepare('PRAGMA table_info(passengers)').all().map(r => r.name);
  if (!cols.includes('phone')) {
    db.exec("ALTER TABLE passengers ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  db.prepare(`
    INSERT OR IGNORE INTO allowed_users (email, role, created_at)
    VALUES (?, 'admin', ?)
  `).run('joseph101039@gmail.com', new Date().toISOString());

  // 退票欄位 migration
  const bookingCols = db.prepare('PRAGMA table_info(bookings)').all().map(r => r.name);
  if (!bookingCols.includes('refund_status')) {
    db.exec("ALTER TABLE bookings ADD COLUMN refund_status TEXT");
  }
  if (!bookingCols.includes('refund_message')) {
    db.exec("ALTER TABLE bookings ADD COLUMN refund_message TEXT");
  }
  if (!bookingCols.includes('depart_time')) {
    db.exec("ALTER TABLE bookings ADD COLUMN depart_time TEXT");
  }
  if (!bookingCols.includes('retry_wait_value')) {
    db.exec("ALTER TABLE bookings ADD COLUMN retry_wait_value INTEGER NOT NULL DEFAULT 2");
  }
  if (!bookingCols.includes('retry_wait_unit')) {
    db.exec("ALTER TABLE bookings ADD COLUMN retry_wait_unit TEXT NOT NULL DEFAULT 'minute'");
  }
  if (!bookingCols.includes('ticket_adult')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_adult INTEGER NOT NULL DEFAULT 1");
  }
  if (!bookingCols.includes('ticket_child')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_child INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_disabled')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_disabled INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_senior')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_senior INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('ticket_student')) {
    db.exec("ALTER TABLE bookings ADD COLUMN ticket_student INTEGER NOT NULL DEFAULT 0");
  }
  if (!bookingCols.includes('search_mode')) {
    db.exec("ALTER TABLE bookings ADD COLUMN search_mode TEXT NOT NULL DEFAULT 'time'");
  }
  if (!bookingCols.includes('train_no_target')) {
    db.exec("ALTER TABLE bookings ADD COLUMN train_no_target TEXT");
  }
  if (!bookingCols.includes('concurrency')) {
    db.exec("ALTER TABLE bookings ADD COLUMN concurrency INTEGER NOT NULL DEFAULT 1");
  }
  if (!bookingCols.includes('owner_email')) {
    db.exec("ALTER TABLE bookings ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''");
    // 回填舊訂單的 owner_email（從 passengers 表取 email）
    db.exec(`
      UPDATE bookings
      SET owner_email = (
        SELECT p.email FROM passengers p WHERE p.id = bookings.passenger_id
      )
      WHERE owner_email = '' AND passenger_id IS NOT NULL
    `);
  }

  // settings 預設值 — 訂票通知開關;INSERT OR IGNORE 不覆寫使用者已改過的值
  const settingsNow = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  `);
  stmt.run('notification.bookingSuccess', 'true', settingsNow);
  stmt.run('notification.bookingFailure', 'true', settingsNow);
}

function _toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

module.exports = { getDb, _toCamel };
