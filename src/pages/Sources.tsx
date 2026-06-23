import { useState, useEffect } from 'react';
import { FolderGit2, Trash2, Tv, Link as LinkIcon, Loader2, AlertCircle, Edit3, RefreshCw, CheckCircle, X } from 'lucide-react';
import { API_URL } from '../config';

interface Source {
  id: string;
  name: string;
  type: string;
  url: string;
  channel_count: number;
  last_updated: string;
}

type ModalState = { type: 'rename' | 'xtream' | 'stalker' | null, sourceId: string | null, sourceName: string };

export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Action States
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);

  // Modal States
  const [modal, setModal] = useState<ModalState>({ type: null, sourceId: null, sourceName: '' });
  const [renameInput, setRenameInput] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');
  const [stalkerMac, setStalkerMac] = useState('');
  const [modalSubmitting, setModalSubmitting] = useState(false);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchSources = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sources`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data)) setSources(data);
    } catch (error: any) {
      setErrorMsg(error.message || "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSources(); }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?\nThis permanently removes all of its channels and Favorites.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API_URL}/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete source.");
      setSources(prev => prev.filter(s => s.id !== id));
      showToast('Playlist deleted successfully.');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const executeRefresh = async (sourceId: string, payload: any = {}) => {
    setRefreshingId(sourceId);
    setModal({ type: null, sourceId: null, sourceName: '' });
    try {
      const res = await fetch(`${API_URL}/api/sources/${sourceId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to refresh source.");
      showToast(`Refreshed successfully! Found ${data.count} channels.`);
      fetchSources(); // Re-sync UI with new timestamps/counts
    } catch (error: any) {
      showToast(`Refresh Failed: ${error.message}`, 'error');
    } finally {
      setRefreshingId(null);
      setModalSubmitting(false);
    }
  };

  const handleRefreshClick = (source: Source) => {
    if (source.type === 'Local Upload') {
      showToast("Local files cannot be refreshed. Please delete and re-upload.", "error");
      return;
    }
    if (source.type === 'M3U URL') {
      executeRefresh(source.id);
    } else if (source.type === 'Xtream API') {
      setXtreamUser(''); setXtreamPass('');
      setModal({ type: 'xtream', sourceId: source.id, sourceName: source.name });
    } else if (source.type === 'Stalker API') {
      setStalkerMac('');
      setModal({ type: 'stalker', sourceId: source.id, sourceName: source.name });
    }
  };

  const submitRename = async () => {
    if (!renameInput.trim() || !modal.sourceId) return;
    setModalSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/sources/${modal.sourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: renameInput.trim() })
      });
      if (!res.ok) throw new Error("Failed to rename.");
      setSources(prev => prev.map(s => s.id === modal.sourceId ? { ...s, name: renameInput.trim() } : s));
      showToast('Playlist renamed.');
      setModal({ type: null, sourceId: null, sourceName: '' });
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;

  if (errorMsg) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6 text-center">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-100 mb-2">Failed to load sources</h2>
        <p className="text-red-400 bg-red-950/30 p-4 rounded-lg border border-red-900/50 max-w-md break-words text-sm">
          {errorMsg}
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32 relative">
      
      <div className="flex items-center gap-3 mb-8">
        <FolderGit2 className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Manage Sources</h2>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed p-10">
          <FolderGit2 size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium text-slate-300 mb-2">No sources added yet.</p>
          <p className="text-sm text-center max-w-sm">Go to the "Add Source" page to import an M3U playlist.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sources.map((source) => (
            <div key={source.id} className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-700 shadow-sm">
              
              {/* Source Info */}
              <div className="flex-1 overflow-hidden">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-slate-100 text-lg truncate">{source.name}</h3>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-900/30 text-blue-400 border border-blue-800/50 shrink-0">
                    {source.type}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-3">
                  <LinkIcon size={14} className="shrink-0" />
                  <a href={source.url} target="_blank" rel="noreferrer" className="truncate hover:text-blue-400 transition-colors">
                    {source.url}
                  </a>
                </div>

                <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                  <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-md border border-slate-800">
                    <Tv size={14} className="text-slate-400" />
                    <span>{source.channel_count.toLocaleString()} Ch.</span>
                  </div>
                  <span>Updated: {new Date(source.last_updated).toLocaleString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 sm:self-stretch pt-3 sm:pt-0 border-t border-slate-800 sm:border-t-0 sm:border-l sm:pl-4 shrink-0 justify-end">
                {source.type !== 'Local Upload' && (
                  <button 
                    onClick={() => handleRefreshClick(source)}
                    disabled={refreshingId === source.id}
                    className="p-2.5 bg-blue-950/30 text-blue-400 hover:bg-blue-900 hover:text-blue-100 border border-blue-900/50 hover:border-blue-700 rounded-lg transition-colors disabled:opacity-50"
                    title="Refresh Playlist"
                  >
                    <RefreshCw size={18} className={refreshingId === source.id ? "animate-spin" : ""} />
                  </button>
                )}

                <button 
                  onClick={() => { setModal({ type: 'rename', sourceId: source.id, sourceName: source.name }); setRenameInput(source.name); }}
                  className="p-2.5 bg-slate-800/50 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
                  title="Rename Playlist"
                >
                  <Edit3 size={18} />
                </button>

                <button 
                  onClick={() => handleDelete(source.id, source.name)}
                  disabled={deletingId === source.id}
                  className="p-2.5 bg-red-950/30 text-red-400 hover:bg-red-900 hover:text-red-100 border border-red-900/50 hover:border-red-700 rounded-lg transition-colors disabled:opacity-50"
                  title="Delete Playlist"
                >
                  {deletingId === source.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                </button>
              </div>

            </div>
          ))}
        </div>
      )}

      {/* DYNAMIC MODALS OVERLAY */}
      {modal.type && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                {modal.type === 'rename' ? <Edit3 size={18} className="text-blue-400"/> : <RefreshCw size={18} className="text-blue-400"/>}
                {modal.type === 'rename' ? 'Rename Playlist' : 'Refresh Credentials'}
              </h3>
              <button onClick={() => setModal({ type: null, sourceId: null, sourceName: '' })} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-400 mb-2">
                Target: <span className="font-bold text-slate-200">{modal.sourceName}</span>
              </p>

              {modal.type === 'rename' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">New Name</label>
                  <input type="text" value={renameInput} onChange={e => setRenameInput(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors" placeholder="Enter new name..." autoFocus />
                </div>
              )}

              {modal.type === 'xtream' && (
                <>
                  <p className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">Security Note: We do not save Xtream passwords in the database. You must provide them to refresh.</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Username</label>
                    <input type="text" value={xtreamUser} onChange={e => setXtreamUser(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="Username" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
                    <input type="password" value={xtreamPass} onChange={e => setXtreamPass(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="Password" />
                  </div>
                </>
              )}

              {modal.type === 'stalker' && (
                <>
                  <p className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">Security Note: We do not save MAC Addresses in the database. You must provide it to refresh.</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">MAC Address</label>
                    <input type="text" value={stalkerMac} onChange={e => setStalkerMac(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="00:1A:79:..." />
                  </div>
                </>
              )}

              <button 
                onClick={() => {
                  if (modal.type === 'rename') submitRename();
                  else if (modal.type === 'xtream') executeRefresh(modal.sourceId!, { username: xtreamUser, password: xtreamPass });
                  else if (modal.type === 'stalker') executeRefresh(modal.sourceId!, { macAddress: stalkerMac });
                }}
                disabled={modalSubmitting}
                className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                {modalSubmitting && <Loader2 size={18} className="animate-spin" />}
                {modal.type === 'rename' ? 'Save Name' : 'Refresh Channels'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 text-white px-6 py-3 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center gap-2 font-medium animate-in slide-in-from-bottom-5 fade-in z-[100] border ${toast.type === 'error' ? 'bg-red-900/95 border-red-700' : 'bg-slate-800/95 border-slate-700'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} className="text-green-400 shrink-0" /> : <AlertCircle size={18} className="text-red-400 shrink-0" />}
          <span className="truncate max-w-[250px] text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}