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
    const captchaAnswer = solveCaptcha(captchaBase64);
    console.log('驗證碼辨識結果：', captchaAnswer);

    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    const passenger = passengers.find(p => p.id === booking.passengerId);
    if (!passenger) throw new Error('Passenger not found: ' + booking.passengerId);

    updateBookingFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.RUNNING,
      trainNo: bestTrain.trainNo,
    });

    const result = thsrcSubmitBooking(sessionId, token, {
      trainNo: bestTrain.trainNo,
      captcha: captchaAnswer,
    });

    if (result.success) {
      updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.SUCCESS,
        ticketNo: result.ticketNo,
      });
      sendSuccessEmail(passenger.email, { ...booking, trainNo: bestTrain.trainNo, ticketNo: result.ticketNo }, passenger);
      console.log('訂票成功：', bookingId, result.ticketNo);
    } else {
      return handleRetry(booking, bookingId, result.error);
    }
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, bookingId, err.message);
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
