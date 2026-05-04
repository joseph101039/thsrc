const TYPE_LABEL = {
  adult: '成人', student: '學生', senior: '敬老', disabled: '愛心', child: '兒童',
};

const ID_NUMBER_RE = /^[A-Z]\d{9}$/;

let _passengerCache = {};

function passengerCard(p, myEmail) {
  const displayId = maskId(p.idNumber, p.email, myEmail);
  return `
    <div class="card" id="p-card-${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="card-title">${p.name}</div>
          <div class="card-sub">${TYPE_LABEL[p.type] || p.type}　${displayId}</div>
          <div class="card-sub">${p.email}</div>
        </div>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost" style="font-size:13px;padding:8px 12px"
          onclick="editPassenger('${p.id}')">編輯</button>
        <button class="btn btn-danger" style="font-size:13px;padding:8px 12px"
          onclick="deletePassenger('${p.id}')">刪除</button>
      </div>
    </div>
  `;
}

async function loadPassengers() {
  const el = document.getElementById('passengers-list');
  const myEmail = window.__auth.getEmail();
  try {
    const { passengers } = await api.getPassengers();
    _passengerCache = {};
    (passengers || []).forEach(p => { _passengerCache[p.id] = p; });
    el.innerHTML = passengers.length
      ? passengers.map(p => passengerCard(p, myEmail)).join('')
      : '<div class="alert alert-info" style="margin-bottom:12px">尚無乘客資料，請新增。</div>';
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

function editPassenger(id) {
  const p = _passengerCache[id];
  if (!p) return;
  document.getElementById('edit-id').value = p.id;
  document.getElementById('p-name').value = p.name;
  document.getElementById('p-id-number').value = p.idNumber;
  document.getElementById('p-type').value = p.type;
  document.getElementById('p-email').value = p.email;
  document.getElementById('form-title').textContent = '編輯乘客';
  document.getElementById('passenger-form-card').scrollIntoView({ behavior: 'smooth' });
}

async function deletePassenger(id) {
  const p = _passengerCache[id];
  const name = p ? p.name : id;
  if (!confirm(`確定刪除「${name}」？`)) return;
  try {
    await api.deletePassenger(id);
    loadPassengers();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function savePassenger() {
  const id       = document.getElementById('edit-id').value;
  const name     = document.getElementById('p-name').value.trim();
  const idNumber = document.getElementById('p-id-number').value.trim();
  const type     = document.getElementById('p-type').value;
  const email    = document.getElementById('p-email').value.trim();

  if (!name || !idNumber || !email) { alert('請填寫所有欄位'); return; }
  if (!ID_NUMBER_RE.test(idNumber)) {
    alert('身分證格式錯誤，應為一個大寫英文字母加 9 位數字');
    return;
  }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = '儲存中...';

  try {
    await api.savePassenger({ id: id || undefined, name, idNumber, type, email });
    document.getElementById('edit-id').value = '';
    document.getElementById('p-name').value = '';
    document.getElementById('p-id-number').value = '';
    document.getElementById('p-type').value = 'adult';
    document.getElementById('p-email').value = '';
    document.getElementById('form-title').textContent = '新增乘客';
    loadPassengers();
  } catch (err) {
    alert('儲存失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '儲存乘客';
  }
}

loadPassengers();
