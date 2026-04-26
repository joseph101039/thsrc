# THSRC GAS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Google Apps Script Backend，提供訂票 API、排程執行、重試邏輯、驗證碼流程、Email 通知，資料存放於 Google Sheet。

**Architecture:** GAS Web App 以 `doPost()` 作為單一入口，依 `action` 欄位 dispatch 到各處理函式。Google Sheet 作為資料庫，`bookings` 和 `passengers` 兩個分頁分別存訂票任務與乘客資料。訂票邏輯以時間觸發器排程執行，跨觸發器狀態透過 Sheet 持久化。

**Tech Stack:** Google Apps Script (V8 runtime)、Google Sheets API（SpreadsheetApp）、UrlFetchApp（HTTP 請求高鐵網站）、GmailApp（Email 通知）、ScriptApp（時間觸發器）

---

## File Structure

```
gas/
├── Code.gs          # doGet / doPost dispatcher，CORS headers
├── Config.gs        # 常數：Sheet 名稱、欄位索引、站名對照、重試等待時間
├── Sheet.gs         # Google Sheet 讀寫封裝（bookings / passengers CRUD）
├── Passengers.gs    # 乘客資料 API handlers（getPassengers、savePassenger、deletePassenger）
├── Bookings.gs      # 訂票任務 API handlers（createBooking、getBookings）
├── Scheduler.gs     # 觸發器管理（建立、刪除、resumeBooking 入口）
├── Thsrc.gs         # 高鐵網站 HTTP 請求封裝（查詢車次、取得驗證碼、送出訂票）
├── BookingEngine.gs # 訂票主邏輯（查車次 → 選班次 → 驗證碼 → 送出 → 重試）
├── Captcha.gs       # 驗證碼 handler（submitCaptcha）
└── Mailer.gs        # Email 通知封裝（成功、失敗、驗證碼請求）
```

> **注意：** GAS 沒有 npm 也沒有原生 unit test framework。測試策略為：
> - 每個 `.gs` 檔案底部寫 `function test_<name>()` 手動在 GAS Editor 執行
> - 使用 `console.log` 驗證輸出
> - 複雜邏輯（車次排序、時間比較）抽成純函式，方便孤立測試

---

## Task 1: 建立 GAS 專案結構與 Config

**Files:**
- Create: `gas/Config.gs`
- Create: `gas/Code.gs`

- [ ] **Step 1: 在 GAS Editor 建立專案**

  開啟 https://script.google.com/home/projects/1HeqzVtQtuV_G-b2XikG2faF9I_cvajJgQQDIr7Tp1HhV-wsxG49N3oaa/edit

  確認 Runtime 設定為 V8：左上選單 → 「專案設定」→ 確認「啟用 Chrome V8 執行階段」已勾選。

- [ ] **Step 2: 建立 `Config.gs`**

  在 GAS Editor 新增檔案 `Config.gs`，貼入：

  ```javascript
  const CONFIG = {
    SHEET_NAME_BOOKINGS: 'bookings',
    SHEET_NAME_PASSENGERS: 'passengers',
    MAX_EXECUTION_MS: 5 * 60 * 1000, // 5 分鐘，保留 1 分鐘緩衝
    RETRY_WAIT_MINUTES: 2,            // 無可用班次或驗證碼超時時等待分鐘數

    STATIONS: ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'],

    PASSENGER_TYPES: {
      adult:    '成人',
      student:  '學生',
      senior:   '敬老',
      disabled: '愛心',
      child:    '兒童',
    },

    BOOKING_STATUS: {
      PENDING:  'pending',
      RUNNING:  'running',
      WAITING_CAPTCHA: 'waiting_captcha',
      SUCCESS:  'success',
      FAILED:   'failed',
    },

    // bookings sheet 欄位索引（0-based）
    BOOKING_COLS: {
      ID: 0, PASSENGER_ID: 1, FROM: 2, TO: 3, DATE: 4,
      DESIRED_TIME: 5, EARLIEST_TIME: 6, LATEST_TIME: 7,
      MAX_RETRIES: 8, SCHEDULED_AT: 9, STATUS: 10,
      RETRY_COUNT: 11, TRAIN_NO: 12, TICKET_NO: 13,
      CREATED_AT: 14, UPDATED_AT: 15,
    },

    // passengers sheet 欄位索引（0-based）
    PASSENGER_COLS: {
      ID: 0, NAME: 1, ID_NUMBER: 2, TYPE: 3, EMAIL: 4,
    },
  };
  ```

