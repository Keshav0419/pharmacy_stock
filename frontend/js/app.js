// Shared helpers used by login.html, register.html and dashboard.html

function getToken() {
  return localStorage.getItem('tiffin_token');
}

function setToken(token) {
  localStorage.setItem('tiffin_token', token);
}

function logout() {
  localStorage.removeItem('tiffin_token');
  window.location.href = '/login.html';
}

// Wrapper around fetch() that attaches the auth header and
// redirects to login on a 401 (expired/missing token).
async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = Object.assign(
    { 'Content-Type': 'application/json' },
    options.headers || {},
    token ? { Authorization: `Bearer ${token}` } : {}
  );
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error('session expired');
  }
  return res;
}

function requireLoggedIn() {
  if (!getToken()) window.location.href = '/login.html';
}

// Small toast notification helper, used across the auth pages and dashboard.
function toast(message, type = 'success') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
