'use strict';

const logger = require('../logger');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcCancelBooking } = require('../thsrc');

const REFUND_TIMEOUT_MS = 120000;

async function runRefund(bookingId) {
  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  const log = logger.child({ booking_id: bookingId });
  bookingRepo.updateFields(bookingId, { refundStatus: CONFIG.REFUND_STATUS.REFUNDING });
  log.info({ ticket_no: booking.ticketNo }, 'runRefund start');

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('退票逾時（120秒）')), REFUND_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doRefund(bookingId, booking, log), timeout]);
  } catch (err) {
    log.error({ err: err.message }, 'runRefund error');
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: err.message,
    });
    bookingRepo.createAttempt({ bookingId, success: false, reason: '退票失敗：' + err.message });
  }
}

async function _doRefund(bookingId, booking, log) {
  const passenger = passengerRepo.getById(booking.passengerId);
  if (!passenger) throw new Error('旅客資料不存在：' + booking.passengerId);

  const result = await thsrcCancelBooking(booking.ticketNo, { idNumber: passenger.idNumber });
  log.info({ success: result.success, message: result.message }, '_doRefund result');

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUNDED,
      refundMessage: result.message,
    });
    bookingRepo.createAttempt({ bookingId, success: true, reason: '退票成功：' + (result.message || '') });
    log.info({ ticket_no: booking.ticketNo }, '退票成功');
  } else {
    bookingRepo.updateFields(bookingId, {
      refundStatus: CONFIG.REFUND_STATUS.REFUND_FAILED,
      refundMessage: result.message,
    });
    bookingRepo.createAttempt({ bookingId, success: false, reason: '退票失敗：' + (result.message || '') });
    log.warn({ message: result.message }, '退票失敗');
  }
}

module.exports = { runRefund };
