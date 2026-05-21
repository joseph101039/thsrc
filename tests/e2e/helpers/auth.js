'use strict';

const http = require('http');

const SERVER_URL = 'http://localhost:8081';
const TEST_EMAIL = 'e2e-test@thsrc-test.local';
const ADMIN_EMAIL = 'joseph101039@gmail.com'; // 預設 admin（已在 allowed_users）

function postJson(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(SERVER_URL + urlPath);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 取得測試 JWT（使用 admin 帳號，已在 allowed_users 白名單）
async function getTestToken(email = ADMIN_EMAIL, role = 'admin') {
  const res = await postJson('/test/auth/token', { email, role });
  if (res.status !== 200) throw new Error(`取得測試 token 失敗: ${JSON.stringify(res.body)}`);
  return res.body.token;
}

// 產生 Playwright storageState（模擬 localStorage.thsrc_jwt）
async function makeStorageState(email = ADMIN_EMAIL, role = 'admin') {
  const token = await getTestToken(email, role);
  return {
    cookies: [],
    origins: [
      {
        origin: 'http://localhost:8082',
        localStorage: [{ name: 'thsrc_jwt', value: token }],
      },
    ],
  };
}

// 動態切換 mock 訂票結果
async function setMockBookingResult(result) {
  const res = await postJson('/test/mock-config', { result });
  if (res.status !== 200) throw new Error(`切換 mock 結果失敗: ${JSON.stringify(res.body)}`);
}

module.exports = { getTestToken, makeStorageState, setMockBookingResult, ADMIN_EMAIL, TEST_EMAIL };
