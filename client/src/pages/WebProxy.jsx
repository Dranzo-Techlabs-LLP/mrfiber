import React, { useState, useEffect } from 'react';
import { Globe, ArrowRight, ShieldAlert, Lock, RefreshCw, XCircle, Bookmark, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import api from '../api/client';

const SITES_KEY = 'mrfiber_tunnel_sites';

const loadSites = () => {
  try {
    const raw = localStorage.getItem(SITES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveSites = (sites) => {
  localStorage.setItem(SITES_KEY, JSON.stringify(sites));
};

export default function WebProxy() {
  const [vpnStatus, setVpnStatus] = useState({ connected: false });
  const [targetIp, setTargetIp] = useState('192.168.100.1');
  const [activeUrl, setActiveUrl] = useState('');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sites, setSites] = useState(loadSites);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState({ id: null, name: '', address: '' });

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await api.get('/vpn/status');
        setVpnStatus(res.data);
      } catch (e) {}
    };
    fetchStatus();
  }, []);

  const buildTunnelUrl = (raw) => {
    // Split off the hash fragment but KEEP it on the final URL — hash-routed
    // SPAs (Vue Router #/login, Angular #!/, etc.) read window.location.hash on
    // boot to decide which route to render. If we drop it the iframe boots on
    // the device's default route and the user's requested path never happens.
    //
    // The hash itself is never sent to the server (browser strips it before the
    // request), so proxy routing / path rewriting is unaffected — only the
    // iframe's internal client-side navigation cares about it.
    const trimmed = raw.trim();
    const hashIdx = trimmed.indexOf('#');
    const hash = hashIdx >= 0 ? trimmed.slice(hashIdx) : '';
    const body = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
    const cleaned = body.replace(/^https?:\/\//, '');
    const slash = cleaned.indexOf('/');
    const host = slash === -1 ? cleaned : cleaned.slice(0, slash);
    const path = slash === -1 ? '/' : (cleaned.slice(slash) || '/');
    return `/tunnel/${host}${path}${hash}`;
  };

  const navigate = (address) => {
    if (!vpnStatus.connected) {
      alert('VPN Tunnel is not connected! Web Proxy cannot resolve the target.');
      return;
    }
    setLoading(true);
    setActiveUrl(buildTunnelUrl(address));
    // Always increment the key so clicking Connect on the same URL still forces
    // a fresh iframe mount — otherwise React skips the re-render because state
    // didn't change, and the page never reloads.
    setIframeKey(k => k + 1);
  };

  const handleNavigate = (e) => {
    e.preventDefault();
    navigate(targetIp);
  };

  const handleFrameLoad = () => setLoading(false);

  const openNewSite = () => {
    setDraft({ id: null, name: '', address: targetIp });
    setEditorOpen(true);
  };

  const openEditSite = (site) => {
    setDraft({ id: site.id, name: site.name, address: site.address });
    setEditorOpen(true);
  };

  const saveDraft = () => {
    const name = draft.name.trim();
    const address = draft.address.trim();
    if (!name || !address) return;
    let next;
    if (draft.id == null) {
      next = [...sites, { id: Date.now(), name, address }];
    } else {
      next = sites.map((s) => (s.id === draft.id ? { ...s, name, address } : s));
    }
    setSites(next);
    saveSites(next);
    setEditorOpen(false);
  };

  const deleteSite = (id) => {
    const next = sites.filter((s) => s.id !== id);
    setSites(next);
    saveSites(next);
  };

  const pickSite = (site) => {
    setTargetIp(site.address);
    navigate(site.address);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 animate-in fade-in duration-500 flex flex-col h-[85vh]">

      {!vpnStatus.connected && (
        <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 p-4 rounded-xl flex items-center space-x-3 shrink-0">
          <ShieldAlert className="w-6 h-6 animate-pulse" />
          <p className="font-semibold">WARNING: VPN Tunnel inactive. Proxy frames will timeout or fail.</p>
        </div>
      )}

      {/* Browser Navbar */}
      <div className="glass rounded-xl p-4 flex flex-col sm:flex-row items-center space-y-4 sm:space-y-0 sm:space-x-4 border border-white/5 shrink-0">
        <div className="bg-black/30 p-2 rounded-lg text-primary hidden sm:block">
          <Globe className="w-5 h-5" />
        </div>
        <form onSubmit={handleNavigate} className="flex-1 flex w-full relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Lock className="w-4 h-4 text-green-500/70" />
          </div>
          <input
            type="text"
            value={targetIp}
            onChange={(e) => setTargetIp(e.target.value)}
            placeholder="Target Router IP (192.168.100.1) or host/path"
            className="w-full bg-black/40 border border-white/10 rounded-l-lg py-3 pl-10 pr-4 text-white font-mono focus:ring-2 focus:ring-primary focus:outline-none min-w-0"
          />
          <button type="submit" disabled={!vpnStatus.connected} className="bg-primary hover:bg-primary/90 text-white px-4 shrink-0 rounded-r-lg font-bold flex items-center justify-center border-y border-r border-primary disabled:opacity-50">
            <span className="hidden md:inline mr-2">Connect</span>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <button onClick={() => setActiveUrl('')} className="bg-black/30 hover:bg-red-500/20 text-white/50 w-full sm:w-auto hover:text-red-400 p-3 flex items-center justify-center rounded-lg border border-white/5 transition" title="Close Tunnel Frame">
          <span className="sm:hidden mr-2 tracking-widest uppercase text-xs font-bold">Close Tunnel</span>
          <XCircle className="w-5 h-5" />
        </button>
      </div>

      {/* Saved Sites */}
      <div className="glass rounded-xl p-3 border border-white/5 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2 text-white/70">
            <Bookmark className="w-4 h-4 text-primary" />
            <span className="text-xs uppercase tracking-widest font-semibold">Saved Sites</span>
          </div>
          <button onClick={openNewSite} className="text-xs flex items-center space-x-1 bg-primary/10 hover:bg-primary/20 text-primary px-3 py-1.5 rounded-lg border border-primary/30 transition">
            <Plus className="w-3.5 h-3.5" />
            <span>Add Site</span>
          </button>
        </div>

        {sites.length === 0 ? (
          <p className="text-white/30 text-xs font-mono px-1 py-2">No saved sites yet. Click &quot;Add Site&quot; to bookmark a target.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {sites.map((site) => (
              <div key={site.id} className="group flex items-stretch bg-black/40 border border-white/5 rounded-lg overflow-hidden hover:border-primary/40 transition">
                <button onClick={() => pickSite(site)} className="px-3 py-2 text-left hover:bg-primary/10 transition">
                  <div className="text-white text-sm font-semibold leading-tight">{site.name}</div>
                  <div className="text-white/40 text-[10px] font-mono leading-tight">{site.address}</div>
                </button>
                <button onClick={() => openEditSite(site)} className="px-2 border-l border-white/5 text-white/30 hover:text-primary hover:bg-black/60 transition" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => deleteSite(site.id)} className="px-2 border-l border-white/5 text-white/30 hover:text-red-400 hover:bg-black/60 transition" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Modal */}
      {editorOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditorOpen(false)}>
          <div className="glass rounded-2xl border border-white/10 p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm">{draft.id == null ? 'Add Site' : 'Edit Site'}</h3>
              <button onClick={() => setEditorOpen(false)} className="text-white/40 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-white/50 text-[10px] uppercase tracking-widest">Name</label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Mars OLT"
                  className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none"
                />
              </div>
              <div>
                <label className="text-white/50 text-[10px] uppercase tracking-widest">Address</label>
                <input
                  type="text"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  placeholder="192.168.0.100 or 192.168.0.100/#/login"
                  className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white font-mono focus:ring-2 focus:ring-primary focus:outline-none"
                />
                <p className="text-white/30 text-[10px] mt-1 font-mono">Formats: IP, IP:port, IP/path, IP:port/path</p>
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setEditorOpen(false)} className="px-4 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white text-sm">Cancel</button>
              <button onClick={saveDraft} className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-sm flex items-center space-x-1">
                <Check className="w-4 h-4" />
                <span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Browser Viewport Frame */}
      <div className="flex-1 glass rounded-2xl border border-white/5 overflow-hidden relative shadow-2xl flex flex-col">
        <div className="bg-black/80 text-center py-1 text-[10px] text-white/30 uppercase tracking-widest border-b border-white/5 relative z-10 shrink-0">
          Remote Equipment Node Wrapper
        </div>

        <div className="flex-1 bg-white relative">
          {loading && (
            <div className="absolute inset-0 bg-black/50 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
              <RefreshCw className="w-8 h-8 text-primary animate-spin mb-4" />
              <p className="text-white font-mono tracking-widest uppercase">Securing Web Tunnel Bridge...</p>
            </div>
          )}

          {activeUrl ? (
            <iframe
              key={iframeKey}
              src={activeUrl}
              onLoad={handleFrameLoad}
              className="w-full h-full border-none"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
              title="Tunnel View"
            />
          ) : (
            <div className="absolute inset-0 bg-[#0A0A0A] flex flex-col items-center justify-center text-white/10">
              <Globe className="w-24 h-24 mb-4" />
              <p className="font-mono uppercase tracking-[0.2em]">Awaiting Target Tunnel String</p>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
