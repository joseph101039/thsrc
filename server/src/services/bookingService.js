'use strict';

const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');

function listBookings() {
  return bookingRepo.getAll();
}

function createBooking(data) {
  const { retryWaitUnit } = data;
  if (retryWaitUnit !== undefined && !['minute', 'second'].includes(retryWaitUnit)) {
    throw Object.assign(new Error('retryWaitUnit 必須為 minute 或 second'), { status: 400 });
  }
  return bookingRepo.create(data);
}

function deleteBooking(id) {
  const booking = bookingRepo.getById(id);
  if (!booking) throw Object.assign(new Error('找不到訂票紀錄'), { status: 404 });
  const blocked = ['pending', 'running', 'refunding'];
  if (blocked.includes(booking.status) || booking.refundStatus === 'refunding') {
    throw Object.assign(new Error('進行中的訂票無法刪除'), { status: 400 });
  }
  return bookingRepo.deleteById(id);
}

function cancelBooking(id) {
  const booking = bookingRepo.getById(id);
  if (!booking) throw Object.assign(new Error('找不到訂票紀錄'), { status: 404 });
  if (booking.status !== CONFIG.BOOKING_STATUS.PENDING) {
    throw Object.assign(new Error('只有等待中的訂票才能取消'), { status: 400 });
  }
  const cancelled = bookingRepo.cancelIfPending(id);
  if (!cancelled) throw Object.assign(new Error('訂票已被排程器接管，無法取消'), { status: 409 });
  bookingRepo.createAttempt({ bookingId: id, success: false, reason: '使用者取消' });
  return { success: true };
}

function getAttempts(bookingId) {
  return bookingRepo.getAttemptsByBookingId(bookingId);
}

function getBookingById(id) {
  return bookingRepo.getById(id);
}

module.exports = { listBookings, createBooking, deleteBooking, cancelBooking, getAttempts, getBookingById };
