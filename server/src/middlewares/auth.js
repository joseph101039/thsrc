'use strict';

const jwt = require('jsonwebtoken');
const userService = require('../services/userService');

const JWT_SECRET = process.env.JWT_SECRET;

function verifyJwt(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未授權' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (!userService.isAllowedUser(req.user.email)) {
      return res.status(403).json({ error: '帳號已被移除' });
    }
    next();
  } catch {
    return res.status(401).json({ error: '未授權' });
  }
}

module.exports = { verifyJwt };
