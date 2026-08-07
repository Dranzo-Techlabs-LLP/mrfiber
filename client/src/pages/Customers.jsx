import React, { useState, useEffect } from 'react';
import { Users, Plus, Pencil, Trash2, X, Check, Search, RefreshCw } from 'lucide-react';
import api from '../api/client';

const emptyDraft = { id: null, name: '', tel_no: '', port: '' };

export default function Customers() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/customers');
      setList(res.data);
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setDraft(emptyDraft); setFormError(''); setEditorOpen(true); };
  const openEdit = (c) => { setDraft({ ...emptyDraft, ...c }); setFormError(''); setEditorOpen(true); };

  const save = async () => {
    if (!draft.name.trim()) { setFormError('Name is required'); return; }
    setSaving(true);
    setFormError('');
    const payload = { name: draft.name.trim(), tel_no: draft.tel_no, port: draft.port };
    try {
      if (draft.id == null) await api.post('/customers', payload);
      else await api.put(`/customers/${draft.id}`, payload);
      setEditorOpen(false);
      await load();
    } catch (e) {
      setFormError(e.response?.data?.error || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c) => {
    if (!window.confirm(`Delete customer "${c.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/customers/${c.id}`);
      await load();
    } catch (e) {
      alert(e.response?.data?.error || 'Failed to delete');
    }
  };

  const filtered = list.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [c.name, c.tel_no, c.port].filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
  });

  return (
    <div className="max-w-5xl mx-auto w-full h-full flex flex-col gap-4 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-primary/10 p-2.5 rounded-xl text-primary"><Users className="w-6 h-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-white">Customers</h1>
            <p className="text-muted text-sm">{list.length} subscriber{list.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-primary hover:bg-primary/90 text-white font-bold px-4 py-2.5 rounded-xl flex items-center justify-center space-x-2 shrink-0">
          <Plus className="w-4 h-4" /><span>Add Customer</span>
        </button>
      </div>

      <div className="glass rounded-xl p-3 border border-white/5 flex items-center gap-2 shrink-0">
        <Search className="w-4 h-4 text-white/30 ml-1" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, tel no, port…"
          className="flex-1 bg-transparent text-white placeholder-white/30 focus:outline-none text-sm py-1" />
        <button onClick={load} title="Refresh" className="text-white/40 hover:text-primary p-1.5"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-3 rounded-xl text-sm shrink-0">{error}</div>}

      <div className="glass rounded-2xl border border-white/5 flex-1 min-h-0 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-white/40 uppercase text-[11px] tracking-wider border-b border-white/5 bg-card sticky top-0 z-10">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Tel No</th>
                <th className="px-4 py-3 font-semibold">Port</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-white/40"><RefreshCw className="w-5 h-5 animate-spin inline mr-2" />Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-10 text-center text-white/30 font-mono">{query ? 'No matches.' : 'No customers yet. Click “Add Customer”.'}</td></tr>
              ) : filtered.map((c) => (
                <tr key={c.id} className="border-b border-white/5 hover:bg-white/5 transition">
                  <td className="px-4 py-3 text-white font-medium">{c.name}</td>
                  <td className="px-4 py-3 text-white/70 font-mono">{c.tel_no || '—'}</td>
                  <td className="px-4 py-3 text-white/70 font-mono">{c.port || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(c)} className="p-2 rounded-lg text-white/40 hover:text-primary hover:bg-white/5" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => remove(c)} className="p-2 rounded-lg text-white/40 hover:text-red-400 hover:bg-white/5" title="Delete"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>

      {editorOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setEditorOpen(false)}>
          <div className="glass rounded-2xl border border-white/10 p-6 w-full max-w-md space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-bold uppercase tracking-widest text-sm">{draft.id == null ? 'Add Customer' : 'Edit Customer'}</h3>
              <button onClick={() => setEditorOpen(false)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            {formError && <div className="bg-red-500/10 border border-red-500/30 text-red-400 p-2.5 rounded-lg text-sm">{formError}</div>}
            <div className="space-y-3">
              <Field label="Name *" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
              <Field label="Tel No" value={draft.tel_no} onChange={(v) => setDraft({ ...draft, tel_no: v })} />
              <Field label="Port" value={draft.port} onChange={(v) => setDraft({ ...draft, port: v })} />
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

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="text-white/50 text-[10px] uppercase tracking-widest">{label}</label>
      <input type={type} value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 bg-black/40 border border-white/10 rounded-lg py-2 px-3 text-white focus:ring-2 focus:ring-primary focus:outline-none" />
    </div>
  );
}
