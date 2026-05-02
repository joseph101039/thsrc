'use strict';

const { v4: uuidv4 } = require('uuid');
const { getDb, _toCamel } = require('../db');

function getAll() {
  return getDb().prepare('SELECT * FROM passengers').all().map(_toCamel);
}

function getById(id) {
  return _toCamel(getDb().prepare('SELECT * FROM passengers WHERE id=?').get(id));
}

function upsert({ id, name, idNumber, type, email, phone }) {
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

function deleteById(id) {
  getDb().prepare('DELETE FROM passengers WHERE id=?').run(id);
  return { success: true };
}

module.exports = { getAll, getById, upsert, deleteById };
