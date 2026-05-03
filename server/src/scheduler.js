'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const bookingRepo = require('./repositories/bookingRepo');
const { runBooking } = require('./services/bookingEngineService');
const { runRefund } = require('./services/refundEngineService');

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

  const stuck = bookingRepo.getStuckRunning();
  for (const b of stuck) {
    console.log(`  [stuck] reset booking ${b.id}`);
    bookingRepo.updateFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
  }

  const next = bookingRepo.getPending();
  if (next) {
    console.log(`  [run] bookingId=${next.id} ${next.fromStation}→${next.toStation} ${next.date} ${next.earliestTime}~${next.latestTime} retry=${next.retryCount}/${next.maxRetries}`);
    await runBooking(next.id);
  } else {
    console.log('  [idle] no pending bookings');
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
