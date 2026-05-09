'use strict';

const logger = require('../logger');
const path = require('path');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const SqliteStore = require('connect-sqlite3')(session);
const CONFIG = require('../config');
const adminApiRouter = require('./adminApiRouter');

const router = express.Router();

const SESSION_SECRET = process.env.SESSION_SECRET;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SESSION_SECRET || !ADMIN_PASSWORD) {
  logger.warn('警告：SESSION_SECRET 或 ADMIN_PASSWORD 未設定，Admin panel 將無法使用');
}

router.use(session({
  store: new SqliteStore({ db: 'sessions.db', dir: path.resolve(CONFIG.DB_PATH, '..') }),
  secret: SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000 },
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: '嘗試次數過多，請 15 分鐘後再試' },
  standardHeaders: true,
  legacyHeaders: false,
});

const VIEWS = path.join(__dirname, 'views');

router.use('/assets', express.static(path.join(VIEWS, 'assets')));

router.get('/login', (req, res) => {
  if (req.session.adminAuthed) return res.redirect('/admin');
  res.sendFile(path.join(VIEWS, 'login.html'));
});

router.post('/login', loginLimiter, express.urlencoded({ extended: false }), (req, res) => {
  const { password } = req.body;
  if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) {
    req.session.regenerate((err) => {
      if (err) {
        logger.error({ err: err.message }, 'Session regenerate 失敗');
        return res.status(500).send('Session error');
      }
      req.session.adminAuthed = true;
      return res.redirect('/admin');
    });
    return;
  }
  logger.warn('管理員登入失敗：密碼錯誤');
  return res.redirect('/admin/login?err=1');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

router.use('/api', adminApiRouter);

router.get('*', (req, res) => {
  if (!req.session.adminAuthed) return res.redirect('/admin/login');
  res.sendFile(path.join(VIEWS, 'dashboard.html'));
});

module.exports = router;
