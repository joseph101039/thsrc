'use strict';

const passengerRepo = require('../repositories/passengerRepo');

function listPassengers() {
  return passengerRepo.getAll();
}

function savePassenger(data) {
  return passengerRepo.upsert(data);
}

function deletePassenger(id) {
  return passengerRepo.deleteById(id);
}

module.exports = { listPassengers, savePassenger, deletePassenger };
