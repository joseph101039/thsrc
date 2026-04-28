'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');
const db = require('./db');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('./thsrc');
const { sendSuccessEmail, sendFailureEmail } = require('./mailer');

async function runBooking(bookingId) {
  const booking = db.getBookingById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  db.updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

  try {
    const { sessionId, token } = await thsrcInit();

    const trains = await thsrcQueryTrains(sessionId, token, {
      fromStation: booking.from_station,
      toStation: booking.to_station,
      date: booking.date,
      earliestTime: booking.earliest_time,
      latestTime: booking.latest_time,
    });

    if (trains.length === 0) {
      return handleRetry(booking, '無可用班次');
    }

    const bestTrain = selectBestTrain(trains, booking.desired_time);
    const captchaBase64 = await thsrcGetCaptcha(sessionId);

    const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: captchaBase64 }),
    });
    const { answer: captchaAnswer } = await captchaRes.json();
    console.log('驗證碼辨識結果：', captchaAnswer);

    db.updateBookingFields(bookingId, { trainNo: bestTrain.trainNo });

    const result = await thsrcSubmitBooking(sessionId, token, {
      trainNo: bestTrain.trainNo,
      captcha: captchaAnswer,
    });

    if (result.success) {
      db.updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.SUCCESS,
        ticketNo: result.ticketNo,
      });
      const passenger = db.getPassengerById(booking.passenger_id);
      const updatedBooking = db.getBookingById(bookingId);
      await sendSuccessEmail(passenger.email, updatedBooking, passenger);
      console.log('訂票成功：', bookingId, result.ticketNo);
    } else {
      return handleRetry(booking, result.error);
    }
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, err.message);
  }
}

function handleRetry(booking, reason) {
  const newRetryCount = (booking.retry_count || 0) + 1;
  db.updateBookingFields(booking.id, { retryCount: newRetryCount });

  if (newRetryCount >= booking.max_retries) {
    db.updateBookingFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    const passenger = db.getPassengerById(booking.passenger_id);
    if (passenger) {
      const updatedBooking = db.getBookingById(booking.id);
      sendFailureEmail(passenger.email, updatedBooking, passenger, reason).catch(console.error);
    }
    console.log('Booking failed after max retries:', booking.id);
  } else {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
    db.updateBookingFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    console.log('Scheduled retry', newRetryCount, '/', booking.max_retries, 'for booking:', booking.id);
  }
}

module.exports = { runBooking, handleRetry };
