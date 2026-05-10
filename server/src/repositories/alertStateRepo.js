'use strict';

// alert_state 表的最小封裝。
// 所有時間用 ISO8601 字串(與其他表一致),caller 計算差值時 new Date(s).getTime()。
//
// race-safe claim 流程:
//   1) caller getByKey 取得 prev
//   2) 判斷是否需要 push
//   3) 若需要 push,呼叫 tryClaim(expectedLastSentAt = prev.last_sent_at) — SQL UPDATE
//      用條件式只在 last_sent_at 仍等於 expected 時更新並寫入 nowIso。回傳 changes=1 表示
//      搶到 push 權(其他並發 caller 會 changes=0)。
//   4) push 成功:不用再寫(claim 時已寫 last_sent_at = nowIso)
//      push 失敗:rollbackClaim 把 last_sent_at 還原成 prev,讓下次能再試
const { getDb } = require('../db');

function getByKey(alertKey) {
  return getDb().prepare(`SELECT * FROM alert_state WHERE alert_key = ?`).get(alertKey);
}

// 嘗試 claim push 權。SQL conditional update 用 last_sent_at 作為樂觀鎖。
// 回傳 true 表示 claim 成功(已將 last_sent_at = nowIso、last_status = newLastStatus)。
function tryClaim({ alertKey, expectedLastSentAt, newLastStatus, nowIso }) {
  const db = getDb();
  // 若 row 不存在:直接 INSERT(失敗代表並發 caller 已 INSERT,落到下面 UPDATE)
  if (expectedLastSentAt === null) {
    try {
      const r = db.prepare(`
        INSERT INTO alert_state (alert_key, last_status, last_seen_at, last_sent_at)
        VALUES (?, ?, ?, ?)
      `).run(alertKey, newLastStatus, nowIso, nowIso);
      if (r.changes === 1) return true;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err.message))) throw err;
      // 並發 caller 已 insert;落到下面用 NULL 條件 update 試一次
    }
    const r2 = db.prepare(`
      UPDATE alert_state
         SET last_status  = ?,
             last_seen_at = ?,
             last_sent_at = ?
       WHERE alert_key    = ?
         AND last_sent_at IS NULL
    `).run(newLastStatus, nowIso, nowIso, alertKey);
    return r2.changes === 1;
  }

  // expectedLastSentAt 不為 null:條件式更新
  const r = db.prepare(`
    UPDATE alert_state
       SET last_status  = ?,
           last_seen_at = ?,
           last_sent_at = ?
     WHERE alert_key    = ?
       AND last_sent_at = ?
  `).run(newLastStatus, nowIso, nowIso, alertKey, expectedLastSentAt);
  return r.changes === 1;
}

// claim 成功但 push 失敗:把 last_sent_at 退回原值,讓下次 webhook 能重試。
// 注意:這裡無 race(只有剛 claim 的 caller 會 rollback,其他人看到的是新 last_sent_at
// 等同推送已成功,本來就不會嘗試推)。
function rollbackClaim(alertKey, originalLastSentAt) {
  getDb().prepare(`
    UPDATE alert_state SET last_sent_at = ? WHERE alert_key = ?
  `).run(originalLastSentAt, alertKey);
}

// 在 dedup 期間僅更新 last_seen_at,讓「上次看到」追蹤仍準確
function touchSeen(alertKey, nowIso) {
  getDb().prepare(`
    UPDATE alert_state SET last_seen_at = ? WHERE alert_key = ?
  `).run(nowIso, alertKey);
}

module.exports = { getByKey, tryClaim, rollbackClaim, touchSeen };
