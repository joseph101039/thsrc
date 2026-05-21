'use strict';

const { test, expect } = require('@playwright/test');
const { makeStorageState } = require('./helpers/auth');

test.describe('旅客管理', () => {
  let storageState;

  test.beforeAll(async () => {
    storageState = await makeStorageState();
  });

  test('場景 4：新增旅客（完整欄位）→ 列表出現新旅客', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.fill('#p-name', 'E2E 測試旅客');
    await page.fill('#p-id-number', 'A123456789');
    await page.selectOption('#p-type', 'adult');
    await page.fill('#p-email', 'e2e@test.com');
    await page.click('#save-btn');

    await expect(page.locator('#passengers-list')).toContainText('E2E 測試旅客', { timeout: 5000 });

    await context.close();
  });

  test('場景 5：編輯旅客姓名 → 列表更新', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.waitForSelector('#passengers-list .card', { timeout: 5000 });
    // 點第一個旅客的編輯按鈕（文字為「編輯」）
    await page.locator('#passengers-list .card').first().locator('button', { hasText: '編輯' }).click();

    await page.fill('#p-name', '更新後旅客姓名');
    await page.click('#save-btn');

    await expect(page.locator('#passengers-list')).toContainText('更新後旅客姓名', { timeout: 5000 });

    await context.close();
  });

  test('場景 6：刪除旅客 → 列表移除', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.waitForSelector('#passengers-list .card', { timeout: 5000 });
    const beforeCount = await page.locator('#passengers-list .card').count();

    // 點第一個刪除按鈕（passengers.js 用 confirm()，攔截後 accept）
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#passengers-list .card').first().locator('button', { hasText: '刪除' }).click();

    await expect(page.locator('#passengers-list .card')).toHaveCount(beforeCount - 1, { timeout: 5000 });

    await context.close();
  });

  test('場景 7：新增旅客身分證格式錯誤 → 後端回 400 → 頁面不 crash', async ({ browser }) => {
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await page.goto('/passengers.html');

    await page.fill('#p-name', '測試旅客');
    await page.fill('#p-id-number', 'INVALID'); // 格式錯誤
    await page.selectOption('#p-type', 'adult');
    await page.fill('#p-email', 'e2e@test.com');

    let alertMessage = '';
    page.on('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });

    await page.click('#save-btn');
    await page.waitForTimeout(2000);

    // 頁面應仍在 passengers.html（沒 crash 跳走）
    await expect(page).toHaveURL(/passengers\.html/);
    // passengers.js 用 alert() 顯示錯誤
    expect(alertMessage).toMatch(/身分證|格式|錯誤|失敗/);

    await context.close();
  });
});
