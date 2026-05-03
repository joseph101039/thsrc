function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTW(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
}

const STATUS_LABEL = {
  pending:       { text: '等待中',  cls: 'badge-pending'   },
  running:       { text: '搶票中',  cls: 'badge-running'   },
  success:       { text: '成功',    cls: 'badge-success'   },
  failed:        { text: '失敗',    cls: 'badge-failed'    },
  refunding:     { text: '退票中',  cls: 'badge-refunding' },
  refunded:      { text: '已退票',  cls: 'badge-refunded'  },
  refund_failed: { text: '退票失敗', cls: 'badge-failed'   },
};

function bookingCard(b) {
  const statusKey = b.refundStatus === 'refunding' ? 'refunding'
    : b.refundStatus === 'refunded' ? 'refunded'
    : b.refundStatus === 'refund_failed' ? 'refund_failed'
    : b.status;
  const s = STATUS_LABEL[statusKey] || { text: statusKey, cls: '' };
  const scheduledInfo = b.scheduledAt
    ? `<div class="card-sub">預約時間：${formatTW(b.scheduledAt)}</div>`
    : '';

  const canDelete = (b.status === 'success' || b.status === 'failed')
    && b.refundStatus !== 'refunding' && b.refundStatus !== 'refunded';
  const deleteBtn = canDelete
    ? `<button class="btn btn-danger" style="padding:6px 14px;font-size:13px" onclick="event.stopPropagation();deleteBooking('${b.id}')">刪除</button>`
    : '';

  const canRefund = b.status === 'success' && !b.refundStatus;
  const refundBtn = canRefund
    ? `<button class="btn btn-warning" style="padding:6px 14px;font-size:13px;margin-right:6px" onclick="event.stopPropagation();refundBooking('${b.id}')">退票</button>`
    : '';

  const copyIcon = b.ticketNo
    ? `<span onclick="event.stopPropagation();copyTicketNo('${b.ticketNo}')" title="複製訂位代號" style="cursor:pointer;margin-left:6px;opacity:0.7">📋</span>`
    : '';

  const refundMsg = b.refundMessage
    ? `<div class="card-sub" style="color:var(--danger)">${escapeHtml(b.refundMessage)}</div>`
    : '';

  return `
    <div class="card" id="booking-${b.id}" style="cursor:pointer" onclick="location.href='booking-detail.html?id=${b.id}'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div class="card-title">${b.fromStation} → ${b.toStation}</div>
        <span class="badge ${s.cls}">${s.text}</span>
      </div>
      <div class="card-sub">日期：${b.date}　期望：${b.desiredTime}</div>
      <div class="card-sub">允許區間：${b.earliestTime} ~ ${b.latestTime}</div>
      ${scheduledInfo}
      <div class="card-sub">嘗試次數：${b.retryCount || 0} / ${b.maxRetries}</div>
      ${b.ticketNo ? `<div class="card-sub" style="color:var(--success);font-weight:600">訂位代號：${b.ticketNo}${copyIcon}</div>` : ''}
      ${refundMsg}
      ${(refundBtn || deleteBtn) ? `<div class="card-actions">${refundBtn}${deleteBtn}</div>` : ''}
    </div>
  `;
}

async function deleteBooking(id) {
  if (!confirm('確定刪除這筆訂票紀錄？')) return;
  try {
    await api.deleteBooking(id);
    document.getElementById('booking-' + id).remove();
  } catch (err) {
    alert('刪除失敗：' + err.message);
  }
}

async function refundBooking(id) {
  if (!confirm('確定要退票？退票後無法復原。')) return;
  try {
    await api.refundBooking(id);
    await loadBookings();
  } catch (err) {
    alert('退票失敗：' + err.message);
  }
}

function copyTicketNo(ticketNo) {
  navigator.clipboard.writeText(ticketNo).then(() => {
    alert('已複製訂位代號：' + ticketNo);
  }).catch(() => {
    alert('複製失敗，請手動複製：' + ticketNo);
  });
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
  const hasPending = document.querySelector('.badge-running, .badge-pending, .badge-refunding');
  if (hasPending) loadBookings();
}, 30000);
