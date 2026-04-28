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
  const stuck = db.getStuckRunningBookings();
  for (const b of stuck) {
    console.log('Resetting stuck booking:', b.id);
    db.updateBookingFields(b.id, { status: CONFIG.BOOKING_STATUS.PENDING });
  }

  const next = db.getPendingBookings();
  if (next) {
    console.log('Polling: running booking', next.id);
    await runBooking(next.id);
  }
}
