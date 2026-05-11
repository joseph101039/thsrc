const API_URL = 'https://api.joseph101039.uk';
window.__API_URL = API_URL;

function _getToken() {
  return localStorage.getItem('thsrc_jwt');
}

function _authHeaders() {
  const token = _getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function _handle401() {
  localStorage.removeItem('thsrc_jwt');
  sessionStorage.setItem('returnUrl', location.href);
  location.href = 'login.html';
  throw new Error('未授權，請重新登入');
}

async function getJson(path) {
  const res = await fetch(API_URL + path, { headers: _authHeaders() });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function postJson(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function putJson(path, body) {
  const res = await fetch(API_URL + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ..._authHeaders() },
    body: JSON.stringify(body),
  });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function deleteJson(path) {
  const res = await fetch(API_URL + path, { method: 'DELETE', headers: _authHeaders() });
  if (res.status === 401) _handle401();
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

const api = {
  googleAuth:         (credential) => postJson('/v1/auth/google', { credential }),
  getPassengers:      ()           => getJson('/v1/passengers'),
  savePassenger:      (data)       => postJson('/v1/passengers', data),
  deletePassenger:    (id)         => deleteJson(`/v1/passengers/${id}`),
  getBookings:        ()           => getJson('/v1/bookings'),
  createBooking:      (data)       => postJson('/v1/bookings', data),
  deleteBooking:      (id)         => deleteJson(`/v1/bookings/${id}`),
  cancelBooking:      (id)         => postJson(`/v1/bookings/${id}/cancel`, {}),
  refundBooking:      (id)         => postJson(`/v1/bookings/${id}/refund`, {}),
  getBookingAttempts: (id)         => getJson(`/v1/bookings/${id}/attempts`),
  getAllowedUsers:     ()           => getJson('/v1/users'),
  addAllowedUser:     (data)       => postJson('/v1/users', data),
  deleteAllowedUser:  (email)      => deleteJson(`/v1/users/${encodeURIComponent(email)}`),
  getNotificationSettings: ()      => getJson('/v1/settings/notification'),
  updateNotificationSettings: (data) => putJson('/v1/settings/notification', data),
};
