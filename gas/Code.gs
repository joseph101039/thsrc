function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action;
    let result;

    switch (action) {
      case 'getPassengers':   result = getPassengers();                       break;
      case 'savePassenger':   result = savePassenger(body.data);              break;
      case 'deletePassenger': result = deletePassenger(body.id);              break;
      case 'createBooking':   result = createBooking(body.data);              break;
      case 'getBookings':     result = getBookings();                         break;
      case 'submitCaptcha':   result = submitCaptcha(body.id, body.captcha);  break;
      default:
        result = { error: 'Unknown action: ' + action };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
