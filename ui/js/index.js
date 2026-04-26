const STATUS_LABEL = {
  pending:         { text: '等待中',       cls: 'badge-pending' },
  running:         { text: '搶票中',       cls: 'badge-running' },
  waiting_captcha: { text: '待輸入驗證碼', cls: 'badge-waiting' },
  success:         { text: '成功',         cls: 'badge-success' },
  failed:          { text: '失敗',         cls: 'badge-failed'  },
};

function bookingCard(b) {
  const s = STATUS_LABEL[b.status] || { text: b.status, cls: '' };
  const scheduledInfo = b.scheduledAt
    ? `<div class="card-sub">預約時間：${b.scheduledAt}</div>`
    : '';
  const captchaBtn = b.status === 'waiting_captcha'
    ? `<a href="captcha.html?id=${b.id}" class="btn btn-ghost" style="font-size:13px;padding:8px 12px;">輸入驗證碼</a>`
    : '';
  return `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${b.fromStation} → ${b.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      <div class="card-sub">日期：${b.date}　期望：${b.desiredTime}</div>
      <div class="card-sub">允許區間：${b.earliestTime} ~ ${b.latestTime}</div>
      ${scheduledInfo}
      <div class="card-sub">嘗試次數：${b.retryCount || 0} / ${b.maxRetries}</div>
      ${b.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${b.ticketNo}</div>` : ''}
      ${captchaBtn ? `<div class="card-actions">${captchaBtn}</div>` : ''}
    </div>
  `;
}

async function loadBookings() {
  const el = document.getElementById('bookings-list');
  try {
    const { bookings } = await api.getBookings();
    if (!bookings || bookings.length === 0) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎫</div>
          <div>尚無訂票紀錄</div>
          <div style="font-size:13px;margin-top:8px">點右下角 + 開始訂票</div>
        </div>`;
      return;
    }
    const sorted = [...bookings].reverse();
    el.innerHTML = sorted.map(bookingCard).join('');
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadBookings();

setInterval(() => {
  const hasPending = document.querySelector('.badge-running, .badge-pending, .badge-waiting');
  if (hasPending) loadBookings();
}, 30000);
