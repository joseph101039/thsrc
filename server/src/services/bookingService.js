'use strict';

const bookingRepo = require('../repositories/bookingRepo');

function listBookings() {
  return bookingRepo.getAll();
}

function createBooking(data) {
  return bookingRepo.create(data);
}

function deleteBooking(id) {
  return bookingRepo.deleteById(id);
}

function getAttempts(bookingId) {
  return bookingRepo.getAttemptsByBookingId(bookingId);
}

function getBookingById(id) {
  return bookingRepo.getById(id);
}

module.exports = { listBookings, createBooking, deleteBooking, getAttempts, getBookingById };
