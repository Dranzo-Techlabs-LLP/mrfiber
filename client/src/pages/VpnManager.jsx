import React, { useState, useEffect } from 'react';
import { Shield, Plus, Power, Trash2, Server, KeyRound, Network, Edit } from 'lucide-react';
import api from '../api/client';

export default function VpnManager() {
  const [profiles, setProfiles] = useState([]);
  const [status, setStatus] = useState({ connected: false, interface: null, assignedIp: null });
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState('');
  const [oltSubnet, setOltSubnet] = useState('192.168.100.0/24');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newProfile, setNewProfile] = useState({ name: '', server_address: '', username: '', password: '' });

  const fetchData = async () => {
    try {
      const [profilesRes, statusRes] = await Promise.all([
        api.get('/vpn/profiles'),
        api.get('/vpn/status')
      ]);
      const list = profilesRes.data;
      setProfiles(list);
      setStatus(statusRes.data);
      // Only set a default selection if nothing is selected yet, or if the
      // currently-selected profile was deleted (no longer in the list).
      setSelectedProfileId(prev => {
        if (prev && list.some(p => p.id == prev)) return prev;
        return list.length > 0 ? list[0].id : '';
      });
    } catch(e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(async () => {
      try {
        const statusRes = await api.get('/vpn/status');
        setStatus(statusRes.data);
      } catch(e) {}
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleConnect = async () => {
    setActionLoading(true);
    try {
      await api.post('/vpn/connect', { profileId: selectedProfileId, oltSubnet });
      await fetchData();
    } catch(e) {
      alert(e.response?.data?.error || 'Connection failed');
    }
    setActionLoading(false);
  };

  const handleDisconnect = async () => {
    setActionLoading(true);
    try {
      await api.post('/vpn/disconnect', { profileId: selectedProfileId });
      await fetchData();
    } catch(e) {
      alert(e.response?.data?.error || 'Disconnection failed');
    }
    setActionLoading(false);
  };

  const handleDelete = async (id) => {
    if(!window.confirm('Delete this VPN profile?')) return;
    try {
      await api.delete(`/vpn/profiles/${id}`);
      fetchData();
    } catch(e) { /* handle */ }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/vpn/profiles/${editingId}`, newProfile);
      } else {
        // Auto-select the new profile so the user can connect immediately
        const res = await api.post('/vpn/profiles', newProfile);
        if (res.data?.id) setSelectedProfileId(res.data.id);
      }
      setIsModalOpen(false);
      setEditingId(null);
      setNewProfile({ name: '', server_address: '', username: '', password: '' });
      fetchData();
    } catch(e) {
      alert(e.response?.data?.error || 'Failed to save profile');
    }
  };

  const openEditModal = (p) => {
      setEditingId(p.id);
      setNewProfile({ name: p.name, server_address: p.server_address, username: p.username, password: '' });
      setIsModalOpen(true);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in fade-in zoom-in-95 duration-500">
      
      {/* Top Banner Status */}
      <div className="glass rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between border-t border-white/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 to-transparent"></div>
        <div className="relative z-10 flex items-center space-x-6">
          <div className="relative">
            <div className="w-16 h-16 rounded-full bg-black/40 flex items-center justify-center border border-white/10">
              <Shield className={`w-8 h-8 ${status.connected ? 'text-green-500 drop-shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 'text-red-500'}`} />
            </div>
            {status.connected && (
               <div className="absolute top-0 right-0 w-4 h-4 bg-green-500 rounded-full border-2 border-card animate-ping"></div>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">System Tunnel</h2>
            <div className="flex items-center space-x-3 mt-1">
              {status.connected ? (
                <>
                  <span className="bg-green-500/20 text-green-400 text-xs font-bold px-2 py-1 rounded border border-green-500/30">CONNECTED</span>
                  <span className="text-sm font-mono text-white/60">{status.interface} • {status.assignedIp}</span>
                </>
              ) : (
                <span className="bg-red-500/20 text-red-400 text-xs font-bold px-2 py-1 rounded border border-red-500/30">DISCONNECTED</span>
              )}
            </div>
          </div>
        </div>

        <div className="relative z-10 flex mt-6 md:mt-0 flex-col sm:flex-row w-full md:w-auto items-stretch sm:items-center space-y-4 sm:space-y-0 sm:space-x-4 bg-black/20 p-4 rounded-xl border border-white/5">
            <select 
              className="w-full sm:w-auto bg-black/40 border border-white/10 text-white rounded-lg px-4 py-2 focus:ring-2 focus:ring-primary focus:outline-none"
              value={selectedProfileId}
              onChange={e=>setSelectedProfileId(e.target.value)}
            >
               <option value="" disabled>Select Profile...</option>
               {profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            
            <input 
              type="text" 
              placeholder="192.168.100.0/24"
              value={oltSubnet}
              onChange={e=>setOltSubnet(e.target.value)}
              className="w-full sm:w-40 bg-black/40 border border-white/10 text-white rounded-lg px-4 py-2 text-sm focus:ring-primary"
              title="Target OLT Subnet Route"
            />

            {status.connected ? (
              <button 
                onClick={handleDisconnect} disabled={actionLoading}
                className="w-full sm:w-auto bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-red-500/20 transition flex justify-center items-center space-x-2 disabled:opacity-50"
              >
                {actionLoading ? <span className="animate-pulse">Killing...</span> : <><Power className="w-4 h-4"/><span>Disconnect</span></>}
              </button>
            ) : (
              <button 
                onClick={handleConnect} disabled={actionLoading || !selectedProfileId}
                className="w-full sm:w-auto bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-primary/20 transition flex justify-center items-center space-x-2 disabled:opacity-50"
              >
                {actionLoading ? <span className="animate-pulse">Firing up...</span> : <><Power className="w-4 h-4"/><span>Connect</span></>}
              </button>
            )}
        </div>
      </div>

      {/* Profiles Database */}
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-white flex items-center space-x-2"><Network className="w-5 h-5 text-secondary" /> <span>VPN Credentials Registry</span></h3>
        <button onClick={() => { setEditingId(null); setNewProfile({ name: '', server_address: '', username: '', password: '' }); setIsModalOpen(true); }} className="bg-secondary/10 hover:bg-secondary/20 text-secondary border border-secondary/20 transition px-4 py-2 rounded-lg text-sm font-semibold flex items-center space-x-1">
          <Plus className="w-4 h-4" /> <span>Add Node</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {profiles.map(profile => (
          <div key={profile.id} className="glass p-6 rounded-xl hover:bg-white/5 transition border border-white/5 group relative overflow-hidden">
             {selectedProfileId == profile.id && <div className="absolute top-0 left-0 w-1 h-full bg-primary" />}
             <div className="flex justify-between items-start mb-4">
                <div className="flex items-center space-x-3">
                   <div className="p-2 bg-black/30 rounded-lg"><Server className="w-5 h-5 text-primary" /></div>
                   <h4 className="font-bold text-white text-lg">{profile.name}</h4>
                </div>
                 <div className="flex space-x-3">
                   <button onClick={() => openEditModal(profile)} className="text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition">
                     <Edit className="w-4 h-4" />
                   </button>
                   <button onClick={() => handleDelete(profile.id)} className="text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition">
                     <Trash2 className="w-4 h-4" />
                   </button>
                 </div>
              </div>
             <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between font-mono bg-black/20 p-2 rounded">
                  <span className="text-white/40">Server IP</span>
                  <span className="text-white">{profile.server_address}</span>
                </div>
                <div className="flex items-center justify-between font-mono bg-black/20 p-2 rounded">
                  <span className="text-white/40">Username</span>
                  <span className="text-white">{profile.username}</span>
                </div>
             </div>
          </div>
        ))}
        {profiles.length === 0 && (
          <div className="col-span-full py-12 text-center text-white/30 border border-dashed border-white/10 rounded-xl">
            No profiles registered. Create one to get started.
          </div>
        )}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="glass w-full max-w-lg p-8 rounded-2xl border border-white/10 shadow-2xl relative animate-in zoom-in-95 duration-200">
            <h2 className="text-2xl font-bold text-white mb-6">{editingId ? 'Update VPN Profile' : 'Register VPN Node'}</h2>
            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div><label className="text-xs font-bold text-muted uppercase">Profile Name Identifier</label><input required className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newProfile.name} onChange={e=>setNewProfile({...newProfile, name: e.target.value})} placeholder="HQ_GATEWAY" /></div>
              <div><label className="text-xs font-bold text-muted uppercase">PPTP Server Address</label><input required className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg p-3 text-white font-mono" value={newProfile.server_address} onChange={e=>setNewProfile({...newProfile, server_address: e.target.value})} placeholder="117.221.64.248" /></div>
              <div><label className="text-xs font-bold text-muted uppercase">Tunnel Username</label><input required className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newProfile.username} onChange={e=>setNewProfile({...newProfile, username: e.target.value})} /></div>
              <div><label className="text-xs font-bold text-muted uppercase">Tunnel Password</label><input required={!editingId} type="password" placeholder={editingId ? '(Leave blank to keep unchanged)' : ''} className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg p-3 text-white" value={newProfile.password} onChange={e=>setNewProfile({...newProfile, password: e.target.value})} /></div>
              <div className="flex justify-end space-x-3 pt-6 mt-6 border-t border-white/10">
                <button type="button" onClick={()=>{setIsModalOpen(false); setEditingId(null);}} className="px-5 py-2 rounded-lg text-white/50 hover:bg-white/5">Cancel</button>
                <button type="submit" className="bg-primary hover:bg-primary/90 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-primary/20">Save Profile</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  )
}
