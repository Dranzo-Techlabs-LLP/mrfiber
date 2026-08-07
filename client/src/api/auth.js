// Central place for the client's auth/session state (token + role + which
// sections the user may access). Kept in localStorage so it survives reloads.

export const SECTION_ROUTES = {
  vpn: '/vpn',
  olt: '/olt',
  proxy: '/proxy',
  customers: '/customers',
  users: '/users',
  roles: '/roles',
};

// Preferred landing order after login.
const SECTION_ORDER = ['vpn', 'olt', 'proxy', 'customers', 'users', 'roles'];

export function setAuth(data) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('username', data.username || '');
  localStorage.setItem('role', data.role || '');
  localStorage.setItem('isAdmin', data.isAdmin ? 'true' : 'false');
  localStorage.setItem('sections', JSON.stringify(Array.isArray(data.sections) ? data.sections : []));
}

export function clearAuth() {
  ['token', 'username', 'role', 'isAdmin', 'sections'].forEach((k) => localStorage.removeItem(k));
}

export function getAuth() {
  let sections = [];
  try { sections = JSON.parse(localStorage.getItem('sections') || '[]'); } catch (_e) { sections = []; }
  return {
    token: localStorage.getItem('token'),
    username: localStorage.getItem('username') || '',
    role: localStorage.getItem('role') || '',
    isAdmin: localStorage.getItem('isAdmin') === 'true',
    sections: Array.isArray(sections) ? sections : [],
  };
}

export function isAuthenticated() {
  return !!localStorage.getItem('token');
}

export function hasSection(key) {
  const a = getAuth();
  return a.isAdmin || a.sections.includes(key);
}

// First route the current user is allowed to open (used for login redirect and
// wildcard fallback). Returns /login if nothing is accessible.
export function firstAccessibleRoute() {
  for (const key of SECTION_ORDER) {
    if (hasSection(key)) return SECTION_ROUTES[key];
  }
  return '/login';
}
