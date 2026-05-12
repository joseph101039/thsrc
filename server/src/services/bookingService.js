'use strict';

const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');

function listBookings() {
  return bookingRepo.getAll();
}

function createBooking(data) {
  const { retryWaitUnit, retryWaitValue, ticketAdult, ticketChild, ticketDisabled, ticketSenior, ticketStudent, searchMode, trainNoTarget, concurrency, scheduledAt, immediate } = data;

  // 併發搶票驗證:1~MAX_CONCURRENCY,且僅限預約未來時間使用(避免立即下單浪費 captcha solver)
  if (concurrency !== undefined) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > CONFIG.MAX_CONCURRENCY) {
      throw Object.assign(new Error(`concurrency 必須為 1–${CONFIG.MAX_CONCURRENCY} 的整數`), { status: 400 });
    }
    // 立即下單強制 concurrency=1 — 即使前端可能繞過,服務端為單一信任源。
    if (concurrency > 1 && immediate) {
      throw Object.assign(new Error('立即下單不允許併發搶票,請設 concurrency=1'), { status: 400 });
    }
    if (concurrency > 1 && !scheduledAt) {
      throw Object.assign(new Error('併發搶票僅在預約未來時間時可用,立即下單請設 concurrency=1'), { status: 400 });
    }
    // scheduledAt 必須在未來 — 防止使用者傳過去時間繞過「預約模式」意圖
    if (concurrency > 1 && scheduledAt) {
      const t = Date.parse(scheduledAt);
      if (!Number.isFinite(t) || t <= Date.now()) {
        throw Object.assign(new Error('併發搶票時 scheduledAt 必須為未來時間'), { status: 400 });
      }
    }
  }

  const hasUnit  = retryWaitUnit  !== undefined;
  const hasValue = retryWaitValue !== undefined;
  if (hasUnit !== hasValue) {
    throw Object.assign(new Error('retryWaitUnit 和 retryWaitValue 必須同時提供'), { status: 400 });
  }
  if (hasUnit && !['minute', 'second'].includes(retryWaitUnit)) {
    throw Object.assign(new Error('retryWaitUnit 必須為 minute 或 second'), { status: 400 });
  }
  if (hasValue) {
    const effectiveUnit = retryWaitUnit ?? 'minute';
    const max = effectiveUnit === 'second' ? 300 : 60;
    if (!Number.isInteger(retryWaitValue) || retryWaitValue < 1 || retryWaitValue > max) {
      throw Object.assign(new Error('retryWaitValue 超出允許範圍'), { status: 400 });
    }
  }

  const tickets = {
    ticketAdult:    ticketAdult    ?? 1,
    ticketChild:    ticketChild    ?? 0,
    ticketDisabled: ticketDisabled ?? 0,
    ticketSenior:   ticketSenior   ?? 0,
    ticketStudent:  ticketStudent  ?? 0,
  };
  for (const [key, val] of Object.entries(tickets)) {
    if (!Number.isInteger(val) || val < 0 || val > 10) {
      throw Object.assign(new Error(`${key} 必須為 0–10 的整數`), { status: 400 });
    }
  }
  if (Object.values(tickets).reduce((a, b) => a + b, 0) < 1) {
    throw Object.assign(new Error('至少需要一張票'), { status: 400 });
  }

  const effectiveSearchMode = searchMode ?? 'time';
  if (!['time', 'train'].includes(effectiveSearchMode)) {
    throw Object.assign(new Error('searchMode 必須為 time 或 train'), { status: 400 });
  }
  if (effectiveSearchMode === 'train' && !trainNoTarget) {
    throw Object.assign(new Error('車次搜尋模式必須提供 trainNoTarget'), { status: 400 });
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
