const WEB_UI_URL = 'https://your-github-pages-url'; // Plan 2 完成後更新

// 主入口：執行一次訂票嘗試
function runBooking(bookingId) {
  const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
  const booking = bookings.find(b => b.id === bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

  try {
    const { sessionId, token } = thsrcInit();

    const trains = thsrcQueryTrains(sessionId, token, {
      fromStation: booking.fromStation,
      toStation: booking.toStation,
      date: booking.date,
      earliestTime: booking.earliestTime,
      latestTime: booking.latestTime,
    });

    if (trains.length === 0) {
      return handleRetry(booking, bookingId, '無可用班次');
    }

    const bestTrain = selectBestTrain(trains, booking.desiredTime);
    const captchaBase64 = thsrcGetCaptcha(sessionId);

    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    const passenger = passengers.find(p => p.id === booking.passengerId);
    if (!passenger) throw new Error('Passenger not found: ' + booking.passengerId);

    PropertiesService.getScriptProperties().setProperty(
      'session_' + bookingId,
      JSON.stringify({
        sessionId,
        token,
        trainNo: bestTrain.trainNo,
        expireAt: Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000,
      })
    );

    updateBookingFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.WAITING_CAPTCHA,
      trainNo: bestTrain.trainNo,
    });

    sendCaptchaEmail(passenger.email, bookingId, captchaBase64, WEB_UI_URL);
    console.log('Waiting for captcha for booking:', bookingId);
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, bookingId, err.message);
  }
}

// submitCaptcha 後繼續訂票
function continueBookingWithCaptcha(bookingId, captcha) {
  const props = PropertiesService.getScriptProperties();
  const sessionJson = props.getProperty('session_' + bookingId);
  if (!sessionJson) throw new Error('No session found for booking: ' + bookingId);

  const session = JSON.parse(sessionJson);
  props.deleteProperty('session_' + bookingId);

  if (Date.now() > session.expireAt) {
    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    const booking = bookings.find(b => b.id === bookingId);
    return handleRetry(booking, bookingId, '驗證碼超時，重新嘗試');
  }

  const result = thsrcSubmitBooking(session.sessionId, session.token, {
    trainNo: session.trainNo,
    captcha,
  });

  const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
  const booking = bookings.find(b => b.id === bookingId);
  const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
  const passenger = passengers.find(p => p.id === booking.passengerId);

  if (result.success) {
    updateBookingFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
    });
    sendSuccessEmail(passenger.email, { ...booking, ticketNo: result.ticketNo }, passenger);
  } else {
    handleRetry(booking, bookingId, result.error);
  }
}

function handleRetry(booking, bookingId, reason) {
  const newRetryCount = (parseInt(booking.retryCount) || 0) + 1;
  updateBookingFields(bookingId, { retryCount: newRetryCount });

  if (newRetryCount >= booking.maxRetries) {
    updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.FAILED });
    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    const passenger = passengers.find(p => p.id === booking.passengerId);
    sendFailureEmail(passenger.email, { ...booking, retryCount: newRetryCount }, passenger, reason);
    console.log('Booking failed after max retries:', bookingId);
  } else {
    updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.PENDING });
    scheduleRetry(bookingId);
    console.log('Scheduled retry', newRetryCount, '/', booking.maxRetries, 'for booking:', bookingId);
  }
}

function updateBookingFields(bookingId, fields) {
  updateRowFields(CONFIG.SHEET_NAME_BOOKINGS, bookingId, CONFIG.BOOKING_COLS, {
    ...fields,
    updatedAt: new Date().toISOString(),
  });
}

function test_handleRetry() {
  const id = generateId();
  appendRow(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS, {
    id, passengerId: 'p1', fromStation: '台北', toStation: '左營',
    date: '2026-05-01', desiredTime: '09:00', earliestTime: '08:00',
    latestTime: '11:00', maxRetries: 3, scheduledAt: '', status: 'running',
    retryCount: 0, trainNo: '', ticketNo: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  const fakeBooking = { id, passengerId: 'p1', maxRetries: 3, retryCount: 0 };
  handleRetry(fakeBooking, id, '測試失敗原因');

  const b = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS).find(x => x.id === id);
  console.log('After 1st retry:', b.status, b.retryCount); // pending, 1

  handleRetry({ ...fakeBooking, retryCount: 1 }, id, '測試失敗原因');
  handleRetry({ ...fakeBooking, retryCount: 2 }, id, '測試失敗原因');
  const b2 = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS).find(x => x.id === id);
  console.log('After max retries:', b2.status, b2.retryCount); // failed, 3

  deleteRowById(CONFIG.SHEET_NAME_BOOKINGS, id);
}
