'use strict';

const { Router } = require('express');
const { verifyJwt } = require('../middlewares/auth');
const { adminOnly } = require('../middlewares/adminOnly');
const authController = require('../controllers/authController');
const passengerController = require('../controllers/passengerController');
const bookingController = require('../controllers/bookingController');
const userController = require('../controllers/userController');
const settingsController = require('../controllers/settingsController');

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

module.exports = router;