- [ ] **Step 3: 建立 `Code.gs`（dispatcher）**

  將預設的 `Code.gs` 內容替換為：

  ```javascript
  function doGet(e) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  function doPost(e) {
    const cors = { 'Access-Control-Allow-Origin': '*' };
    try {
      const body = JSON.parse(e.postData.contents);
      const action = body.action;
      let result;

      switch (action) {
        case 'getPassengers':   result = getPassengers();              break;
        case 'savePassenger':   result = savePassenger(body.data);     break;
        case 'deletePassenger': result = deletePassenger(body.id);     break;
        case 'createBooking':   result = createBooking(body.data);     break;
        case 'getBookings':     result = getBookings();                break;
        case 'submitCaptcha':   result = submitCaptcha(body.id, body.captcha); break;
        default:
          result = { error: 'Unknown action: ' + action };
      }

      return ContentService.createTextOutput(JSON.stringify(result))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }
  ```

- [ ] **Step 4: 手動測試 doGet**

  GAS Editor → 選擇函式 `doGet` → 點「執行」  
  預期 Execution log 無錯誤，回傳 `{"status":"ok"}`

- [ ] **Step 5: Commit（本機儲存設計文件）**

  ```bash
  git add gas/
  git commit -m "feat: add GAS project structure and config"
  ```
  > 注意：GAS 原始碼存在 Google 伺服器，此 commit 只是把本機的 .gs 檔案副本加入 git。若使用 clasp 同步請額外設定，本計畫不強制要求。

---

## Task 2: Google Sheet 初始化與讀寫封裝

**Files:**
- Create: `gas/Sheet.gs`

- [ ] **Step 1: 手動建立 Google Sheet 分頁**

  開啟 Google Sheet「thsrc」，確認：
  1. 分頁一重新命名為 `bookings`，第一列加入表頭：
     ```
     id | passengerId | fromStation | toStation | date | desiredTime | earliestTime | latestTime | maxRetries | scheduledAt | status | retryCount | trainNo | ticketNo | createdAt | updatedAt
     ```
  2. 新增分頁二命名為 `passengers`，第一列加入表頭：
     ```
     id | name | idNumber | type | email
     ```

- [ ] **Step 2: 建立 `Sheet.gs`**

  ```javascript
  function getSheet(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    return ss.getSheetByName(name);
  }

  function generateId() {
    return Utilities.getUuid();
  }

  // 讀取整個 sheet，回傳 object 陣列（跳過 header row）
  function sheetToObjects(sheetName, colsMap) {
    const sheet = getSheet(sheetName);
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return [];
    return rows.slice(1).map(row => {
      const obj = {};
      Object.entries(colsMap).forEach(([key, idx]) => {
        obj[toCamelCase(key)] = row[idx] === '' ? null : row[idx];
      });
      return obj;
    });
  }

  // 找到 id 對應的 row index（1-based，含 header）
  function findRowById(sheetName, id) {
    const sheet = getSheet(sheetName);
    const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues().flat();
    const idx = ids.indexOf(id);
    return idx === -1 ? -1 : idx + 1;
  }

  // 更新指定 row 的特定欄位
  function updateRowFields(sheetName, id, colsMap, fields) {
    const sheet = getSheet(sheetName);
    const rowIndex = findRowById(sheetName, id);
    if (rowIndex === -1) throw new Error('Row not found: ' + id);
    Object.entries(fields).forEach(([key, value]) => {
      const colKey = toScreamingSnake(key);
      const colIdx = colsMap[colKey];
      if (colIdx === undefined) throw new Error('Unknown field: ' + key);
      sheet.getRange(rowIndex, colIdx + 1).setValue(value);
    });
  }

  // 新增一列（從 object 轉成 row array）
  function appendRow(sheetName, colsMap, obj) {
    const sheet = getSheet(sheetName);
    const totalCols = Object.keys(colsMap).length;
    const row = new Array(totalCols).fill('');
    Object.entries(colsMap).forEach(([key, idx]) => {
      const camel = toCamelCase(key);
      row[idx] = obj[camel] !== undefined && obj[camel] !== null ? obj[camel] : '';
    });
    sheet.appendRow(row);
  }

  // 刪除 id 對應的 row
  function deleteRowById(sheetName, id) {
    const sheet = getSheet(sheetName);
    const rowIndex = findRowById(sheetName, id);
    if (rowIndex === -1) throw new Error('Row not found: ' + id);
    sheet.deleteRow(rowIndex);
  }

  // 工具：SCREAMING_SNAKE → camelCase
  function toCamelCase(str) {
    return str.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  }

  // 工具：camelCase → SCREAMING_SNAKE
  function toScreamingSnake(str) {
    return str.replace(/([A-Z])/g, '_$1').toUpperCase();
  }

  // 手動測試
  function test_sheetHelpers() {
    console.log('toCamelCase PASSENGER_ID:', toCamelCase('PASSENGER_ID')); // passengerId
    console.log('toScreamingSnake passengerId:', toScreamingSnake('passengerId')); // PASSENGER_ID
    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    console.log('passengers:', JSON.stringify(passengers));
  }
  ```

