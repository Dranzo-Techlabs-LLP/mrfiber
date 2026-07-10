import React, { useState, useEffect } from 'react';
import { Terminal, Activity, Trash2, ShieldAlert, Cpu, Save, Search, Settings, Edit, Table as TableIcon, FileText } from 'lucide-react';
import api from '../api/client';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs) {
  return twMerge(clsx(inputs));
}

function cleanOutput(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  s = s.replace(/\[\d+(?:;\d+)*[A-Za-z]/g, '');
  s = s.replace(/\[[KJH]/g, '');
  s = s.replace(/\r/g, '');
  s = s.split('\n').filter(l => !/^\s*[\w_-]+\(config[^)]*\)#\s*\.?\s*$/.test(l)).join('\n');
  s = s.replace(/^[^\n]*-->\s*when tested[^\n]*\n?/gmi, '');
  return s.trim();
}

function splitCells(line) {
  return line.trim().split(/\s{2,}|\t+/).filter(s => s.length > 0);
}

function isJunkLine(l) {
  const t = l.trim();
  if (!t) return true;
  if (/^[-=_]+$/.test(t)) return true;
  if (/^Total\s+entries/i.test(t)) return true;
  if (/^[\w_-]+(?:\([^)]*\))?#/.test(t)) return true;
  if (/^show\s+/i.test(t)) return true;
  if (/^---\s*more\s*---/i.test(t)) return true;
  if (/^press\s+/i.test(t)) return true;
  return false;
}

function looksLikeHeader(cells) {
  if (cells.length < 2) return false;
  let alphaCells = 0;
  for (const c of cells) {
    if (/^[A-Za-z][A-Za-z0-9 _\/\-().]*$/.test(c)) alphaCells++;
  }
  return alphaCells / cells.length >= 0.7;
}

function parseTable(raw) {
  const cleaned = cleanOutput(raw);
  const lines = cleaned.split('\n').map(l => l.replace(/\s+$/, ''));

  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isJunkLine(line)) continue;
    const headerCells = splitCells(line);
    if (!looksLikeHeader(headerCells)) continue;

    const dataRows = [];
    let blanks = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.trim()) { blanks++; if (blanks >= 2 && dataRows.length) break; continue; }
      if (isJunkLine(l)) { if (dataRows.length) break; else continue; }
      blanks = 0;
      const cells = splitCells(l);
      if (cells.length < 2) {
        if (dataRows.length) break;
        continue;
      }
      if (Math.abs(cells.length - headerCells.length) > 2) {
        if (dataRows.length) break;
        continue;
      }
      dataRows.push(cells);
    }

    const score = dataRows.length * Math.min(headerCells.length, 8);
    if (score > 0 && (!best || score > best.score)) {
      best = { headers: headerCells, rows: dataRows, score };
    }
  }

  if (!best) return null;

  const colCount = best.headers.length;
  best.rows = best.rows.map(r => {
    if (r.length === colCount) return r;
    if (r.length > colCount) {
      const head = r.slice(0, colCount - 1);
      head.push(r.slice(colCount - 1).join(' '));
      return head;
    }
    return [...r, ...Array(colCount - r.length).fill('')];
  });

  return { headers: best.headers, rows: best.rows };
}

