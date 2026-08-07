const db = require('../db');

// Resolve a user's role + the sections they may access. Authoritative: reads
// the current role from the DB (not the JWT), so a role edit takes effect on
// the next request without forcing a re-login. Admin roles get every section.
async function getUserAccess(userId) {
  const row = await db.prepare(
    `SELECT u.id, u.username, u.full_name, r.id AS role_id, r.name AS role, r.is_admin, r.permissions
       FROM users u
       LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?`
  ).get(userId);

  if (!row) return { role: null, roleId: null, isAdmin: false, sections: [] };

  if (row.is_admin) {
    return { role: row.role, roleId: row.role_id, isAdmin: true, sections: db.SECTION_KEYS.slice() };
  }

  // mysql2 returns JSON columns already parsed; tolerate a string just in case.
  let perms = row.permissions;
  if (typeof perms === 'string') {
    try { perms = JSON.parse(perms); } catch (_e) { perms = []; }
  }
  return {
    role: row.role,
    roleId: row.role_id,
    isAdmin: false,
    sections: Array.isArray(perms) ? perms.filter((k) => db.SECTION_KEYS.includes(k)) : [],
  };
}

// Express middleware factory: allow the request only if the authenticated user's
// role grants `sectionKey`. Must run after the `auth` (verifyToken) middleware,
// which sets req.userId.
function requireSection(sectionKey) {
  return async (req, res, next) => {
    try {
      if (!req.userId) return res.status(403).json({ error: 'Not authenticated' });
      const access = await getUserAccess(req.userId);
      req.access = access; // handy for downstream handlers
      if (access.isAdmin || access.sections.includes(sectionKey)) return next();
      return res.status(403).json({ error: 'Forbidden: your role does not permit this section' });
    } catch (err) {
      console.error('[AUTHZ] requireSection error:', err.message);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

// Like requireSection but passes if the user has ANY of the listed sections.
// Used where a page needs data owned by another section (e.g. the Users form
// needs the roles list).
function requireAnySection(sectionKeys) {
  return async (req, res, next) => {
    try {
      if (!req.userId) return res.status(403).json({ error: 'Not authenticated' });
      const access = await getUserAccess(req.userId);
      req.access = access;
      if (access.isAdmin || sectionKeys.some((k) => access.sections.includes(k))) return next();
      return res.status(403).json({ error: 'Forbidden: your role does not permit this action' });
    } catch (err) {
      console.error('[AUTHZ] requireAnySection error:', err.message);
      return res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}

module.exports = { requireSection, requireAnySection, getUserAccess };
