'use strict';

const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM allowed_users ORDER BY created_at ASC').all().map(_toCamel);
}

function getByEmail(email) {
  return _toCamel(getDb().prepare('SELECT * FROM allowed_users WHERE email = ?').get(email.toLowerCase()));
}

function isAllowed(email) {
  const row = getDb().prepare('SELECT 1 FROM allowed_users WHERE email = ?').get(email.toLowerCase());
  return !!row;
}

function add({ email, role }) {
  if (!email || typeof email !== 'string') return { success: false, error: '缺少 email' };
  const existing = getDb().prepare('SELECT 1 FROM allowed_users WHERE email = ?').get(email.toLowerCase());
  if (existing) return { success: false, error: '帳號已存在' };
  getDb().prepare(
    'INSERT INTO allowed_users (email, role, created_at) VALUES (?, ?, ?)'
  ).run(email.toLowerCase(), role, new Date().toISOString());
  return { success: true };
}

function deleteByEmail(email) {
  getDb().prepare('DELETE FROM allowed_users WHERE email = ?').run(email.toLowerCase());
  return { success: true };
}

module.exports = { getAll, getByEmail, isAllowed, add, deleteByEmail };
