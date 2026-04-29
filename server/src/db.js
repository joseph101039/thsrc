'use strict';

const { DatabaseSync } = require('node:sqlite');
const { v4: uuidv4 } = require('uuid');
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
  `);
}

function _migrate(db) {
  // passengers.phone — 既有 DB 沒有此欄位時自動補上
  const cols = db.prepare("PRAGMA table_info(passengers)").all().map(r => r.name);
  if (!cols.includes('phone')) {
    db.exec("ALTER TABLE passengers ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
}

// ── snake_case → camelCase ────────────────────────────────────

function _toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[camel] = v;
  }
  return out;
}

// ── Passengers ──────────────────────────────────────────────

function getPassengers() {
  return getDb().prepare('SELECT * FROM passengers').all().map(_toCamel);
}

function savePassenger({ id, name, idNumber, type, email, phone }) {
  const db = getDb();
  const phoneVal = phone || '';
  if (id) {
    db.prepare(
      'UPDATE passengers SET name=?, id_number=?, type=?, email=?, phone=? WHERE id=?'
    ).run(name, idNumber, type, email, phoneVal, id);
    return { success: true, id };
  }
  const newId = uuidv4();
  db.prepare(
    'INSERT INTO passengers (id, name, id_number, type, email, phone) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(newId, name, idNumber, type, email, phoneVal);
  return { success: true, id: newId };
}

function deletePassenger(id) {
  getDb().prepare('DELETE FROM passengers WHERE id=?').run(id);
  return { success: true };
}

// ── Bookings ─────────────────────────────────────────────────

function getBookings() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY created_at DESC').all().map(_toCamel);
}

function createBooking({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries || 10, scheduledAt || null, now, now);
  return { success: true, id };
}

function updateBookingFields(id, fields) {
  const now = new Date().toISOString();
  const allFields = { ...fields, updatedAt: now };
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
  };
  const setClauses = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => `${colMap[k]} = ?`).join(', ');
  const values = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => allFields[k]);
  getDb().prepare(`UPDATE bookings SET ${setClauses} WHERE id = ?`).run(...values, id);
}

function deleteBooking(id) {
  getDb().prepare('DELETE FROM bookings WHERE id=?').run(id);
  return { success: true };
}

function getBookingById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM bookings WHERE id=?').get(id));
}

function getPassengerById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM passengers WHERE id=?').get(id));
}

function getPendingBookings() {
  return _toCamel(getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(new Date().toISOString()));
}

function getStuckRunningBookings() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings WHERE status = 'running' AND updated_at < ?
  `).all(cutoff).map(_toCamel);
}

module.exports = {
  getPassengers, savePassenger, deletePassenger,
  getBookings, createBooking, updateBookingFields, deleteBooking,
  getBookingById, getPassengerById,
  getPendingBookings, getStuckRunningBookings,
};
