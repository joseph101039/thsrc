const STATIONS = ['南港', '台北', '板橋', '桃園', '新竹', '苗栗', '台中', '彰化', '雲林', '嘉義', '台南', '左營'];

let bookingMode = 'immediate';

function setMode(mode) {
  bookingMode = mode;
  document.getElementById('btn-immediate').classList.toggle('active', mode === 'immediate');
  document.getElementById('btn-scheduled').classList.toggle('active', mode === 'scheduled');
  document.getElementById('scheduled-fields').style.display = mode === 'scheduled' ? 'grid' : 'none';
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
    fromEl.add(new Option(s, s, false, i === 1));  // 預設台北
    toEl.add(new Option(s, s, false, i === 6));    // 預設台中
  });
}

async function loadPassengers() {
  const sel = document.getElementById('b-passenger');
  try {
    const { passengers } = await api.getPassengers();
    if (!passengers || passengers.length === 0) {
      sel.innerHTML = '<option value="">請先至「乘客設定」新增乘客</option>';
      return;
    }
    sel.innerHTML = passengers
      .map(p => `<option value="${p.id}">${p.name}（${p.idNumber}）</option>`)
      .join('');
  } catch (err) {
    sel.innerHTML = '<option value="">載入失敗</option>';
  }
}

function isValidTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

async function submitBooking() {
  const passengerId  = document.getElementById('b-passenger').value;
  const fromStation  = document.getElementById('b-from').value;
  const toStation    = document.getElementById('b-to').value;
  const date         = document.getElementById('b-date').value;
  const desiredTime  = document.getElementById('b-desired-time').value;
  const earliestTime = document.getElementById('b-earliest').value;
  const latestTime   = document.getElementById('b-latest').value;
  const maxRetries   = parseInt(document.getElementById('b-max-retries').value);

  if (!passengerId)                { alert('請選擇乘客'); return; }
  if (!date)                       { alert('請選擇乘車日期'); return; }
  if (fromStation === toStation)   { alert('出發站與到達站不能相同'); return; }
  if (!isValidTime(desiredTime))   { alert('期望時間格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (!isValidTime(earliestTime))  { alert('允許最早格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (!isValidTime(latestTime))    { alert('允許最晚格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (earliestTime >= latestTime)  { alert('最早時間必須早於最晚時間'); return; }

  let scheduledAt = null;
  if (bookingMode === 'scheduled') {
    const schedDate = document.getElementById('b-schedule-date').value;
    const schedTime = document.getElementById('b-schedule-time').value;
    if (!schedDate || !schedTime) { alert('請填寫預約日期和時間'); return; }
    if (!isValidTime(schedTime))  { alert('預約時間格式錯誤，請輸入 HH:MM（24小時制）'); return; }
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
document.getElementById('b-schedule-date').value = tomorrowStr;

initStationSelects();
loadPassengers();
