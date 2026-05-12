'use strict';

const logger = require('../logger');
const fetch = require('node-fetch');
const CONFIG = require('../config');
const bookingRepo = require('../repositories/bookingRepo');
const passengerRepo = require('../repositories/passengerRepo');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain } = require('../thsrc');
const metrics = require('../metrics');
const settingsService = require('./settingsService');
const lineNotifier = require('./lineNotifier');
const refundEngineService = require('./refundEngineService');

const BOOKING_TIMEOUT_MS = 120000;

// fan-out 入口:整張 booking 進 running 後,依 concurrency 啟動 N 個 worker 平行搶。
// 失敗只算 1 次 attempt(N 個 worker 全失敗 → retry_count += 1)。
// 第一個拿到票的 worker 用 claimWinner CAS 寫入 success;輸家拿到的票自動 enqueue 退票。
async function runBooking(bookingId, parentLog) {
  const baseLog = parentLog || logger;
  const log = baseLog.child({ booking_id: bookingId });
  // Atomic CAS:整張 booking pending→running,避免多個 scheduler tick 重複觸發。
  const claimed = bookingRepo.tryClaimBooking(bookingId);
  if (!claimed) {
    log.info('skip: already claimed by another runner');
    return;
  }

  const booking = bookingRepo.getById(bookingId);
  if (!booking) throw new Error('Booking not found: ' + bookingId);
  const passenger = passengerRepo.getById(booking.passengerId);
  if (!passenger) throw new Error('旅客資料不存在：' + booking.passengerId);

  // booking.concurrency 來自 DB,可能為 null/非整數(舊資料或人工改),clamp 到 [1, MAX_CONCURRENCY]
  const rawConcurrency = Number.isInteger(booking.concurrency) ? booking.concurrency : 1;
  const concurrency = Math.max(1, Math.min(CONFIG.MAX_CONCURRENCY, rawConcurrency));
  log.info({ concurrency }, 'fan-out start');

  // AbortController:第一個贏家觸發,讓尚未送出 submit 的 worker 提早終止,省 captcha solver 流量。
  // 但正確性完全由 claimWinner CAS 保證,不依賴 abort。
  const abortCtrl = { aborted: false };
  const endTimer = metrics.bookingDuration.startTimer();

  const workers = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(_doWorker({
      workerIdx: i,
      bookingId,
      booking,
      passenger,
      abortCtrl,
      parentLog: log,
    }));
  }

  // 父層整體 timeout 保險:任一 worker 卡住不至於讓 fan-out 永遠 hang。
  // 注意:即使父層 timeout 觸發,handleRetry 仍會用 CAS(WHERE status='running')寫 retry,
  // 所以 late winner 先 claimWinner 成功(status→success)時 retry 寫入會 changes=0,不蓋掉成功訂單。
  const fanOutTimeout = new Promise(resolve => setTimeout(() => resolve('FAN_OUT_TIMEOUT'), BOOKING_TIMEOUT_MS));
  const fanOutPromise = Promise.allSettled(workers);
  const raceResult = await Promise.race([fanOutPromise, fanOutTimeout]);
  if (raceResult === 'FAN_OUT_TIMEOUT') {
    abortCtrl.aborted = true;
    log.warn({ concurrency }, 'fan-out 整體逾時(120s),標記 abort 走 retry;若有 late winner CAS 已寫入則 retry 會被擋');
  }
  const results = raceResult === 'FAN_OUT_TIMEOUT' ? [] : raceResult;
  const won = results.some(r => r.status === 'fulfilled' && r.value && r.value.winner);

  if (won) {
    endTimer({ outcome: 'success' });
    metrics.bookingStatusTotal.inc({ status: 'success' });
    log.info({ concurrency }, '訂票成功(fan-out)');
    if (settingsService.isBookingSuccessNotifyEnabled()) {
      const fresh = bookingRepo.getById(bookingId);
      lineNotifier.pushBookingResult(fresh).then(r => {
        if (!r.ok) log.warn({ reason: r.reason }, '訂票成功通知 push 失敗');
      }).catch(err => log.error({ err: err.message }, '訂票成功通知 unexpected error'));
    }
    return;
  }

  endTimer({ outcome: 'failed' });
  // 整理所有 worker 失敗訊息為 1 行,作為 attempt reason
  const reasons = results.map((r, i) => {
    if (r.status === 'rejected') return `w${i}=ERR:${r.reason && r.reason.message ? r.reason.message : String(r.reason)}`;
    const v = r.value || {};
    if (v.aborted) return `w${i}=aborted`;
    return `w${i}=${v.reason || 'unknown'}`;
  }).join(', ');
  return handleRetry(booking, `workers=${concurrency}, ${reasons}`, log);
}

