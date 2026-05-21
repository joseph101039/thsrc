'use strict';

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const CONFIG = require('./config');
const v1Router = require('./routes/v1');
const swaggerSpec = require('./swagger');
const logger = require('./logger');
const requestLogger = require('./middlewares/requestLogger');
const metricsMiddleware = require('./middlewares/metricsMiddleware');
const metricsRouter = require('./routes/metrics');
const healthRouter = require('./routes/health');
const alertsRouter = require('./routes/alerts');
const adminRouter = require('./admin/router');
const bookingRepo = require('./repositories/bookingRepo');
const metrics = require('./metrics');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  logger.error('缺少必要環境變數:JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  logger.warn('警告:SESSION_SECRET 或 ADMIN_PASSWORD 未設定,Admin panel 將無法登入');
}

const app = express();
const ALLOWED_ORIGINS = ['https://joseph101039.github.io', 'http://localhost:8082'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());
app.use(requestLogger);
app.use(metricsMiddleware);

app.use('/', healthRouter);
app.use('/', metricsRouter);
app.use('/', alertsRouter);
app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/v1', v1Router);
app.use('/admin', adminRouter);

if (process.env.MOCK_BOOKING_ENGINE === 'true') {
  const testRouter = require('./routes/test');
  app.use('/test', testRouter);
}

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    logger.info({ port: CONFIG.PORT }, 'THSRC server listening');
    // 定期 sample booking 狀態給 Prometheus gauge(每 15 秒對齊 alloy scrape);
    // 在 listen callback 內啟動,確保 DB 已 ready 後才第一次 sample,避免啟動時 noisy log。
    const sampleBookings = () => {
      try {
        const counts = bookingRepo.countByStatus();
        metrics.bookingPendingGauge.set(counts[CONFIG.BOOKING_STATUS.PENDING] || 0);
        metrics.bookingRunningGauge.set(counts[CONFIG.BOOKING_STATUS.RUNNING] || 0);
      } catch (err) {
        logger.error({ err: err.message }, 'booking gauge sample error');
      }
    };
    sampleBookings();
    setInterval(sampleBookings, 15000).unref();
  });
}

module.exports = app;
