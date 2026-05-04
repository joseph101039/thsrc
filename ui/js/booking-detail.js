function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderAttemptReason(a) {
  if (a.reason) {
    const color = a.success ? 'var(--success)' : 'var(--danger)';
    return `<div class="attempt-reason" style="color:${color}">${escapeHtml(a.reason)}</div>`;
  }
  if (a.success) return '<div class="attempt-reason" style="color:var(--success)">訂票成功</div>';
  return '';
}

const STATUS_LABEL = {
  pending:       { text: '等待中',  cls: 'badge-pending'   },
  running:       { text: '搶票中',  cls: 'badge-running'   },
  success:       { text: '成功',    cls: 'badge-success'   },
  failed:        { text: '失敗',    cls: 'badge-failed'    },
  cancelled:     { text: '已取消',  cls: 'badge-cancelled' },
  refunding:     { text: '退票中',  cls: 'badge-refunding' },
  refunded:      { text: '已退票',  cls: 'badge-refunded'  },
  refund_failed: { text: '退票失敗', cls: 'badge-failed'   },
};

function formatTW(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

function ticketSummary(booking) {
  const types = [
    { key: 'ticketAdult',    label: '全票' },
    { key: 'ticketChild',    label: '孩童票' },
    { key: 'ticketDisabled', label: '愛心票' },
    { key: 'ticketSenior',   label: '敬老票' },
    { key: 'ticketStudent',  label: '大學生票' },
  ];
  const parts = types.filter(t => (booking[t.key] || 0) > 0).map(t => `${t.label}×${booking[t.key]}`);
  return parts.length ? parts.join('、') : '全票×1';
}

function renderDetail(booking, attempts, passenger, myEmail) {
  const s = STATUS_LABEL[booking.status] || { text: booking.status, cls: '' };

  const attemptsHtml = attempts.length === 0
    ? '<div class="card-sub" style="padding:16px 0">尚無嘗試紀錄</div>'
    : `<ul class="attempt-list">${attempts.map((a, i) => `
        <li class="attempt-item">
          <span class="attempt-icon">${a.success ? '✅' : '❌'}</span>
          <div class="attempt-body">
            <div class="attempt-seq">第 ${i + 1} 次嘗試</div>
            <div class="attempt-time">${formatTW(a.attemptedAt)}</div>
            ${renderAttemptReason(a)}
          </div>
        </li>`).join('')}</ul>`;

  const passengerLine = passenger
    ? `<div class="card-sub">乘客：${escapeHtml(passenger.name)}（${escapeHtml(maskId(passenger.idNumber, passenger.email, myEmail))}）</div>`
    : '';

  const searchLine = booking.searchMode === 'train'
    ? `<div class="card-sub">搜尋車次：${escapeHtml(booking.trainNoTarget || '—')}</div>`
    : `<div class="card-sub">期望時間：${booking.desiredTime}</div>
       <div class="card-sub">允許區間：${booking.earliestTime} ~ ${booking.latestTime}</div>`;

  return `
    <div class="section-title">訂單資訊</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${booking.fromStation} → ${booking.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      ${passengerLine}
      <div class="card-sub">日期：${booking.date}</div>
      ${searchLine}
      <div class="card-sub">票種：${ticketSummary(booking)}</div>
      ${booking.scheduledAt ? `<div class="card-sub">預約時間：${formatTW(booking.scheduledAt)}</div>` : ''}
      <div class="card-sub">嘗試次數：${booking.retryCount || 0} / ${booking.maxRetries}</div>
      <div class="card-sub">嘗試間隔：${booking.retryWaitValue ?? 2} ${(booking.retryWaitUnit ?? 'minute') === 'minute' ? '分' : '秒'}</div>
      ${booking.ticketNo && booking.trainNo ? `<div class="card-sub" style="color:var(--success);font-weight:600;margin-top:8px">車次：${escapeHtml(booking.trainNo)}　出發：${escapeHtml(booking.departTime || '—')}</div>` : ''}
      ${booking.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${booking.ticketNo}</div>` : ''}
    </div>

    <div class="section-title">嘗試紀錄</div>
    <div class="card">${attemptsHtml}</div>
  `;
}

async function loadDetail() {
  const params = new URLSearchParams(location.search);
  const bookingId = params.get('id');
  const el = document.getElementById('detail-content');

  if (!bookingId) {
    el.innerHTML = '<div class="alert alert-warning">無效的訂票 ID</div>';
    return;
  }

  const myEmail = window.__auth.getEmail();

  try {
    const [{ bookings }, { attempts }, { passengers }] = await Promise.all([
      api.getBookings(),
      api.getBookingAttempts(bookingId),
      api.getPassengers(),
    ]);

    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) {
      el.innerHTML = '<div class="alert alert-warning">找不到此訂票紀錄</div>';
      return;
    }

    const passenger = (passengers || []).find(p => p.id === booking.passengerId);

    document.getElementById('page-title').textContent =
      `${booking.fromStation} → ${booking.toStation}`;
    el.innerHTML = renderDetail(booking, attempts, passenger, myEmail);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadDetail();
