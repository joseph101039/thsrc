'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');

const THSRC_BASE = 'https://irs.thsrc.com.tw/IMINT';

async function thsrcInit() {
  const res = await fetch(THSRC_BASE + '/', { redirect: 'follow' });
  const html = await res.text();
  const cookieHeader = res.headers.raw()['set-cookie'] || [];
  const cookies = cookieHeader.join('; ');

  const tokenMatch = html.match(/name="BookingS1Form:hf:0"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const sessionMatch = cookies.match(/JSESSIONID=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';

  return { sessionId, token };
}

async function thsrcGetCaptcha(sessionId) {
  const res = await fetch(THSRC_BASE + '/CheckCode.jsp', {
    headers: { Cookie: 'JSESSIONID=' + sessionId },
  });
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

async function thsrcQueryTrains(sessionId, token, { fromStation, toStation, date, earliestTime, latestTime }) {
  const payload = new URLSearchParams({
    'BookingS1Form:hf:0': token,
    selectStartStation: CONFIG.STATION_CODES[fromStation],
    selectDestinationStation: CONFIG.STATION_CODES[toStation],
    toTimeInputField: date,
    toTimeTable: earliestTime,
    bookingMethod: '1',
  });

  const res = await fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
    redirect: 'follow',
  });
  const html = await res.text();
  return parseTrainOptions(html, earliestTime, latestTime);
}

function parseTrainOptions(html, earliestTime, latestTime) {
  const trains = [];
  const regex = /value="([^"]+)"\s[^>]*>[\s\S]*?<label[^>]*>([^<]+)<\/label>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const value = match[1];
    const label = match[2].trim();
    const timeMatch = label.match(/(\d{2}:\d{2})/g);
    if (!timeMatch || timeMatch.length < 2) continue;
    const departTime = timeMatch[0];
    const arriveTime = timeMatch[1];
    if (departTime >= earliestTime && departTime <= latestTime) {
      trains.push({ trainNo: value, departTime, arriveTime, label });
    }
  }
  return trains;
}

function selectBestTrain(trains, desiredTime) {
  if (trains.length === 0) return null;
  return trains.reduce((best, t) => {
    const diff = Math.abs(_timeToMinutes(t.departTime) - _timeToMinutes(desiredTime));
    const bestDiff = Math.abs(_timeToMinutes(best.departTime) - _timeToMinutes(desiredTime));
    return diff < bestDiff ? t : best;
  });
}

function _timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

async function thsrcSubmitBooking(sessionId, token, { trainNo, captcha }) {
  const payload = new URLSearchParams({
    'BookingS2Form:hf:0': token,
    'TrainQueryDataViewPanel:TrainGroup': trainNo,
    passengerCount: '1F',
    toPayment: '確認訂位',
    'homeCaptcha:securityCode': captcha,
  });

  const res = await fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: payload.toString(),
    redirect: 'follow',
  });
  const html = await res.text();
  return parseBookingResult(html);
}

function parseBookingResult(html) {
  const ticketMatch = html.match(/訂位代號[：:]\s*([A-Z0-9]+)/);
  if (ticketMatch) {
    return { success: true, ticketNo: ticketMatch[1], error: null };
  }
  const errorMatch = html.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</);
  return {
    success: false,
    ticketNo: null,
    error: errorMatch ? errorMatch[1].trim() : '訂票失敗（未知原因）',
  };
}

module.exports = { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, selectBestTrain, parseTrainOptions };
