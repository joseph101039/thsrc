function sendCaptchaEmail(toEmail, bookingId, captchaBase64, webUiUrl) {
  const subject = '【高鐵訂票】請輸入驗證碼';
  const captchaUrl = webUiUrl + '?captcha=' + bookingId;
  const body = [
    '高鐵訂票系統正在為您搶票，需要您輸入驗證碼才能繼續。',
    '',
    '請點擊以下連結輸入驗證碼：',
    captchaUrl,
    '',
    '（連結有效時間：' + CONFIG.RETRY_WAIT_MINUTES + ' 分鐘）',
    '',
    '如果您沒有發起訂票請求，請忽略此信。',
  ].join('\n');

  const htmlBody = [
    '<p>高鐵訂票系統正在為您搶票，需要您輸入驗證碼才能繼續。</p>',
    '<p>驗證碼圖片：</p>',
    '<img src="data:image/jpeg;base64,' + captchaBase64 + '" style="border:1px solid #ccc; padding:4px;" />',
    '<p><a href="' + captchaUrl + '" style="background:#2980b9;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;">點此輸入驗證碼</a></p>',
    '<p style="color:#888;font-size:12px;">連結有效時間：' + CONFIG.RETRY_WAIT_MINUTES + ' 分鐘</p>',
  ].join('');

  GmailApp.sendEmail(toEmail, subject, body, { htmlBody });
}

function sendSuccessEmail(toEmail, booking, passenger) {
  const subject = '【高鐵訂票】訂票成功！';
  const body = [
    '您的高鐵票已成功訂購！',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.fromStation + ' → ' + booking.toStation,
    '日期：' + booking.date,
    '車次：' + booking.trainNo,
    '訂位代號：' + booking.ticketNo,
    '嘗試次數：' + booking.retryCount,
    '',
    '請記得在發車前至超商或車站取票付款。',
  ].join('\n');

  GmailApp.sendEmail(toEmail, subject, body);
}

function sendFailureEmail(toEmail, booking, passenger, reason) {
  const subject = '【高鐵訂票】訂票失敗';
  const body = [
    '很抱歉，您的高鐵訂票未能成功。',
    '',
    '乘客：' + passenger.name,
    '路線：' + booking.fromStation + ' → ' + booking.toStation,
    '日期：' + booking.date,
    '期望時間：' + booking.desiredTime,
    '嘗試次數：' + booking.retryCount,
    '失敗原因：' + reason,
    '',
    '請手動前往高鐵官網訂票：https://irs.thsrc.com.tw/IMINT/',
  ].join('\n');

  GmailApp.sendEmail(toEmail, subject, body);
}

function test_mailer() {
  const testEmail = Session.getActiveUser().getEmail();
  sendFailureEmail(
    testEmail,
    { fromStation: '台北', toStation: '左營', date: '2026-05-01', desiredTime: '09:00', retryCount: 3 },
    { name: '測試者' },
    '無可用班次'
  );
  console.log('Test failure email sent to:', testEmail);
}