function HistoryEntry({ entry }) {
  const table = parseTable(entry.rawResponse);
  const cleaned = cleanOutput(entry.rawResponse);
  const [view, setView] = useState(table ? 'table' : 'raw');
  const [filter, setFilter] = useState('');

  const filteredRows = table && filter
    ? table.rows.filter(r => r.some(c => String(c).toLowerCase().includes(filter.toLowerCase())))
    : table?.rows || [];

  return (
    <div className="bg-black/40 rounded p-3 text-xs md:text-sm font-mono relative">
      <div className="flex justify-between items-center mb-2 opacity-70 gap-2">
        <span className="break-all text-secondary">{entry.action}</span>
        <div className="flex items-center gap-2">
          {table && (
            <div className="flex items-center bg-black/40 rounded border border-white/10 overflow-hidden">
              <button
                onClick={() => setView('table')}
                className={cn('px-2 py-1 flex items-center gap-1 text-[10px]', view === 'table' ? 'bg-primary/30 text-primary' : 'text-white/40 hover:text-white')}
                title="Table view"
              >
                <TableIcon className="w-3 h-3" /> Table
              </button>
              <button
                onClick={() => setView('raw')}
                className={cn('px-2 py-1 flex items-center gap-1 text-[10px]', view === 'raw' ? 'bg-primary/30 text-primary' : 'text-white/40 hover:text-white')}
                title="Raw view"
              >
                <FileText className="w-3 h-3" /> Raw
              </button>
            </div>
          )}
          <span className="text-[10px] opacity-60">{new Date(entry.timestamp).toLocaleTimeString()}</span>
        </div>
      </div>

      {view === 'table' && table ? (
        <div className="space-y-2">
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={`Filter ${table.rows.length} rows...`}
            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
          />
          <div className="overflow-auto rounded border border-white/5 max-h-[420px]">
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-black/80 backdrop-blur">
                <tr>
                  {table.headers.map((h, i) => (
                    <th key={i} className="text-left px-2 py-1.5 font-semibold text-primary/90 border-b border-white/10 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => (
                  <tr key={ri} className="odd:bg-white/[0.02] hover:bg-primary/10 transition-colors">
                    {table.headers.map((_, ci) => {
                      const cell = row[ci] ?? '';
                      const lc = String(cell).toLowerCase();
                      const status = lc === 'online' || lc === 'working'
                        ? 'text-emerald-400'
                        : lc === 'offline' || lc === 'down' || lc === 'failed'
                          ? 'text-red-400'
                          : 'text-white/80';
                      return (
                        <td key={ci} className={cn('px-2 py-1 border-b border-white/5 whitespace-nowrap font-mono', status)}>
                          {String(cell)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[10px] text-white/40">
            {filter ? `${filteredRows.length} / ${table.rows.length}` : `${table.rows.length}`} rows
          </div>
        </div>
      ) : (
        <pre className="text-muted leading-relaxed whitespace-pre-wrap overflow-x-auto selection:bg-primary/30 max-h-[420px]">
          {cleaned || entry.rawResponse}
        </pre>
      )}
    </div>
  );
}

export default function OltMonitor() {
  const [configs, setConfigs] = useState([]);
  const [vpnStatus, setVpnStatus] = useState({ connected: false });
  const [selectedConfig, setSelectedConfig] = useState('');
  
  const [activeTab, setActiveTab] = useState('monitor');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newConfig, setNewConfig] = useState({ name: '', ip_address: '', telnet_port: 23, username: '', password: '' });

  // Monitor State
  const [monitorOption, setMonitorOption] = useState('monitor_optical_info');
  const [monitorRegion, setMonitorRegion] = useState('all');

  // Configure State
  const [confDeviceType, setConfDeviceType] = useState('c40-210');
  const [confRegion, setConfRegion] = useState('0/1/');
  const [confSno, setConfSno] = useState('');
  const [confVlan, setConfVlan] = useState('');
  const [confName, setConfName] = useState('');

  // Delete State
  const [delPort, setDelPort] = useState('');

  const fetchData = async () => {
    try {
      const [confRes, statusRes] = await Promise.all([
        api.get('/olt/configs'),
        api.get('/vpn/status')
      ]);
      setConfigs(confRes.data);
      setVpnStatus(statusRes.data);
      if (confRes.data.length > 0 && !selectedConfig) setSelectedConfig(confRes.data[0].id);
    } catch(e) {}
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleMonitor = async () => {
     setLoading(true);
     try {
         const res = await api.post('/olt/command', {
             oltConfigId: selectedConfig,
             action: monitorOption,
             region: monitorRegion
         });
         setHistory(prev => [res.data, ...prev].slice(0, 20));
     } catch(e) {
         alert(e.response?.data?.error || 'Command failed executing to OLT');
     }
     setLoading(false);
  };

  const handleConfigure = async (e) => {
      e.preventDefault();
      setLoading(true);
      try {
          const res = await api.post('/olt/command', {
              oltConfigId: selectedConfig,
              action: 'configure_ont',
              deviceType: confDeviceType,
              ont: confRegion,
              region: confRegion, // Often they tie back interchangeably based on the C# snippet logically
              sno: confSno,
              vlan: confVlan,
              ontName: confName
          });
          setHistory(prev => [res.data, ...prev].slice(0, 20));
      } catch(e) {
         alert(e.response?.data?.error || 'Configure command failed');
      }
      setLoading(false);
  };

  const handleDelete = async (e) => {
      e.preventDefault();
      if (!window.confirm(`DANGER: Remove ONT ${delPort}? This wipes its configuration entirely.`)) return;
      setLoading(true);
      try {
          const res = await api.post('/olt/command', {
              oltConfigId: selectedConfig,
              action: 'remove_ont',
              delPort: delPort,
              confirmRemove: true
          });
          setHistory(prev => [res.data, ...prev].slice(0, 20));
      } catch(e) {
         alert(e.response?.data?.error || 'Delete command failed');
      }
      setLoading(false);
  };

  const handleDeleteConfig = async () => {
     if(!window.confirm('Delete this OLT equipment registry?')) return;
     try {
         await api.delete(`/olt/configs/${selectedConfig}`);
         setSelectedConfig('');
         fetchData();
     } catch(e) {}
  };

  const openEditModal = () => {
     const c = configs.find(x => x.id == selectedConfig);
     if (c) {
         setEditingId(c.id);
         setNewConfig({ name: c.name, ip_address: c.ip_address, telnet_port: c.telnet_port, username: c.username, password: '' });
         setIsModalOpen(true);
     }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in duration-500">
      
      {!vpnStatus.connected && (
        <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 p-4 rounded-xl flex items-center space-x-3">
          <ShieldAlert className="w-6 h-6 animate-pulse" />
          <p className="font-semibold">WARNING: Secure Tunnel is disconnected. Commands might fail or timeout unless you are strictly on the local routing layer.</p>
        </div>
      )}

      {/* Main Container */}
      <div className="glass rounded-2xl border border-white/5 overflow-hidden flex flex-col md:flex-row">
         
         {/* Left Sidebar Menu */}
         <div className="w-full md:w-64 bg-black/40 border-r border-white/5 flex flex-col p-4 space-y-4">
             <div className="mb-4">
                 <div className="flex items-center justify-between mb-2 px-2">
                     <label className="block text-xs font-bold text-white/50 uppercase tracking-widest">Target Node</label>
                     <button onClick={() => { setEditingId(null); setNewConfig({ name: '', ip_address: '', telnet_port: 23, username: '', password: '' }); setIsModalOpen(true); }} className="text-[10px] bg-primary/20 hover:bg-primary/30 text-primary px-2 py-1 rounded font-bold shadow-sm">ADD +</button>
                 </div>
                 <div className="flex items-center space-x-2 w-full">
                     <select 
                        value={selectedConfig} onChange={e=>setSelectedConfig(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-sm text-white appearance-none focus:ring-2 focus:ring-primary focus:outline-none truncate"
                     >
                        <option value="" disabled>Select Equipment...</option>
                        {configs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                     </select>
                     {selectedConfig && (
                         <div className="flex flex-col space-y-1">
                             <button onClick={openEditModal} title="Edit Equipment" className="p-1.5 bg-white/5 hover:bg-primary/20 rounded text-white/50 hover:text-primary transition"><Edit className="w-3.5 h-3.5"/></button>
                             <button onClick={handleDeleteConfig} title="Delete Equipment" className="p-1.5 bg-white/5 hover:bg-red-500/20 rounded text-white/50 hover:text-red-400 transition"><Trash2 className="w-3.5 h-3.5"/></button>
                         </div>
                     )}
                 </div>
             </div>

             <nav className="space-y-1">
                 <button onClick={()=>setActiveTab('monitor')} className={cn("w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition font-medium", activeTab === 'monitor' ? 'bg-primary/20 text-primary' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
                     <Activity className="w-5 h-5"/><span>Monitor Dashboard</span>
                 </button>
                 <button onClick={()=>setActiveTab('configure')} className={cn("w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition font-medium", activeTab === 'configure' ? 'bg-primary/20 text-primary' : 'text-white/60 hover:bg-white/5 hover:text-white')}>
                     <Settings className="w-5 h-5"/><span>Configure new ONT</span>
                 </button>
                 <button onClick={()=>setActiveTab('delete')} className={cn("w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition font-medium text-red-400", activeTab === 'delete' ? 'bg-red-500/20 text-red-500' : 'hover:bg-red-500/10 hover:text-red-400')}>
                     <Trash2 className="w-5 h-5"/><span>Remove existing ONT</span>
                 </button>
             </nav>
         </div>

         {/* Content Area */}
         <div className="flex-1 flex flex-col md:flex-row h-auto min-h-[500px] md:h-[700px]">
            
            {/* Form Section */}
            <div className="w-full md:w-1/2 p-4 md:p-6 overflow-y-auto border-b md:border-b-0 md:border-r border-white/5">
                {activeTab === 'monitor' && (
                    <div className="space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-white mb-2">Monitor Settings</h2>
                            <p className="text-sm text-white/50 mb-6">Execute read-only commands for ONT interface analytics.</p>
                        </div>
                        <div>
                            <label className="block mb-2 text-sm text-muted">Command Type</label>
                            <select value={monitorOption} onChange={e=>setMonitorOption(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white">
                                <option value="monitor_optical_info">show ont optical-info interface</option>
                                <option value="monitor_find_list">show ont-find list interface</option>
                                <option value="monitor_brief">show ont brief interface</option>
                                <option value="monitor_mac_table">show mac-address-table</option>
                            </select>
                        </div>
                        {monitorOption !== 'monitor_mac_table' && (
                            <div>
                                <label className="block mb-2 text-sm text-muted">Region Interface (GPON)</label>
                                <input type="text" placeholder="all or 0/1" value={monitorRegion} onChange={e=>setMonitorRegion(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white" />
                            </div>
                        )}
                        <div className="pt-4">
                            <button disabled={loading || !selectedConfig} onClick={handleMonitor} className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3 rounded-xl shadow-lg shadow-primary/20 flex justify-center items-center space-x-2 disabled:opacity-50">
                                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Search className="w-5 h-5"/><span>Execute Monitor</span></>}
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'configure' && (
                    <form onSubmit={handleConfigure} className="space-y-5">
                       <div>
                            <h2 className="text-xl font-bold text-white mb-2">Configure new ONT</h2>
                            <p className="text-sm text-white/50 mb-6">Builds target interface and maps GEM ports onto VLAN dynamically.</p>
                        </div>
                        <div>
                           <label className="block mb-1 text-sm text-muted">Device Type</label>
                           <select required value={confDeviceType} onChange={e=>setConfDeviceType(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white">
                              <option value="c40-210">c40-210</option>
                              <option value="c30-423">c30-423</option>
                              <option value="c40-100">c40-100</option>
                              <option value="c30-214">c30-214</option>
                              <option value="c30-401">c30-401</option>
                              <option value="c30-420">c30-420</option>
                           </select>
                        </div>
                        <div>
                           <label className="block mb-1 text-sm text-muted">Interface Region (e.g. 0/1/)</label>
                           <input required type="text" placeholder="0/1/" value={confRegion} onChange={e=>setConfRegion(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white" />
                        </div>
                        <div>
                           <label className="block mb-1 text-sm text-muted">ONT Name / Alias</label>
                           <input required type="text" placeholder="Customer Name" value={confName} onChange={e=>setConfName(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white" />
                        </div>
                        <div>
                           <label className="block mb-1 text-sm text-muted">VLAN ID</label>
                           <input required type="text" placeholder="1831" value={confVlan} onChange={e=>setConfVlan(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white" />
                        </div>
                        <div>
                           <label className="block mb-1 text-sm text-muted">Serial Number (SNO)</label>
                           <input required type="text" placeholder="GNX..." value={confSno} onChange={e=>setConfSno(e.target.value)} className="w-full bg-black/40 border border-white/10 rounded-lg p-2.5 text-white uppercase" />
                        </div>
                         <div className="pt-2">
                            <button type="submit" disabled={loading || !selectedConfig} className="w-full bg-secondary hover:bg-secondary/90 text-background font-bold py-3 rounded-xl shadow-lg shadow-secondary/20 flex justify-center items-center space-x-2 disabled:opacity-50">
                                {loading ? <div className="w-5 h-5 border-2 border-background/30 border-t-background rounded-full animate-spin" /> : <><Save className="w-5 h-5"/><span>Deploy Configuration</span></>}
                            </button>
                        </div>
                    </form>
                )}

                {activeTab === 'delete' && (
                    <form onSubmit={handleDelete} className="space-y-6">
                        <div>
                            <h2 className="text-xl font-bold text-red-500 mb-2">Remove existing ONT</h2>
                            <p className="text-sm text-white/50 mb-6">Eradicate target port interface aim completely. Cannot be undone.</p>
                        </div>
                        <div>
                           <label className="block mb-2 text-sm text-red-300">Target Delete Port</label>
                           <input required type="text" placeholder="e.g. 0/1/1" value={delPort} onChange={e=>setDelPort(e.target.value)} className="w-full bg-red-500/5 hover:bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-white" />
                        </div>
                        <div className="pt-4">
                            <button type="submit" disabled={loading || !selectedConfig} className="w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl shadow-lg shadow-red-500/20 flex justify-center items-center space-x-2 disabled:opacity-50">
                                {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <><Trash2 className="w-5 h-5"/><span>Execute Deletion</span></>}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            {/* Results Output Section */}
            <div className="w-full md:w-1/2 p-4 md:p-6 flex flex-col h-[400px] min-h-[400px] md:h-full overflow-hidden bg-black/20">
               <div className="flex items-center justify-between mb-4">
                 <h3 className="font-bold text-white/80 flex items-center space-x-2"><Terminal className="w-4 h-4 text-muted" /><span>Execution Log</span></h3>
                 {loading && <div className="text-xs text-secondary animate-pulse">Intializing Sequence...</div>}
               </div>
               
               <div className="flex-1 overflow-auto space-y-4 rounded-xl border border-white/5 bg-black/30 p-2">
                 {history.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-white/20 font-mono space-y-2 opacity-50">
                       <Terminal className="w-10 h-10" />
                       <p className="text-sm">Awaiting Outputs...</p>
                    </div>
                 )}

                 {history.map((h, i) => <HistoryEntry key={i} entry={h} />)}
               </div>
            </div>

         </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="glass w-full max-w-lg p-8 rounded-2xl border border-white/10 shadow-2xl relative">
            <h2 className="text-2xl font-bold text-white mb-6">{editingId ? 'Update OLT Node' : 'Register OLT Node'}</h2>
            <form onSubmit={async(e)=>{
                e.preventDefault();
                if (editingId) {
                   await api.put(`/olt/configs/${editingId}`, newConfig);
                } else {
                   await api.post('/olt/configs', newConfig);
                }
                setIsModalOpen(false);
                setEditingId(null);
                setNewConfig({ name: '', ip_address: '', telnet_port: 23, username: '', password: '' });
                fetchData();
            }} className="space-y-4">
              <div><input required placeholder="Site Name (HQ_OLT)" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newConfig.name} onChange={e=>setNewConfig({...newConfig, name: e.target.value})} /></div>
              <div><input required placeholder="IP Address (192.168.100.2)" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white font-mono" value={newConfig.ip_address} onChange={e=>setNewConfig({...newConfig, ip_address: e.target.value})} /></div>
              <div><input required placeholder="Port (23)" type="number" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newConfig.telnet_port} onChange={e=>setNewConfig({...newConfig, telnet_port: e.target.value})} /></div>
              <div><input required placeholder="Telnet User" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newConfig.username} onChange={e=>setNewConfig({...newConfig, username: e.target.value})} /></div>
              <div><input required={!editingId} placeholder="Telnet Password" type="password" className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newConfig.password} onChange={e=>setNewConfig({...newConfig, password: e.target.value})} /></div>
              <div className="flex justify-end space-x-3 pt-6 border-t border-white/10">
                <button type="button" onClick={()=>{setIsModalOpen(false); setEditingId(null);}} className="px-5 py-2 rounded-lg text-white/50 hover:bg-white/5">Cancel</button>
                <button type="submit" className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-primary/20">Save Node</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

