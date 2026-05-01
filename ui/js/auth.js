(function () {
  const JWT_KEY = 'thsrc_jwt';

  function getToken() {
    return localStorage.getItem(JWT_KEY);
  }

  function isTokenValid(token) {
    if (!token) return false;
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  }

  function logout() {
    localStorage.removeItem(JWT_KEY);
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
  }

  const token = getToken();
  if (!isTokenValid(token)) {
    sessionStorage.setItem('returnUrl', location.href);
    location.href = 'login.html';
  }

  window.__auth = { getToken, logout };
})();
