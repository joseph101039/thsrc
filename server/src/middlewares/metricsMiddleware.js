'use strict';

// 在每個 HTTP 請求結束時記錄 duration / count。
// 用 req.route?.path 作為 label,避免把 /v1/bookings/:id 中的 id 拿去當 label
// 而炸 cardinality。沒匹配到 route 的(404)用固定字串。
const { httpRequestDuration, httpRequestsTotal } = require('../metrics');

module.exports = function metricsMiddleware(req, res, next) {
  // 不要把 /metrics 自己的 scrape 記成一筆 HTTP 樣本,免得 dashboard 上的 req/s 被 alloy 流量混雜
  if (req.path === '/metrics') return next();
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const route = req.route?.path || req.baseUrl || 'unknown';
    const labels = {
      method: req.method,
      route,
      status: String(res.statusCode),
    };
    const durationS = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, durationS);
    httpRequestsTotal.inc(labels);
  });
  next();
};
