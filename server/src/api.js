'use strict';

const express = require('express');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const CONFIG = require('./config');
const v1Router = require('./routes/v1');
const swaggerSpec = require('./swagger');

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  console.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD) {
  console.warn('警告：SESSION_SECRET 或 ADMIN_PASSWORD 未設定，Admin panel 將無法登入');
}

const app = express();
const ALLOWED_ORIGINS = ['https://joseph101039.github.io', 'http://localhost:8082'];
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/v1', v1Router);

const adminRouter = require('./admin/router');
app.use('/admin', adminRouter);

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    console.log('THSRC server listening on port', CONFIG.PORT);
  });
}

module.exports = app;