- [ ] **Step 3: 執行 `test_sheetHelpers`**

  GAS Editor → 選擇 `test_sheetHelpers` → 執行  
  預期 log：
  ```
  toCamelCase PASSENGER_ID: passengerId
  toScreamingSnake passengerId: PASSENGER_ID
  passengers: []
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add gas/Sheet.gs
  git commit -m "feat: add Sheet read/write helpers"
  ```

---

## Task 3: 乘客 CRUD API

**Files:**
- Create: `gas/Passengers.gs`

- [ ] **Step 1: 建立 `Passengers.gs`**

  ```javascript
  function getPassengers() {
    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    return { passengers };
  }

  function savePassenger(data) {
    const { id, name, idNumber, type, email } = data;
    const now = new Date().toISOString();

    if (id) {
      // 更新既有乘客
      updateRowFields(CONFIG.SHEET_NAME_PASSENGERS, id, CONFIG.PASSENGER_COLS, {
        name, idNumber, type, email,
      });
      return { success: true, id };
    } else {
      // 新增乘客
      const newId = generateId();
      appendRow(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS, {
        id: newId, name, idNumber, type, email,
      });
      return { success: true, id: newId };
    }
  }

  function deletePassenger(id) {
    deleteRowById(CONFIG.SHEET_NAME_PASSENGERS, id);
    return { success: true };
  }

  // 手動測試
  function test_passengers() {
    // 新增
    const created = savePassenger({ name: '測試者', idNumber: 'A123456789', type: 'adult', email: 'test@example.com' });
    console.log('created:', JSON.stringify(created));

    // 查詢
    const list = getPassengers();
    console.log('list:', JSON.stringify(list));

    // 更新
    savePassenger({ id: created.id, name: '測試者2', idNumber: 'A123456789', type: 'senior', email: 'test2@example.com' });
    console.log('after update:', JSON.stringify(getPassengers()));

    // 刪除
    deletePassenger(created.id);
    console.log('after delete:', JSON.stringify(getPassengers()));
  }
  ```

- [ ] **Step 2: 執行 `test_passengers`**

  GAS Editor → 選擇 `test_passengers` → 執行  
  預期：
  - created 有 `id` 欄位
  - list 包含一筆資料
  - after update 顯示更新後資料
  - after delete 回到空陣列

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Passengers.gs
  git commit -m "feat: add passenger CRUD API"
  ```

---

## Task 4: 訂票任務建立與查詢 API

**Files:**
- Create: `gas/Bookings.gs`

- [ ] **Step 1: 建立 `Bookings.gs`**

  ```javascript
  function getBookings() {
    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    return { bookings };
  }

  function createBooking(data) {
    const {
      passengerId, fromStation, toStation, date,
      desiredTime, earliestTime, latestTime,
      maxRetries, scheduledAt,
    } = data;

    const now = new Date().toISOString();
    const id = generateId();

    appendRow(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS, {
      id,
      passengerId,
      fromStation,
      toStation,
      date,
      desiredTime,
      earliestTime,
      latestTime,
      maxRetries: maxRetries || 10,
      scheduledAt: scheduledAt || '',
      status: CONFIG.BOOKING_STATUS.PENDING,
      retryCount: 0,
      trainNo: '',
      ticketNo: '',
      createdAt: now,
      updatedAt: now,
    });

    if (scheduledAt) {
      scheduleBooking(id, new Date(scheduledAt));
    } else {
      runBooking(id);
    }

    return { success: true, id };
  }

  // 手動測試（不會真的送出訂票，runBooking 會在 test 環境失敗是預期內）
  function test_createBooking() {
    const result = createBooking({
      passengerId: 'test-passenger-id',
      fromStation: '台北',
      toStation: '左營',
      date: '2026-05-01',
      desiredTime: '09:00',
      earliestTime: '08:00',
      latestTime: '11:00',
      maxRetries: 3,
      scheduledAt: null,
    });
    console.log('createBooking result:', JSON.stringify(result));
    console.log('bookings:', JSON.stringify(getBookings()));
  }
  ```

- [ ] **Step 2: 執行 `test_createBooking`**

  選擇 `test_createBooking` → 執行  
  預期：Sheet `bookings` 新增一筆資料，status 為 `pending` 或 `running`（`runBooking` 尚未實作，會拋錯是正常的，確認 Sheet 有資料即可）

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Bookings.gs
  git commit -m "feat: add booking create and query API"
  ```

