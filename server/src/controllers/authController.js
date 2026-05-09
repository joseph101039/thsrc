'use strict';

const authService = require('../services/authService');
const userService = require('../services/userService');
const logger = require('../logger');

/**
 * @swagger
 * /v1/auth/google:
 *   post:
 *     summary: Google OAuth 登入
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [credential]
 *             properties:
 *               credential:
 *                 type: string
 *                 description: Google ID token
 *     responses:
 *       200:
 *         description: 登入成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       400:
 *         description: 缺少 credential
 *       401:
 *         description: 無效的 Google token
 *       403:
 *         description: 帳號無權限
 */
async function googleAuth(req, res) {
  const { credential } = req.body || {};
  if (!credential) return res.status(400).json({ error: '缺少 credential' });
  try {
    const { email, emailVerified } = await authService.verifyGoogleCredential(credential);
    if (!emailVerified) return res.status(401).json({ error: '無效的 Google token' });
    if (!userService.isAllowedUser(email)) {
      (req.log || logger).warn({ email }, '登入被拒');
      return res.status(403).json({ error: '帳號無權限' });
    }
    const row = userService.getUser(email);
    const token = authService.signJwt(email, row.role);
    res.json({ token });
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'Google token 驗證失敗');
    res.status(401).json({ error: '無效的 Google token' });
  }
}

module.exports = { googleAuth };
