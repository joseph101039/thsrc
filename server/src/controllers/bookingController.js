'use strict';

const bookingService = require('../services/bookingService');
const { runRefund } = require('../services/refundEngineService');

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
    res.json(bookingService.createBooking(req.body));
  } catch (err) {
    console.error('createBooking error:', err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    // 非同步執行退票，不等待
    runRefund(req.params.id).catch(err => console.error('refundBooking background error:', err.message));
    res.status(202).json({ success: true });
  } catch (err) {
    console.error('refundBooking error:', err.message);
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listBookings, createBooking, deleteBooking, getAttempts, refundBooking };
