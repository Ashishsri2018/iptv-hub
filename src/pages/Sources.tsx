import { useState, useEffect } from 'react';
import { FolderGit2, Trash2, Tv, Link as LinkIcon, Loader2, AlertCircle } from 'lucide-react';
import { API_URL } from '../config';

interface Source {
  id: string;
  name: string;
  type: string;
  url: string;
  channel_count: number;
  last_updated: string;
}

export default function Sources() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchSources = async () => {
    try {
      const res = await fetch(`${API_URL}/api/sources`);
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);
      
      if (Array.isArray(data)) {
        setSources(data);
      } else {
        throw new Error("Invalid data format received from API.");
      }
    } catch (error: any) {
      console.error("Failed to fetch sources:", error);
      setErrorMsg(error.message || "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSources();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    // 1. Confirm before executing the destructive action
    const confirmed = window.confirm(`Are you sure you want to delete "${name}"?\n\nThis will permanently remove all of its channels and any associated Favorites.`);
    if (!confirmed) return;

    setDeletingId(id);

    try {
      // 2. Call our new strictly-cascading Worker route
      const res = await fetch(`${API_URL}/api/sources/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete source from database.");

      // 3. Remove it from the UI
      setSources(prev => prev.filter(s => s.id !== id));
      
    } catch (error) {
      alert("Error deleting source. Please check your connection.");
      console.error(error);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  }

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
    <div className="p-4 md:p-6 max-w-4xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      
      <div className="flex items-center gap-3 mb-8">
        <FolderGit2 className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Manage Sources</h2>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center justify-center mt-20 text-slate-500 bg-slate-900/50 rounded-xl border border-slate-800 border-dashed p-10">
          <FolderGit2 size={48} className="mb-4 opacity-30" />
          <p className="text-lg font-medium text-slate-300 mb-2">No sources added yet.</p>
          <p className="text-sm text-center max-w-sm">
            Go to the "Add Source" page to import an M3U playlist.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sources.map((source) => (
            <div 
              key={source.id} 
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all hover:border-slate-700 shadow-sm"
            >
              
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
                    <span>{source.channel_count.toLocaleString()} Channels</span>
                  </div>
                  <span>Updated: {new Date(source.last_updated).toLocaleDateString()}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 sm:self-stretch pt-3 sm:pt-0 border-t border-slate-800 sm:border-t-0 sm:border-l sm:pl-4 shrink-0 justify-end">
                <button 
                  onClick={() => handleDelete(source.id, source.name)}
                  disabled={deletingId === source.id}
                  className="flex items-center justify-center gap-2 px-4 py-2 sm:p-3 bg-red-950/30 text-red-400 hover:bg-red-900 hover:text-red-100 border border-red-900/50 hover:border-red-700 rounded-lg transition-colors disabled:opacity-50"
                  title="Delete Source"
                >
                  {deletingId === source.id ? <Loader2 size={20} className="animate-spin" /> : <Trash2 size={20} />}
                  <span className="sm:hidden font-medium">Delete Playlist</span>
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}