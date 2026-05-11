'use strict';

// 臨時 endpoint:用來抓 LINE group/room/user id。
// LINE 沒有 UI 顯示 groupId,只能從 webhook event 的 source 拿。
// 流程:
//   1) LINE Developers Console 把 Webhook URL 設為 https://api.joseph101039.uk/line/webhook + Use webhook ON
//   2) 在已加入 bot 的群組裡發任何訊息
//   3) 查 server log: `docker logs thsrc-server 2>&1 | grep LINE_SOURCE`
//   4) 把 groupId 寫進 .env 的 LINE_USER_ID(push API 的 to 欄位接受 userId/groupId/roomId)
//   5) 拿到 ID 後刪除此 route(或關 Use webhook)
//
// 簽章驗證:若 LINE_CHANNEL_SECRET 有設則驗;沒設則放行(此 endpoint 不執行任何動作,只 log)。
// 回應 200 是必要的 — LINE 對 webhook 失敗會 retry + 多次失敗會自動 disable webhook。
const express = require('express');
const crypto = require('crypto');
const logger = require('../logger');

const router = express.Router();

function _verifySignature(rawBody, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;
  const hmac = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
  } catch {
    return false;
  }
}

router.post(
  '/line/webhook',
  express.raw({ type: '*/*', limit: '64kb' }),
  (req, res) => {
    const secret = process.env.LINE_CHANNEL_SECRET;
    const signature = req.headers['x-line-signature'];
    const rawBody = req.body instanceof Buffer ? req.body : Buffer.from('');
    if (!_verifySignature(rawBody, signature, secret)) {
      (req.log || logger).warn('LINE webhook signature 驗證失敗');
      return res.status(401).type('text/plain').send('unauthorized');
    }
    let payload = {};
    try {
      payload = JSON.parse(rawBody.toString('utf8') || '{}');
    } catch (err) {
      (req.log || logger).warn({ err: err.message }, 'LINE webhook payload 不是 JSON');
      return res.status(200).end();
    }
    const events = Array.isArray(payload.events) ? payload.events : [];
    for (const ev of events) {
      const src = ev.source || {};
      (req.log || logger).info({
        tag: 'LINE_SOURCE',
        type: src.type,
        groupId: src.groupId || null,
        roomId: src.roomId || null,
        userId: src.userId || null,
        eventType: ev.type,
      }, 'LINE_SOURCE 收到 webhook event');
    }
    res.status(200).end();
  }
);

module.exports = router;
