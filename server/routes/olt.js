const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../middleware/auth');
const TelnetClient = require('../services/telnetClient');

router.use(auth);

// GET /api/olt/configs
router.get('/configs', async (req, res) => {
  try {
    const configs = await db.prepare('SELECT id, name, ip_address, telnet_port, username FROM olt_configs').all();
    res.json(configs);
  } catch (err) {
    console.error('[OLT] Failed to list configs:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/olt/configs
router.post('/configs', async (req, res) => {
  const { name, ip_address, telnet_port, username, password } = req.body;
  try {
    const stmt = db.prepare('INSERT INTO olt_configs (name, ip_address, telnet_port, username, password) VALUES (?, ?, ?, ?, ?)');
    const info = await stmt.run(name, ip_address, telnet_port || 23, username, password);
    res.json({ id: info.lastInsertRowid, name, ip_address });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/olt/configs/:id
router.delete('/configs/:id', async (req, res) => {
  try {
    await db.prepare('DELETE FROM olt_configs WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/olt/configs/:id
router.put('/configs/:id', async (req, res) => {
  const { name, ip_address, telnet_port, username, password } = req.body;
  try {
    const existing = await db.prepare('SELECT id FROM olt_configs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Config not found' });

    const stmt = db.prepare('UPDATE olt_configs SET name=?, ip_address=?, telnet_port=?, username=?, password=? WHERE id=?');
    await stmt.run(name, ip_address, telnet_port || 23, username, password, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/olt/command
router.post('/command', async (req, res) => {
  const { oltConfigId, action, region, ont, vlan, sno, deviceType, ontName, delPort, confirmRemove } = req.body;

  if (!oltConfigId || !action) {
    return res.status(400).json({ error: 'oltConfigId and action required' });
  }

  // Safety check for remove
  if (action === 'remove_ont' && confirmRemove !== true) {
    return res.status(403).json({ error: 'explicit confirmRemove required to delete ONT' });
  }

  let config;
  try {
    config = await db.prepare('SELECT * FROM olt_configs WHERE id = ?').get(oltConfigId);
  } catch (dbErr) {
    console.error('[OLT] DB lookup failed:', dbErr.message);
    return res.status(500).json({ error: 'Database error' });
  }
  if (!config) return res.status(404).json({ error: 'OLT Config not found' });

  const isDev = process.env.NODE_ENV !== 'production';

  // Mock for Dev environment without real OLT
  if (isDev && !process.env.FORCE_TELNET_LOCAL) {
     return res.json({
       success: true,
       action,
       rawResponse: `[Dev Mock Mode] Response from OLT Simulator for action: ${action}\
Execution successfully simulated.\
#`,
       timestamp: new Date().toISOString()
     });
  }

  const client = new TelnetClient(config.ip_address, config.telnet_port);
  
  try {
    await client.connect();
    await client.login(config.username, config.password);
    
    let rawResponse = '';
    
    if (action.startsWith('monitor_')) {
       let command = '';
       if (action === 'monitor_optical_info') command = `show ont optical-info interface gpon ${region}`;
       else if (action === 'monitor_find_list') command = `show ont-find list interface gpon ${region}`;
       else if (action === 'monitor_brief') command = `show ont brief interface gpon ${region}`;
       else if (action === 'monitor_mac_table') command = `show mac-address-table`;
       
       rawResponse = await client.sendCommand(command);
    } 
    else if (action === 'configure_ont') {
       if (!region || !sno || !ont || !vlan || !ontName || !deviceType) {
           throw new Error('Missing fields for configuration');
       }
       
       const isMulti = ['c40-210', 'c30-423', 'c30-214', 'c30-420'].includes(deviceType);
       const isSingle = ['c40-100', 'c30-401'].includes(deviceType);
       
       if (!isMulti && !isSingle) throw new Error(`Unknown device type: ${deviceType}`);

       let commands = [
           'enable',
           'configure terminal',
           'deploy profile line',
           `delete aim ${vlan}`,
           `aim ${vlan}`,
           `device type ${deviceType}`,
           'tcont 1 profile dba 1',
           `gemport 1 tcont 1 vlan-profile ${vlan}`
       ];

       if (isMulti) {
           commands.push(`gemport 2 tcont 1 vlan-profile ${vlan}`);
           commands.push(`mapping 1 vlan ${vlan} gemport 1`);
           commands.push(`mapping 2 vlan 1831 gemport 2`);
       } else {
           commands.push(`mapping 1 vlan ${vlan} gemport 1`);
       }

       commands = commands.concat([
           'active',
           'exit',
           'exit',
           'deploy profile rule',
           `aim ${ont}`, // e.g. "0/1/"
           `permit sn s ${sno} line ${vlan} default line ${vlan}`,
           'active',
           'exit',
           'exit',
           'exit',
           'copy running-config startup-config',
           'y'
       ]);
       
       rawResponse = await client.executeMacro(commands);
       await new Promise(r => setTimeout(r, 5000)); // Sleep 5s after configure copy
    }
    else if (action === 'remove_ont') {
       if (!delPort) throw new Error('delPort missing');
       let commands = [
           'enable',
           'configure terminal',
           'deploy profile rule',
           `delete aim ${delPort}`,
           'y'
       ];
       rawResponse = await client.executeMacro(commands);
    }
    else {
       throw new Error('Unknown action pattern');
    }

    await client.disconnect();

    res.json({
      success: true,
      action,
      rawResponse,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    client.disconnect();
    res.status(500).json({ error: `Telnet error: ${error.message}` });
  }
});

module.exports = router;
