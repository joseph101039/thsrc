const THSRC_BASE = 'https://irs.thsrc.com.tw/IMINT';

// 取得訂票首頁，回傳 session cookie 和 security token
function thsrcInit() {
  const res = UrlFetchApp.fetch(THSRC_BASE + '/', {
    method: 'GET',
    followRedirects: true,
    muteHttpExceptions: true,
  });
  const cookies = res.getAllHeaders()['Set-Cookie'];
  const html = res.getContentText();

  const tokenMatch = html.match(/name="BookingS1Form:hf:0"\s+value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : '';

  const sessionMatch = (Array.isArray(cookies) ? cookies : [cookies])
    .join('; ')
    .match(/JSESSIONID=([^;]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';

  return { sessionId, token, html };
}

// 取得驗證碼圖片（Base64）
function thsrcGetCaptcha(sessionId) {
  const res = UrlFetchApp.fetch(THSRC_BASE + '/CheckCode.jsp', {
    method: 'GET',
    headers: { Cookie: 'JSESSIONID=' + sessionId },
    muteHttpExceptions: true,
  });
  const bytes = res.getContent();
  return Utilities.base64Encode(bytes);
}

// 查詢可用車次，回傳 [{ trainNo, departTime, arriveTime }] 或 []
function thsrcQueryTrains(sessionId, token, params) {
  const { fromStation, toStation, date, earliestTime, latestTime } = params;

  const stationCodeMap = {
    '南港': '1', '台北': '2', '板橋': '3', '桃園': '4',
    '新竹': '5', '苗栗': '6', '台中': '7', '彰化': '8',
    '雲林': '9', '嘉義': '10', '台南': '11', '左營': '12',
  };

  const payload = {
    'BookingS1Form:hf:0': token,
    'selectStartStation': stationCodeMap[fromStation],
    'selectDestinationStation': stationCodeMap[toStation],
    'toTimeInputField': date,
    'toTimeTable': earliestTime,
    'bookingMethod': '1',
  };

  const res = UrlFetchApp.fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    payload: Object.entries(payload)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&'),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  return parseTrainOptions(res.getContentText(), earliestTime, latestTime);
}

// 從 HTML 解析車次選項
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

// 選擇最接近 desiredTime 的班次
function selectBestTrain(trains, desiredTime) {
  if (trains.length === 0) return null;
  return trains.reduce((best, t) => {
    const diff = Math.abs(timeToMinutes(t.departTime) - timeToMinutes(desiredTime));
    const bestDiff = Math.abs(timeToMinutes(best.departTime) - timeToMinutes(desiredTime));
    return diff < bestDiff ? t : best;
  });
}

function timeToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// 送出訂票，回傳 { success, ticketNo, error }
function thsrcSubmitBooking(sessionId, token, params) {
  const { trainNo, captcha } = params;

  const payload = {
    'BookingS2Form:hf:0': token,
    'TrainQueryDataViewPanel:TrainGroup': trainNo,
    'passengerCount': '1F',
    'toPayment': '確認訂位',
    'homeCaptcha:securityCode': captcha,
  };

  const res = UrlFetchApp.fetch(THSRC_BASE + '/IMINT', {
    method: 'POST',
    headers: {
      Cookie: 'JSESSIONID=' + sessionId,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    payload: Object.entries(payload)
      .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
      .join('&'),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  return parseBookingResult(res.getContentText());
}

// 從確認頁面解析訂票結果
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

function test_thsrcHelpers() {
  console.log('09:30 in minutes:', timeToMinutes('09:30')); // 570

  const trains = [
    { trainNo: '101', departTime: '08:00', arriveTime: '10:30' },
    { trainNo: '103', departTime: '09:30', arriveTime: '12:00' },
    { trainNo: '105', departTime: '11:00', arriveTime: '13:30' },
  ];
  const best = selectBestTrain(trains, '09:00');
  console.log('best train for 09:00:', JSON.stringify(best));

  const fakeHtml = `
    <input type="radio" name="TrainQueryDataViewPanel:TrainGroup" value="0103">
    <label>車次 0103 出發 09:30 抵達 12:00</label>
  `;
  const parsed = parseTrainOptions(fakeHtml, '08:00', '11:00');
  console.log('parsed trains:', JSON.stringify(parsed));
}
