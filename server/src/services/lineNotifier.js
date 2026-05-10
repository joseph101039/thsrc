'use strict';

// LINE Messaging API push:對指定 userId 發 text message。
// API 文件: https://developers.line.biz/en/reference/messaging-api/#send-push-message
//
// 為何不用 LINE Notify(已 EOL):LINE 在 2025 關閉 Notify 服務,僅剩 Messaging API 可用。
// node-fetch 必須是 v2.x(CJS);v3+ 是 ESM-only,本專案 require() 不相容。
const fetch = require('node-fetch');
const logger = require('../logger');

const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
// LINE p95 通常 <500ms;5 秒 timeout 給 TLS handshake + 慢路徑足夠,
// 又能避免 LINE 出狀況時把 webhook 整個卡爆讓 Grafana 重試。
const PUSH_TIMEOUT_MS = 5000;

async function pushText(text) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const userId = process.env.LINE_USER_ID;
  if (!token || !userId) {
    logger.warn('LINE_CHANNEL_ACCESS_TOKEN / LINE_USER_ID 未設定,skip push');
    return { ok: false, reason: 'missing_credentials' };
  }
  // LINE 單則 text 限制 5000 字,超過會 400;先截斷比丟錯好
  const safeText = text.length > 4900 ? text.slice(0, 4900) + '…(truncated)' : text;
  try {
    const res = await fetch(PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text: safeText }],
      }),
      // node-fetch v2 timeout 涵蓋 socket 連線 + 全部 body 讀取
      timeout: PUSH_TIMEOUT_MS,
    });
    if (!res.ok) {
      // 只記 status + LINE message 短碼,不帶 body 避免日後 LINE 加欄位時誤洩 alert 內容
      logger.error({ status: res.status }, 'LINE push 失敗');
      return { ok: false, reason: 'http_' + res.status };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err: err.message }, 'LINE push 網路錯誤');
    return { ok: false, reason: 'network_error' };
  }
}

module.exports = { pushText };
