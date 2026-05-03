'use strict';

const fetch = require('node-fetch');
const CONFIG = require('./config');

const THSRC_BASE = 'https://irs.thsrc.com.tw';
const FETCH_TIMEOUT_MS = 15000;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-TW,zh;q=0.9',
  'Connection': 'keep-alive',
  'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Upgrade-Insecure-Requests': '1',
};

// Maps HH:MM strings to the <select name="toTimeTable"> option values on the booking page
const TIME_TABLE_VALUES = {
  '00:00': '1201A', '00:30': '1230A',
  '05:00': '500A',  '05:30': '530A',
  '06:00': '600A',  '06:30': '630A',
  '07:00': '700A',  '07:30': '730A',
  '08:00': '800A',  '08:30': '830A',
  '09:00': '900A',  '09:30': '930A',
  '10:00': '1000A', '10:30': '1030A',
  '11:00': '1100A', '11:30': '1130A',
  '12:00': '1200N', '12:30': '1230P',
  '13:00': '100P',  '13:30': '130P',
  '14:00': '200P',  '14:30': '230P',
  '15:00': '300P',  '15:30': '330P',
  '16:00': '400P',  '16:30': '430P',
  '17:00': '500P',  '17:30': '530P',
  '18:00': '600P',  '18:30': '630P',
  '19:00': '700P',  '19:30': '730P',
  '20:00': '800P',  '20:30': '830P',
  '21:00': '900P',  '21:30': '930P',
  '22:00': '1000P', '22:30': '1030P',
  '23:00': '1100P', '23:30': '1130P',
};

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// Returns { sessionId, cookieJar, formAction, captchaUrl }
// 高鐵網站第一次請求會回 302，Set-Cookie 帶 Akamai 防護 cookie，
// 需手動處理重導向，將 302 的 cookie 帶入第二次請求才能拿到正確 HTML。
async function thsrcInit() {
  const NAV_HEADERS = {
    ...BROWSER_HEADERS,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  // 第一次請求：不帶 cookie，預期 302，收集 Set-Cookie
  const res1 = await fetchWithTimeout(THSRC_BASE + '/IMINT/', {
    redirect: 'manual',
    headers: NAV_HEADERS,
  });
  const cookies1 = res1.headers.raw()['set-cookie'] || [];

  // 第二次請求：帶上第一次拿到的 cookie，跟隨重導向到 200 頁面
  const cookieJar1 = cookies1.map(c => c.split(';')[0].trim()).join('; ');
  const res2 = await fetchWithTimeout(THSRC_BASE + '/IMINT/', {
    redirect: 'follow',
    headers: { ...NAV_HEADERS, 'Cookie': cookieJar1 },
  });
  const cookies2 = res2.headers.raw()['set-cookie'] || [];
  const html = await res2.text();

  // 合併兩次 Set-Cookie，去重（後者覆蓋前者同名 key）
  const cookieMap = new Map();
  for (const c of [...cookies1, ...cookies2]) {
    const kv = c.split(';')[0].trim();
    const key = kv.split('=')[0];
    cookieMap.set(key, kv);
  }
  const cookieJar = Array.from(cookieMap.values()).join('; ');

  const sessionMatch = cookieJar.match(/JSESSIONID=([^;,\s]+)/);
  const sessionId = sessionMatch ? sessionMatch[1] : '';

  // Extract Wicket form action URL (contains jsessionid + wicket:interface)
  const formActionMatch = html.match(/action="(\/IMINT\/[^"]+BookingS1Form[^"]+)"/);
  const formAction = formActionMatch ? THSRC_BASE + formActionMatch[1] : null;

  // Extract Wicket captcha image URL
  const captchaUrlMatch = html.match(/src="(\/IMINT\/[^"]+passCode[^"]+)"/);
  const captchaUrl = captchaUrlMatch ? THSRC_BASE + captchaUrlMatch[1] : null;

  // bookingMethod radio value 是 Wicket 動態生成的 component ID（search-by-time 那個）
  const bookingMethodMatch = html.match(/data-target="search-by-time"\s+name="bookingMethod"[^>]+value="([^"]+)"/);
  const bookingMethod = bookingMethodMatch ? bookingMethodMatch[1] : 'radio31';

  return { sessionId, cookieJar, formAction, captchaUrl, bookingMethod };
}