---

## Task 5: 高鐵網站 HTTP 請求封裝

**Files:**
- Create: `gas/Thsrc.gs`

- [ ] **Step 1: 建立 `Thsrc.gs`**

  ```javascript
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

    // 取得 CSRF token（hidden input name="BookingS1Form:hf:0"）
    const tokenMatch = html.match(/name="BookingS1Form:hf:0"\s+value="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : '';

    // 取得 session id from cookie
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

  // 查詢可用車次
  // 回傳 [{ trainNo, departTime, arriveTime }] 或 []
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
      payload: Object.entries(payload).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'),
      muteHttpExceptions: true,
      followRedirects: true,
    });

    const html = res.getContentText();
    return parseTrainOptions(html, earliestTime, latestTime);
  }

  // 從 HTML 解析車次選項
  function parseTrainOptions(html, earliestTime, latestTime) {
    const trains = [];
    // 車次資訊在 <input type="radio" name="TrainQueryDataViewPanel:TrainGroup" ...>
    // 和對應的 label 中
    const regex = /value="([^"]+)"\s[^>]*>[\s\S]*?<label[^>]*>([^<]+)<\/label>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const value = match[1];
      const label = match[2].trim();
      // label 格式通常為 "車次 0102 出發 09:00 抵達 11:30"
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

  // 送出訂票
  // 回傳 { success: boolean, ticketNo: string|null, error: string|null }
  function thsrcSubmitBooking(sessionId, token, params) {
    const { trainNo, passengerType, idNumber, captcha } = params;

    const typeCodeMap = {
      adult: 'F', student: 'H', senior: 'W', disabled: 'B', child: 'E',
    };

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
      payload: Object.entries(payload).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'),
      muteHttpExceptions: true,
      followRedirects: true,
    });

    const html = res.getContentText();
    return parseBookingResult(html);
  }

  // 從確認頁面解析訂票結果
  function parseBookingResult(html) {
    // 成功頁面包含訂位代號
    const ticketMatch = html.match(/訂位代號[：:]\s*([A-Z0-9]+)/);
    if (ticketMatch) {
      return { success: true, ticketNo: ticketMatch[1], error: null };
    }
    // 失敗頁面包含錯誤訊息
    const errorMatch = html.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)</);
    return {
      success: false,
      ticketNo: null,
      error: errorMatch ? errorMatch[1].trim() : '訂票失敗（未知原因）',
    };
  }

  // 手動測試（只測輔助函式，不真的呼叫高鐵網站）
  function test_thsrcHelpers() {
    // 測試 timeToMinutes
    console.log('09:30 in minutes:', timeToMinutes('09:30')); // 570

    // 測試 selectBestTrain
    const trains = [
      { trainNo: '101', departTime: '08:00', arriveTime: '10:30' },
      { trainNo: '103', departTime: '09:30', arriveTime: '12:00' },
      { trainNo: '105', departTime: '11:00', arriveTime: '13:30' },
    ];
    const best = selectBestTrain(trains, '09:00');
    console.log('best train for 09:00:', JSON.stringify(best)); // 103（最接近 09:00 的是 09:30）

    // 測試 parseTrainOptions（用假 HTML）
    const fakeHtml = `
      <input type="radio" name="TrainQueryDataViewPanel:TrainGroup" value="0103">
      <label>車次 0103 出發 09:30 抵達 12:00</label>
    `;
    const parsed = parseTrainOptions(fakeHtml, '08:00', '11:00');
    console.log('parsed trains:', JSON.stringify(parsed));
  }
  ```

