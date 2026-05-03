'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY created_at DESC').all().map(_toCamel);
}

function getById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM bookings WHERE id=?').get(id));
}

function create({ passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime, maxRetries, scheduledAt }) {
  const id = uuidv4();
  const now = new Date().toISOString();
  getDb().prepare(`
    INSERT INTO bookings
      (id, passenger_id, from_station, to_station, date, desired_time, earliest_time, latest_time,
       max_retries, scheduled_at, status, retry_count, train_no, ticket_no, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, '', '', ?, ?)
  `).run(id, passengerId, fromStation, toStation, date, desiredTime, earliestTime, latestTime,
         maxRetries ?? 10, scheduledAt ?? null, now, now);
  return { success: true, id };
}

function updateFields(id, fields) {
  const now = new Date().toISOString();
  const allFields = { ...fields, updatedAt: now };
  const colMap = {
    status: 'status', retryCount: 'retry_count', trainNo: 'train_no',
    ticketNo: 'ticket_no', scheduledAt: 'scheduled_at', updatedAt: 'updated_at',
    refundStatus: 'refund_status', refundMessage: 'refund_message',
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

function getAttemptsByBookingId(bookingId) {
  return getDb().prepare(`
    SELECT * FROM booking_attempts WHERE booking_id = ? ORDER BY attempted_at ASC
  `).all(bookingId).map(_toCamel);
}

module.exports = {
  getAll, getById, create, updateFields, deleteById,
  getPending, getStuckRunning, getStuckRefunding,
  createAttempt, getAttemptsByBookingId,
};