// 單一 worker:完整跑一遍 init → captcha → query → submit。
// 成功送出且拿到票後嘗試 claimWinner;贏家寫 booking,輸家自動退票。
// 回傳 { winner: bool, aborted?: bool, reason?: string }
async function _doWorker({ workerIdx, bookingId, booking, passenger, abortCtrl, parentLog }) {
  const log = parentLog.child({ worker: workerIdx });

  const checkAborted = (stage) => {
    if (abortCtrl.aborted) {
      log.info({ stage }, 'worker aborted (winner already produced)');
      metrics.bookingWorkerOutcomeTotal.inc({ outcome: 'aborted' });
      return true;
    }
    return false;
  };

  try {
    if (checkAborted('init')) return { winner: false, aborted: true };
    log.info('[1/5] thsrcInit');
    const { cookieJar, formAction, captchaUrl, bookingMethod, bookingMethodTrain } = await thsrcInit();

    if (checkAborted('captcha')) return { winner: false, aborted: true };
    log.info('[2/5] thsrcGetCaptcha');
    const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);

    if (checkAborted('solver')) return { winner: false, aborted: true };
    const endCaptchaTimer = metrics.captchaSolveDuration.startTimer();
    let captchaAnswer;
    try {
      const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: captchaBase64 }),
      });
      const captchaJson = await captchaRes.json();
      if (!captchaJson.answer) {
        endCaptchaTimer({ result: 'error' });
        return { winner: false, reason: '驗證碼辨識失敗：' + (captchaJson.detail || JSON.stringify(captchaJson)) };
      }
      endCaptchaTimer({ result: 'ok' });
      captchaAnswer = captchaJson.answer;
    } catch (err) {
      endCaptchaTimer({ result: 'error' });
      return { winner: false, reason: 'captcha solver error: ' + err.message };
    }

    if (checkAborted('query')) return { winner: false, aborted: true };
    log.info('[4/5] thsrcQueryTrains');
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

    if (!isDirectS3 && trains.length === 0) return { winner: false, reason: '無可用班次' };
    if (!s2FormAction) return { winner: false, reason: '無可用班次' };

    let trainNoForLog, radioValueForSubmit, bestTrain;
    if (isDirectS3) {
      trainNoForLog = booking.trainNoTarget;
      radioValueForSubmit = booking.trainNoTarget;
    } else {
      bestTrain = selectBestTrain(trains, booking.desiredTime);
      trainNoForLog = bestTrain.trainNo;
      radioValueForSubmit = bestTrain.radioValue;
    }

    // submit 之前最後一次 abort 檢查 — 過此關後不管贏輸都必須處理拿到的票
    if (checkAborted('submit')) return { winner: false, aborted: true };
    log.info({ train_no: trainNoForLog, is_direct_s3: isDirectS3 }, '[5/5] thsrcSubmitBooking');
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
    log.info({ success: result.success, ticket_no: result.ticketNo }, '[5/5] done');

    if (!result.success) return { winner: false, reason: result.error || '訂票失敗' };

    // 拿到票 — CAS 裁決贏家。
    // 此處 isDirectS3 或 bestTrain 必為其一(前面的 guard 已保證),不需 fallback。
    const won = bookingRepo.claimWinner(bookingId, {
      ticketNo: result.ticketNo,
      trainNo: isDirectS3 ? booking.trainNoTarget : bestTrain.trainNo,
      departTime: isDirectS3 ? null : bestTrain.departTime,
    });

    if (won) {
      // 我是贏家 — 通知其他 worker 可以放棄了
      abortCtrl.aborted = true;
      bookingRepo.createAttempt({ bookingId, success: true, reason: `winner=w${workerIdx}, ticket_no=${result.ticketNo}` });
      metrics.bookingWorkerOutcomeTotal.inc({ outcome: 'winner' });
      log.info({ ticket_no: result.ticketNo }, 'winner');
      return { winner: true };
    }

    // 輸家 — 拿到了多餘的票,丟給 refund 路徑處理
    log.warn({ ticket_no: result.ticketNo }, 'lost CAS, enqueue refund for duplicate ticket');
    refundEngineService.runRefundByTicketNo({
      bookingId,
      ticketNo: result.ticketNo,
      idNumber: passenger.idNumber,
      parentLog: log,
    }).catch(err => log.error({ err: err.message }, 'runRefundByTicketNo error'));
    return { winner: false, reason: `lost CAS, refunding ticket_no=${result.ticketNo}` };
  } catch (err) {
    log.error({ err: err.message }, 'worker error');
    metrics.bookingWorkerOutcomeTotal.inc({ outcome: 'error' });
    return { winner: false, reason: err.message };
  }
}

