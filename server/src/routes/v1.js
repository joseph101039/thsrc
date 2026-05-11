'use strict';

const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { verifyJwt } = require('../middlewares/auth');
const { adminOnly } = require('../middlewares/adminOnly');
const authController = require('../controllers/authController');
const passengerController = require('../controllers/passengerController');
const bookingController = require('../controllers/bookingController');
const userController = require('../controllers/userController');
const settingsController = require('../controllers/settingsController');
const alertsController = require('../controllers/alertsController');

const router = Router();

router.post('/auth/google', authController.googleAuth);

router.get('/passengers',        verifyJwt, passengerController.listPassengers);
router.post('/passengers',       verifyJwt, passengerController.savePassenger);
router.delete('/passengers/:id', verifyJwt, passengerController.deletePassenger);

router.get('/bookings',               verifyJwt, bookingController.listBookings);
router.post('/bookings',              verifyJwt, bookingController.createBooking);
router.delete('/bookings/:id',        verifyJwt, bookingController.deleteBooking);
router.get('/bookings/:id/attempts',  verifyJwt, bookingController.getAttempts);
router.post('/bookings/:id/cancel',   verifyJwt, bookingController.cancelBooking);
router.post('/bookings/:id/refund',   verifyJwt, bookingController.refundBooking);

router.get('/users',           verifyJwt, adminOnly, userController.listUsers);
router.post('/users',          verifyJwt, adminOnly, userController.addUser);
router.delete('/users/:email', verifyJwt, adminOnly, userController.deleteUser);

router.get('/settings/notification', verifyJwt, adminOnly, settingsController.getNotification);
router.put('/settings/notification', verifyJwt, adminOnly, settingsController.putNotification);

// 對 admin alert proxy 加 rate limit:擋 token 洩漏 / 程式錯誤 / UI bug 不小心打爆 Grafana 配額。
// 60 req / 5 min 對單 admin 點 toggle 足夠用,惡意連點會被擋。
const alertsAdminLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

router.get('/alerts/rules',             verifyJwt, adminOnly, alertsAdminLimiter, alertsController.listRules);
router.post('/alerts/rules/:uid/pause', verifyJwt, adminOnly, alertsAdminLimiter, alertsController.pauseRule);

module.exports = router;
