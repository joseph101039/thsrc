'use strict';

const logger = require('../logger');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcCancelBooking } = require('../thsrc');
const lineNotifier = require('./lineNotifier');
const metrics = require('../metrics');

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

// per-booking semaphore — 同一 booking 的多個輸家退票需序列化,
// 避免 N>2 時多個 loser 同時對 THSRC 發起退票流程,觸發反濫用機制。
const _refundLocks = new Map(); // bookingId -> Promise chain tail
function _withBookingRefundLock(bookingId, fn) {
  const prev = _refundLocks.get(bookingId) || Promise.resolve();
  const next = prev.then(fn, fn);
  // 寫回 tail 但加上 cleanup,避免無限累積
  _refundLocks.set(bookingId, next.finally(() => {
    if (_refundLocks.get(bookingId) === next) _refundLocks.delete(bookingId);
  }));
  return next;
}

// 併發搶票輸家退票:拿到票但 CAS 輸給其他 worker 的副本票,需立即退掉。
// 與 runRefund 不同的是不寫 booking row(贏家還在用 booking.ticketNo)。
// 失敗時自動重試 LOSER_REFUND_RETRIES 次,間隔 LOSER_REFUND_INTERVAL_MS;
// 全部失敗才發 LINE 給 admin 手動處理。
// 同一 booking 的多個輸家會被序列化處理(_withBookingRefundLock)。
async function runRefundByTicketNo(args) {
  return _withBookingRefundLock(args.bookingId, () => _runRefundByTicketNoInner(args));
}

async function _runRefundByTicketNoInner({ bookingId, ticketNo, idNumber, parentLog }) {
  const log = (parentLog || logger).child({ booking_id: bookingId, ticket_no: ticketNo, refund_kind: 'loser' });
  log.info('runRefundByTicketNo start');

  const maxRetries = CONFIG.LOSER_REFUND_RETRIES;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await Promise.race([
        thsrcCancelBooking(ticketNo, { idNumber }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('退票逾時（120秒）')), REFUND_TIMEOUT_MS)),
      ]);
      if (result.success) {
        bookingRepo.createAttempt({
          bookingId,
          success: true,
          reason: `輸家票退票成功 (ticket_no=${ticketNo}, attempt=${attempt}): ${result.message || ''}`,
        });
        metrics.bookingWorkerOutcomeTotal.inc({ outcome: 'loser_refunded' });
        log.info({ attempt }, '輸家票退票成功');
        return { ok: true };
      }
      log.warn({ attempt, message: result.message }, '輸家票退票失敗,排程下次重試');
      bookingRepo.createAttempt({
        bookingId,
        success: false,
        reason: `輸家票退票失敗 (ticket_no=${ticketNo}, attempt=${attempt}/${maxRetries}): ${result.message || ''}`,
      });
    } catch (err) {
      log.warn({ attempt, err: err.message }, '輸家票退票例外,排程下次重試');
      bookingRepo.createAttempt({
        bookingId,
        success: false,
        reason: `輸家票退票例外 (ticket_no=${ticketNo}, attempt=${attempt}/${maxRetries}): ${err.message}`,
      });
    }
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.LOSER_REFUND_INTERVAL_MS));
    }
  }

  // 重試耗盡仍失敗 — 發 LINE 通知 admin 手動處理
  metrics.bookingWorkerOutcomeTotal.inc({ outcome: 'loser_refund_failed' });
  log.error('輸家票退票全部重試失敗,需手動處理');
  lineNotifier.pushText(
    `⚠️ 輸家票退票失敗\nbooking_id=${bookingId}\nticket_no=${ticketNo}\n已重試 ${maxRetries} 次仍失敗,請手動至 THSRC 退票`
  ).catch(err => log.error({ err: err.message }, 'admin 通知 push 失敗'));
  return { ok: false };
}

module.exports = { runRefund, runRefundByTicketNo };
