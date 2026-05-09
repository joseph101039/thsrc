'use strict';

// 健康探針:
// - /healthz   process 存活,固定回 200
// - /readyz    檢查 DB 可讀寫 + scheduler heartbeat 是否新鮮
//
// 安全注意:這兩個 endpoint 未授權公開,因此 readyz 不應回傳 raw exception
// 訊息或精確時間,避免洩漏 SQLite 路徑、schema、scheduler 排程節奏。
const express = require('express');
const { getDb } = require('../db');
const heartbeatRepo = require('../repositories/heartbeatRepo');
const logger = require('../logger');

const HEARTBEAT_STALE_MS = parseInt(process.env.HEARTBEAT_STALE_MS || '180000', 10); // 預設 3 分鐘
const router = express.Router();

router.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

router.get('/readyz', (req, res) => {
  const result = { db: 'unknown', scheduler: 'unknown' };
  let httpStatus = 200;

  try {
    getDb().prepare('SELECT 1').get();
    result.db = 'ok';
  } catch (err) {
    logger.error({ err: err.message }, 'readyz DB check failed');
    result.db = 'error';
    httpStatus = 503;
  }

  try {
    const hb = heartbeatRepo.get('scheduler');
    if (!hb) {
      result.scheduler = 'never_seen';
      httpStatus = 503;
    } else {
      const ageMs = Date.now() - new Date(hb.last_seen_at).getTime();
      if (ageMs > HEARTBEAT_STALE_MS) {
        result.scheduler = 'stale';
        httpStatus = 503;
      } else {
        result.scheduler = 'ok';
      }
    }
  } catch (err) {
    logger.error({ err: err.message }, 'readyz heartbeat check failed');
    result.scheduler = 'error';
    httpStatus = 503;
  }

  res.status(httpStatus).json(result);
});

module.exports = router;
