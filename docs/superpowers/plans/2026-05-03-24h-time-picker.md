# 24h 滾輪時間選擇器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將 `booking.html` 的 4 個時間輸入欄位換成自製 24h 滾輪選擇器，解決 iOS Safari 強制 12h AM/PM 顯示問題。

**Architecture:** 新增獨立的 `time-picker.js` 建立單例 picker DOM，attach 到任意 `[data-timepicker]` input；picker panel 定位在 input 正下方，小時 00–23 + 分鐘每 10 分鐘（6 格），確認後寫回 input。保留 text 輸入，`blur` 時驗證格式。

**Tech Stack:** Vanilla JS, CSS (現有 CSS 變數), HTML `type="text"`

---

## File Map

| 檔案 | 動作 | 說明 |
|------|------|------|
| `ui/js/time-picker.js` | 新增 | picker DOM、滾輪邏輯、touch/click 事件 |
| `ui/booking.html` | 修改 | 4 個 `type="time"` → `type="text" data-timepicker`；引入 `time-picker.js` |
| `ui/js/booking.js` | 修改 | 加 `isValidTime()` + submit 驗證 4 個欄位 |
| `ui/css/style.css` | 修改 | 加 picker panel 樣式、`.input-error` 紅框 |

---

## Task 1: 開 feature branch

**Files:** —

- [ ] **Step 1: 建 branch**

```bash
git checkout -b feat-24h-time-picker
```

---

## Task 2: 加 CSS — picker panel 樣式 + input-error

**Files:**
- Modify: `ui/css/style.css`（在檔案末尾加）

- [ ] **Step 1: 在 `style.css` 末尾加入以下樣式**

```css
/* ── 24h Time Picker ── */
.time-picker-panel {
  position: absolute;
  z-index: 1000;
  background: white;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  display: none;
  width: 200px;
  padding: 12px;
  user-select: none;
}
.time-picker-panel.open { display: block; }
.time-picker-cols {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  margin-bottom: 12px;
}
.time-picker-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.time-picker-col button {
  background: none;
  border: none;
  font-size: 20px;
  color: var(--primary);
  cursor: pointer;
  padding: 2px 8px;
  line-height: 1;
}
.time-picker-val {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  width: 52px;
  text-align: center;
  line-height: 1.2;
}
.time-picker-sep {
  font-size: 28px;
  font-weight: 700;
  color: var(--text);
  padding-bottom: 4px;
}
.time-picker-confirm {
  width: 100%;
  padding: 8px;
  background: var(--primary);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}
.time-picker-confirm:active { opacity: 0.8; }
.input-error {
  border-color: var(--danger) !important;
  box-shadow: 0 0 0 3px rgba(231,76,60,0.15) !important;
}
```

- [ ] **Step 2: 目視確認 CSS 沒有語法錯誤（括號對稱）**

---

## Task 3: 新增 `time-picker.js`

**Files:**
- Create: `ui/js/time-picker.js`

- [ ] **Step 1: 建立檔案，貼入以下完整程式碼**

```js
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
```

- [ ] **Step 2: 確認檔案存在**

```bash
ls ui/js/time-picker.js
```

---

## Task 4: 修改 `booking.html`

**Files:**
- Modify: `ui/booking.html`

- [ ] **Step 1: 將 4 個 `type="time"` input 換成 `type="text" data-timepicker`**

把這 4 行：

```html
<input type="time" id="b-desired-time" value="09:00">
<input type="time" id="b-earliest" value="08:00">
<input type="time" id="b-latest" value="11:00">
<input type="time" id="b-schedule-time">
```

改成：

```html
<input type="text" id="b-desired-time" value="09:00" placeholder="HH:MM" maxlength="5" inputmode="numeric" data-timepicker autocomplete="off">
<input type="text" id="b-earliest" value="08:00" placeholder="HH:MM" maxlength="5" inputmode="numeric" data-timepicker autocomplete="off">
<input type="text" id="b-latest" value="11:00" placeholder="HH:MM" maxlength="5" inputmode="numeric" data-timepicker autocomplete="off">
<input type="text" id="b-schedule-time" placeholder="HH:MM" maxlength="5" inputmode="numeric" data-timepicker autocomplete="off">
```

- [ ] **Step 2: 在 `</body>` 前加入 `time-picker.js`（在 `booking.js` 之前）**

```html
  <script src="js/auth.js"></script>
  <script src="js/api.js"></script>
  <script src="js/time-picker.js"></script>
  <script src="js/booking.js"></script>
```

---

## Task 5: 修改 `booking.js` — 加驗證

**Files:**
- Modify: `ui/js/booking.js`

- [ ] **Step 1: 在 `submitBooking()` 函式前加入 `isValidTime` helper**

在 `async function submitBooking()` 行**之前**插入：

```js
function isValidTime(t) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}
```

- [ ] **Step 2: 在 `submitBooking()` 內，`earliestTime >= latestTime` 那行之前加入 3 行時間格式驗證**

找到：
```js
  if (earliestTime >= latestTime)  { alert('最早時間必須早於最晚時間'); return; }
```

改成：
```js
  if (!isValidTime(desiredTime))   { alert('期望時間格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (!isValidTime(earliestTime))  { alert('允許最早格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (!isValidTime(latestTime))    { alert('允許最晚格式錯誤，請輸入 HH:MM（24小時制）'); return; }
  if (earliestTime >= latestTime)  { alert('最早時間必須早於最晚時間'); return; }
```

- [ ] **Step 3: 在 scheduled mode 的 `schedTime` 驗證後加格式檢查**

找到：
```js
    if (!schedDate || !schedTime) { alert('請填寫預約日期和時間'); return; }
```

改成：
```js
    if (!schedDate || !schedTime) { alert('請填寫預約日期和時間'); return; }
    if (!isValidTime(schedTime))  { alert('預約時間格式錯誤，請輸入 HH:MM（24小時制）'); return; }
```

---

## Task 6: 本機驗證

**Files:** —

- [ ] **Step 1: 開本機 UI server**

```bash
cd /Users/joseph/projects/nodejs/thsrc
node ui/serve.js
```

在瀏覽器（或 iOS Safari）開啟 `http://localhost:3000/booking.html`

- [ ] **Step 2: 測試滾輪**
  - 點擊「期望時間」→ picker 展開，顯示 24h 小時
  - 點 ▲▼ 確認小時循環 00→23→00
  - 點 ▲▼ 確認分鐘循環 00→50→00（每格 10 分鐘）
  - 點「確認」→ input 更新為選取的 HH:MM
  - 點 panel 外 → picker 關閉

- [ ] **Step 3: 測試手打**
  - 直接在 input 打 `25:00` → blur → 紅框出現
  - 清除輸入，打 `08:30` → blur → 紅框消失

- [ ] **Step 4: 測試 submit 驗證**
  - 清空「期望時間」→ 按確認 → alert 顯示格式錯誤
  - 改回正確值 → 正常送出

- [ ] **Step 5: 確認 4 個 time 欄位都有 picker（含「預約時間」切換到預約模式後）**

---

## Task 7: Commit

**Files:** 全部修改過的檔案

- [ ] **Step 1: 確認所有變更**

```bash
git diff --stat
```

Expected: 4 files changed（`style.css`, `booking.html`, `booking.js`, `time-picker.js`）

- [ ] **Step 2: Commit**

```bash
git add ui/css/style.css ui/booking.html ui/js/booking.js ui/js/time-picker.js
git commit -m "feat: add 24h wheel time picker for booking form"
```
