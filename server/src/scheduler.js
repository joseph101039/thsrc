'use strict';

const schedule = require('node-schedule');
const CONFIG = require('./config');
const db = require('./db');
const { runBooking } = require('./booking_engine');

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

  const stuck = db.getStuckRunningBookings();
  for (const b of stuck) {
    console.log(`  [stuck] reset booking ${b.id}`);
    db.updateBookingFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
  }

  const next = db.getPendingBookings();
  if (next) {
    console.log(`  [run] bookingId=${next.id} ${next.fromStation}→${next.toStation} ${next.date} ${next.earliestTime}~${next.latestTime} retry=${next.retryCount}/${next.maxRetries}`);
    await runBooking(next.id);
  } else {
    console.log('  [idle] no pending bookings');
  }
}
