const express = require('express');
const router = express.Router();
const db = require('../db');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const { getUserAccess } = require('../middleware/permissions');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Disabled accounts can authenticate their password but are refused entry.
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    const isValid = bcrypt.compareSync(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const access = await getUserAccess(user.id);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: access.role },
      process.env.JWT_SECRET || 'fallback_secret',
      { expiresIn: '24h' }
    );

    res.json({
      token,
      username: user.username,
      role: access.role,
      isAdmin: access.isAdmin,
      sections: access.sections,
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/auth/me — current user's identity + fresh access (role/sections).
// Lets the UI refresh permissions without a re-login after a role change.
router.get('/me', auth, async (req, res) => {
  try {
    const access = await getUserAccess(req.userId);
    res.json({ username: req.username, ...access });
  } catch (err) {
    console.error('[AUTH] /me error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
