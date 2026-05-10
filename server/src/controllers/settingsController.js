'use strict';

const settingsService = require('../services/settingsService');
const logger = require('../logger');

/**
 * @swagger
 * /v1/settings/notification:
 *   get:
 *     summary: 取得訂票通知開關狀態（admin only）
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 目前開關狀態
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookingSuccess:
 *                   type: boolean
 *                 bookingFailure:
 *                   type: boolean
 */
function getNotification(req, res) {
  try {
    res.json(settingsService.getNotificationToggles());
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'getNotification error');
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/settings/notification:
 *   put:
 *     summary: 更新訂票通知開關（admin only）
 *     tags: [Settings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               bookingSuccess:
 *                 type: boolean
 *               bookingFailure:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: 更新成功,回傳最新狀態
 *       422:
 *         description: body 欄位型別錯誤
 */
function putNotification(req, res) {
  try {
    const body = req.body || {};
    const allowedFields = ['bookingSuccess', 'bookingFailure'];
    // 拒未知欄位 — 避免管理員打錯欄位名沒 feedback
    const unknown = Object.keys(body).filter(k => !allowedFields.includes(k));
    if (unknown.length > 0) {
      return res.status(422).json({ error: `unknown fields: ${unknown.join(', ')}` });
    }
    // 至少要更新一個欄位,空 body 視為錯誤
    const provided = allowedFields.filter(f => body[f] !== undefined);
    if (provided.length === 0) {
      return res.status(422).json({ error: 'at least one of bookingSuccess/bookingFailure required' });
    }
    // 型別檢查
    for (const f of provided) {
      if (typeof body[f] !== 'boolean') {
        return res.status(422).json({ error: `${f} must be boolean` });
      }
    }
    if (body.bookingSuccess !== undefined) settingsService.setBookingSuccessNotify(body.bookingSuccess);
    if (body.bookingFailure !== undefined) settingsService.setBookingFailureNotify(body.bookingFailure);
    res.json({ ok: true, current: settingsService.getNotificationToggles() });
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'putNotification error');
    res.status(500).json({ error: err.message });
  }
}

module.exports = { getNotification, putNotification };
