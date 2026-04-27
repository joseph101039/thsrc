// 呼叫驗證碼辨識 API，回傳辨識結果字串，失敗則 throw
function solveCaptcha(captchaBase64) {
  const res = UrlFetchApp.fetch(CONFIG.CAPTCHA_API_URL + '/solve', {
    method: 'POST',
    contentType: 'application/json',
    payload: JSON.stringify({ image: captchaBase64 }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('驗證碼 API 錯誤：' + res.getResponseCode() + ' ' + res.getContentText());
  }
  const data = JSON.parse(res.getContentText());
  if (!data.answer) throw new Error('驗證碼 API 回傳格式錯誤：' + res.getContentText());
  return data.answer;
}