function handleRetry(booking, reason, log) {
  const childLog = log || logger.child({ booking_id: booking.id });
  // 先寫 attempt(失敗紀錄總要留),再用 CAS 改狀態。
  // CAS 若失敗(changes=0)代表有 late winner 已把 booking 改為 success,本次 retry 應放棄。
  bookingRepo.createAttempt({ bookingId: booking.id, success: false, reason });
  const newRetryCount = (booking.retryCount || 0) + 1;

  if (newRetryCount >= booking.maxRetries) {
    const ok = bookingRepo.setRetryFromRunning(booking.id, {
      status: CONFIG.BOOKING_STATUS.FAILED,
      retryCount: newRetryCount,
    });
    if (!ok) {
      childLog.info('handleRetry skipped: booking already left running (likely late winner success)');
      return;
    }
    metrics.bookingStatusTotal.inc({ status: 'failed' });
    childLog.warn('booking failed after max retries');
    if (settingsService.isBookingFailureNotifyEnabled()) {
      const fresh = bookingRepo.getById(booking.id);
      const lastAttempt = bookingRepo.getLastFailedAttempt(booking.id);
      lineNotifier.pushBookingResult(fresh, lastAttempt).then(r => {
        if (!r.ok) childLog.warn({ reason: r.reason }, '訂票失敗通知 push 失敗');
      }).catch(err => childLog.error({ err: err.message }, '訂票失敗通知 unexpected error'));
    }
  } else {
    const waitValue = booking.retryWaitValue ?? CONFIG.RETRY_WAIT_MINUTES;
    const waitUnit  = booking.retryWaitUnit  ?? 'minute';
    const waitMs    = waitUnit === 'second' ? waitValue * 1000 : waitValue * 60 * 1000;
    const retryAt   = new Date(Date.now() + waitMs).toISOString();
    const ok = bookingRepo.setRetryFromRunning(booking.id, {
      status: CONFIG.BOOKING_STATUS.PENDING,
      scheduledAt: retryAt,
      retryCount: newRetryCount,
    });
    if (!ok) {
      childLog.info('handleRetry skipped: booking already left running (likely late winner success)');
      return;
    }
    metrics.bookingStatusTotal.inc({ status: 'retrying' });
    setTimeout(() => runBooking(booking.id, childLog).catch(err => childLog.error({ err: err.message }, 'retry-timeout error')), waitMs);
    childLog.info({ retry: newRetryCount, max: booking.maxRetries, wait_ms: waitMs }, 'scheduled retry');
  }
}

module.exports = { runBooking, handleRetry };
