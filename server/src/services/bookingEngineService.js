'use strict';

const fetch = require('node-fetch');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('../thsrc');

const BOOKING_TIMEOUT_MS = 120000;

async function runBooking(bookingId) {
  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  bookingRepo.updateFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('訂票逾時（120秒）')), BOOKING_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doBooking(bookingId, booking), timeout]);
  } catch (err) {
    console.error('runBooking error:', err.message);
    return handleRetry(booking, err.message);
  }
}

async function _doBooking(bookingId, booking) {
  console.log('  [1/5] thsrcInit...');
  const { cookieJar, formAction, captchaUrl, bookingMethod } = await thsrcInit();
  console.log(`  [1/5] done — bookingMethod=${bookingMethod} formAction=${formAction.slice(0, 60)}...`);

  console.log('  [2/5] thsrcGetCaptcha...');
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);
  console.log(`  [2/5] done — base64 length=${captchaBase64.length}`);

  console.log(`  [3/5] solving captcha via ${CONFIG.CAPTCHA_API_URL}/solve ...`);
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const captchaJson = await captchaRes.json();
  if (!captchaJson.answer) throw new Error('驗證碼辨識失敗：' + (captchaJson.detail || JSON.stringify(captchaJson)));
  const captchaAnswer = captchaJson.answer;
  console.log(`  [3/5] done — answer=${captchaAnswer} confidence=${captchaJson.confidence ? captchaJson.confidence.map(c => c.toFixed(2)).join(',') : 'n/a'}`);

  console.log(`  [4/5] thsrcQueryTrains ${booking.fromStation}→${booking.toStation} ${booking.date} ${booking.earliestTime}~${booking.latestTime}...`);
  const { trains, s2FormAction, cookieJar: queryCookieJar } = await thsrcQueryTrains(cookieJar, formAction, {
    fromStation: booking.fromStation,
    toStation: booking.toStation,
    date: booking.date,
    earliestTime: booking.earliestTime,
    latestTime: booking.latestTime,
    captcha: captchaAnswer,
    bookingMethod,
  });
  console.log(`  [4/5] done — ${trains.length} trains found, s2FormAction=${s2FormAction ? s2FormAction.slice(0, 60) + '...' : 'null'}`);
  trains.forEach(t => console.log(`    班次 ${t.trainNo} ${t.departTime}→${t.arriveTime} (${t.radioValue})`));

  if (trains.length === 0) {
    return handleRetry(booking, '無可用班次');
  }

  const bestTrain = selectBestTrain(trains, booking.desiredTime);
  console.log(`  [4/5] selected — 車次 ${bestTrain.trainNo} ${bestTrain.departTime}→${bestTrain.arriveTime} (desired=${booking.desiredTime})`);
  bookingRepo.updateFields(bookingId, { trainNo: bestTrain.trainNo });

  const passenger = passengerRepo.getById(booking.passengerId);
  console.log(`  [5/5] thsrcSubmitBooking trainNo=${bestTrain.trainNo} radioValue=${bestTrain.radioValue} passenger.idNumber=${passenger?.idNumber?.slice(0, 3)}... phone=${passenger?.phone} email=${passenger?.email}`);
  const result = await thsrcSubmitBooking(queryCookieJar, s2FormAction, {
    trainNo: bestTrain.radioValue,
    captcha: captchaAnswer,
    passenger: { idNumber: passenger.idNumber, phone: passenger.phone || '', email: passenger.email },
  });
  console.log(`  [5/5] done — success=${result.success} ticketNo=${result.ticketNo} error=${result.error}`);

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
    });
    bookingRepo.createAttempt({ bookingId, success: true, reason: null });
    console.log('  [done] 訂票成功：', bookingId, result.ticketNo);
  } else {
    return handleRetry(booking, result.error);
  }
}

function handleRetry(booking, reason) {
  const newRetryCount = (booking.retryCount || 0) + 1;
  bookingRepo.updateFields(booking.id, { retryCount: newRetryCount });
  bookingRepo.createAttempt({ bookingId: booking.id, success: false, reason });

  if (newRetryCount >= booking.maxRetries) {
    bookingRepo.updateFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    console.log('Booking failed after max retries:', booking.id);
  } else {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000).toISOString();
    bookingRepo.updateFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    console.log('Scheduled retry', newRetryCount, '/', booking.maxRetries, 'for booking:', booking.id);
  }
}

module.exports = { runBooking, handleRetry };
