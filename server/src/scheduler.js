'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const bookingRepo = require('./repositories/bookingRepo');
const { runBooking } = require('./services/bookingEngineService');
const { runRefund } = require('./services/refundEngineService');

// 提前多少毫秒排入 setTimeout（讓 runBooking 在 scheduled_at 前開始準備）
const SCHEDULE_AHEAD_MS = 2 * 60 * 1000; // 2 分鐘
// 輪詢時往前看多遠的訂單
const LOOKAHEAD_MS = 5 * 60 * 1000; // 5 分鐘

// 已排程的 booking id（in-memory，程序重啟後由下次輪詢重新補入）
const scheduledIds = new Set();

console.log('Scheduler started');

schedule.scheduleJob('* * * * *', async () => {
  try {
    await pollPendingBookings();
  } catch (err) {
    console.error('pollPendingBookings error:', err.message);
  }
  try {
    await pollStuckRefunds();
  } catch (err) {
    console.error('pollStuckRefunds error:', err.message);
  }
});

async function pollPendingBookings() {
  const now = new Date().toISOString();
  console.log(`[${now}] poll`);

  // 重置卡住的 running bookings
  const stuck = bookingRepo.getStuckRunning();
  for (const b of stuck) {
    console.log(`  [stuck] reset booking ${b.id}`);
    bookingRepo.updateFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
    scheduledIds.delete(b.id);
  }

  // 立即執行：scheduled_at 已過期或無排程時間的所有 pending（runBooking 內部 atomic CAS 防重複）
  const overdue = bookingRepo.getAllOverduePending();
  for (const b of overdue) {
    console.log(`  [run] bookingId=${b.id} ${b.fromStation}→${b.toStation} ${b.date} ${b.earliestTime}~${b.latestTime} retry=${b.retryCount}/${b.maxRetries}`);
    runBooking(b.id).catch(err => console.error(`  [run] bookingId=${b.id} error:`, err.message));
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
      console.error(`  [schedule] invalid scheduled_at bookingId=${b.id} value=${b.scheduledAt}`);
      continue;
    }

    const delay = targetTime - SCHEDULE_AHEAD_MS - Date.now();
    if (delay < 0) continue; // 已過期，由 getAllOverduePending 處理

    scheduledIds.add(b.id);
    console.log(`  [schedule] bookingId=${b.id} scheduled_at=${b.scheduledAt} delay=${Math.round(delay / 1000)}s`);

    setTimeout(async () => {
      scheduledIds.delete(b.id);
      console.log(`  [precise-run] bookingId=${b.id}`);
      // runBooking 內部 tryClaimBooking atomic CAS，已取消或重複觸發會自動 skip
      runBooking(b.id).catch(err => console.error(`  [precise-run] bookingId=${b.id} error:`, err.message));
    }, delay);
  }
}

async function pollStuckRefunds() {
  const stuckRefunds = bookingRepo.getStuckRefunding();
  for (const b of stuckRefunds) {
    console.log(`  [stuck-refund] retry refund bookingId=${b.id} ticketNo=${b.ticketNo}`);
    bookingRepo.updateFields(b.id, { refundStatus: CONFIG.REFUND_STATUS.REFUNDING });
    runRefund(b.id).catch(err => console.error('pollStuckRefunds runRefund error:', err.message));
  }
}
