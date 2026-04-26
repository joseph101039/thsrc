function getBookings() {
  const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
  return { bookings };
}

function createBooking(data) {
  const {
    passengerId, fromStation, toStation, date,
    desiredTime, earliestTime, latestTime,
    maxRetries, scheduledAt,
  } = data;

  const now = new Date().toISOString();
  const id = generateId();

  appendRow(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS, {
    id,
    passengerId,
    fromStation,
    toStation,
    date,
    desiredTime,
    earliestTime,
    latestTime,
    maxRetries: maxRetries || 10,
    scheduledAt: scheduledAt || '',
    status: CONFIG.BOOKING_STATUS.PENDING,
    retryCount: 0,
    trainNo: '',
    ticketNo: '',
    createdAt: now,
    updatedAt: now,
  });

  if (scheduledAt) {
    scheduleBooking(id, new Date(scheduledAt));
  } else {
    // 立即訂票：用觸發器非同步執行，避免 doPost 超時
    scheduleBooking(id, new Date(Date.now() + 3000));
  }

  return { success: true, id };
}

function test_createBooking() {
  const result = createBooking({
    passengerId: 'test-passenger-id',
    fromStation: '台北',
    toStation: '左營',
    date: '2026-05-01',
    desiredTime: '09:00',
    earliestTime: '08:00',
    latestTime: '11:00',
    maxRetries: 3,
    scheduledAt: null,
  });
  console.log('createBooking result:', JSON.stringify(result));
  console.log('bookings:', JSON.stringify(getBookings()));
}