- [ ] **Step 2: 執行 `test_thsrcHelpers`**

  選擇 `test_thsrcHelpers` → 執行  
  預期：
  ```
  09:30 in minutes: 570
  best train for 09:00: {"trainNo":"103","departTime":"09:30","arriveTime":"12:00"}
  parsed trains: [{"trainNo":"0103","departTime":"09:30","arriveTime":"12:00","label":"..."}]
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Thsrc.gs
  git commit -m "feat: add THSRC HTTP request and train parsing helpers"
  ```

---

## Task 6: Email 通知封裝

**Files:**
- Create: `gas/Mailer.gs`

- [ ] **Step 1: 建立 `Mailer.gs`**

  ```javascript
  function sendCaptchaEmail(toEmail, bookingId, captchaBase64, webUiUrl) {
    const subject = '【高鐵訂票】請輸入驗證碼';
    const captchaUrl = webUiUrl + '?captcha=' + bookingId;
    const body = `
高鐵訂票系統正在為您搶票，需要您輸入驗證碼才能繼續。

請點擊以下連結輸入驗證碼：
${captchaUrl}

（連結有效時間：${CONFIG.RETRY_WAIT_MINUTES} 分鐘）

如果您沒有發起訂票請求，請忽略此信。
    `.trim();

    const htmlBody = `
<p>高鐵訂票系統正在為您搶票，需要您輸入驗證碼才能繼續。</p>
<p>驗證碼圖片：</p>
<img src="data:image/jpeg;base64,${captchaBase64}" style="border:1px solid #ccc; padding:4px;" />
<p><a href="${captchaUrl}" style="background:#2980b9;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;">點此輸入驗證碼</a></p>
<p style="color:#888;font-size:12px;">連結有效時間：${CONFIG.RETRY_WAIT_MINUTES} 分鐘</p>
    `.trim();

    GmailApp.sendEmail(toEmail, subject, body, { htmlBody });
  }

  function sendSuccessEmail(toEmail, booking, passenger) {
    const subject = '【高鐵訂票】訂票成功！';
    const body = `
您的高鐵票已成功訂購！

乘客：${passenger.name}
路線：${booking.fromStation} → ${booking.toStation}
日期：${booking.date}
車次：${booking.trainNo}
訂位代號：${booking.ticketNo}
嘗試次數：${booking.retryCount}

請記得在發車前至超商或車站取票付款。
    `.trim();

    GmailApp.sendEmail(toEmail, subject, body);
  }

  function sendFailureEmail(toEmail, booking, passenger, reason) {
    const subject = '【高鐵訂票】訂票失敗';
    const body = `
很抱歉，您的高鐵訂票未能成功。

乘客：${passenger.name}
路線：${booking.fromStation} → ${booking.toStation}
日期：${booking.date}
期望時間：${booking.desiredTime}
嘗試次數：${booking.retryCount}
失敗原因：${reason}

請手動前往高鐵官網訂票：https://irs.thsrc.com.tw/IMINT/
    `.trim();

    GmailApp.sendEmail(toEmail, subject, body);
  }

  // 手動測試（會真的寄信）
  function test_mailer() {
    const testEmail = Session.getActiveUser().getEmail();
    sendFailureEmail(
      testEmail,
      { fromStation: '台北', toStation: '左營', date: '2026-05-01', desiredTime: '09:00', retryCount: 3 },
      { name: '測試者' },
      '無可用班次'
    );
    console.log('Test failure email sent to:', testEmail);
  }
  ```

