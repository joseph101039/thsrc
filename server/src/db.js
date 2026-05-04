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
      id            TEXT PRIMARY KEY,
      passenger_id  TEXT NOT NULL,
      from_station  TEXT NOT NULL,
      to_station    TEXT NOT NULL,
      date          TEXT NOT NULL,
      desired_time  TEXT NOT NULL,
      earliest_time TEXT NOT NULL,
      latest_time   TEXT NOT NULL,
      max_retries   INTEGER NOT NULL DEFAULT 10,
      scheduled_at  TEXT,
      status        TEXT NOT NULL DEFAULT 'pending',
      retry_count   INTEGER NOT NULL DEFAULT 0,
      train_no      TEXT,
      ticket_no     TEXT,
      created_at    TEXT NOT NULL,
      updated_at    TEXT NOT NULL
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
  if (!bookingCols.includes('owner_email')) {
    db.exec("ALTER TABLE bookings ADD COLUMN owner_email TEXT NOT NULL DEFAULT ''");
  }
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
