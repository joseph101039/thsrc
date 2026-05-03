'use strict';

const bookingService = require('../services/bookingService');
const bookingRepo = require('../repositories/bookingRepo');
const { runRefund } = require('../services/refundEngineService');
const { runBooking } = require('../services/bookingEngineService');

/**
 * @swagger
 * /v1/bookings:
 *   get:
 *     summary: 取得所有訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 訂票列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 bookings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Booking'
 */
function listBookings(req, res) {
  try {
    res.json({ bookings: bookingService.listBookings() });
  } catch (err) {
    console.error('listBookings error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings:
 *   post:
 *     summary: 建立訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BookingInput'
 *     responses:
 *       200:
 *         description: 建立成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 id:
 *                   type: string
 */
function createBooking(req, res) {
  try {
    const result = bookingService.createBooking(req.body);
    if (req.body.immediate && result.id) {
      runBooking(result.id).catch(err => console.error('createBooking immediate runBooking error:', err.message));
    }
    res.json(result);
  } catch (err) {
    console.error('createBooking error:', err.message);
    const status = [400, 401, 403, 404, 409].includes(err.status) ? err.status : 500;
    res.status(status).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings/{id}:
 *   delete:
 *     summary: 刪除訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 刪除成功
 */
function deleteBooking(req, res) {
  try {
    res.json(bookingService.deleteBooking(req.params.id));
  } catch (err) {
    console.error('deleteBooking error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings/{id}/attempts:
 *   get:
 *     summary: 取得訂票嘗試記錄
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 嘗試記錄列表
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attempts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/BookingAttempt'
 */
function getAttempts(req, res) {
  try {
    res.json({ attempts: bookingService.getAttempts(req.params.id) });
  } catch (err) {
    console.error('getAttempts error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/bookings/{id}/cancel:
 *   post:
 *     summary: 取消等待中的訂票
 *     tags: [Bookings]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 取消成功
 *       400:
 *         description: 狀態不允許取消
 *       404:
 *         description: 找不到訂票
 */
function cancelBooking(req, res) {
  try {
    res.json(bookingService.cancelBooking(req.params.id));
  } catch (err) {
    console.error('cancelBooking error:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
}

function refundBooking(req, res) {
  try {
    const booking = bookingService.getBookingById(req.params.id);
    if (!booking) {
      return res.status(404).json({ error: '找不到訂票紀錄' });
    }
    if (booking.status !== 'success') {
      return res.status(400).json({ error: '只有成功訂票才能退票' });
    }
    if (booking.refundStatus === 'refunding' || booking.refundStatus === 'refunded') {
      return res.status(400).json({ error: '該訂票已在退票中或已完成退票' });
    }
    // 同步設為 refunding，防止重複提交（race condition）
    bookingRepo.updateFields(req.params.id, { refundStatus: 'refunding' });
    // 非同步執行退票，不等待
    runRefund(req.params.id).catch(err => console.error('refundBooking background error:', err.message));
    res.status(202).json({ success: true });
  } catch (err) {
    console.error('refundBooking error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listBookings, createBooking, deleteBooking, cancelBooking, getAttempts, refundBooking };
