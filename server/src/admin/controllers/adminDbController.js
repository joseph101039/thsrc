'use strict';

const { getDb } = require('../../db');

const TABLE_NAME_RE = /^[a-zA-Z0-9_]+$/;

let _testDb = null;
function _setDb(db) { _testDb = db; }
function db() { return _testDb || getDb(); }

function _assertTableName(table) {
  if (!TABLE_NAME_RE.test(table)) throw new Error(`無效的資料表名稱: ${table}`);
}

function listTables() {
  const rows = db().prepare(
    `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`
  ).all();
  return rows.map(r => {
    const count = db().prepare(`SELECT COUNT(*) as c FROM "${r.name}"`).get();
    return { name: r.name, rowCount: count.c };
  });
}

function getSchema(table) {
  _assertTableName(table);
  return db().prepare(`PRAGMA table_info("${table}")`).all();
}

function _pkColumn(table) {
  const cols = getSchema(table);
  const pk = cols.find(c => c.pk === 1);
  return pk ? pk.name : 'rowid';
}

function _textColumns(table) {
  return getSchema(table)
    .filter(c => /TEXT|CHAR|CLOB/i.test(c.type) || c.type === '')
    .map(c => c.name);
}

function getRows(table, { page = 1, limit = 50, search = '' } = {}) {
  _assertTableName(table);
  const offset = (page - 1) * limit;
  let where = '';
  let params = [];
  if (search) {
    const textCols = _textColumns(table);
    if (textCols.length > 0) {
      where = 'WHERE ' + textCols.map(c => `"${c}" LIKE ?`).join(' OR ');
      params = textCols.map(() => `%${search}%`);
    }
  }
  const total = db().prepare(`SELECT COUNT(*) as c FROM "${table}" ${where}`).get(...params).c;
  const rows = db().prepare(
    `SELECT * FROM "${table}" ${where} LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
  return { rows, total };
}

function getRow(table, id) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  return db().prepare(`SELECT * FROM "${table}" WHERE "${pk}" = ?`).get(id);
}

function insertRow(table, data) {
  _assertTableName(table);
  const keys = Object.keys(data);
  const cols = keys.map(k => `"${k}"`).join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  db().prepare(`INSERT INTO "${table}" (${cols}) VALUES (${placeholders})`).run(...Object.values(data));
}

function updateRow(table, id, data) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  const keys = Object.keys(data);
  const set = keys.map(k => `"${k}" = ?`).join(', ');
  db().prepare(`UPDATE "${table}" SET ${set} WHERE "${pk}" = ?`).run(...Object.values(data), id);
}

function deleteRow(table, id) {
  _assertTableName(table);
  const pk = _pkColumn(table);
  db().prepare(`DELETE FROM "${table}" WHERE "${pk}" = ?`).run(id);
}

module.exports = { listTables, getSchema, getRows, getRow, insertRow, updateRow, deleteRow, _setDb };
