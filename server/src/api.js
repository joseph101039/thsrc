'use strict';

const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const CONFIG = require('./config');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!JWT_SECRET || !GOOGLE_CLIENT_ID) {
  console.error('缺少必要環境變數：JWT_SECRET 與 GOOGLE_CLIENT_ID 必須設定');
  process.exit(1);
}

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function googleAuthHandler(req, res) {
  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: '缺少 credential' });
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, email_verified } = payload;
    if (!email_verified) {
      return res.status(401).json({ error: '無效的 Google token' });
    }
    if (!db.isAllowedUser(email)) {
      console.error('登入被拒：', email);
      return res.status(403).json({ error: '帳號無權限' });
    }
    const row = db.getAllowedUser(email);
    const token = jwt.sign(
      { email, role: row.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token });
  } catch (err) {
    console.error('Google token 驗證失敗：', err.message);
    res.status(401).json({ error: '無效的 Google token' });
  }
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未授權' });
  }
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '未授權' });
  }
}

app.get('/', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/', async (req, res, next) => {
  if ((req.body || {}).action === 'googleAuth') {
    return googleAuthHandler(req, res);
  }
  return authMiddleware(req, res, next);
}, (req, res) => {
  const { action, data, id } = req.body || {};
  try {
    let result;
    switch (action) {
      case 'getPassengers':      result = { passengers: db.getPassengers() };          break;
      case 'savePassenger':      result = db.savePassenger(data);                      break;
      case 'deletePassenger':    result = db.deletePassenger(id);                      break;
      case 'getBookings':        result = { bookings: db.getBookings() };              break;
      case 'createBooking':      result = db.createBooking(data);                      break;
      case 'deleteBooking':      result = db.deleteBooking(id);                        break;
      case 'getBookingAttempts': result = { attempts: db.getAttemptsByBookingId(id) }; break;
      case 'getAllowedUsers':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        result = { users: db.getAllowedUsers() };
        break;
      case 'addAllowedUser':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        if (!['user', 'admin'].includes((data || {}).role)) return res.status(400).json({ error: '無效的角色' });
        result = db.addAllowedUser(data);
        break;
      case 'deleteAllowedUser':
        if (req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
        if ((id || '').toLowerCase() === req.user.email.toLowerCase()) return res.status(400).json({ error: '不能刪除自己' });
        result = db.deleteAllowedUser(id);
        break;
      default:
        return res.status(400).json({ error: 'Unknown action: ' + action });
    }
    res.json(result);
  } catch (err) {
    console.error('API error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

if (require.main === module) {
  const port = CONFIG.PORT;
  app.listen(port, () => {
    console.log('THSRC server listening on port', port);
  });
}

module.exports = app;
