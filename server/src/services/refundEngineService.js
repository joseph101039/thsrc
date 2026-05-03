'use strict';

const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcCancelBooking } = require('../thsrc');

const REFUND_TIMEOUT_MS = 120000;

async function runRefund(bookingId) {
  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  bookingRepo.updateFields(bookingId, { refundStatus: CONFIG.REFUND_STATUS.REFUNDING });
  console.log('runRefund start:', bookingId, booking.ticketNo);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('退票逾時（120秒）')), REFUND_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doRefund(bookingId, booking), timeout]);
  } catch (err) {
    console.error('runRefund error:', err.message);
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: err.message,
    });
    bookingRepo.createAttempt({ bookingId, success: false, reason: '退票失敗：' + err.message });
  }
}

async function _doRefund(bookingId, booking) {
  const passenger = passengerRepo.getById(booking.passengerId);
  if (!passenger) throw new Error('旅客資料不存在：' + booking.passengerId);

  const result = await thsrcCancelBooking(booking.ticketNo, { idNumber: passenger.idNumber });
  console.log('_doRefund result:', result);

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUNDED,
      refundMessage: result.message,
    });
    bookingRepo.createAttempt({ bookingId, success: true, reason: '退票成功：' + (result.message || '') });
    console.log('退票成功：', bookingId, booking.ticketNo);
  } else {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: result.message,
    });
    bookingRepo.createAttempt({ bookingId, success: false, reason: '退票失敗：' + (result.message || '') });
    console.log('退票失敗：', bookingId, result.message);
  }
}

module.exports = { runRefund };
