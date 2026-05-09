'use strict';

// 為每個 HTTP 請求附帶 request_id 與 child logger,並在 response 結束時記錄 access log。
// 客戶端可帶 X-Request-Id,但只接受 [A-Za-z0-9_-]{1,64};否則 fallback UUID,
// 避免被塞超大字串撐爆 log 與下游索引。
const { randomUUID } = require('node:crypto');
const logger = require('../logger');

const REQ_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

module.exports = function requestLogger(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const reqId = (typeof incoming === 'string' && REQ_ID_PATTERN.test(incoming))
    ? incoming
    : randomUUID();
  req.log = logger.child({ req_id: reqId });
  res.setHeader('x-request-id', reqId);

  const start = Date.now();
  res.on('finish', () => {
    req.log.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    }, 'request');
  });

  next();
};
