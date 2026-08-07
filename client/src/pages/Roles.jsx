import React, { useState, useEffect } from 'react';
import { KeyRound, Plus, Pencil, Trash2, X, Check, RefreshCw, ShieldCheck, Lock } from 'lucide-react';
import api from '../api/client';

const emptyDraft = { id: null, name: '', description: '', permissions: [] };

export default function Roles() {
  const [list, setList] = useState([]);
  const [sections, setSections] = useState([]);
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
      const [r, s] = await Promise.all([api.get('/roles'), api.get('/roles/sections')]);
      setList(r.data);
      setSections(s.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load roles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const labelFor = (key) => sections.find((s) => s.key === key)?.label || key;

  const openNew = () => { setDraft(emptyDraft); setFormError(''); setEditorOpen(true); };
  const openEdit = (r) => { setDraft({ id: r.id, name: r.name, description: r.description || '', permissions: [...(r.permissions || [])] }); setFormError(''); setEditorOpen(true); };

  const toggle = (key) => setDraft((d) => ({
    ...d,
    permissions: d.permissions.includes(key) ? d.permissions.filter((k) => k !== key) : [...d.permissions, key],
  }));

  const save = async () => {
    if (!draft.name.trim()) { setFormError('Role name is required'); return; }
    setSaving(true); setFormError('');
    const payload = { name: draft.name.trim(), description: draft.description, permissions: draft.permissions };
    try {
      if (draft.id == null) await api.post('/roles', payload);
      else await api.put(`/roles/${draft.id}`, payload);
      setEditorOpen(false);
      await load();
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete role "${r.name}"?`)) return;
    try { await api.delete(`/roles/${r.id}`); await load(); }
    catch (e) { alert(e.response?.data?.error || 'Failed to delete'); }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="bg-primary/10 p-2.5 rounded-xl text-primary"><KeyRound className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Roles &amp; Privileges</h1>
            <p className="text-muted text-sm">{list.length} role{list.length === 1 ? '' : 's'} · access is granted per section</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-primary hover:bg-primary/90 text-white font-bold px-4 py-2.5 rounded-xl flex items-center justify-center space-x-2 shrink-0">
          <Plus className="w-4 h-4" /><span>Add Role</span>
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-sm">{error}</div>}

      {loading ? (
        <div className="glass rounded-2xl border border-white/5 p-10 text-center text-white/40"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {list.map((r) => (
            <div key={r.id} className="glass rounded-2xl border border-white/5 p-5 flex flex-col">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-white font-bold text-lg">{r.name}</h3>
                    {r.is_admin && <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full"><ShieldCheck className="w-3 h-3" />Super</span>}
                  </div>
                  <p className="text-white/40 text-sm mt-0.5">{r.description || 'No description'}</p>
                </div>
                <div className="flex items-center gap-1">
                  {r.is_admin ? (
                    <span className="p-2 text-white/20" title="Built-in role — locked"><Lock className="w-4 h-4" /></span>
                  ) : (
                    <>
                      <button onClick={() => openEdit(r)} className="p-2 rounded-lg text-white/40 hover:text-primary hover:bg-white/5" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(r)} className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-white/5" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-4">
                {r.is_admin ? (
                  <span className="text-[11px] px-2 py-1 rounded-lg bg-primary/10 text-primary border border-primary/30">All sections</span>
                ) : (r.permissions || []).length === 0 ? (
                  <span className="text-[11px] text-white/30 font-mono">No sections</span>
                ) : (r.permissions || []).map((k) => (
                  <span key={k} className="text-[11px] px-2 py-1 rounded-lg bg-white/5 text-white/70 border border-white/10">{labelFor(k)}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditorOpen(false)}>
          <div className="glass rounded-2xl border border-white/10 p-6 w-full max-w-lg space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm">{draft.id == null ? 'Add Role' : 'Edit Role'}</h3>
              <button onClick={() => setEditorOpen(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-2.5 rounded-lg text-sm">{formError}</div>}
            <div>
              <label className="text-white/50 text-[10px] uppercase tracking-widest">Role name *</label>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-white/50 text-[10px] uppercase tracking-widest">Description</label>
              <input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none" />
            </div>
            <div>
              <label className="text-white/50 text-[10px] uppercase tracking-widest">Section access</label>
              <div className="grid grid-cols-2 gap-2 mt-2">
                {sections.map((s) => {
                  const on = draft.permissions.includes(s.key);
                  return (
                    <button key={s.key} type="button" onClick={() => toggle(s.key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition text-left ${on ? 'bg-primary/15 border-primary/40 text-white' : 'bg-black/30 border-white/10 text-white/50 hover:border-white/20'}`}>
                      <span className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${on ? 'bg-primary text-white' : 'border border-white/20'}`}>{on && <Check className="w-3 h-3" />}</span>
                      {s.label}
                    </button>
                  );
                })}
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
