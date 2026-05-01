const GAS_URL = 'https://api.joseph101039.uk';
window.__API_URL = GAS_URL;

async function gasCall(action, payload = {}) {
  const token = localStorage.getItem('thsrc_jwt');
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (res.status === 401) {
    localStorage.removeItem('thsrc_jwt');
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
    throw new Error('未授權，請重新登入');
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const api = {
  getPassengers:      ()     => gasCall('getPassengers'),
  savePassenger:      (data) => gasCall('savePassenger', { data }),
  deletePassenger:    (id)   => gasCall('deletePassenger', { id }),
  getBookings:        ()     => gasCall('getBookings'),
  createBooking:      (data) => gasCall('createBooking', { data }),
  deleteBooking:      (id)   => gasCall('deleteBooking', { id }),
  getBookingAttempts: (id)   => gasCall('getBookingAttempts', { id }),
};
