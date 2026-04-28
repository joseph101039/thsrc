'use strict';

const { test, skip } = require('node:test');
const assert = require('node:assert/strict');
const { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, parseTrainOptions, selectBestTrain } = require('../src/thsrc');

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

runNetwork('thsrcInit：可連線高鐵網站並取得 sessionId 和 token', async () => {
  const { sessionId, token } = await thsrcInit();
  assert.ok(sessionId, '應取得 JSESSIONID');
  assert.ok(token, '應取得 BookingS1Form token');
  console.log('  sessionId:', sessionId.slice(0, 12) + '...');
  console.log('  token:', token.slice(0, 20) + '...');
});

runNetwork('thsrcGetCaptcha：可取得 base64 驗證碼圖片', async () => {
  const { sessionId } = await thsrcInit();
  const base64 = await thsrcGetCaptcha(sessionId);
  assert.ok(base64.length > 100, '應回傳有內容的 base64 字串');
  // PNG header in base64 starts with 'iVBORw0KGgo'
  assert.ok(base64.startsWith('iVBORw0KGgo'), '應為有效的 PNG base64');
  console.log('  captcha base64 長度:', base64.length);
});

runNetwork('thsrcQueryTrains：可查詢台北→左營明天班次', async () => {
  const { sessionId, token } = await thsrcInit();
  const trains = await thsrcQueryTrains(sessionId, token, {
    fromStation: '台北',
    toStation: '左營',
    date: tomorrow(),
    earliestTime: '08:00',
    latestTime: '20:00',
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
  // 模擬高鐵 HTML 的真實格式：radio input + label 包含出發/到達時間
  const fakeHtml = `
    <input type="radio" value="0610A" name="TrainQueryDataViewPanel:TrainGroup" id="r1">
    <label for="r1">06:10出發 09:00抵達 自強號</label>
    <input type="radio" value="1030B" name="TrainQueryDataViewPanel:TrainGroup" id="r2">
    <label for="r2">10:30出發 13:00抵達 自強號</label>
    <input type="radio" value="2200C" name="TrainQueryDataViewPanel:TrainGroup" id="r3">
    <label for="r3">22:00出發 01:00抵達 自強號</label>
  `;
  const trains = parseTrainOptions(fakeHtml, '09:00', '15:00');
  assert.equal(trains.length, 1, '只有 10:30 在 09:00~15:00 區間內');
  assert.equal(trains[0].trainNo, '1030B');
  assert.equal(trains[0].departTime, '10:30');
  assert.equal(trains[0].arriveTime, '13:00');
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
