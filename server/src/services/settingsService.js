'use strict';

// 設定快取層 — 訂票熱路徑(每次 attempt 終態)會呼叫 isXxxEnabled,所以不能每次查 DB。
//
// 並發行為:
// - 單 admin 場景幾乎不會同時兩個 writer。但若兩個 writer A→B 對 DB 的最終值是 B,
//   cache.set 順序若反過來會留下 A — 故寫入用 `cache.delete` 讓下一次 read 重撈 DB,
//   接受最差 30s 一次的 cache miss(訂票事件量小,可忽略)。
// - reader 看到 cache miss → 撈 DB → cache.set:後續 reader hit;若 set/delete 跟 reader
//   交錯,最壞情況是某 reader 撈到舊 DB 但下次讀就會更新,沒有資料污染。
const repo = require('../repositories/settingsRepo');

const CACHE_TTL_MS = 30_000;
const cache = new Map(); // key → { value: bool, expiresAt: number }

const KEYS = {
  bookingSuccess: 'notification.bookingSuccess',
  bookingFailure: 'notification.bookingFailure',
};

function _readBool(key, defaultVal) {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const raw = repo.get(key);
  // 未知 key(漏 migration / DB corrupt)走 default,不要因設定缺失把訂票流程炸掉
  const value = raw === null ? defaultVal : raw === 'true';
  cache.set(key, { value, expiresAt: now + CACHE_TTL_MS });
  return value;
}

function _writeBool(key, bool) {
  repo.set(key, bool ? 'true' : 'false');
  // 用 delete 而非 cache.set:避免並發 writer 順序顛倒寫入造成 cache 跟 DB 不一致。
  // 代價是下一次 read 會 cache miss 撈 DB 一次 — 訂票事件量小可接受。
  cache.delete(key);
}

function isBookingSuccessNotifyEnabled() {
  return _readBool(KEYS.bookingSuccess, true);
}

function isBookingFailureNotifyEnabled() {
  return _readBool(KEYS.bookingFailure, true);
}

function setBookingSuccessNotify(bool) {
  _writeBool(KEYS.bookingSuccess, bool);
}

function setBookingFailureNotify(bool) {
  _writeBool(KEYS.bookingFailure, bool);
}

function getNotificationToggles() {
  return {
    bookingSuccess: isBookingSuccessNotifyEnabled(),
    bookingFailure: isBookingFailureNotifyEnabled(),
  };
}

// 測試專用 — 清空 cache 強制下次讀 DB
function _clearCache() {
  cache.clear();
}

module.exports = {
  isBookingSuccessNotifyEnabled,
  isBookingFailureNotifyEnabled,
  setBookingSuccessNotify,
  setBookingFailureNotify,
  getNotificationToggles,
  _clearCache,
};
