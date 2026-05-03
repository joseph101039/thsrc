'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

// Create in-memory DB with one test table
let db;
before(() => {
  db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE test_items (id TEXT PRIMARY KEY, name TEXT NOT NULL)`);
});
after(() => db.close());

const { listTables, getSchema, getRows, getRow, insertRow, updateRow, deleteRow } =
  (() => {
    // Temporarily override getDb for unit tests
    const mod = require('../src/admin/controllers/adminDbController');
    mod._setDb(db);
    return mod;
  })();

describe('adminDbController', () => {
  it('listTables returns test_items', () => {
    const tables = listTables();
    assert.ok(tables.some(t => t.name === 'test_items'));
  });

  it('getSchema returns id and name columns', () => {
    const cols = getSchema('test_items');
    assert.deepEqual(cols.map(c => c.name), ['id', 'name']);
  });

  it('insertRow inserts and getRow retrieves', () => {
    insertRow('test_items', { id: '1', name: 'Alpha' });
    const row = getRow('test_items', '1');
    assert.equal(row.name, 'Alpha');
  });

  it('getRows returns paginated results', () => {
    insertRow('test_items', { id: '2', name: 'Beta' });
    const { rows, total } = getRows('test_items', { page: 1, limit: 10, search: '' });
    assert.equal(total, 2);
    assert.equal(rows.length, 2);
  });

  it('getRows search filters by name', () => {
    const { rows } = getRows('test_items', { page: 1, limit: 10, search: 'Alp' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Alpha');
  });

  it('updateRow updates name', () => {
    updateRow('test_items', '1', { name: 'Alpha Updated' });
    const row = getRow('test_items', '1');
    assert.equal(row.name, 'Alpha Updated');
  });

  it('deleteRow removes the row', () => {
    deleteRow('test_items', '1');
    const row = getRow('test_items', '1');
    assert.equal(row, undefined);
  });
});
