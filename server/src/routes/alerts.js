'use strict';

// /alerts/grafana — 接收 Grafana Cloud Alerting 的 webhook contact point。
// 用 ALERT_WEBHOOK_TOKEN(Bearer)保護,token 未設定則 503(避免 prod 忘設外洩)。
//
// 防濫用三層防線(token 洩漏 / 規則設錯導致 LINE 配額 200/月 被打爆):
//   1) Bearer token(timingSafeEqual)
//   2) express.json({ limit: '32kb' })  — Grafana 正常 payload < 5kb
//   3) express-rate-limit:60 req / 5 min(正常 alert 量遠低於此)
//
// 注意:TOKEN 在 module-load 時 capture,rotate token 必須 docker compose up -d 重建
// container 才生效(restart 不夠 — env_file 是 container 啟動時 snapshot)。
const express = require('express');
const rateLimit = require('express-rate-limit');
const { compareBearer } = require('../middlewares/bearerAuth');
const { handleWebhook } = require('../services/alertDispatcher');
const logger = require('../logger');

const TOKEN = process.env.ALERT_WEBHOOK_TOKEN;
if (!TOKEN) {
  logger.warn('ALERT_WEBHOOK_TOKEN 未設定,/alerts/grafana 已停用(回 503)');
}

const alertsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

const router = express.Router();

router.post(
  '/alerts/grafana',
  express.json({ limit: '32kb' }),
  alertsLimiter,
  async (req, res) => {
    if (!TOKEN) {
      res.status(503).type('text/plain').send('alert webhook disabled');
      return;
    }
    if (!compareBearer(req.headers.authorization, TOKEN)) {
      res.status(401).type('text/plain').send('unauthorized');
      return;
    }
    try {
      const alertCount = Array.isArray(req.body?.alerts) ? req.body.alerts.length : 0;
      (req.log || logger).info({ alertCount }, 'alert webhook 收到');
      const result = await handleWebhook(req.body || {});
      (req.log || logger).info(result, 'alert webhook 處理完成');
      res.status(200).json(result);
    } catch (err) {
      (req.log || logger).error({ err: err.message }, 'alert webhook 處理失敗');
      res.status(500).json({ error: 'internal_error' });
    }
  }
);

module.exports = router;
