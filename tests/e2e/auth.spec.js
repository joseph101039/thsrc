'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState } = require('./helpers/auth');
const jwt = require('jsonwebtoken');

test.describe('Auth 流程', () => {
  test('場景 1：有效 JWT 注入 localStorage → 首頁正常載入不跳轉', async ({ browser }) => {
    const storageState = await makeStorageState();
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    await page.goto('/index.html');
    await expect(page).not.toHaveURL(/login/);
    await expect(page.locator('#bookings-list')).toBeVisible();

    await context.close();
  });

  test('場景 2：無 JWT → 訪問首頁 → 自動跳轉 login.html', async ({ page }) => {
    await page.goto('/index.html');
    await expect(page).toHaveURL(/login\.html/);
  });

  test('場景 3：無效 JWT（錯誤 secret）→ 訪問首頁 → 跳轉 login.html', async ({ browser }) => {
    // 用錯誤 secret 簽名，後端驗簽會 401 → _handle401() → 跳 login
    const invalidToken = jwt.sign(
      { email: 'joseph101039@gmail.com', role: 'admin' },
      'wrong-secret-that-does-not-match',
      { expiresIn: '1h' }
    );
    const context = await browser.newContext({
      storageState: {
        cookies: [],
        origins: [{
          origin: 'http://localhost:8082',
          localStorage: [{ name: 'thsrc_jwt', value: invalidToken }],
        }],
      },
    });
    const page = await context.newPage();

    await page.goto('/index.html');
    // 首頁 JS 呼叫 /v1/bookings → 後端 401 → _handle401() → 跳 login
    await expect(page).toHaveURL(/login\.html/, { timeout: 10000 });

    await context.close();
  });
});
