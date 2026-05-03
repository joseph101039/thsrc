'use strict';
(() => {
  const BASE = '/admin/api';
  let currentTable = null;
  let currentSchema = [];
  let currentPage = 1;
  let currentSearch = '';
  let debounceTimer = null;

  async function apiFetch(path, options = {}) {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  }

  async function loadTables() {
    const { tables } = await apiFetch('/tables');
    const tabsEl = document.getElementById('tabs');
    tabsEl.innerHTML = '';
    tables.forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn';
      btn.textContent = `${t.name} (${t.rowCount})`;
      btn.dataset.table = t.name;
      btn.onclick = () => selectTable(t.name);
      tabsEl.appendChild(btn);
    });
    const hash = location.hash.slice(1);
    const first = (hash && tables.find(t => t.name === hash)) ? hash : (tables[0] && tables[0].name);
    if (first) selectTable(first);
  }

  async function selectTable(table) {
    currentTable = table;
    currentPage = 1;
    currentSearch = '';
    document.getElementById('searchInput').value = '';
    location.hash = table;
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.table === table);
    });
    const { schema } = await apiFetch(`/${table}/schema`);
    currentSchema = schema;
    await renderTable();
  }

  async function renderTable() {
    const container = document.getElementById('tableContainer');
    container.innerHTML = '<div class="loading">載入中...</div>';
    try {
      const params = new URLSearchParams({ page: currentPage, limit: 50, search: currentSearch });
      const { rows, total } = await apiFetch(`/${currentTable}?${params}`);
      if (rows.length === 0) {
        container.innerHTML = '<div class="empty">沒有資料</div>';
        renderPagination(0, 0);
        return;
      }
      const cols = currentSchema.map(c => c.name);
      const pk = (currentSchema.find(c => c.pk === 1) || currentSchema[0]).name;
      let html = '<table><thead><tr>';
      cols.forEach(c => { html += `<th>${c}</th>`; });
      html += '<th>操作</th></tr></thead><tbody>';
      rows.forEach(row => {
        html += '<tr>';
        cols.forEach(c => { html += `<td title="${escHtml(String(row[c] ?? ''))}">${escHtml(String(row[c] ?? ''))}</td>`; });
        const id = escHtml(String(row[pk]));
        html += `<td class="action-cell">
          <button class="btn-edit" onclick="editRow('${id}')">編輯</button>
          <button class="btn-delete" id="del-${id}" onclick="confirmDelete('${id}')">刪除</button>
        </td></tr>`;
      });
      html += '</tbody></table>';
      container.innerHTML = html;
      renderPagination(total, 50);
    } catch (e) {
      container.innerHTML = `<div class="empty">載入失敗：${escHtml(e.message)}</div>`;
    }
  }

  function renderPagination(total, limit) {
    const pages = Math.ceil(total / limit) || 1;
    const el = document.getElementById('pagination');
    el.innerHTML = `
      <button onclick="changePage(${currentPage - 1})" ${currentPage <= 1 ? 'disabled' : ''}>‹</button>
      <span>第 ${currentPage} / ${pages} 頁</span>
      <button onclick="changePage(${currentPage + 1})" ${currentPage >= pages ? 'disabled' : ''}>›</button>
      <span class="total">共 ${total} 筆</span>
    `;
  }

  window.changePage = function(page) {
    currentPage = page;
    renderTable();
  };

  window.editRow = async function(id) {
    const { row } = await apiFetch(`/${currentTable}/${id}`);
    openModal('編輯資料', row, async (data) => {
      await apiFetch(`/${currentTable}/${id}`, { method: 'PUT', body: JSON.stringify(data) });
      renderTable();
    });
  };

  window.confirmDelete = function(id) {
    const btn = document.getElementById(`del-${id}`);
    if (!btn) return;
    if (btn.dataset.confirming) {
      apiFetch(`/${currentTable}/${id}`, { method: 'DELETE' })
        .then(() => renderTable())
        .catch(e => alert('刪除失敗：' + e.message));
    } else {
      btn.dataset.confirming = '1';
      btn.textContent = '確定刪除';
      btn.classList.add('btn-delete-confirm');
      setTimeout(() => {
        if (btn) { btn.textContent = '刪除'; btn.classList.remove('btn-delete-confirm'); delete btn.dataset.confirming; }
      }, 3000);
    }
  };

  function openModal(title, defaults, onSave) {
    document.getElementById('modalTitle').textContent = title;
    const form = document.getElementById('modalForm');
    form.innerHTML = '';
    currentSchema.forEach(col => {
      const label = document.createElement('label');
      label.textContent = col.name + (col.notnull ? ' *' : '');
      const input = document.createElement('input');
      input.name = col.name;
      input.value = defaults ? (defaults[col.name] ?? '') : '';
      if (col.notnull && !defaults) input.required = true;
      form.appendChild(label);
      form.appendChild(input);
    });
    document.getElementById('modalOverlay').classList.add('open');
    document.getElementById('btnSave').onclick = async () => {
      const data = {};
      currentSchema.forEach(col => { data[col.name] = form.elements[col.name].value; });
      try {
        await onSave(data);
        closeModal();
      } catch (e) {
        alert('儲存失敗：' + e.message);
      }
    };
  }

  function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
  }

  document.getElementById('btnCancel').onclick = closeModal;
  document.getElementById('modalOverlay').onclick = (e) => {
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  };

  document.getElementById('btnAdd').onclick = () => {
    openModal('新增資料', null, async (data) => {
      await apiFetch(`/${currentTable}`, { method: 'POST', body: JSON.stringify(data) });
      renderTable();
    });
  };

  document.getElementById('searchInput').oninput = (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentSearch = e.target.value;
      currentPage = 1;
      renderTable();
    }, 300);
  };

  function escHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  loadTables();
})();