async function thsrcGetCaptcha(cookieJar, captchaUrl) {
  const res = await fetchWithTimeout(captchaUrl, {
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'image',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('image')) {
    throw new Error('驗證碼請求被 WAF 攔截（回傳 ' + contentType + ' 而非圖片）');
  }
  const buffer = await res.buffer();
  return buffer.toString('base64');
}

// captcha is required — the train query form includes homeCaptcha:securityCode
// POST 查詢班次也會先回 302（帶新 cookie），需兩段式請求才能拿到班次頁面
async function thsrcQueryTrains(cookieJar, formAction, { fromStation, toStation, date, earliestTime, latestTime, captcha, bookingMethod }) {
  const dateFormatted = date.replace(/-/g, '/'); // YYYY-MM-DD → YYYY/MM/DD
  const timeTableValue = TIME_TABLE_VALUES[earliestTime] || earliestTime;

  const payload = new URLSearchParams({
    'BookingS1Form:hf:0': '',
    'trainCon:trainRadioGroup': '0',
    'tripCon:typesoftrip': '0',
    'seatCon:seatRadioGroup': '0',
    bookingMethod: bookingMethod || 'radio31',
    selectStartStation: CONFIG.STATION_CODES[fromStation],
    selectDestinationStation: CONFIG.STATION_CODES[toStation],
    toTimeInputField: dateFormatted,
    backTimeInputField: dateFormatted,
    toTimeTable: timeTableValue,
    toTrainIDInputField: '',
    backTimeTable: '',
    backTrainIDInputField: '',
    'ticketPanel:rows:0:ticketAmount': '1F',
    'ticketPanel:rows:1:ticketAmount': '0H',
    'ticketPanel:rows:2:ticketAmount': '0W',
    'ticketPanel:rows:3:ticketAmount': '0E',
    'ticketPanel:rows:4:ticketAmount': '0P',
    ticketTypeNum: '1F,0H,0W,0E,0P',
    'homeCaptcha:securityCode': captcha || '',
    SubmitButton: '開始查詢',
    portalTag: 'false',
    isShowTeenager: '0',
    isTicketAmount: 'false',
  });

  const POST_HEADERS = {
    ...BROWSER_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cache-Control': 'max-age=0',
    'Cookie': cookieJar,
    'Referer': THSRC_BASE + '/IMINT/',
    'Origin': THSRC_BASE,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
  };

  // 第一次 POST：預期 302，收集新 Set-Cookie
  const res1 = await fetchWithTimeout(formAction, {
    method: 'POST',
    headers: POST_HEADERS,
    body: payload.toString(),
    redirect: 'manual',
  });
  const cookies3 = res1.headers.raw()['set-cookie'] || [];
  const redirectUrl = res1.headers.get('location');

  // 合併 302 新 cookie 到現有 cookieJar
  const cookieMap = new Map();
  for (const c of cookieJar.split(';')) {
    const kv = c.trim();
    const key = kv.split('=')[0];
    if (key) cookieMap.set(key, kv);
  }
  for (const c of cookies3) {
    const kv = c.split(';')[0].trim();
    const key = kv.split('=')[0];
    cookieMap.set(key, kv);
  }
  const updatedCookieJar = Array.from(cookieMap.values()).join('; ');

  // 第二次請求：GET 重導向目標（帶合併後 cookie）
  const followUrl = redirectUrl
    ? (redirectUrl.startsWith('http') ? redirectUrl : THSRC_BASE + redirectUrl)
    : formAction;

  const res2 = await fetchWithTimeout(followUrl, {
    method: 'GET',
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': updatedCookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'follow',
  });
  const html = await res2.text();

  // Extract the S2 form action for subsequent booking submission
  const s2ActionMatch = html.match(/action="(\/IMINT\/[^"]+BookingS2Form[^"]+)"/);
  const s2FormAction = s2ActionMatch ? THSRC_BASE + s2ActionMatch[1] : null;

  const trains = parseTrainOptions(html, earliestTime, latestTime);
  return { trains, s2FormAction, cookieJar: updatedCookieJar };
}

function parseTrainOptions(html, earliestTime, latestTime) {
  const trains = [];
  // 實際 HTML 格式：<input QueryArrival="HH:MM" QueryDeparture="HH:MM" QueryCode="NNN"
  //   name="TrainQueryDataViewPanel:TrainGroup" ... value="radioNN">
  const regex = /<input\s[^>]*name="TrainQueryDataViewPanel:TrainGroup"[^>]*>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const valueMatch = tag.match(/value="([^"]+)"/);
    const departMatch = tag.match(/QueryDeparture="([^"]+)"/);
    const arriveMatch = tag.match(/QueryArrival="([^"]+)"/);
    const trainNoMatch = tag.match(/QueryCode="([^"]+)"/);
    if (!valueMatch || !departMatch || !arriveMatch) continue;
    const radioValue = valueMatch[1];
    const departTime = departMatch[1];
    const arriveTime = arriveMatch[1];
    const trainNo = trainNoMatch ? trainNoMatch[1] : radioValue;
    if (departTime >= earliestTime && departTime <= latestTime) {
      trains.push({ trainNo, radioValue, departTime, arriveTime });
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

// S2 → S3（乘客資料）→ S4（付款頁，含訂位代號）
// passenger: { idNumber, phone, email }
async function thsrcSubmitBooking(cookieJar, s2FormAction, { trainNo, captcha, passenger }) {
  const POST_HEADERS = (jar) => ({
    ...BROWSER_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cache-Control': 'max-age=0',
    'Cookie': jar,
    'Referer': THSRC_BASE + '/IMINT/',
    'Origin': THSRC_BASE,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
  });

  // S2 POST → 302 → GET S3
  const s2Payload = new URLSearchParams({
    'BookingS2Form:hf:0': '',
    'TrainQueryDataViewPanel:TrainGroup': trainNo,
    'ticketPanel:rows:0:ticketAmount': '1F',
    'ticketPanel:rows:1:ticketAmount': '0H',
    'ticketPanel:rows:2:ticketAmount': '0W',
    'ticketPanel:rows:3:ticketAmount': '0E',
    'ticketPanel:rows:4:ticketAmount': '0P',
    toPayment: '確認訂位',
    'homeCaptcha:securityCode': captcha,
  });

  const { html: s3Html, cookieJar: jar3, s3FormAction } = await _postAndFollow(
    s2FormAction, cookieJar, s2Payload.toString(), POST_HEADERS, 'BookingS3Form'
  );
  console.log('  [5/5] S2→S3: s3FormAction=', s3FormAction ? s3FormAction.slice(0, 60) + '...' : 'null', 'html len=', s3Html.length);

  if (!s3FormAction) {
    console.log('  [5/5] S3 not found, parsing S2 result directly');
    return parseBookingResult(s3Html);
  }

  // 從 S3 頁面取得 memberSystemRadioGroup 的預設 radio value（非會員）
  const memberRadioMatch = s3Html.match(/<input[^>]+memberSystemRadioGroup[^>]+checked[^>]+value="([^"]+)"/);
  const memberRadioValue = memberRadioMatch ? memberRadioMatch[1]
    : (s3Html.match(/<input[^>]+memberSystemRadioGroup[^>]+value="([^"]+)"/)?.[1] || 'radio45');
  console.log('  [5/5] memberRadioValue=', memberRadioValue);

  // S3 POST → 302 → GET S4
  const s3Payload = new URLSearchParams({
    'BookingS3FormSP:hf:0': '',
    idInputRadio: '0',  // 0 = 身份證
    dummyId: passenger.idNumber,
    dummyPhone: passenger.phone || '',
    email: passenger.email,
    'TicketMemberSystemInputPanel:TakerMemberSystemDataView:memberSystemRadioGroup': memberRadioValue,
    agree: 'on',
    SubmitButton: '確定',
  });

  const { html: s4Html } = await _postAndFollow(
    s3FormAction, jar3, s3Payload.toString(), POST_HEADERS, null
  );
  console.log('  [5/5] S3→S4: html len=', s4Html.length, 'has 訂位代號=', s4Html.includes('訂位代號'));

  return parseBookingResult(s4Html);
}

