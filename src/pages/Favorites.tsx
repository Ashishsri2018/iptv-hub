import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { Search, Play, Trash2, Loader2, Star, ExternalLink, CheckCircle, X, AlertCircle } from 'lucide-react';
import { useAppStore } from '../store';
import { API_URL } from '../config';

interface FavoriteChannel { id: string; name: string; logo_url: string | null; stream_url: string; source_name: string; }

export default function Favorites() {
  const { playChannel } = useAppStore();
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => { fetchFavorites(); }, []);

  const fetchFavorites = async () => {
    try {
      const res = await fetch(`${API_URL}/api/favorites`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      if (Array.isArray(data)) setFavorites(data);
    } catch (error: any) { 
      console.error("Favorites Fetch Error:", error);
      showToast(`Failed to load favorites: ${error.message}`, 'error');
      setFavorites([]); 
    } 
    finally { setLoading(false); }
  };

  const removeFavorite = async (e: React.MouseEvent, channelId: string) => {
    e.stopPropagation();
    const backup = [...favorites];
    setFavorites(prev => prev.filter(f => f.id !== channelId));
    try { 
      const res = await fetch(`${API_URL}/api/favorites/${channelId}`, { method: 'DELETE' }); 
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error: any) { 
      setFavorites(backup);
      showToast(`Failed to remove: ${error.message}`, 'error');
    }
  };

  const handleTouchStart = (url: string) => {
    pressTimer.current = setTimeout(() => {
      navigator.clipboard.writeText(url)
        .then(() => showToast("Link Copied!", 'success'))
        .catch(err => showToast(`Copy Failed: ${err.message}`, 'error'));
    }, 800);
  };

  const handleTouchEnd = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };

  // THE UPGRADED OS INTENT ENGINE
  const launchExternalPlayer = (e: React.MouseEvent, url: string, name: string) => {
    e.stopPropagation();
    try {
      if (!url) throw new Error("Stream URL is empty.");

      if (url.startsWith('acestream://')) {
        window.location.href = url;
        return;
      }

      const isAndroid = /Android/i.test(navigator.userAgent);
      let targetUrl = url;

      if (isAndroid) {
        const match = url.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
        if (match) {
          const scheme = match[1];
          const path = match[2];
          targetUrl = `intent://${path}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(name)};end;`;
        } else {
          throw new Error("Invalid URL formatting for Android OS.");
        }
      } else {
        targetUrl = `vlc://${url}`;
      }

      const a = document.createElement('a');
      a.href = targetUrl;
      a.target = '_top'; 
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      showToast("Launching Player...", 'success');
    } catch (error: any) {
      console.error("External Player Launch Error:", error);
      showToast(`Launch Failed: ${error.message}`, 'error');
    }
  };

  const searchResults = useMemo(() => {
    if (!searchQuery) return favorites;
    const fuse = new Fuse(favorites, { keys: ['name', 'source_name'], threshold: 0.3, useExtendedSearch: true });
    const formattedQuery = searchQuery.split(' ').map(word => `'${word}`).join(' ');
    return fuse.search(formattedQuery).map(res => res.item);
  }, [favorites, searchQuery]);

  const groupedFavorites = useMemo(() => {
    const groups: Record<string, FavoriteChannel[]> = {};
    searchResults.forEach(ch => {
      let firstChar = ch.name.charAt(0).toUpperCase();
      if (!/[A-Z0-9]/.test(firstChar)) firstChar = '#'; 
      if (!groups[firstChar]) groups[firstChar] = [];
      groups[firstChar].push(ch);
    });
    return Object.keys(groups).sort((a, b) => a==='#'?1:b==='#'?-1:a.localeCompare(b)).map(letter => ({ letter, channels: groups[letter].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [searchResults]);

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;

  return (
    <div className="flex flex-col h-full bg-slate-900 relative">
      <div className="p-4 border-b border-slate-800 bg-slate-950 shrink-0 z-10">
        <h2 className="text-2xl font-semibold mb-4 text-slate-100 flex items-center gap-2">
          <Star className="text-yellow-400 fill-yellow-400" /> Favorites
        </h2>
        
        <div className="relative max-w-2xl mx-auto flex items-center">
          <Search className="absolute left-3 text-slate-400" size={18} />
          <input 
            type="text" placeholder="Search favorites..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-10 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors shadow-inner"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 p-1 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-slate-900/50 select-none">
        <div className="max-w-4xl mx-auto pb-32">
          {groupedFavorites.length === 0 ? (
            <div className="text-center mt-20 text-slate-500">
              <Star size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">No favorites found.</p>
            </div>
          ) : (
            groupedFavorites.map(group => (
              <div key={group.letter} className="mb-8">
                <h3 className="text-2xl font-bold text-slate-100 mb-4 border-b border-slate-700 pb-2 inline-block min-w-[3rem]">{group.letter}</h3>
                <ul className="list-disc list-inside space-y-3 marker:text-blue-500 pl-2">
                  {group.channels.map(channel => {
                    const isExternalOnly = !channel.stream_url.startsWith('http');
                    return (
                      <li key={channel.id} className="relative group">
                        <div 
                          onMouseDown={() => handleTouchStart(channel.stream_url)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(channel.stream_url)} onTouchEnd={handleTouchEnd}
                          className="inline-flex flex-col sm:flex-row sm:items-center justify-between w-[calc(100%-1.5rem)] p-3 bg-slate-950 border border-slate-800 rounded-lg hover:border-slate-600 transition-all cursor-pointer align-top"
                        >
                          <div className="flex items-center gap-3 overflow-hidden" onClick={(e) => { 
                            e.stopPropagation(); 
                            if(!isExternalOnly) playChannel(channel.stream_url, channel.name); 
                            else launchExternalPlayer(e, channel.stream_url, channel.name); 
                          }}>
                            <div className="w-10 h-10 bg-slate-900 rounded flex items-center justify-center shrink-0 overflow-hidden relative">
                              {channel.logo_url ? <img src={channel.logo_url} alt="" loading="lazy" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} /> : null}
                              <div className={`font-bold text-slate-500 absolute ${channel.logo_url ? 'hidden' : ''}`}>{channel.name.charAt(0).toUpperCase()}</div>
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-100 text-lg leading-tight truncate">{channel.name}</span>
                              </div>
                              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold mt-0.5 truncate">{channel.source_name}</span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1 mt-3 sm:mt-0 ml-[3.25rem] sm:ml-0 shrink-0">
                            <button onClick={(e) => removeFavorite(e, channel.id)} className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors">
                              <Trash2 size={18} />
                            </button>
                            
                            {isExternalOnly ? (
                              <button onClick={(e) => launchExternalPlayer(e, channel.stream_url, channel.name)} className="p-1.5 bg-purple-600/10 text-purple-500 hover:bg-purple-600 hover:text-white rounded-lg transition-colors ml-1">
                                <ExternalLink size={18} />
                              </button>
                            ) : (
                              <>
                                <button onClick={(e) => launchExternalPlayer(e, channel.stream_url, channel.name)} className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors">
                                  <ExternalLink size={18} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); playChannel(channel.stream_url, channel.name); }} className="p-1.5 bg-blue-600/10 text-blue-500 hover:bg-blue-600 hover:text-white rounded-lg transition-colors ml-1">
                                  <Play size={18} className="fill-current" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>

      {toast && (
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-2 font-medium animate-in slide-in-from-bottom-5 fade-in z-50 border ${toast.type === 'error' ? 'bg-red-900 border-red-700' : 'bg-slate-800 border-slate-700'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} className="text-green-400" /> : <AlertCircle size={18} className="text-red-400" />}
          <span className="truncate max-w-[250px]">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}