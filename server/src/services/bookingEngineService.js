'use strict';

const logger = require('../logger');
const fetch = require('node-fetch');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('../thsrc');

const BOOKING_TIMEOUT_MS = 120000;

async function runBooking(bookingId) {
  const log = logger.child({ booking_id: bookingId });
  // Atomic CAS：只有搶到鎖（status pending→running）才執行，避免重複執行競態
  const claimed = bookingRepo.tryClaimBooking(bookingId);
  if (!claimed) {
    log.info('skip: already claimed by another runner');
    return;
  }

  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('訂票逾時（120秒）')), BOOKING_TIMEOUT_MS)
  );

  try {
    await Promise.race([_doBooking(bookingId, booking, log), timeout]);
  } catch (err) {
    log.error({ err: err.message }, 'runBooking error');
    return handleRetry(booking, err.message, log);
  }
}

async function _doBooking(bookingId, booking, log) {
  log.info('[1/5] thsrcInit');
  const { cookieJar, formAction, captchaUrl, bookingMethod, bookingMethodTrain } = await thsrcInit();
  log.info({ booking_method: bookingMethod, booking_method_train: bookingMethodTrain }, '[1/5] done');

  log.info('[2/5] thsrcGetCaptcha');
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);
  log.info({ captcha_b64_len: captchaBase64.length }, '[2/5] done');

  log.info({ url: CONFIG.CAPTCHA_API_URL + '/solve' }, '[3/5] solving captcha');
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const captchaJson = await captchaRes.json();
  if (!captchaJson.answer) throw new Error('驗證碼辨識失敗：' + (captchaJson.detail || JSON.stringify(captchaJson)));
  const captchaAnswer = captchaJson.answer;
  log.info({
    answer: captchaAnswer,
    confidence: captchaJson.confidence ? captchaJson.confidence.map(c => Number(c.toFixed(2))) : null,
  }, '[3/5] done');

  log.info({
    from: booking.fromStation, to: booking.toStation, date: booking.date,
    earliest: booking.earliestTime, latest: booking.latestTime,
    search_mode: booking.searchMode, train_no_target: booking.trainNoTarget,
  }, '[4/5] thsrcQueryTrains');
  const { trains, s2FormAction, isDirectS3, cookieJar: queryCookieJar } = await thsrcQueryTrains(cookieJar, formAction, {
    fromStation: booking.fromStation,
    toStation: booking.toStation,
    date: booking.date,
    earliestTime: booking.earliestTime,
    latestTime: booking.latestTime,
    captcha: captchaAnswer,
    bookingMethod,
    bookingMethodTrain,
    searchMode: booking.searchMode,
    trainNoTarget: booking.trainNoTarget,
    ticketAdult: booking.ticketAdult,
    ticketChild: booking.ticketChild,
    ticketDisabled: booking.ticketDisabled,
    ticketSenior: booking.ticketSenior,
    ticketStudent: booking.ticketStudent,
  });
  log.info({ trains_count: trains.length, is_direct_s3: isDirectS3 }, '[4/5] done');
  trains.forEach(t => log.debug({ train_no: t.trainNo, depart: t.departTime, arrive: t.arriveTime }, '  candidate'));

  // 車次模式：S1 直接回傳 S3 — trains 為空陣列，但 s2FormAction（實為 S3 URL）存在則繼續
  if (!isDirectS3 && trains.length === 0) {
    return handleRetry(booking, '無可用班次', log);
  }
  if (!s2FormAction) {
    return handleRetry(booking, '無可用班次', log);
  }

  // 車次模式：trainNo 為 booking.trainNoTarget，radioValue 在直接 S3 時不使用
  // 時間模式：選出最佳班次
  let trainNoForLog, radioValueForSubmit, bestTrain;
  if (isDirectS3) {
    trainNoForLog = booking.trainNoTarget;
    radioValueForSubmit = booking.trainNoTarget;
    bookingRepo.updateFields(bookingId, { trainNo: booking.trainNoTarget });
  } else {
    bestTrain = selectBestTrain(trains, booking.desiredTime);
    log.info({ train_no: bestTrain.trainNo, depart: bestTrain.departTime, arrive: bestTrain.arriveTime, desired: booking.desiredTime }, '[4/5] selected');
    bookingRepo.updateFields(bookingId, { trainNo: bestTrain.trainNo });
    trainNoForLog = bestTrain.trainNo;
    radioValueForSubmit = bestTrain.radioValue;
  }

  const passenger = passengerRepo.getById(booking.passengerId);
  if (!passenger) throw new Error('旅客資料不存在：' + booking.passengerId);
  log.info({
    train_no: trainNoForLog,
    is_direct_s3: isDirectS3,
    id_prefix: passenger.idNumber.slice(0, 3),
  }, '[5/5] thsrcSubmitBooking');
  const result = await thsrcSubmitBooking(queryCookieJar, s2FormAction, {
    trainNo: radioValueForSubmit,
    captcha: captchaAnswer,
    passenger: { idNumber: passenger.idNumber, phone: passenger.phone || '', email: passenger.email },
    isDirectS3,
    ticketAdult: booking.ticketAdult,
    ticketChild: booking.ticketChild,
    ticketDisabled: booking.ticketDisabled,
    ticketSenior: booking.ticketSenior,
    ticketStudent: booking.ticketStudent,
  });
  log.info({ success: result.success, ticket_no: result.ticketNo, error: result.error }, '[5/5] done');

  if (result.success) {
    bookingRepo.updateFields(bookingId, {
      status: CONFIG.BOOKING_STATUS.SUCCESS,
      ticketNo: result.ticketNo,
      departTime: isDirectS3 ? null : bestTrain.departTime,
    });
    bookingRepo.createAttempt({ bookingId, success: true, reason: null });
    log.info({ ticket_no: result.ticketNo }, '訂票成功');
  } else {
    return handleRetry(booking, result.error, log);
  }
}

function handleRetry(booking, reason, log) {
  const childLog = log || logger.child({ booking_id: booking.id });
  const newRetryCount = (booking.retryCount || 0) + 1;
  bookingRepo.updateFields(booking.id, { retryCount: newRetryCount });
  bookingRepo.createAttempt({ bookingId: booking.id, success: false, reason });

  if (newRetryCount >= booking.maxRetries) {
    bookingRepo.updateFields(booking.id, { status: CONFIG.BOOKING_STATUS.FAILED });
    childLog.warn('booking failed after max retries');
  } else {
    const waitValue = booking.retryWaitValue ?? CONFIG.RETRY_WAIT_MINUTES;
    const waitUnit  = booking.retryWaitUnit  ?? 'minute';
    const waitMs    = waitUnit === 'second' ? waitValue * 1000 : waitValue * 60 * 1000;
    const retryAt   = new Date(Date.now() + waitMs).toISOString();
    bookingRepo.updateFields(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
    });
    setTimeout(() => runBooking(booking.id).catch(err => childLog.error({ err: err.message }, 'retry-timeout error')), waitMs);
    childLog.info({ retry: newRetryCount, max: booking.maxRetries, wait_ms: waitMs }, 'scheduled retry');
  }
}

module.exports = { runBooking, handleRetry };
