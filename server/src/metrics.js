'use strict';

// Prometheus metrics registry — server 與 scheduler 共用此 module,
// 但各自 process 有獨立 registry instance(require cache 不跨 process)。
// 因此 server (8081) 與 scheduler (8082) 各自暴露 /metrics,Alloy 兩邊都 scrape。
// runBooking / captcha 指標主要在 scheduler 累積;HTTP 指標在 server。

const client = require('prom-client');

const register = new client.Registry();

// 預設 process / nodejs 指標(memory、event loop lag、gc、handles 等)
client.collectDefaultMetrics({
  register,
  prefix: 'thsrc_',
});

// HTTP server
const httpRequestDuration = new client.Histogram({
  name: 'thsrc_http_request_duration_seconds',
  help: 'HTTP 請求處理時間',
  // 注意:label 不含 path(會爆 cardinality);用 route(express 的 route pattern)
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

const httpRequestsTotal = new client.Counter({
  name: 'thsrc_http_requests_total',
  help: 'HTTP 請求總數',
  labelNames: ['method', 'route', 'status'],
  registers: [register],
});

// Booking 業務指標
const bookingStatusTotal = new client.Counter({
  name: 'thsrc_booking_status_total',
  help: 'Booking 狀態變動次數(以最終狀態切片)',
  labelNames: ['status'], // success | failed | retrying | cancelled
  registers: [register],
});

const bookingDuration = new client.Histogram({
  name: 'thsrc_booking_duration_seconds',
  help: 'Booking 從 runBooking 開始到結束的耗時',
  labelNames: ['outcome'], // success | failed
  buckets: [1, 3, 5, 10, 20, 30, 60, 120],
  registers: [register],
});

// Captcha 指標
const captchaSolveDuration = new client.Histogram({
  name: 'thsrc_captcha_solve_duration_seconds',
  help: 'Captcha solver API 回應時間',
  labelNames: ['result'], // ok | error
  buckets: [0.1, 0.3, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// 目前 pending booking 數(由 server 定期 sample;若無 sample 則不會更新)
const bookingPendingGauge = new client.Gauge({
  name: 'thsrc_booking_pending',
  help: '當前 pending booking 筆數',
  registers: [register],
});

const bookingRunningGauge = new client.Gauge({
  name: 'thsrc_booking_running',
  help: '當前 running booking 筆數',
  registers: [register],
});

module.exports = {
  register,
  httpRequestDuration,
  httpRequestsTotal,
  bookingStatusTotal,
  bookingDuration,
  captchaSolveDuration,
  bookingPendingGauge,
  bookingRunningGauge,
};
