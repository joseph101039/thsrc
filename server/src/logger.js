'use strict';

// 共用 pino logger:JSON 輸出 + GCP Cloud Logging severity 對應 + 敏感欄位遮罩。
// pino redact 注意:`*` 是單層 wildcard,深層巢狀路徑必須顯式列出或使用 `*.x.y` 形式。
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { service: process.env.SERVICE_NAME || 'server' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ severity: label.toUpperCase() }),
  },
  redact: {
    paths: [
      // HTTP headers
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-admin-token"]',
      // top-level (淺層)
      '*.password',
      '*.token',
      '*.idNumber',
      '*.id_number',
      '*.creditCard',
      '*.credit_card',
      // request body (controllers 直接 log req 的情境)
      'req.body.password',
      'req.body.token',
      'req.body.credential',
      'req.body.image',
      'req.body.idNumber',
      'req.body.id_number',
      'req.body.phone',
      'req.body.email',
      // passenger 物件:bookingEngineService 與 thsrc.js 內部會傳遞
      'passenger.idNumber',
      'passenger.id_number',
      'passenger.phone',
      'passenger.email',
      // booking 物件中嵌套的 passenger
      'booking.passenger.idNumber',
      'booking.passenger.id_number',
      'booking.passenger.phone',
      'booking.passenger.email',
      // req.body.passenger 路徑
      'req.body.passenger.idNumber',
      'req.body.passenger.id_number',
      'req.body.passenger.phone',
      'req.body.passenger.email',
      // 一層 wildcard 涵蓋 user / row / data 等常見容器
      '*.passenger.idNumber',
      '*.passenger.id_number',
      '*.passenger.phone',
      '*.passenger.email',
      // captcha 圖片 base64 / 表單填空欄位(thsrc.js 內部 payload)
      '*.dummyId',
      '*.dummyPhone',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;
