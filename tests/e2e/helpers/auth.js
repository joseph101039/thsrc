'use strict';

const http = require('http');

const SERVER_URL = 'http://localhost:8081';
// db.js 在初始化時將此 email seed 進 allowed_users（role='admin'），測試環境可直接使用
const ADMIN_EMAIL = 'joseph101039@gmail.com';

function getTestApiKey() {
  const key = process.env.TEST_API_KEY;
  if (!key) throw new Error('TEST_API_KEY 未設定，無法呼叫 /test 端點');
  return key;
}

function postJson(urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(SERVER_URL + urlPath);
    const options = {
      hostname: url.hostname,
      port: Number(url.port) || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...extraHeaders,
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(raw); } catch { parsed = { _raw: raw }; }
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} from ${urlPath}: ${raw}`));
        } else {
          resolve({ status: res.statusCode, body: parsed });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 取得測試 JWT，需帶 X-Test-Api-Key header 通過二次驗證
async function getTestToken(email = ADMIN_EMAIL, role = 'admin') {
  const res = await postJson('/test/auth/token', { email, role }, {
    'x-test-api-key': getTestApiKey(),
  });
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
  await postJson('/test/mock-config', { result }, {
    'x-test-api-key': getTestApiKey(),
  });
}

module.exports = { getTestToken, makeStorageState, setMockBookingResult, ADMIN_EMAIL };
