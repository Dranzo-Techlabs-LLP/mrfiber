const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireSection, requireAnySection } = require('../middleware/permissions');

router.use(auth);

// Normalises a submitted permissions array to known section keys only.
function cleanPermissions(perms) {
  if (!Array.isArray(perms)) return [];
  return [...new Set(perms.filter((k) => db.SECTION_KEYS.includes(k)))];
}

function parsePerms(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (_e) { return []; }
  }
  return [];
}

// GET /api/roles/sections — list of gate-able sections (for the Roles editor UI).
router.get('/sections', requireSection('roles'), (req, res) => {
  res.json(db.SECTIONS);
});

// GET /api/roles — list roles. Readable by anyone who manages users OR roles
// (the Users form needs this to populate its role dropdown).
router.get('/', requireAnySection(['roles', 'users']), async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT id, name, description, is_admin, permissions, created_at FROM roles ORDER BY is_admin DESC, name ASC'
    ).all();
    res.json(rows.map((r) => ({ ...r, is_admin: !!r.is_admin, permissions: parsePerms(r.permissions) })));
  } catch (err) {
    console.error('[ROLES] list:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/roles — create a role. User-created roles are never super-admin.
router.post('/', requireSection('roles'), async (req, res) => {
  const name = (req.body.name || '').trim();
  const description = (req.body.description || '').trim() || null;
  const permissions = cleanPermissions(req.body.permissions);
  if (!name) return res.status(400).json({ error: 'Role name is required' });
  try {
    const dupe = await db.prepare('SELECT id FROM roles WHERE name = ?').get(name);
    if (dupe) return res.status(409).json({ error: 'A role with that name already exists' });

    const info = await db.prepare(
      'INSERT INTO roles (name, description, is_admin, permissions) VALUES (?, ?, 0, ?)'
    ).run(name, description, JSON.stringify(permissions));
    res.json({ id: info.lastInsertRowid, name, description, is_admin: false, permissions });
  } catch (err) {
    console.error('[ROLES] create:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/roles/:id — update name/description/permissions. The built-in Admin
// (super) role is locked to prevent anyone editing themselves out of access.
router.put('/:id', requireSection('roles'), async (req, res) => {
  try {
    const existing = await db.prepare('SELECT * FROM roles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.is_admin) return res.status(400).json({ error: 'The built-in Admin role cannot be modified' });

    const name = (req.body.name || existing.name).trim();
    const description = (req.body.description ?? existing.description) || null;
    const permissions = cleanPermissions(req.body.permissions);
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const dupe = await db.prepare('SELECT id FROM roles WHERE name = ? AND id <> ?').get(name, req.params.id);
    if (dupe) return res.status(409).json({ error: 'A role with that name already exists' });

    await db.prepare('UPDATE roles SET name=?, description=?, permissions=? WHERE id=?')
      .run(name, description, JSON.stringify(permissions), req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[ROLES] update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/roles/:id — blocked for the Admin role and any role still in use.
router.delete('/:id', requireSection('roles'), async (req, res) => {
  try {
    const existing = await db.prepare('SELECT id, is_admin FROM roles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Role not found' });
    if (existing.is_admin) return res.status(400).json({ error: 'The built-in Admin role cannot be deleted' });

    const inUse = await db.prepare('SELECT COUNT(*) AS c FROM users WHERE role_id = ?').get(req.params.id);
    if (inUse.c > 0) {
      return res.status(400).json({ error: `Role is assigned to ${inUse.c} user(s). Reassign them first.` });
    }

    await db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[ROLES] delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
