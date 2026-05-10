'use strict';

// /admin/settings 頁面控制器:載入兩個 toggle 狀態,切換時 PUT 後端,失敗時 revert UI。

let _saving = false;

async function loadSettings() {
  try {
    const cur = await api.getNotificationSettings();
    document.getElementById('toggle-success').checked = !!cur.bookingSuccess;
    document.getElementById('toggle-failure').checked = !!cur.bookingFailure;
    document.getElementById('loading').style.display = 'none';
    document.getElementById('toggles').style.display = '';
  } catch (err) {
    document.getElementById('loading').textContent = '載入失敗: ' + err.message;
  }
}

async function onToggleChange(field, inputEl) {
  if (_saving) return;
  const newVal = inputEl.checked;
  _saving = true;
  inputEl.disabled = true;
  try {
    const body = {};
    body[field] = newVal;
    await api.updateNotificationSettings(body);
    showToast('已儲存');
  } catch (err) {
    inputEl.checked = !newVal; // revert
    showToast('儲存失敗: ' + err.message);
  } finally {
    inputEl.disabled = false;
    _saving = false;
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.remove('show'), 2000);
}
