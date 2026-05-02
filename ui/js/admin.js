// admin-only 頁面：非 admin 跳回首頁
if (window.__auth.getRole() !== 'admin') {
  location.href = 'index.html';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const adminApi = {
  getUsers:   ()      => api.getAllowedUsers(),
  addUser:    (data)  => api.addAllowedUser(data),
  deleteUser: (email) => api.deleteAllowedUser(email),
};

function roleBadge(role) {
  const style = role === 'admin'
    ? 'background:#cce5ff;color:#004085'
    : 'background:#d4edda;color:#155724';
  return `<span style="${style};padding:2px 8px;border-radius:10px;font-size:12px;font-weight:600;">${role}</span>`;
}

function userRow(u, selfEmail) {
  const isSelf = u.email.toLowerCase() === selfEmail.toLowerCase();
  const safeEmail = escHtml(u.email);
  const deleteBtn = isSelf
    ? `<span style="color:#aaa;font-size:13px;">（你）</span>`
    : `<button class="btn btn-danger" style="font-size:13px;padding:6px 10px;" data-email="${safeEmail}">刪除</button>`;
  return `
    <div class="card" style="display:grid;grid-template-columns:1fr auto auto;gap:12px;align-items:center;padding:12px 16px;">
      <div style="font-size:14px;word-break:break-all;">${safeEmail}</div>
      ${roleBadge(u.role)}
      ${deleteBtn}
    </div>`;
}

async function loadUsers() {
  const el = document.getElementById('users-list');
  try {
    const { users } = await adminApi.getUsers();
    const token = window.__auth.getToken();
    const selfEmail = JSON.parse(atob(token.split('.')[1])).email;
    el.innerHTML = users.length
      ? users.map(u => userRow(u, selfEmail)).join('')
      : '<div class="alert alert-info">尚無使用者資料。</div>';
    el.querySelectorAll('button[data-email]').forEach(btn => {
      btn.addEventListener('click', () => deleteUser(btn.dataset.email));
    });
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

function openAddModal() {
  document.getElementById('add-email').value = '';
  document.getElementById('add-role').value = 'user';
  document.getElementById('add-modal').style.display = 'flex';
}

function closeAddModal() {
  document.getElementById('add-modal').style.display = 'none';
}

async function confirmAddUser() {
  const email = document.getElementById('add-email').value.trim();
  const role  = document.getElementById('add-role').value;
  if (!email) { alert('請輸入 Email'); return; }

  const btn = document.getElementById('add-confirm-btn');
  btn.disabled = true;
  btn.textContent = '新增中...';
  try {
    const result = await adminApi.addUser({ email, role });
    if (!result.success) { alert(result.error || '新增失敗'); return; }
    closeAddModal();
    loadUsers();
  } catch (err) {
    alert('新增失敗：' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '新增';
  }
}

async function deleteUser(email) {
  if (!confirm(`確定刪除 ${email}？`)) return;
  try {
    await adminApi.deleteUser(email);
    loadUsers();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

loadUsers();
