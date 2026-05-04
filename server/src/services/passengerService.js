'use strict';

const passengerRepo = require('../repositories/passengerRepo');

const ID_NUMBER_RE = /^[A-Z]\d{9}$/;

function listPassengers() {
  return passengerRepo.getAll();
}

function savePassenger(data) {
  if (data.idNumber !== undefined && !ID_NUMBER_RE.test(data.idNumber)) {
    throw Object.assign(new Error('身分證格式錯誤，應為一個大寫英文字母加 9 位數字'), { status: 400 });
  }
  return passengerRepo.upsert(data);
}

function deletePassenger(id) {
  return passengerRepo.deleteById(id);
}

module.exports = { listPassengers, savePassenger, deletePassenger };
