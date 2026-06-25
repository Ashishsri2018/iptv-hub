import { useState, useEffect, useRef } from 'react';
import { FolderGit2, Trash2, Tv, Link as LinkIcon, Loader2, AlertCircle, Edit3, RefreshCw, CheckCircle, X, Info } from 'lucide-react';
import { API_URL } from '../config';

// Updated interface to include the new metadata columns
interface Source {
  id: string;
  name: string;
  type: string;
  url: string;
  channel_count: number;
  last_updated: string;
  playlist_metadata?: string;
  account_info?: string;
}

type ModalState = { 
  type: 'rename' | 'xtream' | 'stalker' | 'info' | null, 
  sourceId: string | null, 
  sourceName: string,
  sourceObj?: Source | null // Passed for the Info view
};

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

  // MEMORY SAFETY REFS
  const toastTimer = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // CLEANUP ON UNMOUNT
  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  // SAFE PARSER HELPER
  const safeJson = async (res: Response) => {
    try { 
      return await res.json(); 
    } catch { 
      throw new Error('Invalid response format from server.'); 
    }
  };

  const fetchSources = async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();

    try {
      const res = await fetch(`${API_URL}/api/sources`, {
        signal: abortControllerRef.current.signal
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      
      const data = await safeJson(res);
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data)) setSources(data);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setErrorMsg(error.message || "Failed to load sources.");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { 
    fetchSources(); 
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"?\nThis permanently removes all of its channels and Favorites.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`${API_URL}/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await safeJson(res);
      if (data.error || !data.success) throw new Error(data.error || "Failed to delete source.");
      
      setSources(prev => prev.filter(s => s.id !== id));
      showToast('Playlist deleted successfully.');
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const executeRefresh = async (sourceId: string, payload: any = {}) => {
    setModalSubmitting(true);
    setRefreshingId(sourceId);
    try {
      const res = await fetch(`${API_URL}/api/sources/${sourceId}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      
      const data = await safeJson(res);
      if (data.error || !data.success) throw new Error(data.error || "Failed to refresh source.");
      
      showToast(`Refreshed successfully! Found ${data.count} channels.`);
      setModal({ type: null, sourceId: null, sourceName: '' }); 
      fetchSources(); 
    } catch (error: any) {
      showToast(`Refresh Failed: ${error.message}`, 'error');
    } finally {
      setRefreshingId(null);
      setModalSubmitting(false);
    }
  };

  const handleRefreshClick = (source: Source) => {
    const isLocalFile = source.type === 'Local Upload' || source.type === 'M3U File';
    if (isLocalFile) {
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
    const newName = renameInput.trim();
    if (!newName || newName === modal.sourceName || !modal.sourceId) {
      setModal({ type: null, sourceId: null, sourceName: '' });
      return;
    }
    
    setModalSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/sources/${modal.sourceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      
      const data = await safeJson(res);
      if (data.error || !data.success) throw new Error(data.error || "Failed to rename.");
      
      setSources(prev => prev.map(s => s.id === modal.sourceId ? { ...s, name: newName } : s));
      showToast('Playlist renamed.');
      setModal({ type: null, sourceId: null, sourceName: '' });
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  // URL CREDENTIAL MASKING UTILITY
  const maskUrlCredentials = (url: string) => {
    if (!url || !url.startsWith('http')) return url;
    try {
      const parsed = new URL(url);
      if (parsed.searchParams.has('username')) parsed.searchParams.set('username', '***');
      if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***');
      return parsed.toString();
    } catch {
      return url.replace(/(username|password)=[^&]+/ig, '$1=***');
    }
  };

  // SMART UI HELPER: Safely formats JSON and dynamically converts UNIX timestamps
  const formatJson = (str?: string) => {
    if (!str || str === '{}' || str.trim() === '') return null;
    try { 
      const parsed = JSON.parse(str);
      
      // Recursive function to find and convert timestamps
      const transformDates = (obj: any): any => {
        if (Array.isArray(obj)) return obj.map(transformDates);
        if (obj !== null && typeof obj === 'object') {
          const newObj: any = {};
          for (const key in obj) {
            const val = obj[key];
            const strVal = String(val);
            
            // Look for keys that usually contain dates/times
            const isDateKey = /(date|time|created|exp|updated|added)/i.test(key);
            // Check for 10-digit (seconds) or 13-digit (ms) Unix timestamps
            const isSeconds = /^[1-9]\d{9}$/.test(strVal);
            const isMillis = /^[1-9]\d{12}$/.test(strVal);
            
            if (isDateKey && (isSeconds || isMillis)) {
              const ms = isSeconds ? Number(val) * 1000 : Number(val);
              const date = new Date(ms);
              if (!isNaN(date.getTime())) {
                newObj[key] = `${val} (${date.toLocaleString()})`;
                continue;
              }
            }
            newObj[key] = transformDates(val);
          }
          return newObj;
        }
        return obj;
      };

      return JSON.stringify(transformDates(parsed), null, 2); 
    } catch { 
      return str; 
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

  // DYNAMIC MODAL SUBMIT BUTTON STATE
  let isSubmitDisabled = modalSubmitting;
  if (modal.type === 'rename') {
    isSubmitDisabled = isSubmitDisabled || !renameInput.trim() || renameInput.trim() === modal.sourceName;
  } else if (modal.type === 'xtream') {
    isSubmitDisabled = isSubmitDisabled || !xtreamUser.trim() || !xtreamPass.trim();
  } else if (modal.type === 'stalker') {
    isSubmitDisabled = isSubmitDisabled || !stalkerMac.trim();
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
          {sources.map((source) => {
            const isLocalFile = source.type === 'Local Upload' || source.type === 'M3U File';
            const isHttp = source.url && source.url.toLowerCase().startsWith('http');
            const maskedUrl = maskUrlCredentials(source.url);

            return (
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
                    {isHttp ? (
                      <a href={source.url} target="_blank" rel="noreferrer" className="truncate hover:text-blue-400 transition-colors" title={source.url}>
                        {maskedUrl}
                      </a>
                    ) : (
                      <span className="truncate" title={source.url}>{source.url || 'No URL provided'}</span>
                    )}
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
                  
                  {/* NEW INFO BUTTON */}
                  <button 
                    onClick={() => setModal({ type: 'info', sourceId: source.id, sourceName: source.name, sourceObj: source })}
                    className="p-2.5 bg-indigo-950/30 text-indigo-400 hover:bg-indigo-900 hover:text-indigo-100 border border-indigo-900/50 hover:border-indigo-700 rounded-lg transition-colors"
                    title="Playlist Details & Metadata"
                  >
                    <Info size={18} />
                  </button>

                  {!isLocalFile && (
                    <button 
                      onClick={() => handleRefreshClick(source)}
                      disabled={refreshingId === source.id}
                      className="p-2.5 bg-blue-950/30 text-blue-400 hover:bg-blue-900 hover:text-blue-100 border border-blue-900/50 hover:border-blue-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                    className="p-2.5 bg-red-950/30 text-red-400 hover:bg-red-900 hover:text-red-100 border border-red-900/50 hover:border-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Delete Playlist"
                  >
                    {deletingId === source.id ? <Loader2 size={18} className="animate-spin" /> : <Trash2 size={18} />}
                  </button>
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* DYNAMIC MODALS OVERLAY */}
      {modal.type && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className={`bg-slate-900 border border-slate-700 rounded-xl w-full ${modal.type === 'info' ? 'max-w-lg' : 'max-w-md'} shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200`}>
            
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="font-bold text-slate-100 flex items-center gap-2">
                {modal.type === 'rename' ? <Edit3 size={18} className="text-blue-400"/> : 
                 modal.type === 'info' ? <Info size={18} className="text-indigo-400" /> :
                 <RefreshCw size={18} className="text-blue-400"/>}
                
                {modal.type === 'rename' ? 'Rename Playlist' : 
                 modal.type === 'info' ? 'Playlist Details' :
                 'Refresh Credentials'}
              </h3>
              <button 
                onClick={() => !modalSubmitting && setModal({ type: null, sourceId: null, sourceName: '' })} 
                disabled={modalSubmitting}
                className="text-slate-400 hover:text-white disabled:opacity-50 transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-400 mb-2">
                Target: <span className="font-bold text-slate-200">{modal.sourceName}</span>
              </p>

              {/* === INFO UI === */}
              {modal.type === 'info' && modal.sourceObj && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-sm text-slate-300 bg-slate-950 p-4 rounded-lg border border-slate-800">
                    <div><span className="text-slate-500 font-semibold block text-[10px] uppercase tracking-wider">Type</span> {modal.sourceObj.type}</div>
                    <div><span className="text-slate-500 font-semibold block text-[10px] uppercase tracking-wider">Channels</span> {modal.sourceObj.channel_count.toLocaleString()}</div>
                    <div className="col-span-2"><span className="text-slate-500 font-semibold block text-[10px] uppercase tracking-wider">Updated</span> {new Date(modal.sourceObj.last_updated).toLocaleString()}</div>
                    <div className="col-span-2 truncate" title={maskUrlCredentials(modal.sourceObj.url)}>
                      <span className="text-slate-500 font-semibold block text-[10px] uppercase tracking-wider">URL</span> 
                      {maskUrlCredentials(modal.sourceObj.url)}
                    </div>
                  </div>

                  {(() => {
                    const accInfo = formatJson(modal.sourceObj.account_info);
                    const metaInfo = formatJson(modal.sourceObj.playlist_metadata);
                    
                    return (
                      <>
                        {accInfo && (
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Tv size={14}/> Server Account Info</label>
                            <div className="bg-[#050505] border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-400 overflow-y-auto max-h-[180px] custom-scrollbar select-all">
                              <pre>{accInfo}</pre>
                            </div>
                          </div>
                        )}
                        {metaInfo && (
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5"><Edit3 size={14}/> Metadata Overrides</label>
                            <div className="bg-[#050505] border border-slate-800 rounded-lg p-3 font-mono text-[11px] text-slate-400 overflow-y-auto max-h-[180px] custom-scrollbar select-all">
                              <pre>{metaInfo}</pre>
                            </div>
                          </div>
                        )}
                        {!accInfo && !metaInfo && (
                          <p className="text-sm text-slate-500 italic mt-4 border-t border-slate-800 pt-4">No advanced server data or metadata overrides found for this playlist.</p>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}

              {/* === RENAME UI === */}
              {modal.type === 'rename' && (
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">New Name</label>
                  <input type="text" value={renameInput} onChange={e => setRenameInput(e.target.value)} disabled={modalSubmitting} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors" placeholder="Enter new name..." autoFocus />
                </div>
              )}

              {/* === XTREAM REFRESH UI === */}
              {modal.type === 'xtream' && (
                <>
                  <p className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">Security Note: We do not save Xtream passwords in the database. You must provide them to refresh.</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Username</label>
                    <input type="text" value={xtreamUser} onChange={e => setXtreamUser(e.target.value)} disabled={modalSubmitting} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="Username" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Password</label>
                    <input type="password" value={xtreamPass} onChange={e => setXtreamPass(e.target.value)} disabled={modalSubmitting} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="Password" />
                  </div>
                </>
              )}

              {/* === STALKER REFRESH UI === */}
              {modal.type === 'stalker' && (
                <>
                  <p className="text-xs text-yellow-500 bg-yellow-500/10 p-2 rounded border border-yellow-500/20">Security Note: We do not save MAC Addresses in the database. You must provide it to refresh.</p>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">MAC Address</label>
                    <input type="text" value={stalkerMac} onChange={e => setStalkerMac(e.target.value)} disabled={modalSubmitting} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500" placeholder="00:1A:79:..." />
                  </div>
                </>
              )}

              {/* Submit Buttons (Hidden for 'Info' modal) */}
              {modal.type !== 'info' && (
                <button 
                  onClick={() => {
                    if (modal.type === 'rename') submitRename();
                    else if (modal.type === 'xtream') executeRefresh(modal.sourceId!, { username: xtreamUser, password: xtreamPass });
                    else if (modal.type === 'stalker') executeRefresh(modal.sourceId!, { macAddress: stalkerMac });
                  }}
                  disabled={isSubmitDisabled}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {modalSubmitting && <Loader2 size={18} className="animate-spin" />}
                  {modal.type === 'rename' ? 'Save Name' : 'Refresh Channels'}
                </button>
              )}
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
