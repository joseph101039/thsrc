'use strict';

// 對應 design: docs/superpowers/specs/2026-05-21-e2e-integration-tests-design.md
// 此 router 僅在 MOCK_BOOKING_ENGINE=true 時由 api.js 掛載，生產環境不載入

const express = require('express');
const jwt = require('jsonwebtoken');
const router = express.Router();

// 全局 mock 結果狀態（process 層級，單一 container 內）
global.__mockBookingResult = process.env.MOCK_BOOKING_RESULT || 'success';

// POST /test/auth/token — 直接發行 JWT（繞過 Google OAuth）
// body: { email: string, role?: 'admin'|'user' }
router.post('/auth/token', (req, res) => {
  const { email, role = 'user' } = req.body || {};
  if (!email) return res.status(400).json({ error: '缺少 email' });
  const token = jwt.sign({ email, role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.json({ token });
});

// POST /test/mock-config — 動態切換訂票 mock 結果
// body: { result: 'success'|'failure' }
router.post('/mock-config', (req, res) => {
  const { result } = req.body || {};
  if (!['success', 'failure'].includes(result)) {
    return res.status(400).json({ error: 'result 必須為 success 或 failure' });
  }
  global.__mockBookingResult = result;
  res.json({ ok: true, result });
});

module.exports = router;
