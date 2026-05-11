'use strict';

// Grafana Cloud Alerting Provisioning API 薄客戶端。
// 用於 PR-6b admin UI 列 rule + Pause/Unpause。
//
// 認證:Bearer <Service Account token>(.env GRAFANA_API_TOKEN)。
// Provenance:Grafana 對 UI 建的 rule 標 provenance=API/file/...,API 直接 PUT 會被拒;
//   加 X-Disable-Provenance: true 讓 API 寫入視同 admin override(此 token 是 admin SA)。
//
// ⚠️ 並非原子操作 (last-writer-wins):pause/unpause 是 GET→mutate→PUT 流程,Grafana
// provisioning API 不支援 ETag / If-Match 條件 PUT。若中間有別人改 query/threshold,
// 我們的 PUT 會覆蓋。本服務只用於單一 admin 操作 isPaused,影響可控;若日後接 IaC
// (Terraform/Grafana-as-code),改用 IaC 為 SoT 並關閉此 UI 寫入。
// GET 回來的 rule 會把 updated/version log 出來,事後可比對 drift。
const fetch = require('node-fetch');
const logger = require('../logger');

const API_TIMEOUT_MS = 5000;

function _baseUrl() {
  return (process.env.GRAFANA_API_URL || '').replace(/\/+$/, '');
}

function _headers() {
  const token = (process.env.GRAFANA_API_TOKEN || '').trim();
  if (!token) return null;
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Disable-Provenance': 'true',
  };
}

async function listAlertRules() {
  const headers = _headers();
  if (!headers || !_baseUrl()) return { ok: false, reason: 'missing_credentials' };
  try {
    const res = await fetch(`${_baseUrl()}/api/v1/provisioning/alert-rules`, {
      headers,
      timeout: API_TIMEOUT_MS,
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'Grafana listAlertRules failed');
      return { ok: false, status: res.status, reason: 'http_' + res.status };
    }
    const data = await res.json();
    return { ok: true, rules: data };
  } catch (err) {
    logger.error({ err: err.message }, 'Grafana listAlertRules network error');
    return { ok: false, reason: 'network_error' };
  }
}

// Pause / unpause:Grafana provisioning API 的 PUT 必須帶完整 rule body,只改 isPaused。
// 流程:GET 拿原 rule → 改 isPaused → PUT 回去。
async function pauseAlertRule(uid, paused) {
  const headers = _headers();
  if (!headers || !_baseUrl()) return { ok: false, reason: 'missing_credentials' };
  try {
    const getRes = await fetch(`${_baseUrl()}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`, {
      headers,
      timeout: API_TIMEOUT_MS,
    });
    if (!getRes.ok) {
      logger.error({ status: getRes.status, uid }, 'Grafana GET rule failed');
      return { ok: false, status: getRes.status, reason: 'http_' + getRes.status };
    }
    const rule = await getRes.json();
    rule.isPaused = !!paused;
    // 記 version / updated 方便事後追查 drift(若 GET→PUT 間有人改了 rule)
    logger.info({ uid, version: rule.version, updated: rule.updated, paused }, 'Grafana PUT rule (last-writer-wins)');

    const putRes = await fetch(`${_baseUrl()}/api/v1/provisioning/alert-rules/${encodeURIComponent(uid)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(rule),
      timeout: API_TIMEOUT_MS,
    });
    if (!putRes.ok) {
      const body = await putRes.text().catch(() => '');
      logger.error({ status: putRes.status, uid, body: body.slice(0, 300) }, 'Grafana PUT rule failed');
      return { ok: false, status: putRes.status, reason: 'http_' + putRes.status };
    }
    return { ok: true, uid, isPaused: rule.isPaused };
  } catch (err) {
    logger.error({ err: err.message, uid }, 'Grafana pauseAlertRule network error');
    return { ok: false, reason: 'network_error' };
  }
}

module.exports = { listAlertRules, pauseAlertRule };
