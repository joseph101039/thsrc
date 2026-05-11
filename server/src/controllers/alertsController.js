'use strict';

// /v1/alerts/rules — 代理 Grafana Alerting API,僅供 admin。
// 列表帶 30s in-process cache(Grafana API 1-2s,UI 不需即時)。
// Pause 後 invalidate cache 讓 UI 重新整理拿到 isPaused 新值。
const grafanaApi = require('../services/grafanaApi');
const logger = require('../logger');

// 10s cache:Grafana 評估頻率 ≥1m,10s cache 對 UI 體感等同即時,
// 又能擋住短時間刷新對 Grafana API 配額的消耗。
const CACHE_TTL_MS = 10_000;
let _cache = null; // { rules, expiresAt }

const UID_RE = /^[A-Za-z0-9_-]+$/;

function _slim(rules) {
  // 只挑 UI 顯示需要的欄位 — 避免把 Grafana query AST/labels 全部回給瀏覽器
  return rules.map(r => ({
    uid: r.uid,
    title: r.title,
    isPaused: !!r.isPaused,
    ruleGroup: r.ruleGroup,
    severity: r.labels?.severity || null,
    forDuration: r.for || null,
    summary: r.annotations?.summary || null,
  }));
}

/**
 * @swagger
 * /v1/alerts/rules:
 *   get:
 *     summary: 列 Grafana alert rules(admin only)
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 規則列表
 *       502:
 *         description: Grafana API 不可用
 */
async function listRules(req, res) {
  try {
    const now = Date.now();
    if (_cache && _cache.expiresAt > now) {
      return res.json({ rules: _cache.rules, cached: true });
    }
    const r = await grafanaApi.listAlertRules();
    if (!r.ok) {
      return res.status(502).json({ error: r.reason || 'grafana_unavailable' });
    }
    const slim = _slim(r.rules);
    _cache = { rules: slim, expiresAt: now + CACHE_TTL_MS };
    res.json({ rules: slim, cached: false });
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'listRules error');
    res.status(500).json({ error: err.message });
  }
}

/**
 * @swagger
 * /v1/alerts/rules/{uid}/pause:
 *   post:
 *     summary: Pause / unpause Grafana alert rule(admin only)
 *     tags: [Alerts]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: uid
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paused]
 *             properties:
 *               paused: { type: boolean }
 *     responses:
 *       200: { description: 成功 }
 *       422: { description: paused 欄位型別錯誤 }
 *       502: { description: Grafana API 不可用 }
 */
async function pauseRule(req, res) {
  try {
    const { uid } = req.params;
    if (!uid || !UID_RE.test(uid)) {
      return res.status(422).json({ error: 'invalid uid format' });
    }
    const body = req.body || {};
    if (body.paused === undefined) {
      return res.status(422).json({ error: 'paused is required' });
    }
    if (typeof body.paused !== 'boolean') {
      return res.status(422).json({ error: 'paused must be boolean' });
    }
    const r = await grafanaApi.pauseAlertRule(uid, body.paused);
    if (!r.ok) {
      return res.status(502).json({ error: r.reason || 'grafana_unavailable' });
    }
    _cache = null; // invalidate
    res.json({ ok: true, uid, isPaused: r.isPaused });
  } catch (err) {
    (req.log || logger).error({ err: err.message }, 'pauseRule error');
    res.status(500).json({ error: err.message });
  }
}

// 測試專用
function _clearCache() { _cache = null; }

module.exports = { listRules, pauseRule, _clearCache };
