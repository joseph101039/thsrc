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

const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => res.json({ status: 'ok' }));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/v1', v1Router);

if (require.main === module) {
  app.listen(CONFIG.PORT, () => {
    console.log('THSRC server listening on port', CONFIG.PORT);
  });
}

module.exports = app;
