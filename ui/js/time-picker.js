(function () {
  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const MINS  = ['00', '10', '20', '30', '40', '50'];

  let panel, hourVal, minVal, activeInput;

  function buildPanel() {
    panel = document.createElement('div');
    panel.className = 'time-picker-panel';
    panel.innerHTML = `
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
    document.body.appendChild(panel);

    hourVal = panel.querySelector('#tp-hour');
    minVal  = panel.querySelector('#tp-min');

    panel.querySelector('.tp-h-up').addEventListener('click', () => stepHour(+1));
    panel.querySelector('.tp-h-dn').addEventListener('click', () => stepHour(-1));
    panel.querySelector('.tp-m-up').addEventListener('click', () => stepMin(+1));
    panel.querySelector('.tp-m-dn').addEventListener('click', () => stepMin(-1));
    panel.querySelector('.time-picker-confirm').addEventListener('click', confirm);

    // 觸控滑動：上滑 = 往後、下滑 = 往前
    let touchStartY = 0, touchCol = null;
    panel.addEventListener('touchstart', e => {
      touchStartY = e.touches[0].clientY;
      touchCol = e.target.closest('.time-picker-col');
    }, { passive: true });
    panel.addEventListener('touchend', e => {
      if (!touchCol) return;
      const dy = touchStartY - e.changedTouches[0].clientY;
      if (Math.abs(dy) < 10) return;
      const isHour = touchCol.querySelector('#tp-hour');
      if (isHour) stepHour(dy > 0 ? +1 : -1);
      else        stepMin(dy > 0 ? +1 : -1);
    }, { passive: true });

    // 點擊 panel 外關閉
    document.addEventListener('click', e => {
      if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== activeInput) {
        close();
      }
    });
  }

  function stepHour(dir) {
    const idx = (HOURS.indexOf(hourVal.textContent) + dir + 24) % 24;
    hourVal.textContent = HOURS[idx];
  }

  function stepMin(dir) {
    const idx = (MINS.indexOf(minVal.textContent) + dir + MINS.length) % MINS.length;
    minVal.textContent = MINS[idx];
  }

  function open(input) {
    if (!panel) buildPanel();
    activeInput = input;

    // 從 input 現有值初始化滾輪
    const val = input.value;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) {
      const [h, m] = val.split(':');
      hourVal.textContent = h;
      // 對齊到最近的 10 分鐘刻度
      const mSnap = MINS.reduce((a, b) => Math.abs(+b - +m) < Math.abs(+a - +m) ? b : a);
      minVal.textContent = mSnap;
    }

    // 定位到 input 正下方
    const rect = input.getBoundingClientRect();
    panel.style.top  = (rect.bottom + window.scrollY + 4) + 'px';
    panel.style.left = rect.left + 'px';
    panel.classList.add('open');
  }

  function close() {
    if (panel) panel.classList.remove('open');
    activeInput = null;
  }

  function confirm() {
    if (activeInput) {
      activeInput.value = hourVal.textContent + ':' + minVal.textContent;
      activeInput.classList.remove('input-error');
    }
    close();
  }

  // 綁定所有 [data-timepicker] input
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-timepicker]').forEach(input => {
      input.addEventListener('click', () => open(input));
      input.addEventListener('blur', () => {
        const v = input.value;
        if (v && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
          input.classList.add('input-error');
        } else {
          input.classList.remove('input-error');
        }
      });
    });
  });
})();
