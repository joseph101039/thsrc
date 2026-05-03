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

function renderDetail(booking, attempts) {
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

  return `
    <div class="section-title">訂單資訊</div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${booking.fromStation} → ${booking.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      <div class="card-sub">日期：${booking.date}</div>
      <div class="card-sub">期望時間：${booking.desiredTime}</div>
      <div class="card-sub">允許區間：${booking.earliestTime} ~ ${booking.latestTime}</div>
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

  try {
    const [{ bookings }, { attempts }] = await Promise.all([
      api.getBookings(),
      api.getBookingAttempts(bookingId),
    ]);

    const booking = bookings.find(b => b.id === bookingId);
    if (!booking) {
      el.innerHTML = '<div class="alert alert-warning">找不到此訂票紀錄</div>';
      return;
    }

    document.getElementById('page-title').textContent =
      `${booking.fromStation} → ${booking.toStation}`;
    el.innerHTML = renderDetail(booking, attempts);
  } catch (err) {
    el.innerHTML = `<div class="alert alert-warning">載入失敗：${err.message}</div>`;
  }
}

loadDetail();
