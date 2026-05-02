'use strict';

const userRepo = require('../repositories/userRepo');
const { VALID_ROLES } = require('../models/schemas');

function listUsers() {
  return userRepo.getAll();
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function addUser({ email, role }) {
  if (!VALID_ROLES.includes(role)) return { success: false, error: '無效的角色' };
  if (!EMAIL_RE.test(email)) return { success: false, error: '無效的 Email 格式' };
  return userRepo.add({ email, role });
}

function deleteUser(email, requestorEmail) {
  if (email.toLowerCase() === requestorEmail.toLowerCase()) {
    return { success: false, error: '不能刪除自己' };
  }
  return userRepo.deleteByEmail(email);
}

function isAllowedUser(email) {
  return userRepo.isAllowed(email);
}

function getUser(email) {
  return userRepo.getByEmail(email);
}

module.exports = { listUsers, addUser, deleteUser, isAllowedUser, getUser };
