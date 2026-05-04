const STATIONS = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];

let bookingMode = 'immediate';
let searchMode = 'time';

const ticketCounts = { adult: 1, child: 0, disabled: 0, senior: 0, student: 0 };

function setMode(mode) {
  bookingMode = mode;
  document.getElementById('btn-immediate').classList.toggle('active', mode === 'immediate');
  document.getElementById('btn-scheduled').classList.toggle('active', mode === 'scheduled');
  document.getElementById('scheduled-fields').style.display = mode === 'scheduled' ? 'grid' : 'none';
}

function setSearchMode(mode) {
  searchMode = mode;
  document.getElementById('btn-mode-time').style.background = mode === 'time' ? '#4A90E2' : '#fff';
  document.getElementById('btn-mode-time').style.color = mode === 'time' ? '#fff' : '#4A90E2';
  document.getElementById('btn-mode-train').style.background = mode === 'train' ? '#4A90E2' : '#fff';
  document.getElementById('btn-mode-train').style.color = mode === 'train' ? '#fff' : '#4A90E2';
  document.getElementById('time-fields').style.display = mode === 'time' ? '' : 'none';
  document.getElementById('train-fields').style.display = mode === 'train' ? '' : 'none';
}

function changeTicket(type, delta) {
  const newVal = Math.max(0, Math.min(10, ticketCounts[type] + delta));
  ticketCounts[type] = newVal;
  document.getElementById(`ticket-${type}-val`).textContent = newVal;
}

function swapStations() {
  const from = document.getElementById('b-from');
  const to   = document.getElementById('b-to');
  const tmp  = from.value;
  from.value = to.value;
  to.value   = tmp;
}

function initStationSelects() {
  const fromEl = document.getElementById('b-from');
  const toEl   = document.getElementById('b-to');
  STATIONS.forEach((s, i) => {
    fromEl.add(new Option(s, s, false, i === 1));
    toEl.add(new Option(s, s, false, i === 6));
  });
}

async function loadPassengers() {
  const sel = document.getElementById('b-passenger');
  const myEmail = window.__auth.getEmail();
  try {
    const { passengers } = await api.getPassengers();
    if (!passengers || passengers.length === 0) {
      sel.innerHTML = '<option value="">請先至「乘客設定」新增乘客</option>';
      return;
    }
    const sorted = [
      ...passengers.filter(p => p.email === myEmail),
      ...passengers.filter(p => p.email !== myEmail),
    ];
    sel.innerHTML = sorted
      .map(p => `<option value="${p.id}">${p.name}（${maskId(p.idNumber, p.email, myEmail)}）</option>`)
      .join('');
  } catch (err) {
    sel.innerHTML = '<option value="">載入失敗</option>';
  }
}

async function submitBooking() {
  const passengerId  = document.getElementById('b-passenger').value;
  const fromStation  = document.getElementById('b-from').value;
  const toStation    = document.getElementById('b-to').value;
  const maxRetries     = parseInt(document.getElementById('b-max-retries').value);
  const retryWaitValue = parseInt(document.getElementById('b-retry-wait-value').value);
  const retryWaitUnit  = document.getElementById('b-retry-wait-unit').value;

  if (!passengerId)              { alert('請選擇乘客'); return; }
  if (fromStation === toStation) { alert('出發站與到達站不能相同'); return; }

  const totalTickets = Object.values(ticketCounts).reduce((a, b) => a + b, 0);
  if (totalTickets < 1) { alert('至少需要一張票'); return; }

  const maxWait = retryWaitUnit === 'minute' ? 60 : 300;
  if (!retryWaitValue || retryWaitValue < 1 || retryWaitValue > maxWait) {
    alert(`重試間隔：分鐘請填 1–60，秒請填 1–300`);
    return;
  }

  let date, desiredTime, earliestTime, latestTime, trainNoTarget;

  if (searchMode === 'time') {
    date         = document.getElementById('b-date').value;
    desiredTime  = document.getElementById('b-desired-time').value;
    earliestTime = document.getElementById('b-earliest').value;
    latestTime   = document.getElementById('b-latest').value;
    if (!date)                        { alert('請選擇乘車日期'); return; }
    if (!desiredTime)                 { alert('請選擇期望時間'); return; }
    if (!earliestTime || !latestTime) { alert('請選擇允許時間區間'); return; }
    if (earliestTime >= latestTime)   { alert('最早時間必須早於最晚時間'); return; }
  } else {
    date          = document.getElementById('b-date-train').value;
    trainNoTarget = document.getElementById('b-train-no-target').value.trim();
    desiredTime   = '00:00';
    earliestTime  = '00:00';
    latestTime    = '23:59';
    if (!date)          { alert('請選擇乘車日期'); return; }
    if (!trainNoTarget) { alert('請輸入車次號碼'); return; }
  }

  let scheduledAt = null;
  if (bookingMode === 'scheduled') {
    const schedDate = document.getElementById('b-schedule-date').value;
    const schedTime = document.getElementById('b-schedule-time').value;
    if (!schedDate || !schedTime) { alert('請填寫預約日期和時間'); return; }
    scheduledAt = new Date(schedDate + 'T' + schedTime + ':00').toISOString();
  }

  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.textContent = '送出中...';

  try {
    await api.createBooking({
      passengerId, fromStation, toStation, date,
      desiredTime, earliestTime, latestTime,
      maxRetries, scheduledAt,
      retryWaitValue, retryWaitUnit,
      ticketAdult:    ticketCounts.adult,
      ticketChild:    ticketCounts.child,
      ticketDisabled: ticketCounts.disabled,
      ticketSenior:   ticketCounts.senior,
      ticketStudent:  ticketCounts.student,
      searchMode,
      trainNoTarget: trainNoTarget || null,
      immediate: bookingMode === 'immediate',
    });
    location.href = 'index.html';
  } catch (err) {
    alert('送出失敗：' + err.message);
    btn.disabled = false;
    btn.textContent = '確認送出';
  }
}

// 日期預設為明天
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const tomorrowStr = tomorrow.toISOString().slice(0, 10);
document.getElementById('b-date').value = tomorrowStr;
document.getElementById('b-date-train').value = tomorrowStr;
document.getElementById('b-schedule-date').value = tomorrowStr;

function updateTimeRange() {
  const desired = document.getElementById('b-desired-time').value;
  if (!desired) return;
  const [h, m] = desired.split(':').map(Number);
  const mStr = m.toString().padStart(2, '0');
  const earliestH = Math.max(0, h - 2).toString().padStart(2, '0');
  const latestH   = Math.min(23, h + 2).toString().padStart(2, '0');
  document.getElementById('b-earliest').value = `${earliestH}:${mStr}`;
  document.getElementById('b-latest').value   = `${latestH}:${mStr}`;
}

document.getElementById('b-desired-time').addEventListener('change', updateTimeRange);
updateTimeRange();

initStationSelects();
loadPassengers();
