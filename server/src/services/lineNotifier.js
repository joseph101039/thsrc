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

// 訂票終態通知 helper:從 booking row 組訊息再呼叫 pushText。
// success 與 failure 兩條格式分流;訊息不含 passenger 姓名(PII)。
//
// reason 來自 THSRC HTML 解析 / catch err.message,可能帶 control char 或超長字串
// → 先去除 control char + 截到 200 字,避免吃掉訊息頭
function _sanitizeReason(reason) {
  if (!reason) return null;
  // 去除 ASCII control chars(\x00-\x1f \x7f),保留中文/全形
  const clean = String(reason).replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return clean.length > 200 ? clean.slice(0, 200) + '…' : clean;
}

async function pushBookingResult(booking, lastFailedAttempt = null) {
  const isSuccess = booking.status === 'success';
  const lines = isSuccess
    ? [
        '✅ [訂票成功]',
        `路線: ${booking.fromStation} → ${booking.toStation}`,
        `日期: ${booking.date}`,
        booking.trainNo ? `車次: ${booking.trainNo}` : null,
        booking.departTime ? `出發: ${booking.departTime}` : null,
        booking.ticketNo ? `票號: ${booking.ticketNo}` : null,
      ]
    : [
        '❌ [訂票失敗] 重試耗盡',
        `路線: ${booking.fromStation} → ${booking.toStation}`,
        `日期: ${booking.date}`,
        `重試: ${booking.retryCount ?? 0}/${booking.maxRetries ?? 0}`,
        lastFailedAttempt?.reason ? `原因: ${_sanitizeReason(lastFailedAttempt.reason)}` : null,
      ];
  // 透過 module.exports.pushText 而非閉包 pushText,讓測試能 monkey-patch
  return module.exports.pushText(lines.filter(Boolean).join('\n'));
}

module.exports = { pushText, pushBookingResult };
