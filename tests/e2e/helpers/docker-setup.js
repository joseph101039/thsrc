'use strict';

const fs = require('fs');
const path = require('path');

// 載入 .env.test 到 process.env（供 helpers/auth.js 使用 TEST_API_KEY）
const envPath = path.resolve(__dirname, '../../../.env.test');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const { setup } = require('./docker');

module.exports = async () => { await setup(); };