// POST → manual redirect → GET，回傳最終 HTML 和合併後 cookieJar
async function _postAndFollow(url, cookieJar, body, headersFn, expectFormKey) {
  const res1 = await fetchWithTimeout(url, {
    method: 'POST',
    headers: headersFn(cookieJar),
    body,
    redirect: 'manual',
  });

  const newCookies = res1.headers.raw()['set-cookie'] || [];
  const cookieMap = new Map();
  for (const c of cookieJar.split(';')) {
    const kv = c.trim(); const key = kv.split('=')[0]; if (key) cookieMap.set(key, kv);
  }
  for (const c of newCookies) {
    const kv = c.split(';')[0].trim(); const key = kv.split('=')[0]; cookieMap.set(key, kv);
  }
  const updatedJar = Array.from(cookieMap.values()).join('; ');

  const loc = res1.headers.get('location');
  let html;
  if (loc) {
    const followUrl = loc.startsWith('http') ? loc : THSRC_BASE + loc;
    const res2 = await fetchWithTimeout(followUrl, {
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': updatedJar,
        'Referer': THSRC_BASE + '/IMINT/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'same-origin',
      },
      redirect: 'follow',
    });
    html = await res2.text();
  } else {
    html = await res1.text();
  }

  let nextFormAction = null;
  if (expectFormKey) {
    const m = html.match(new RegExp(`action="(\\/IMINT\\/[^"]+${expectFormKey}[^"]+)"`));
    nextFormAction = m ? THSRC_BASE + m[1] : null;
  }

  return { html, cookieJar: updatedJar, s3FormAction: nextFormAction };
}