- [ ] **Step 2: 執行 `test_mailer`**

  選擇 `test_mailer` → 執行（首次執行需授權 GmailApp 權限）  
  預期：收到一封測試失敗通知信

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Mailer.gs
  git commit -m "feat: add email notification helpers"
  ```

---

## Task 7: 排程管理（Scheduler）

**Files:**
- Create: `gas/Scheduler.gs`

- [ ] **Step 1: 建立 `Scheduler.gs`**

  ```javascript
  // 建立一次性時間觸發器，在 targetDate 執行 resumeBooking(bookingId)
  // GAS 觸發器無法直接傳參數，用 ScriptProperties 存 bookingId
  function scheduleBooking(bookingId, targetDate) {
    // 清除同一 bookingId 的舊觸發器
    clearTriggerForBooking(bookingId);

    const trigger = ScriptApp.newTrigger('resumeBookingTrigger')
      .timeBased()
      .at(targetDate)
      .create();

    // 用 triggerId → bookingId 對應存在 ScriptProperties
    PropertiesService.getScriptProperties()
      .setProperty('trigger_' + trigger.getUniqueId(), bookingId);

    console.log('Scheduled booking', bookingId, 'at', targetDate.toISOString());
  }

  // 觸發器入口（GAS 觸發器只能呼叫無參數函式）
  function resumeBookingTrigger(e) {
    const triggerId = e.triggerUid;
    const props = PropertiesService.getScriptProperties();
    const bookingId = props.getProperty('trigger_' + triggerId);

    if (!bookingId) {
      console.error('No bookingId found for trigger:', triggerId);
      return;
    }

    // 清除已用的 property 和觸發器
    props.deleteProperty('trigger_' + triggerId);
    clearTriggerById(triggerId);

    runBooking(bookingId);
  }

  function clearTriggerForBooking(bookingId) {
    const props = PropertiesService.getScriptProperties();
    const allProps = props.getProperties();
    ScriptApp.getProjectTriggers().forEach(trigger => {
      const key = 'trigger_' + trigger.getUniqueId();
      if (allProps[key] === bookingId) {
        props.deleteProperty(key);
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  function clearTriggerById(triggerId) {
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getUniqueId() === triggerId) {
        ScriptApp.deleteTrigger(trigger);
      }
    });
  }

  // 排程重試（等待 RETRY_WAIT_MINUTES 後再試）
  function scheduleRetry(bookingId) {
    const retryAt = new Date(Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000);
    scheduleBooking(bookingId, retryAt);
  }

  // 手動測試
  function test_scheduler() {
    // 建立一個 5 分鐘後執行的觸發器（測試完記得手動刪除）
    const future = new Date(Date.now() + 5 * 60 * 1000);
    scheduleBooking('test-booking-id', future);
    const triggers = ScriptApp.getProjectTriggers();
    console.log('Active triggers:', triggers.length);

    // 清除
    clearTriggerForBooking('test-booking-id');
    console.log('After clear:', ScriptApp.getProjectTriggers().length);
  }
  ```

- [ ] **Step 2: 執行 `test_scheduler`**

  選擇 `test_scheduler` → 執行（首次需授權 ScriptApp 權限）  
  預期：
  ```
  Active triggers: 1
  After clear: 0
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Scheduler.gs
  git commit -m "feat: add trigger-based scheduler for booking retries"
  ```

---

## Task 8: 訂票主引擎（BookingEngine）

**Files:**
- Create: `gas/BookingEngine.gs`

- [ ] **Step 1: 建立 `BookingEngine.gs`**

  ```javascript
  const WEB_UI_URL = 'https://your-github-pages-url'; // 部署後更新

  // 主入口：執行一次訂票嘗試
  function runBooking(bookingId) {
    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) throw new Error('Booking not found: ' + bookingId);

    // 更新狀態為 running
    updateBookingFields(bookingId, { status: CONFIG.BOOKING_STATUS.RUNNING });

    const startTime = Date.now();

    try {
      // Step 1: 初始化 session
      const { sessionId, token } = thsrcInit();

      // Step 2: 查詢車次
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

      // Step 3: 選擇最佳班次
      const bestTrain = selectBestTrain(trains, booking.desiredTime);

      // Step 4: 取得驗證碼
      const captchaBase64 = thsrcGetCaptcha(sessionId);

      // Step 5: 發送驗證碼 Email，等待使用者輸入
      const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
      const passenger = passengers.find(p => p.id === booking.passengerId);
      if (!passenger) throw new Error('Passenger not found: ' + booking.passengerId);

      // 將 session 資訊存入 ScriptProperties 供 submitCaptcha 使用
      const props = PropertiesService.getScriptProperties();
      props.setProperty('session_' + bookingId, JSON.stringify({
        sessionId, token, trainNo: bestTrain.trainNo,
        passengerType: passenger.type, idNumber: passenger.idNumber,
        expireAt: Date.now() + CONFIG.RETRY_WAIT_MINUTES * 60 * 1000,
      }));

      updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.WAITING_CAPTCHA,
        trainNo: bestTrain.trainNo,
      });

      sendCaptchaEmail(passenger.email, bookingId, captchaBase64, WEB_UI_URL);

      console.log('Waiting for captcha for booking:', bookingId);
    } catch (err) {
      console.error('runBooking error:', err.message);
      return handleRetry(booking, bookingId, err.message);
    }
  }

  // submitCaptcha 後繼續訂票
  function continueBookingWithCaptcha(bookingId, captcha) {
    const props = PropertiesService.getScriptProperties();
    const sessionJson = props.getProperty('session_' + bookingId);
    if (!sessionJson) throw new Error('No session found for booking: ' + bookingId);

    const session = JSON.parse(sessionJson);
    if (Date.now() > session.expireAt) {
      props.deleteProperty('session_' + bookingId);
      const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
      const booking = bookings.find(b => b.id === bookingId);
      return handleRetry(booking, bookingId, '驗證碼超時，重新嘗試');
    }

    props.deleteProperty('session_' + bookingId);

    const result = thsrcSubmitBooking(session.sessionId, session.token, {
      trainNo: session.trainNo,
      passengerType: session.passengerType,
      idNumber: session.idNumber,
      captcha,
    });

    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    const booking = bookings.find(b => b.id === bookingId);
    const passengers = sheetToObjects(CONFIG.SHEET_NAME_PASSENGERS, CONFIG.PASSENGER_COLS);
    const passenger = passengers.find(p => p.id === booking.passengerId);

    if (result.success) {
      updateBookingFields(bookingId, {
        status: CONFIG.BOOKING_STATUS.SUCCESS,
        ticketNo: result.ticketNo,
      });
      sendSuccessEmail(passenger.email, { ...booking, ticketNo: result.ticketNo }, passenger);
    } else {
      handleRetry(booking, bookingId, result.error);
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
  ```

- [ ] **Step 2: 執行邏輯驗證（不呼叫高鐵網站）**

  在 GAS Editor 加入臨時測試函式：
  ```javascript
  function test_handleRetry() {
    // 先在 bookings sheet 建一筆測試資料
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

    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    const b = bookings.find(x => x.id === id);
    console.log('After 1st retry:', b.status, b.retryCount); // pending, 1

    handleRetry({ ...fakeBooking, retryCount: 1 }, id, '測試失敗原因');
    handleRetry({ ...fakeBooking, retryCount: 2 }, id, '測試失敗原因');
    const b2 = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS).find(x => x.id === id);
    console.log('After max retries:', b2.status, b2.retryCount); // failed, 3

    // 清除測試資料
    deleteRowById(CONFIG.SHEET_NAME_BOOKINGS, id);
  }
  ```
  執行 `test_handleRetry`  
  預期：
  ```
  After 1st retry: pending 1
  After max retries: failed 3
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add gas/BookingEngine.gs
  git commit -m "feat: add booking engine with retry logic"
  ```

---

## Task 9: 驗證碼 Handler

**Files:**
- Create: `gas/Captcha.gs`

- [ ] **Step 1: 建立 `Captcha.gs`**

  ```javascript
  function submitCaptcha(bookingId, captcha) {
    if (!bookingId || !captcha) {
      return { error: 'bookingId and captcha are required' };
    }

    // 確認訂單存在且狀態為 waiting_captcha
    const bookings = sheetToObjects(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS);
    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) return { error: 'Booking not found: ' + bookingId };
    if (booking.status !== CONFIG.BOOKING_STATUS.WAITING_CAPTCHA) {
      return { error: 'Booking is not waiting for captcha. Status: ' + booking.status };
    }

    try {
      continueBookingWithCaptcha(bookingId, captcha);
      return { success: true };
    } catch (err) {
      return { error: err.message };
    }
  }
  ```

- [ ] **Step 2: 手動測試整合流程驗證**

  在 GAS Editor 執行：
  ```javascript
  function test_submitCaptcha_validation() {
    // 測試無效 bookingId
    const r1 = submitCaptcha('nonexistent-id', '1234');
    console.log('nonexistent:', r1.error); // Booking not found

    // 測試狀態不符
    const id = generateId();
    appendRow(CONFIG.SHEET_NAME_BOOKINGS, CONFIG.BOOKING_COLS, {
      id, passengerId: 'p1', fromStation: '台北', toStation: '左營',
      date: '2026-05-01', desiredTime: '09:00', earliestTime: '08:00',
      latestTime: '11:00', maxRetries: 3, scheduledAt: '', status: 'running',
      retryCount: 0, trainNo: '', ticketNo: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const r2 = submitCaptcha(id, '1234');
    console.log('wrong status:', r2.error); // not waiting for captcha
    deleteRowById(CONFIG.SHEET_NAME_BOOKINGS, id);
  }
  ```
  預期：
  ```
  nonexistent: Booking not found: nonexistent-id
  wrong status: Booking is not waiting for captcha. Status: running
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add gas/Captcha.gs
  git commit -m "feat: add captcha submission handler"
  ```

---

## Task 10: 部署 GAS Web App 並端對端測試

**Files:** 無新增檔案，為部署與整合測試步驟

- [ ] **Step 1: 部署 GAS Web App**

  GAS Editor → 右上角「部署」→「新增部署作業」  
  - 類型：Web 應用程式  
  - 執行身份：**我（你的 Google 帳號）**  
  - 誰可以存取：**所有人**（含匿名使用者）  
  - 點「部署」→ 複製 Web App URL（格式：`https://script.google.com/macros/s/xxxxx/exec`）

  將 URL 記錄下來，Web UI 計畫會用到。

- [ ] **Step 2: 測試 getPassengers API**

  用 curl 或 Postman 送：
  ```bash
  curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
    -H "Content-Type: application/json" \
    -d '{"action":"getPassengers"}'
  ```
  預期回傳：`{"passengers":[]}`

- [ ] **Step 3: 測試 savePassenger API**

  ```bash
  curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
    -H "Content-Type: application/json" \
    -d '{"action":"savePassenger","data":{"name":"測試者","idNumber":"A123456789","type":"adult","email":"test@example.com"}}'
  ```
  預期：`{"success":true,"id":"..."}` 並在 Google Sheet `passengers` 分頁看到新資料

- [ ] **Step 4: 測試 getBookings API**

  ```bash
  curl -X POST "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec" \
    -H "Content-Type: application/json" \
    -d '{"action":"getBookings"}'
  ```
  預期：`{"bookings":[]}`

- [ ] **Step 5: 更新 WEB_UI_URL 常數**

  在 `BookingEngine.gs` 第一行，將 `WEB_UI_URL` 更新為實際的 Web UI URL（Plan 2 完成後再回來更新）。目前暫時填入測試用 Email。

- [ ] **Step 6: 重新部署（每次改動 .gs 檔後需重新部署）**

  GAS Editor → 「部署」→「管理部署作業」→ 點現有部署旁的編輯（鉛筆圖示）→「版本」選「新版本」→ 「部署」

- [ ] **Step 7: Commit**

  ```bash
  git add gas/BookingEngine.gs
  git commit -m "feat: complete GAS backend, ready for Web UI integration"
  ```

---

## 自我審查（Spec Coverage）

| Spec 需求 | 對應 Task |
|-----------|-----------|
| doPost dispatcher + CORS | Task 1 Code.gs |
| getPassengers / savePassenger / deletePassenger | Task 3 |
| createBooking / getBookings | Task 4 |
| submitCaptcha | Task 9 |
| 高鐵 HTTP 請求（查車次、取驗證碼、送訂票） | Task 5 |
| 選擇最接近期望時間的班次 | Task 5 selectBestTrain |
| 最大重試次數、跨觸發器累計 | Task 8 handleRetry |
| 無可用班次 → 重試 | Task 8 runBooking |
| 時間觸發器（分鐘精確） | Task 7 Scheduler.gs |
| GAS 6 分鐘執行限制處理 | Task 7 + Task 8（scheduleRetry） |
| Email 驗證碼通知 | Task 6 + Task 8 |
| Email 成功通知 | Task 6 + Task 8 |
| Email 失敗通知（含原因） | Task 6 + Task 8 |
| Google Sheet bookings 結構 | Task 2 |
| Google Sheet passengers 結構 | Task 2 |
| 部署為 Web App | Task 10 |
