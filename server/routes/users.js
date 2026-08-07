const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const auth = require('../middleware/auth');
const { requireSection } = require('../middleware/permissions');

// All user-management routes require login + the 'users' section privilege.
router.use(auth);
router.use(requireSection('users'));

// Count active users holding a super-admin role — used to block removing the
// last one (which would lock everyone out of user/role management).
async function countActiveAdmins() {
  const row = await db.prepare(
    `SELECT COUNT(*) AS c FROM users u JOIN roles r ON u.role_id = r.id
      WHERE r.is_admin = 1 AND u.status = 'active'`
  ).get();
  return row.c;
}

async function roleIsAdmin(roleId) {
  if (!roleId) return false;
  const r = await db.prepare('SELECT is_admin FROM roles WHERE id = ?').get(roleId);
  return !!(r && r.is_admin);
}

// GET /api/users
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      `SELECT u.id, u.username, u.full_name, u.email, u.status, u.role_id,
              r.name AS role, r.is_admin, u.created_at
         FROM users u LEFT JOIN roles r ON u.role_id = r.id
        ORDER BY u.id ASC`
    ).all();
    res.json(rows.map((r) => ({ ...r, is_admin: !!r.is_admin })));
  } catch (err) {
    console.error('[USERS] list:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/users
router.post('/', async (req, res) => {
  const username = (req.body.username || '').trim();
  const { password, full_name, email, role_id, status } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const dupe = await db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (dupe) return res.status(409).json({ error: 'Username already exists' });

    const roleId = role_id || null;
    if (roleId) {
      const role = await db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
      if (!role) return res.status(400).json({ error: 'Invalid role' });
    }

    const hash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
    const info = await db.prepare(
      'INSERT INTO users (username, password_hash, full_name, email, role_id, status) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username, hash, full_name || null, email || null, roleId, status || 'active');
    res.json({ id: info.lastInsertRowid, username });
  } catch (err) {
    console.error('[USERS] create:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/users/:id
router.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { username, password, full_name, email, role_id, status } = req.body;
  try {
    const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    // Keep existing role if none supplied; validate if a new one is given.
    const roleId = (role_id === undefined || role_id === null || role_id === '') ? existing.role_id : role_id;
    if (roleId) {
      const role = await db.prepare('SELECT id FROM roles WHERE id = ?').get(roleId);
      if (!role) return res.status(400).json({ error: 'Invalid role' });
    }
    const newStatus = status || existing.status || 'active';

    // Guard: don't let the last active admin be demoted or disabled.
    if (await roleIsAdmin(existing.role_id) && existing.status === 'active') {
      const stillAdmin = await roleIsAdmin(roleId);
      if ((!stillAdmin || newStatus !== 'active') && (await countActiveAdmins()) <= 1) {
        return res.status(400).json({ error: 'Cannot remove the last active admin' });
      }
    }

    const newUsername = (username || existing.username).trim();
    if (newUsername !== existing.username) {
      const dupe = await db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(newUsername, id);
      if (dupe) return res.status(409).json({ error: 'Username already exists' });
    }

    if (password && String(password).trim()) {
      const hash = bcrypt.hashSync(password, bcrypt.genSaltSync(10));
      await db.prepare(
        'UPDATE users SET username=?, password_hash=?, full_name=?, email=?, role_id=?, status=? WHERE id=?'
      ).run(newUsername, hash, full_name || null, email || null, roleId, newStatus, id);
    } else {
      await db.prepare(
        'UPDATE users SET username=?, full_name=?, email=?, role_id=?, status=? WHERE id=?'
      ).run(newUsername, full_name || null, email || null, roleId, newStatus, id);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[USERS] update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (id === req.userId) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const existing = await db.prepare(
      'SELECT u.id, u.status, r.is_admin FROM users u LEFT JOIN roles r ON u.role_id = r.id WHERE u.id = ?'
    ).get(id);
    if (!existing) return res.status(404).json({ error: 'User not found' });

    if (existing.is_admin && existing.status === 'active' && (await countActiveAdmins()) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last active admin' });
    }

    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[USERS] delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
