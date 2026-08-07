import React, { useState, useEffect } from 'react';
import { UserCog, Plus, Pencil, Trash2, X, Check, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../api/client';

const emptyDraft = { id: null, username: '', password: '', full_name: '', email: '', role_id: '', status: 'active' };

export default function Users() {
  const [list, setList] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [u, r] = await Promise.all([api.get('/users'), api.get('/roles')]);
      setList(u.data);
      setRoles(r.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setDraft({ ...emptyDraft, role_id: roles.find((r) => !r.is_admin)?.id || roles[0]?.id || '' });
    setFormError(''); setEditorOpen(true);
  };
  const openEdit = (u) => {
    setDraft({ id: u.id, username: u.username, password: '', full_name: u.full_name || '', email: u.email || '', role_id: u.role_id || '', status: u.status || 'active' });
    setFormError(''); setEditorOpen(true);
  };

  const save = async () => {
    if (!draft.username.trim()) { setFormError('Username is required'); return; }
    if (draft.id == null && !draft.password) { setFormError('Password is required for a new user'); return; }
    setSaving(true); setFormError('');
    const payload = {
      username: draft.username.trim(), full_name: draft.full_name, email: draft.email,
      role_id: draft.role_id || null, status: draft.status,
    };
    if (draft.password) payload.password = draft.password;
    try {
      if (draft.id == null) await api.post('/users', payload);
      else await api.put(`/users/${draft.id}`, payload);
      setEditorOpen(false);
      await load();
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (u) => {
    if (!window.confirm(`Delete user "${u.username}"?`)) return;
    try { await api.delete(`/users/${u.id}`); await load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed to delete'); }
  };

  return (
    <div className="max-w-6xl mx-auto w-full h-full flex flex-col gap-4 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-primary/10 p-2.5 rounded-xl text-primary"><UserCog className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Users</h1>
            <p className="text-muted text-sm">{list.length} account{list.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-primary hover:bg-primary/90 text-white font-bold px-4 py-2.5 rounded-xl flex items-center justify-center space-x-2 shrink-0">
          <Plus className="w-4 h-4" /><span>Add User</span>
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-sm shrink-0">{error}</div>}

      <div className="glass rounded-2xl border border-white/5 flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 uppercase text-[11px] tracking-wider border-b border-white/5 bg-card sticky top-0 z-10">
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Full name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/40"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading…</td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-white/30 font-mono">No users yet.</td></tr>
              ) : list.map((u) => (
                <tr key={u.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-4 py-3 text-white font-medium flex items-center gap-2">{u.username}{u.is_admin && <ShieldCheck className="w-3.5 h-3.5 text-primary" title="Admin" />}</td>
                  <td className="px-4 py-3 text-white/70">{u.full_name || '—'}</td>
                  <td className="px-4 py-3 text-white/70">{u.email || '—'}</td>
                  <td className="px-4 py-3"><span className="text-[11px] px-2 py-1 rounded-full border border-primary/30 bg-primary/10 text-primary">{u.role || '—'}</span></td>
                  <td className="px-4 py-3"><span className={`text-[11px] px-2 py-1 rounded-full border capitalize ${u.status === 'active' ? 'bg-green-500/15 text-green-400 border-green-500/30' : 'bg-white/10 text-white/50 border-white/20'}`}>{u.status}</span></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(u)} className="p-2 rounded-lg text-white/40 hover:text-primary hover:bg-white/5" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(u)} className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-white/5" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditorOpen(false)}>
          <div className="glass rounded-2xl border border-white/10 p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm">{draft.id == null ? 'Add User' : 'Edit User'}</h3>
              <button onClick={() => setEditorOpen(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-2.5 rounded-lg text-sm">{formError}</div>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <UField label="Username *" value={draft.username} onChange={(v) => setDraft({ ...draft, username: v })} />
              <UField label={draft.id == null ? 'Password *' : 'Password (leave blank to keep)'} type="password" value={draft.password} onChange={(v) => setDraft({ ...draft, password: v })} />
              <UField label="Full name" value={draft.full_name} onChange={(v) => setDraft({ ...draft, full_name: v })} />
              <UField label="Email" value={draft.email} onChange={(v) => setDraft({ ...draft, email: v })} />
              <div>
                <label className="text-white/50 text-[10px] uppercase tracking-widest">Role</label>
                <select value={draft.role_id} onChange={(e) => setDraft({ ...draft, role_id: e.target.value })}
                  className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none">
                  <option value="" className="bg-[#0B0C10]">— none —</option>
                  {roles.map((r) => <option key={r.id} value={r.id} className="bg-[#0B0C10]">{r.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-white/50 text-[10px] uppercase tracking-widest">Status</label>
                <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}
                  className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none capitalize">
                  <option value="active" className="bg-[#0B0C10]">active</option>
                  <option value="disabled" className="bg-[#0B0C10]">disabled</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setEditorOpen(false)} className="px-4 py-2 rounded-lg border border-white/10 text-white/60 hover:text-white text-sm">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-white font-bold text-sm flex items-center space-x-1 disabled:opacity-50">
                {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}<span>Save</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UField({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="text-white/50 text-[10px] uppercase tracking-widest">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)} autoComplete="off"
        className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none" />
    </div>
  );
}
