const bookingId = new URLSearchParams(location.search).get('id');

function renderError(msg) {
  document.getElementById('captcha-content').innerHTML = `
    <div class="alert alert-warning">${msg}</div>
    <a href="index.html" class="btn btn-primary" style="margin-top:12px">返回首頁</a>
  `;
}

async function submitCaptcha() {
  const code = document.getElementById('captcha-input').value.trim();
  if (!code) { alert('請輸入驗證碼'); return; }

  const btn = document.getElementById('captcha-submit');
  btn.disabled = true;
  btn.textContent = '送出中...';

  try {
    await api.submitCaptcha(bookingId, code);
    document.getElementById('captcha-content').innerHTML = `
      <div class="alert alert-info" style="margin-bottom:16px">
        ✅ 驗證碼已送出！系統正在為您訂票，完成後會寄 Email 通知。
      </div>
      <a href="index.html" class="btn btn-primary">返回首頁</a>
    `;
  } catch (err) {
    alert('送出失敗：' + err.message);
    btn.disabled = false;
    btn.textContent = '送出驗證碼';
  }
}

if (!bookingId) {
  renderError('缺少訂單 ID，請從 Email 連結開啟此頁面。');
} else {
  document.getElementById('captcha-content').innerHTML = `
    <div class="alert alert-info" style="margin-bottom:16px">
      請查看 Email 中的驗證碼圖片，輸入後點送出。
    </div>
    <div class="card">
      <div class="form-group">
        <label>驗證碼</label>
        <input type="text" id="captcha-input" placeholder="輸入驗證碼" maxlength="6"
               autocomplete="off" autocorrect="off" autocapitalize="off"
               style="font-size:24px;letter-spacing:8px;text-align:center">
      </div>
      <button class="btn btn-primary" id="captcha-submit" onclick="submitCaptcha()">送出驗證碼</button>
    </div>
    <p style="font-size:13px;color:var(--text-muted);margin-top:12px;text-align:center">
      訂單 ID：${bookingId.slice(0, 8)}...
    </p>
  `;
  document.getElementById('captcha-input').focus();
}
