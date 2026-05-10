'use strict';

// 共用 Bearer token 比較工具 — 用 timingSafeEqual 避免 timing 側通道攻擊。
// 雖然 /metrics 端點走內網信任域,security review 仍建議補上;成本極低。
const { timingSafeEqual } = require('node:crypto');

function compareBearer(authHeader, expectedToken) {
  if (typeof authHeader !== 'string' || !expectedToken) return false;
  const expected = `Bearer ${expectedToken}`;
  // 長度短路:Buffer.byteLength 不一致時 timingSafeEqual 會 throw
  if (Buffer.byteLength(authHeader) !== Buffer.byteLength(expected)) return false;
  try {
    return timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

module.exports = { compareBearer };
