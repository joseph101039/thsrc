'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState, setMockBookingResult, getTestToken, ADMIN_EMAIL } = require('./helpers/auth');
const http = require('http');

function apiRequest(method, path, token, body = null) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: 'localhost', port: 8081, path, method,
      headers: {
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        Authorization: `Bearer ${token}`,
      },
    }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// 直接打 API 建立旅客
async function createPassengerViaApi(token) {
  const res = await apiRequest('POST', '/v1/passengers', token, {
    name: 'E2E Booking 旅客',
    idNumber: 'A123456789',
    type: 'adult',
    email: 'booking-e2e@test.com',
  });
  if (res.status >= 400) throw new Error(`createPassengerViaApi failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

// 直接打 API 建立訂單
async function createBookingViaApi(token, passengerId, overrides = {}) {
  const tDate = tomorrow();
  const res = await apiRequest('POST', '/v1/bookings', token, {
    passengerId,
    fromStation: '台北',
    toStation: '左營',
    date: tDate,
    desiredTime: '09:00',
    earliestTime: '08:00',
    latestTime: '11:00',
    maxRetries: 1,
    ticketAdult: 1,
    ticketChild: 0,
    ticketDisabled: 0,
    ticketSenior: 0,
    ticketStudent: 0,
    searchMode: 'time',
    retryWaitUnit: 'minute',
    retryWaitValue: 2,
    immediate: false,
    ...overrides,
  });
  if (res.status >= 400) throw new Error(`createBookingViaApi failed: ${JSON.stringify(res.body)}`);
  return res.body;
}

// 打 API 取消訂單
function cancelBookingViaApi(token, bookingId) {
  return apiRequest('POST', `/v1/bookings/${bookingId}/cancel`, token);
}

function tomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 填寫訂票表單（時間模式）
async function fillBookingForm(page, { passengerId, date, time = '09:00', mode = 'immediate' }) {
  // 等待旅客選單非同步載入完成（option value 非空代表旅客資料已載入）
  await page.waitForFunction(
    () => {
      const sel = document.getElementById('b-passenger');
      return sel && Array.from(sel.options).some(o => o.value !== '');
    },
    { timeout: 10000 }
  );
  await page.selectOption('#b-passenger', { value: passengerId });
  await page.selectOption('#b-from', { value: '台北' });
  await page.selectOption('#b-to', { value: '左營' });
  await page.fill('#b-date', date);
  await page.fill('#b-desired-time', time);
  await page.fill('#b-earliest', '08:00');
  await page.fill('#b-latest', '11:00');

  if (mode === 'scheduled') {
    await page.click('#btn-scheduled');
    const tomorrowDate = tomorrow();
    await page.fill('#b-schedule-date', tomorrowDate);
    await page.fill('#b-schedule-time', '08:00');
  }
  // mode === 'immediate'：預設已是立即模式（#btn-immediate 預設 active）
}

test.describe('訂票流程', () => {
  let storageState;
  let token;
  let passengerId;

  test.beforeAll(async () => {
    token = await getTestToken(ADMIN_EMAIL, 'admin');
    storageState = await makeStorageState(ADMIN_EMAIL, 'admin');
    const passenger = await createPassengerViaApi(token);
    passengerId = passenger.id;
    await setMockBookingResult('success');
  });

  test('場景 8：建立預約單（immediate: false）→ 首頁列表顯示等待中', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'scheduled' });
    await page.click('#submit-btn');

    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
    await expect(page.locator('#bookings-list')).toContainText('等待中', { timeout: 5000 });

    await context.close();
  });

  test('場景 9：立即訂票 mock success → 首頁列表顯示成功', async ({ browser }) => {
    await setMockBookingResult('success');
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'immediate' });
    await page.click('#submit-btn');

    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });

    // mock runBooking 是 fire-and-forget，等待後重新載入確認最終狀態
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.locator('#bookings-list')).toContainText('成功', { timeout: 10000 });

    await context.close();
  });

  test('場景 10：立即訂票 mock failure → 首頁列表顯示失敗', async ({ browser }) => {
    await setMockBookingResult('failure');
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'immediate' });
    await page.click('#submit-btn');

    await expect(page).toHaveURL(/index\.html/, { timeout: 10000 });
    await page.waitForTimeout(2000);
    await page.reload();
    await expect(page.locator('#bookings-list')).toContainText('失敗', { timeout: 10000 });

    await setMockBookingResult('success');
    await context.close();
  });

  test('場景 11：取消 pending 訂單 → 狀態更新為已取消', async ({ browser }) => {
    // 先透過 API 建立一個 pending 訂單，確保有可取消的訂單
    await createBookingViaApi(token, passengerId);

    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/index.html');

    await page.waitForSelector('#bookings-list .card', { timeout: 5000 });

    // 找有「取消」按鈕的第一張卡片
    const cancelBtn = page.locator('#bookings-list .card')
      .filter({ has: page.locator('button', { hasText: '取消' }) })
      .first()
      .locator('button', { hasText: '取消' });

    await expect(cancelBtn).toBeVisible({ timeout: 5000 });
    page.on('dialog', dialog => dialog.accept());
    await cancelBtn.click();

    await expect(page.locator('#bookings-list')).toContainText('已取消', { timeout: 5000 });

    await context.close();
  });

  test('場景 12：表單未選旅客 → alert 阻擋送出', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    // 等待旅客選單非同步載入完成後清空選擇
    await page.waitForFunction(
      () => {
        const sel = document.getElementById('b-passenger');
        return sel && Array.from(sel.options).some(o => o.value !== '');
      },
      { timeout: 10000 }
    );
    await page.evaluate(() => {
      document.getElementById('b-passenger').value = '';
    });

    let alertMsg = '';
    page.on('dialog', async dialog => {
      alertMsg = dialog.message();
      await dialog.accept();
    });

    await page.click('#submit-btn');
    await page.waitForTimeout(1000);

    expect(alertMsg).toContain('請選擇乘客');
    await expect(page).toHaveURL(/booking\.html/);

    await context.close();
  });

  test('場景 13：預約時間選過去 → 後端 400 → UI 顯示送出失敗', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/booking.html');

    await fillBookingForm(page, { passengerId, date: tomorrow(), mode: 'scheduled' });
    // 覆蓋預約日期為昨天（繞過前端可能的 date input 限制，直接改 value）
    await page.evaluate(() => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      document.getElementById('b-schedule-date').value = d.toISOString().slice(0, 10);
    });

    let alertMsg = '';
    page.on('dialog', async dialog => {
      alertMsg = dialog.message();
      await dialog.accept();
    });

    await page.click('#submit-btn');
    await page.waitForTimeout(3000);

    // 前端驗證可能先攔截，或後端回 400 → alert('送出失敗：...')
    expect(alertMsg).toMatch(/送出失敗|時間|過去|未來|scheduledAt/);

    await context.close();
  });

  test('場景 14：取消非 pending 訂單（已取消）→ API 回非 200 錯誤', async () => {
    // 建立 pending 訂單，取消一次（成功），再取消一次（應失敗）
    const booking = await createBookingViaApi(token, passengerId);

    // 第一次取消 → 成功
    const res1 = await cancelBookingViaApi(token, booking.id);
    expect(res1.status).toBe(200);

    // 第二次取消（已是 cancelled）→ 應失敗
    const res2 = await cancelBookingViaApi(token, booking.id);
    expect(res2.status).not.toBe(200);
    expect(res2.body.error).toBeTruthy();
  });
});
