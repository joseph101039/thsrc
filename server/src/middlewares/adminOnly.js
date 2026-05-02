'use strict';

function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: '無權限' });
  next();
}

module.exports = { adminOnly };
