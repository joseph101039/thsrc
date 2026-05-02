'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const bookingRepo = require('./repositories/bookingRepo');
const { runBooking } = require('./services/bookingEngineService');

console.log('Scheduler started');

schedule.scheduleJob('* * * * *', async () => {
  try {
    await pollPendingBookings();
  } catch (err) {
    console.error('pollPendingBookings error:', err.message);
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
