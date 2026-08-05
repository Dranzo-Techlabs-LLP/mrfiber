const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const vpnManager = require('../services/vpnManager');

router.use(auth);

// GET /api/vpn/profiles
router.get('/profiles', async (req, res) => {
  try {
    const profiles = await db.prepare('SELECT id, name, server_address, username FROM vpn_profiles').all();
    res.json(profiles);
  } catch (err) {
    console.error('[VPN] Failed to list profiles:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Validates and normalises a profile name for use as a ppp peer filename.
// Allows letters, digits, dash and underscore only — no spaces, slashes, etc.
function sanitiseName(raw = '') {
  const clean = String(raw).trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
  if (!clean) throw new Error('Profile name must contain at least one letter or digit');
  return clean;
}

// POST /api/vpn/profiles
router.post('/profiles', async (req, res) => {
  let { name, server_address, username, password } = req.body;
  if (!name || !server_address || !username || !password) {
    return res.status(400).json({ error: 'All fields required' });
  }

  try {
    name = sanitiseName(name);
    const stmt = db.prepare('INSERT INTO vpn_profiles (name, server_address, username, password) VALUES (?, ?, ?, ?)');
    const info = await stmt.run(name, server_address, username, password);

    // Write peer file — error here is fatal: roll back the DB row so the
    // user sees a real error instead of a profile that silently never works.
    try {
      await vpnManager.writeProfileFile({ name, server_address, username, password });
    } catch (peerErr) {
      await db.prepare('DELETE FROM vpn_profiles WHERE id = ?').run(info.lastInsertRowid);
      return res.status(500).json({ error: `Saved to DB but failed to write peer file: ${peerErr.message}` });
    }

    res.json({ id: info.lastInsertRowid, name, server_address, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/vpn/profiles/:id
router.put('/profiles/:id', async (req, res) => {
  let { name, server_address, username, password } = req.body;
  try {
    const existing = await db.prepare('SELECT * FROM vpn_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    name = sanitiseName(name || existing.name);

    // If password is blank (user left the edit field empty), keep the stored one
    const finalPassword = (password && password.trim()) ? password : existing.password;

    // If name changed, remove the old peer file
    if (existing.name !== name) {
      await vpnManager.deleteProfileFile(existing.name);
    }

    const stmt = db.prepare('UPDATE vpn_profiles SET name=?, server_address=?, username=?, password=? WHERE id=?');
    await stmt.run(name, server_address, username, finalPassword, req.params.id);

    await vpnManager.writeProfileFile({ name, server_address, username, password: finalPassword });
    res.json({ success: true, id: req.params.id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vpn/profiles/:id
router.delete('/profiles/:id', async (req, res) => {
  try {
    const existing = await db.prepare('SELECT name FROM vpn_profiles WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    await db.prepare('DELETE FROM vpn_profiles WHERE id = ?').run(req.params.id);
    await vpnManager.deleteProfileFile(existing.name);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/vpn/status
router.get('/status', async (req, res) => {
  const status = await vpnManager.getVpnStatus();
  res.json(status);
});

// POST /api/vpn/connect
router.post('/connect', async (req, res) => {
  const { profileId, oltSubnet } = req.body;
  if (!profileId) return res.status(400).json({ error: 'profileId required' });

  try {
    const profile = await db.prepare('SELECT name FROM vpn_profiles WHERE id = ?').get(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    const result = await vpnManager.connectVpn(profile.name, oltSubnet || '192.168.100.0/24');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vpn/disconnect
router.post('/disconnect', async (req, res) => {
  const { profileId } = req.body;
  let profileName = 'Unknown';

  try {
    if (profileId) {
      const profile = await db.prepare('SELECT name FROM vpn_profiles WHERE id = ?').get(profileId);
      if (profile) profileName = profile.name;
    } else {
      const status = await vpnManager.getVpnStatus();
      if (status.activeProfile) profileName = status.activeProfile;
    }

    const result = await vpnManager.disconnectVpn(profileName);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
