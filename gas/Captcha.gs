function submitCaptcha(bookingId, captcha) {
  if (!bookingId || !captcha) {
    return { error: 'bookingId and captcha are required' };
  }

  const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) return { error: 'Booking not found: ' + bookingId };
  if (booking.status !== CONFIG.BOOKING_STATUS.WAITING_CAPTCHA) {
    return { error: 'Booking is not waiting for captcha. Status: ' + booking.status };
  }

  try {
    continueBookingWithCaptcha(bookingId, captcha);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
}

function test_submitCaptcha_validation() {
  const r1 = submitCaptcha('nonexistent-id', '1234');
  console.log('nonexistent:', r1.error);

  const id = generateId();
  appendRow(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS, {
    id, passengerId: 'p1', fromStation: '台北', toStation: '左營',
    date: '2026-05-01', desiredTime: '09:00', earliestTime: '08:00',
    latestTime: '11:00', maxRetries: 3, scheduledAt: '', status: 'running',
    retryCount: 0, trainNo: '', ticketNo: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const r2 = submitCaptcha(id, '1234');
  console.log('wrong status:', r2.error);
  deleteRowById(CONFIG.SHEET_NAME_BOOKINGS, id);
}