// passenger: { idNumber }
// 退票流程：History 頁初始化 → 查詢訂單 → 點擊取消 → 確認取消 → 解析結果
async function thsrcCancelBooking(ticketNo, passenger) {
  const HISTORY_URL = THSRC_BASE + '/IMINT/?wicket:bookmarkablePage=:tw.com.mitac.webapp.thsr.viewer.History';
  const NAV_HEADERS = {
    ...BROWSER_HEADERS,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  // [1/6] 初始化 session（兩段式，同 thsrcInit）
  console.log('  [退票 1/6] thsrcCancelBooking init session...');
  const res1 = await fetchWithTimeout(HISTORY_URL, { redirect: 'manual', headers: NAV_HEADERS });
  const cookies1 = res1.headers.raw()['set-cookie'] || [];
  const cookieJar1 = cookies1.map(c => c.split(';')[0].trim()).join('; ');

  const res2 = await fetchWithTimeout(HISTORY_URL, {
    redirect: 'follow',
    headers: { ...NAV_HEADERS, 'Cookie': cookieJar1 },
  });
  const cookies2 = res2.headers.raw()['set-cookie'] || [];
  const historyHtml = await res2.text();

  const cookieMap = new Map();
  for (const c of [...cookies1, ...cookies2]) {
    const kv = c.split(';')[0].trim();
    const key = kv.split('=')[0];
    cookieMap.set(key, kv);
  }
  let cookieJar = Array.from(cookieMap.values()).join('; ');

  // 解析 HistoryForm action（含 jsessionid）
  const historyFormMatch = historyHtml.match(/action="(\/IMINT\/[^"]*HistoryForm[^"]*)"/);
  if (!historyFormMatch) throw new Error('找不到 HistoryForm action');
  const historyFormAction = THSRC_BASE + historyFormMatch[1];
  console.log('  [退票 1/6] done — historyFormAction=', historyFormAction.slice(0, 80) + '...');

  // [2/6] 取 captcha（與訂票頁相同格式：passCode IResourceListener）
  console.log('  [退票 2/6] 取驗證碼...');
  const captchaUrlMatch = historyHtml.match(/src="(\/IMINT\/[^"]*passCode[^"]*)"/);
  if (!captchaUrlMatch) throw new Error('找不到 History 頁驗證碼 URL');
  const captchaUrl = THSRC_BASE + captchaUrlMatch[1];
  const captchaBase64 = await thsrcGetCaptcha(cookieJar, captchaUrl);

  console.log('  [退票 2/6] solving captcha...');
  const captchaRes = await fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: captchaBase64 }),
  });
  const captchaJson = await captchaRes.json();
  if (!captchaJson.answer) throw new Error('驗證碼辨識失敗：' + JSON.stringify(captchaJson));
  const captchaAnswer = captchaJson.answer;
  console.log('  [退票 2/6] done — answer=', captchaAnswer);

  // [3/6] POST HistoryForm 查詢訂單
  console.log('  [退票 3/6] POST 查詢訂單', ticketNo, '...');
  const POST_HEADERS = (jar) => ({
    ...BROWSER_HEADERS,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cache-Control': 'max-age=0',
    'Cookie': jar,
    'Referer': HISTORY_URL,
    'Origin': THSRC_BASE,
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
  });

  const historyPayload = new URLSearchParams({
    'HistoryForm:hf:0': '',
    typesofid: '0',
    rocId: passenger.idNumber,
    orderId: ticketNo,
    'divCaptcha:securityCode': captchaAnswer,
    SubmitButton: '查詢',
  });

  const { html: detailHtml, cookieJar: jar3 } = await _postAndFollow(
    historyFormAction, cookieJar, historyPayload.toString(), POST_HEADERS, null
  );
  cookieJar = jar3;
  console.log('  [退票 3/6] done — detailHtml len=', detailHtml.length);

  // [4/6] 解析 CancelSeatsButton ILinkListener 連結並 GET
  // 實際 HTML：<a href="/IMINT/?wicket:interface=...:CancelSeatsButton::ILinkListener">取消訂位</a>
  console.log('  [退票 4/6] 點擊取消訂位按鈕...');
  const cancelBtnMatch = detailHtml.match(/href="(\/IMINT\/[^"]*CancelSeatsButton[^"]*)"/);
  if (!cancelBtnMatch) throw new Error('找不到取消訂位按鈕連結（訂單可能無法退票或已付款）');
  const cancelBtnUrl = THSRC_BASE + cancelBtnMatch[1];

  const cancelBtnRes = await fetchWithTimeout(cancelBtnUrl, {
    redirect: 'manual',
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
  });
  const cancelBtnCookies = cancelBtnRes.headers.raw()['set-cookie'] || [];
  const cancelBtnRedirect = cancelBtnRes.headers.get('location');

  // 合併 cookie
  const cmapBtn = new Map();
  for (const c of cookieJar.split(';')) { const kv = c.trim(); const key = kv.split('=')[0]; if (key) cmapBtn.set(key, kv); }
  for (const c of cancelBtnCookies) { const kv = c.split(';')[0].trim(); const key = kv.split('=')[0]; cmapBtn.set(key, kv); }
  cookieJar = Array.from(cmapBtn.values()).join('; ');

  const cancelConfirmUrl = cancelBtnRedirect
    ? (cancelBtnRedirect.startsWith('http') ? cancelBtnRedirect : THSRC_BASE + cancelBtnRedirect)
    : cancelBtnUrl;

  // [5/6] GET 取消確認頁，解析 HistoryDetailsCancelForm action
  console.log('  [退票 5/6] 取消確認頁...');
  const confirmRes = await fetchWithTimeout(cancelConfirmUrl, {
    headers: {
      ...BROWSER_HEADERS,
      'Cookie': cookieJar,
      'Referer': THSRC_BASE + '/IMINT/',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-origin',
    },
    redirect: 'follow',
  });
  const confirmHtml = await confirmRes.text();
  console.log('  [退票 5/6] done — confirmHtml len=', confirmHtml.length);

  const cancelFormMatch = confirmHtml.match(/action="(\/IMINT\/[^"]*HistoryDetailsCancelForm[^"]*)"/);
  if (!cancelFormMatch) throw new Error('找不到取消確認表單 action');
  const cancelFormAction = THSRC_BASE + cancelFormMatch[1];

  // [6/6] POST 確認取消（agree=on, SubmitButton=下一步）
  console.log('  [退票 6/6] POST 確認取消...');
  const cancelPayload = new URLSearchParams({
    'HistoryDetailsCancelForm:hf:0': '',
    agree: 'on',
    SubmitButton: '下一步',
  });

  const { html: resultHtml } = await _postAndFollow(
    cancelFormAction, cookieJar, cancelPayload.toString(), POST_HEADERS, null
  );
  console.log('  [退票 6/6] done — resultHtml len=', resultHtml.length, 'has 取消訂位成功=', resultHtml.includes('取消訂位成功'));

  if (resultHtml.includes('取消訂位成功')) {
    return { success: true, message: '取消訂位成功' };
  }
  const errMatch = resultHtml.match(/class="[^"]*error[^"]*"[^>]*>([^<]{3,100})</);
  const message = errMatch ? errMatch[1].trim() : '退票失敗（未知原因）';
  return { success: false, message };
}

function parseBookingResult(html) {
  // S4 HTML 格式：<td ...>訂位代號</td><td class="td-data"><p class="pnr-code"><span>XXXXXXXX</span></p>
  const ticketMatch = html.match(/訂位代號<\/td>[\s\S]{0,300}?<p[^>]*pnr[^>]*>[\s\S]{0,50}?<span>\s*(\d{6,10})\s*<\/span>/);
  if (ticketMatch) {
    return { success: true, ticketNo: ticketMatch[1], error: null };
  }
  const errorMatch = html.match(/class="[^"]*error[^"]*"[^>]*>([^<]{3,100})</);
  return {
    success: false,
    ticketNo: null,
    error: errorMatch ? errorMatch[1].trim() : '訂票失敗（未知原因）',
  };
}

module.exports = { thsrcInit, thsrcGetCaptcha, thsrcQueryTrains, thsrcSubmitBooking, thsrcCancelBooking, selectBestTrain, parseTrainOptions };
