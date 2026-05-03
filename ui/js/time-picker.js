(function () {
  // ── Time Picker ──────────────────────────────────────────────
  const HOURS   = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINS    = ['00', '10', '20', '30', '40', '50'];
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

  let tPanel, hourVal, minVal, tActiveInput;

  function buildTimePanel() {
    tPanel = document.createElement('div');
    tPanel.className = 'time-picker-panel';
    tPanel.innerHTML = `
      <div class="time-picker-cols">
        <div class="time-picker-col">
          <button class="tp-h-up">▲</button>
          <div class="time-picker-val" id="tp-hour">08</div>
          <button class="tp-h-dn">▼</button>
        </div>
        <div class="time-picker-sep">:</div>
        <div class="time-picker-col">
          <button class="tp-m-up">▲</button>
          <div class="time-picker-val" id="tp-min">00</div>
          <button class="tp-m-dn">▼</button>
        </div>
      </div>
      <button class="time-picker-confirm">確認</button>
    `;
    document.body.appendChild(tPanel);

    hourVal = tPanel.querySelector('#tp-hour');
    minVal  = tPanel.querySelector('#tp-min');

    tPanel.querySelector('.tp-h-up').addEventListener('click', () => stepHour(+1));
    tPanel.querySelector('.tp-h-dn').addEventListener('click', () => stepHour(-1));
    tPanel.querySelector('.tp-m-up').addEventListener('click', () => stepMin(+1));
    tPanel.querySelector('.tp-m-dn').addEventListener('click', () => stepMin(-1));
    tPanel.querySelector('.time-picker-confirm').addEventListener('click', confirmTime);

    let touchStartY = 0, touchCol = null;
    tPanel.addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY;
      touchCol = e.target.closest('.time-picker-col');
    }, { passive: true });
    tPanel.addEventListener('touchend', e => {
      if (!touchCol) return;
      const dy = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(dy) < 10) return;
      const isHour = touchCol.querySelector('#tp-hour');
      if (isHour) stepHour(dy > 0 ? +1 : -1);
      else        stepMin(dy > 0 ? +1 : -1);
    }, { passive: true });

    document.addEventListener('click', e => {
      if (tPanel.classList.contains('open') && !tPanel.contains(e.target) && e.target !== tActiveInput) {
        closeTime();
      }
    });
    window.addEventListener('scroll', closeTime, { passive: true });
    window.addEventListener('resize', closeTime, { passive: true });
  }

  function stepHour(dir) {
    const current = hourVal.textContent.padStart(2, '0');
    const idx = (HOURS.indexOf(current) + dir + 24) % 24;
    hourVal.textContent = HOURS[Math.max(0, idx)];
  }

  function stepMin(dir) {
    const current = minVal.textContent.padStart(2, '0');
    const idx = (MINS.indexOf(current) + dir + MINS.length) % MINS.length;
    minVal.textContent = MINS[Math.max(0, idx)];
  }

  function openTime(input) {
    if (!tPanel) buildTimePanel();
    // 關閉 date picker（如有）
    closeDate();
    tActiveInput = input;

    const val = input.value;
    if (TIME_RE.test(val)) {
      const [h, m] = val.split(':');
      hourVal.textContent = h;
      const mSnap = MINS.reduce((a, b) => Math.abs(+b - +m) < Math.abs(+a - +m) ? b : a);
      minVal.textContent = mSnap;
    } else {
      hourVal.textContent = '08';
      minVal.textContent  = '00';
    }

    positionPanel(tPanel, input);
    tPanel.classList.add('open');
  }

  function closeTime() {
    if (tPanel) tPanel.classList.remove('open');
    tActiveInput = null;
  }

  function confirmTime() {
    if (tActiveInput) {
      tActiveInput.value = hourVal.textContent + ':' + minVal.textContent;
      tActiveInput.classList.remove('input-error');
      tActiveInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeTime();
  }

  // ── Date Picker ───────────────────────────────────────────────
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

  let dPanel, yearVal, monthVal, dayVal, dActiveInput;

  function buildDatePanel() {
    dPanel = document.createElement('div');
    dPanel.className = 'time-picker-panel date-picker-panel';
    dPanel.innerHTML = `
      <div class="time-picker-cols">
        <div class="time-picker-col">
          <button class="dp-y-up">▲</button>
          <div class="time-picker-val dp-wide" id="dp-year">2026</div>
          <button class="dp-y-dn">▼</button>
        </div>
        <div class="time-picker-col">
          <button class="dp-m-up">▲</button>
          <div class="time-picker-val dp-wide" id="dp-month">1月</div>
          <button class="dp-m-dn">▼</button>
        </div>
        <div class="time-picker-col">
          <button class="dp-d-up">▲</button>
          <div class="time-picker-val" id="dp-day">01</div>
          <button class="dp-d-dn">▼</button>
        </div>
      </div>
      <button class="time-picker-confirm">確認</button>
    `;
    document.body.appendChild(dPanel);

    yearVal  = dPanel.querySelector('#dp-year');
    monthVal = dPanel.querySelector('#dp-month');
    dayVal   = dPanel.querySelector('#dp-day');

    dPanel.querySelector('.dp-y-up').addEventListener('click', () => stepYear(+1));
    dPanel.querySelector('.dp-y-dn').addEventListener('click', () => stepYear(-1));
    dPanel.querySelector('.dp-m-up').addEventListener('click', () => stepMonth(+1));
    dPanel.querySelector('.dp-m-dn').addEventListener('click', () => stepMonth(-1));
    dPanel.querySelector('.dp-d-up').addEventListener('click', () => stepDay(+1));
    dPanel.querySelector('.dp-d-dn').addEventListener('click', () => stepDay(-1));
    dPanel.querySelector('.time-picker-confirm').addEventListener('click', confirmDate);

    let touchStartY = 0, touchCol = null;
    dPanel.addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY;
      touchCol = e.target.closest('.time-picker-col');
    }, { passive: true });
    dPanel.addEventListener('touchend', e => {
      if (!touchCol) return;
      const dy = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(dy) < 10) return;
      if (touchCol.querySelector('#dp-year'))  stepYear(dy > 0 ? +1 : -1);
      else if (touchCol.querySelector('#dp-month')) stepMonth(dy > 0 ? +1 : -1);
      else stepDay(dy > 0 ? +1 : -1);
    }, { passive: true });

    document.addEventListener('click', e => {
      if (dPanel.classList.contains('open') && !dPanel.contains(e.target) && e.target !== dActiveInput) {
        closeDate();
      }
    });
    window.addEventListener('scroll', closeDate, { passive: true });
    window.addEventListener('resize', closeDate, { passive: true });
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
  }

  function clampDay() {
    const y = parseInt(yearVal.textContent);
    const m = MONTH_NAMES.indexOf(monthVal.textContent) + 1;
    const maxD = getDaysInMonth(y, m);
    const d = parseInt(dayVal.textContent);
    if (d > maxD) dayVal.textContent = String(maxD).padStart(2, '0');
  }

  function stepYear(dir) {
    yearVal.textContent = String(parseInt(yearVal.textContent) + dir);
    clampDay();
  }

  function stepMonth(dir) {
    const idx = (MONTH_NAMES.indexOf(monthVal.textContent) + dir + 12) % 12;
    monthVal.textContent = MONTH_NAMES[idx];
    clampDay();
  }

  function stepDay(dir) {
    const y = parseInt(yearVal.textContent);
    const m = MONTH_NAMES.indexOf(monthVal.textContent) + 1;
    const max = getDaysInMonth(y, m);
    const d = parseInt(dayVal.textContent);
    const next = ((d - 1 + dir + max) % max) + 1;
    dayVal.textContent = String(next).padStart(2, '0');
  }

  function openDate(input) {
    if (!dPanel) buildDatePanel();
    // 關閉 time picker（如有）
    closeTime();
    dActiveInput = input;

    const val = input.value;
    if (DATE_RE.test(val)) {
      const [y, m, d] = val.split('-');
      yearVal.textContent  = y;
      monthVal.textContent = MONTH_NAMES[parseInt(m) - 1];
      dayVal.textContent   = d;
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      yearVal.textContent  = String(tomorrow.getFullYear());
      monthVal.textContent = MONTH_NAMES[tomorrow.getMonth()];
      dayVal.textContent   = String(tomorrow.getDate()).padStart(2, '0');
    }

    positionPanel(dPanel, input);
    dPanel.classList.add('open');
  }

  function closeDate() {
    if (dPanel) dPanel.classList.remove('open');
    dActiveInput = null;
  }

  function confirmDate() {
    if (dActiveInput) {
      const y = yearVal.textContent;
      const m = String(MONTH_NAMES.indexOf(monthVal.textContent) + 1).padStart(2, '0');
      const d = dayVal.textContent;
      dActiveInput.value = `${y}-${m}-${d}`;
      dActiveInput.classList.remove('input-error');
    }
    closeDate();
  }

  // ── Shared ────────────────────────────────────────────────────
  function positionPanel(panel, input) {
    const rect   = input.getBoundingClientRect();
    const panelW = panel.classList.contains('date-picker-panel') ? 260 : 200;
    const left   = Math.min(rect.left, window.innerWidth - panelW - 8);
    panel.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    panel.style.left = Math.max(8, left) + 'px';
  }

  // ── Init ──────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-timepicker]').forEach(input => {
      input.setAttribute('readonly', '');
      input.addEventListener('click', () => openTime(input));
      input.addEventListener('blur', () => {
        const v = input.value;
        if (v && !TIME_RE.test(v)) input.classList.add('input-error');
        else input.classList.remove('input-error');
      });
    });

    document.querySelectorAll('[data-datepicker]').forEach(input => {
      input.setAttribute('readonly', '');
      input.addEventListener('click', () => openDate(input));
    });
  });
})();
