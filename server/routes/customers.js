const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const { requireSection } = require('../middleware/permissions');

// All customer routes require login + the 'customers' section privilege.
router.use(auth);
router.use(requireSection('customers'));

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    const rows = await db.prepare(
      'SELECT id, name, tel_no, port, created_at FROM customers ORDER BY id DESC'
    ).all();
    res.json(rows);
  } catch (err) {
    console.error('[CUSTOMERS] list:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/customers
router.post('/', async (req, res) => {
  const { name, tel_no, port } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const info = await db.prepare(
      'INSERT INTO customers (name, tel_no, port) VALUES (?, ?, ?)'
    ).run(String(name).trim(), tel_no || null, port || null);
    res.json({ id: info.lastInsertRowid, name: String(name).trim() });
  } catch (err) {
    console.error('[CUSTOMERS] create:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/customers/:id
router.put('/:id', async (req, res) => {
  const { name, tel_no, port } = req.body;
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  try {
    const existing = await db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    await db.prepare(
      'UPDATE customers SET name=?, tel_no=?, port=? WHERE id=?'
    ).run(String(name).trim(), tel_no || null, port || null, req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[CUSTOMERS] update:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/customers/:id
router.delete('/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[CUSTOMERS] delete:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
