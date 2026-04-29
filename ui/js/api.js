const GAS_URL = 'https://api.joseph101039.uk';

async function gasCall(action, payload = {}) {
  const res = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
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
