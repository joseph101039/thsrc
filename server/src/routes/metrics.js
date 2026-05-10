'use strict';

// /metrics 端點 — Prometheus scrape target,由 Alloy 帶 Bearer token 來抓。
// 沒有 token 設定時(本機開發、CI)直接 503,避免在生產環境忘了設 token
// 而造成 metrics 公開外洩。
const express = require('express');
const { register } = require('../metrics');
const { compareBearer } = require('../middlewares/bearerAuth');
const logger = require('../logger');

const TOKEN = process.env.METRICS_TOKEN;
if (!TOKEN) {
  // 啟動時警告一次即可,handler 內保持安靜避免被 scrape 洗版
  logger.warn('METRICS_TOKEN 未設定,/metrics 已停用(回 503)');
}
const router = express.Router();

router.get('/metrics', async (req, res) => {
  if (!TOKEN) {
    res.status(503).type('text/plain').send('metrics disabled');
    return;
  }
  if (!compareBearer(req.headers.authorization, TOKEN)) {
    res.status(401).type('text/plain').send('unauthorized');
    return;
  }
  try {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  } catch (err) {
    logger.error({ err: err.message }, 'metrics render error');
    res.status(500).type('text/plain').send('error');
  }
});

module.exports = router;
