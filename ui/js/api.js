const GAS_URL = 'http://35.212.154.47:8081';

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
  getPassengers:   ()     => gasCall('getPassengers'),
  savePassenger:   (data) => gasCall('savePassenger', { data }),
  deletePassenger: (id)   => gasCall('deletePassenger', { id }),
  getBookings:     ()     => gasCall('getBookings'),
  createBooking:   (data) => gasCall('createBooking', { data }),
};
