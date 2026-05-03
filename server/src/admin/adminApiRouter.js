'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('./controllers/adminDbController');

function requireSession(req, res, next) {
  if (req.session && req.session.adminAuthed) return next();
  res.status(401).json({ error: '未登入' });
}

router.use(requireSession);

router.get('/tables', (req, res) => {
  try {
    res.json({ tables: ctrl.listTables() });
  } catch (e) {
    console.error('列出資料表失敗', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/:table/schema', (req, res) => {
  try {
    res.json({ schema: ctrl.getSchema(req.params.table) });
  } catch (e) {
    console.error('讀取 schema 失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.get('/:table', (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 200);
    const search = req.query.search || '';
    const result = ctrl.getRows(req.params.table, { page, limit, search });
    res.json(result);
  } catch (e) {
    console.error('查詢資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.get('/:table/:id', (req, res) => {
  try {
    const row = ctrl.getRow(req.params.table, req.params.id);
    if (!row) return res.status(404).json({ error: '找不到資料' });
    res.json({ row });
  } catch (e) {
    console.error('讀取單筆失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.post('/:table', (req, res) => {
  try {
    ctrl.insertRow(req.params.table, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('新增資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.put('/:table/:id', (req, res) => {
  try {
    ctrl.updateRow(req.params.table, req.params.id, req.body);
    res.json({ success: true });
  } catch (e) {
    console.error('更新資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:table/:id', (req, res) => {
  try {
    ctrl.deleteRow(req.params.table, req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error('刪除資料失敗', e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
