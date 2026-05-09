'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const bookingRepo = require('./repositories/bookingRepo');
const { runBooking } = require('./services/bookingEngineService');
const { runRefund } = require('./services/refundEngineService');
const logger = require('./logger').child({ component: 'scheduler' });

// 提前多少毫秒排入 setTimeout（讓 runBooking 在 scheduled_at 前開始準備）
const SCHEDULE_AHEAD_MS = 2 * 60 * 1000; // 2 分鐘
// 輪詢時往前看多遠的訂單
const LOOKAHEAD_MS = 5 * 60 * 1000; // 5 分鐘

// 已排程的 booking id（in-memory，程序重啟後由下次輪詢重新補入）
const scheduledIds = new Set();

logger.info('Scheduler started');

schedule.scheduleJob('* * * * *', async () => {
  try {
    await pollPendingBookings();
  } catch (err) {
    logger.error({ err: err.message }, 'pollPendingBookings error');
  }
  try {
    await pollStuckRefunds();
  } catch (err) {
    logger.error({ err: err.message }, 'pollStuckRefunds error');
  }
});

async function pollPendingBookings() {
  const now = new Date().toISOString();
  logger.debug({ at: now }, 'poll');

  // 重置卡住的 running bookings
  const stuck = bookingRepo.getStuckRunning();
  for (const b of stuck) {
    logger.warn({ booking_id: b.id }, 'stuck booking reset');
    bookingRepo.updateFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
    scheduledIds.delete(b.id);
  }

  // 立即執行：scheduled_at 已過期或無排程時間的所有 pending（runBooking 內部 atomic CAS 防重複）
  const overdue = bookingRepo.getAllOverduePending();
  for (const b of overdue) {
    logger.info({
      booking_id: b.id,
      from: b.fromStation,
      to: b.toStation,
      date: b.date,
      earliest: b.earliestTime,
      latest: b.latestTime,
      retry: b.retryCount,
      max_retries: b.maxRetries,
    }, 'run booking');
    runBooking(b.id).catch(err => logger.error({ booking_id: b.id, err: err.message }, 'run booking error'));
  }

  // 精準排程：未來 LOOKAHEAD_MS 內即將到期的 pending
  scheduleFutureBookings();
}

function scheduleFutureBookings() {
  const upcoming = bookingRepo.getPendingWithin(LOOKAHEAD_MS);
  for (const b of upcoming) {
    if (scheduledIds.has(b.id)) continue;

    const targetTime = new Date(b.scheduledAt).getTime();
    if (!Number.isFinite(targetTime)) {
      logger.error({ booking_id: b.id, scheduled_at: b.scheduledAt }, 'invalid scheduled_at');
      continue;
    }

    const delay = targetTime - SCHEDULE_AHEAD_MS - Date.now();
    if (delay < 0) continue; // 已過期，由 getAllOverduePending 處理

    scheduledIds.add(b.id);
    logger.info({ booking_id: b.id, scheduled_at: b.scheduledAt, delay_s: Math.round(delay / 1000) }, 'schedule future booking');

    setTimeout(async () => {
      scheduledIds.delete(b.id);
      logger.info({ booking_id: b.id }, 'precise-run');
      // runBooking 內部 tryClaimBooking atomic CAS，已取消或重複觸發會自動 skip
      runBooking(b.id).catch(err => logger.error({ booking_id: b.id, err: err.message }, 'precise-run error'));
    }, delay);
  }
}

async function pollStuckRefunds() {
  const stuckRefunds = bookingRepo.getStuckRefunding();
  for (const b of stuckRefunds) {
    logger.warn({ booking_id: b.id, ticket_no: b.ticketNo }, 'stuck refund retry');
    bookingRepo.updateFields(b.id, { refundStatus: CONFIG.REFUND_STATUS.REFUNDING });
    runRefund(b.id).catch(err => logger.error({ booking_id: b.id, err: err.message }, 'pollStuckRefunds runRefund error'));
  }
}
