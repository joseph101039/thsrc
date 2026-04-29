'use strict';

const { test, skip } = require('node:test');
const assert = require('node:assert/strict');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, parseTrainOptions, selectBestTrain } = require('../src/thsrc');
const fetch = require('node-fetch');

// 取明天日期（高鐵只能訂未來車票）
function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 網路測試：需要能連到 irs.thsrc.com.tw，在 VM 上跑
// 本機執行：RUN_NETWORK_TESTS=1 npm test
const runNetwork = process.env.RUN_NETWORK_TESTS === '1'
  ? test
  : (name, fn) => skip(name, { skip: '需設定 RUN_NETWORK_TESTS=1 且能連到高鐵網站' });

runNetwork('thsrcInit：可連線高鐵網站並取得 sessionId 和 formAction', async () => {
  const { sessionId, formAction } = await thsrcInit();
  assert.ok(sessionId, '應取得 JSESSIONID');
  assert.ok(formAction, '應取得 Wicket form action URL');
  assert.ok(formAction.includes('BookingS1Form'), 'formAction 應包含 BookingS1Form');
  console.log('  sessionId:', sessionId.slice(0, 12) + '...');
  console.log('  formAction:', formAction.slice(0, 60) + '...');
});

runNetwork('thsrcGetCaptcha：可取得 base64 驗證碼圖片', async () => {
  const { cookieJar, captchaUrl } = await thsrcInit();
  const base64 = await thsrcGetCaptcha(cookieJar, captchaUrl);
  assert.ok(base64.length > 100, '應回傳有內容的 base64 字串');
  // PNG header in base64 starts with 'iVBORw0KGgo'
  assert.ok(base64.startsWith('iVBORw0KGgo'), '應為有效的 PNG base64');
  console.log('  captcha base64 長度:', base64.length);
});

runNetwork('thsrcQueryTrains：可查詢台北→左營明天班次（需驗證碼）', async () => {
  const { cookieJar, formAction, captchaUrl } = await thsrcInit();
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);

  // Use captcha API to solve (requires captcha server running)
  const CONFIG = require('../src/config');
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const { answer: captchaAnswer } = await captchaRes.json();

  const { trains } = await thsrcQueryTrains(cookieJar, formAction, {
    fromStation: '台北',
    toStation: '左營',
    date: tomorrow(),
    earliestTime: '08:00',
    latestTime: '20:00',
    captcha: captchaAnswer,
  });
  assert.ok(Array.isArray(trains), '應回傳陣列');
  assert.ok(trains.length > 0, '台北→左營應有可用班次');
  const t = trains[0];
  assert.ok(t.trainNo, '班次應有 trainNo');
  assert.ok(t.departTime.match(/^\d{2}:\d{2}$/), '出發時間格式應為 HH:MM');
  assert.ok(t.arriveTime.match(/^\d{2}:\d{2}$/), '到達時間格式應為 HH:MM');
  console.log('  找到', trains.length, '個班次，第一班:', t.departTime, '→', t.arriveTime, '車次:', t.trainNo);
});

// ── 純邏輯測試（不需要網路）──────────────────────────────────

test('parseTrainOptions：正確過濾時間區間', () => {
  // 實際高鐵 HTML 格式：<input QueryDeparture="HH:MM" QueryArrival="HH:MM" QueryCode="NNN"
  //   name="TrainQueryDataViewPanel:TrainGroup" ... value="radioNN">
  const fakeHtml = `
    <input QueryDeparture="06:10" QueryArrival="09:00" QueryCode="101" type="radio" value="radio1" name="TrainQueryDataViewPanel:TrainGroup" class="uk-radio">
    <input QueryDeparture="10:30" QueryArrival="13:00" QueryCode="205" type="radio" value="radio2" name="TrainQueryDataViewPanel:TrainGroup" class="uk-radio">
    <input QueryDeparture="22:00" QueryArrival="01:00" QueryCode="609" type="radio" value="radio3" name="TrainQueryDataViewPanel:TrainGroup" class="uk-radio">
  `;
  const trains = parseTrainOptions(fakeHtml, '09:00', '15:00');
  assert.equal(trains.length, 1, '只有 10:30 在 09:00~15:00 區間內');
  assert.equal(trains[0].trainNo, '205');
  assert.equal(trains[0].radioValue, 'radio2');
  assert.equal(trains[0].departTime, '10:30');
  assert.equal(trains[0].arriveTime, '13:00');
});

const db = require('../src/db');

test('createBookingAttempt 和 getAttemptsByBookingId：可寫入並查詢嘗試紀錄', () => {
  const bookingId = 'test-booking-' + Date.now();
  db.getBookings(); // 確保 DB 已初始化

  db.createBookingAttempt({ bookingId, success: false, reason: '無可用班次' });
  db.createBookingAttempt({ bookingId, success: true, reason: null });

  const attempts = db.getAttemptsByBookingId(bookingId);
  assert.equal(attempts.length, 2, '應有 2 筆嘗試紀錄');
  assert.equal(attempts[0].success, 0, '第一筆應為失敗');
  assert.equal(attempts[0].reason, '無可用班次');
  assert.equal(attempts[1].success, 1, '第二筆應為成功');
  assert.equal(attempts[1].reason, null);
  assert.ok(attempts[0].attemptedAt, '應有 attemptedAt 欄位');
});

test('selectBestTrain：選出最接近期望時間的班次', () => {
  const trains = [
    { trainNo: 'A', departTime: '09:00', arriveTime: '11:30' },
    { trainNo: 'B', departTime: '10:30', arriveTime: '13:00' },
    { trainNo: 'C', departTime: '12:00', arriveTime: '14:30' },
  ];
  // 10:00 → 09:00 差 60 分，10:30 差 30 分 → 應選 B
  const best = selectBestTrain(trains, '10:00');
  assert.equal(best.trainNo, 'B', '10:30 最接近 10:00');

  // 11:30 → 10:30 差 60 分，12:00 差 30 分 → 應選 C
  const best2 = selectBestTrain(trains, '11:30');
  assert.equal(best2.trainNo, 'C', '12:00 最接近 11:30');

  // 09:10 → 09:00 差 10 分，10:30 差 80 分 → 應選 A
  const best3 = selectBestTrain(trains, '09:10');
  assert.equal(best3.trainNo, 'A', '09:00 最接近 09:10');
});
