const GAS_URL = 'https://script.google.com/macros/s/AKfycbzdtPx4EiNx01o5RDohRVfEHROdlHRBgNRPs28K7-seg899U9hY91Um3g5oz2MTDfkzig/exec';

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
};
