const GAS_URL = 'https://script.google.com/macros/s/AKfycbxt0Sp-zQrRCstkcENkrfbRLILgITtTyYtl4izs0nepX7U577K8FAQvHiShfZQ4KV6Obw/exec';

async function gasCall(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const api = {
  getPassengers:  ()              => gasCall('getPassengers'),
  savePassenger:  (data)          => gasCall('savePassenger', { data }),
  deletePassenger:(id)            => gasCall('deletePassenger', { id }),
  getBookings:    ()              => gasCall('getBookings'),
  createBooking:  (data)          => gasCall('createBooking', { data }),
  submitCaptcha:  (id, captcha)   => gasCall('submitCaptcha', { id, captcha }),
};
