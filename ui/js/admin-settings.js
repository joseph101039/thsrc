'use strict';

// /admin-settings:同一頁包含
//   1. 訂票通知 toggle (PR-7)
//   2. Grafana 告警規則 isPaused toggle (PR-6b)

// ─── 訂票通知 ─────────────────────────────────────────

let _notifySaving = false;

async function loadNotifySettings() {
  try {
    const cur = await api.getNotificationSettings();
    document.getElementById('toggle-success').checked = !!cur.bookingSuccess;
    document.getElementById('toggle-failure').checked = !!cur.bookingFailure;
    document.getElementById('notify-loading').style.display = 'none';
    document.getElementById('notify-toggles').style.display = '';
  } catch (err) {
    document.getElementById('notify-loading').textContent = '載入失敗: ' + err.message;
  }
}

async function onNotifyChange(field, inputEl) {
  if (_notifySaving) return;
  const newVal = inputEl.checked;
  _notifySaving = true;
  inputEl.disabled = true;
  try {
    const body = {};
    body[field] = newVal;
    await api.updateNotificationSettings(body);
    showToast('已儲存');
  } catch (err) {
    inputEl.checked = !newVal;
    showToast('儲存失敗: ' + err.message);
  } finally {
    inputEl.disabled = false;
    _notifySaving = false;
  }
}

// ─── Grafana 告警規則 ─────────────────────────────────

const _alertSaving = new Set();

async function loadAlerts() {
  const loading = document.getElementById('alerts-loading');
  const list = document.getElementById('alerts-list');
  const empty = document.getElementById('alerts-empty');
  const err = document.getElementById('alerts-error');
  loading.style.display = '';
  list.style.display = 'none';
  empty.style.display = 'none';
  err.style.display = 'none';
  try {
    const { rules } = await api.getAlertRules();
    loading.style.display = 'none';
    if (!rules || rules.length === 0) {
      empty.style.display = '';
      return;
    }
    renderAlerts(rules);
    list.style.display = '';
  } catch (e) {
    loading.style.display = 'none';
    err.textContent = '載入失敗: ' + e.message;
    err.style.display = '';
  }
}

function renderAlerts(rules) {
  const list = document.getElementById('alerts-list');
  list.innerHTML = '';
  for (const r of rules) {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.innerHTML = `
      <div class="toggle-label">
        <div class="title">
          ${escapeHtml(r.title)}
          <span class="badge ${r.isPaused ? 'badge-paused' : 'badge-active'}">
            ${r.isPaused ? '已停用' : '啟用中'}
          </span>
        </div>
        <div class="meta">
          ${r.severity ? `severity: ${escapeHtml(r.severity)} · ` : ''}
          ${r.forDuration ? `for: ${escapeHtml(r.forDuration)} · ` : ''}
          group: ${escapeHtml(r.ruleGroup || '-')}
        </div>
        ${r.summary ? `<div class="desc">${escapeHtml(r.summary)}</div>` : ''}
      </div>
      <label class="switch">
        <input type="checkbox" ${r.isPaused ? '' : 'checked'} data-uid="${escapeAttr(r.uid)}">
        <span class="slider"></span>
      </label>
    `;
    const input = row.querySelector('input[type="checkbox"]');
    input.addEventListener('change', () => onAlertToggle(r.uid, input));
    list.appendChild(row);
  }
}

async function onAlertToggle(uid, inputEl) {
  if (_alertSaving.has(uid)) return;
  const newPaused = !inputEl.checked; // checked = active = !paused
  _alertSaving.add(uid);
  inputEl.disabled = true;
  try {
    await api.pauseAlertRule(uid, newPaused);
    showToast(newPaused ? '已停用' : '已啟用');
    await loadAlerts();
  } catch (err) {
    inputEl.checked = !inputEl.checked;
    showToast('切換失敗: ' + err.message);
  } finally {
    _alertSaving.delete(uid);
    inputEl.disabled = false;
  }
}

// ─── 共用 ─────────────────────────────────────────

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2000);
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }
