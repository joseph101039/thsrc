'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY created_at DESC').all().map(_toCamel);
}

function getById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM bookings WHERE id=?').get(id));
}

function create({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt, retryWaitValue, retryWaitUnit, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent, searchMode, trainNoTarget, ownerEmail }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no,
       retry_wait_value, retry_wait_unit,
       ticket_adult, ticket_child, ticket_disabled, ticket_senior, ticket_student,
       search_mode, train_no_target, owner_email,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries ?? 10, scheduledAt ?? null,
         retryWaitValue ?? 2, retryWaitUnit ?? 'minute',
         ticketAdult ?? 1, ticketChild ?? 0, ticketDisabled ?? 0, ticketSenior ?? 0, ticketStudent ?? 0,
         searchMode ?? 'time', trainNoTarget ?? null, ownerEmail ?? '',
         now, now);
  return { success: true, id };
}

function updateFields(id, fields) {
  const now = new Date().toISOString();
  const allFields = { ...fields, updatedAt: now };
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', departTime: 'depart_time', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
    refundStatus: 'refund_status', refundMessage: 'refund_message',
    retryWaitValue: 'retry_wait_value', retryWaitUnit: 'retry_wait_unit',
  };
  const setClauses = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => `${colMap[k]} = ?`).join(', ');
  const values = Object.keys(allFields)
    .filter(k => colMap[k])
    .map(k => allFields[k]);
  getDb().prepare(`UPDATE bookings SET ${setClauses} WHERE id = ?`).run(...values, id);
}

function deleteById(id) {
  getDb().prepare('DELETE FROM bookings WHERE id=?').run(id);
  return { success: true };
}

function getPending() {
  return _toCamel(getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY created_at ASC
    LIMIT 1
  `).get(new Date().toISOString()));
}

// 撈出所有已到期的 pending bookings（無 LIMIT，避免輪詢只處理第一筆）
function getAllOverduePending() {
  return getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND (scheduled_at IS NULL OR scheduled_at <= ?)
    ORDER BY created_at ASC
  `).all(new Date().toISOString()).map(_toCamel);
}

// Atomic CAS：只有在 status 仍為 'pending' 時才更新為 'cancelled'，回傳是否成功
function cancelIfPending(id) {
  const now = new Date().toISOString();
  const result = getDb().prepare(`
    UPDATE bookings SET status = 'cancelled', updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, id);
  return result.changes === 1;
}

// Atomic CAS：只有在 status 仍為 'pending' 時才更新為 'running'，回傳是否搶到鎖
function tryClaimBooking(id) {
  const now = new Date().toISOString();
  const result = getDb().prepare(`
    UPDATE bookings SET status = 'running', updated_at = ?
    WHERE id = ? AND status = 'pending'
  `).run(now, id);
  return result.changes === 1;
}

// 撈出未來 windowMs 毫秒內即將到期的 pending bookings（用於精準 setTimeout 排程）
function getPendingWithin(windowMs) {
  const now = new Date();
  const horizon = new Date(now.getTime() + windowMs).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings
    WHERE status = 'pending'
      AND scheduled_at IS NOT NULL
      AND scheduled_at > ?
      AND scheduled_at <= ?
    ORDER BY scheduled_at ASC
  `).all(now.toISOString(), horizon).map(_toCamel);
}

function getStuckRunning() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings WHERE status = 'running' AND updated_at < ?
  `).all(cutoff).map(_toCamel);
}

function getStuckRefunding() {
  const cutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  return getDb().prepare(`
    SELECT * FROM bookings WHERE refund_status = 'refunding' AND updated_at < ?
  `).all(cutoff).map(_toCamel);
}

function createAttempt({ bookingId, success, reason }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO booking_attempts (id, booking_id, attempted_at, success, reason)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, bookingId, now, success ? 1 : 0, reason || null);
  return { success: true, id };
}

// 取最後一筆失敗 attempt — 用於失敗通知時帶最新 reason
function getLastFailedAttempt(bookingId) {
  return _toCamel(getDb().prepare(`
    SELECT id, attempted_at, reason FROM booking_attempts
    WHERE booking_id = ? AND success = 0
    ORDER BY attempted_at DESC LIMIT 1
  `).get(bookingId));
}

function getAttemptsByBookingId(bookingId) {
  return getDb().prepare(`
    SELECT * FROM booking_attempts WHERE booking_id = ? ORDER BY attempted_at ASC
  `).all(bookingId).map(_toCamel);
}

// 給 metrics gauge sample 用 — 回 { pending: N, running: N, success: N, failed: N, ... }
function countByStatus() {
  const rows = getDb().prepare(`SELECT status, COUNT(*) AS n FROM bookings GROUP BY status`).all();
  const out = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}

module.exports = {
  getAll, getById, create, updateFields, deleteById,
  getPending, getAllOverduePending, getPendingWithin, tryClaimBooking, cancelIfPending, getStuckRunning, getStuckRefunding,
  createAttempt, getAttemptsByBookingId, getLastFailedAttempt, countByStatus,
};
