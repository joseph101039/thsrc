(function () {
  const JWT_KEY = 'thsrc_jwt';

  function getToken() {
    return localStorage.getItem(JWT_KEY);
  }

  function _decodePayload(token) {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64));
  }

  function isTokenValid(token) {
    if (!token) return false;
    try {
      return _decodePayload(token).exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem(JWT_KEY);
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
  }

  function getRole() {
    const token = getToken();
    if (!token) return null;
    try {
      return _decodePayload(token).role || null;
    } catch { return null; }
  }

  function getEmail() {
    const token = getToken();
    if (!token) return null;
    try {
      return _decodePayload(token).email || null;
    } catch { return null; }
  }

  const token = getToken();
  if (!isTokenValid(token)) {
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
  }

  window.__auth = { getToken, logout, getRole, getEmail };
})();
