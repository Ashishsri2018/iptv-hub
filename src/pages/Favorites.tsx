import { useState, useEffect, useMemo, useRef } from 'react';
import Fuse from 'fuse.js';
import { Search, Play, Trash2, Loader2, Star, ExternalLink, CheckCircle, X, AlertCircle, LayoutGrid, List as ListIcon } from 'lucide-react';
import { useAppStore } from '../store';
import { API_URL } from '../config';

interface FavoriteChannel { 
  id: string; 
  name: string; 
  logo_url: string | null; 
  stream_url: string; 
  source_name: string; 
}

export default function Favorites() {
  const { playChannel } = useAppStore();
  const [favorites, setFavorites] = useState<FavoriteChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  
  // View Mode State
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  
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
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
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
      if (!res.ok) throw new Error(`Server rejected deletion (HTTP ${res.status})`);
      showToast("Removed from favorites", 'success');
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

      // Open seamlessly in the same window to allow OS interception
      window.location.href = targetUrl;
      showToast("Launching Player...", 'success');
    } catch (error: any) {
      console.error("External Player Launch Error:", error);
      showToast(`Launch Failed: ${error.message}`, 'error');
    }
  };

  // SEARCH FIX: Clean trailing spaces and handle multi-word perfectly
  const searchResults = useMemo(() => {
    const cleanQuery = searchQuery.trim();
    if (!cleanQuery) return favorites;
    
    const fuse = new Fuse(favorites, { keys: ['name', 'source_name'], threshold: 0.3, useExtendedSearch: true });
    
    // Split by any number of spaces, map to Fuse.js exact-match format
    const formattedQuery = cleanQuery.split(/\s+/).map(word => `'${word}`).join(' ');
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
    return Object.keys(groups)
      .sort((a, b) => a==='#'?1:b==='#'?-1:a.localeCompare(b))
      .map(letter => ({ letter, channels: groups[letter].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [searchResults]);

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;

  return (
    <div className="flex flex-col h-full bg-[#0f1115] relative">
      <div className="p-4 sm:p-6 border-b border-slate-800/50 bg-[#12141a] shrink-0 z-10 shadow-sm">
        
        {/* HEADER & VIEW TOGGLE */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Star className="text-yellow-400 fill-yellow-400" /> Favorites
          </h2>
          
          <div className="flex bg-[#1a1e26] border border-slate-700/50 rounded-lg p-1 shrink-0 self-start sm:self-auto">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
              title="Grid View"
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'}`}
              title="List View"
            >
              <ListIcon size={18} />
            </button>
          </div>
        </div>
        
        {/* SEARCH BAR */}
        <div className="relative w-full flex items-center">
          <Search className="absolute left-3 text-slate-400" size={18} />
          <input 
            type="text" placeholder="Search favorites..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#1a1e26] border border-slate-700/50 rounded-full pl-10 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors shadow-inner text-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-3 p-1.5 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar select-none" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="max-w-7xl mx-auto pb-32">
          {groupedFavorites.length === 0 ? (
            <div className="text-center mt-20 text-slate-500">
              <Star size={48} className="mx-auto mb-4 opacity-30" />
              <p className="text-lg">No favorites found.</p>
            </div>
          ) : (
            groupedFavorites.map(group => (
              <div key={group.letter} className="mb-8">
                <h3 className="text-2xl font-bold text-slate-100 mb-4 border-b border-slate-800/50 pb-2 inline-block min-w-[3rem]">{group.letter}</h3>
                
                {/* DYNAMIC RENDER BASED ON VIEW MODE */}
                <div className={viewMode === 'grid' 
                  ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2 sm:gap-3" 
                  : "space-y-2 sm:space-y-3"
                }>
                  {group.channels.map(channel => {
                    const isExternalOnly = !channel.stream_url.startsWith('http');
                    
                    // ==========================================
                    // COMPACT GRID VIEW CARD
                    // ==========================================
                    if (viewMode === 'grid') {
                      return (
                        <div 
                          key={channel.id}
                          onMouseDown={() => handleTouchStart(channel.stream_url)}
                          onMouseUp={handleTouchEnd}
                          onMouseLeave={handleTouchEnd}
                          onTouchStart={() => handleTouchStart(channel.stream_url)}
                          onTouchEnd={handleTouchEnd}
                          onClick={(e) => { 
                            if(!isExternalOnly) playChannel(channel.stream_url, channel.name); 
                            else launchExternalPlayer(e, channel.stream_url, channel.name); 
                          }}
                          className="bg-[#12141a] border border-slate-800/60 rounded-xl overflow-hidden hover:border-blue-500/50 hover:shadow-[0_0_15px_rgba(59,130,246,0.15)] transition-all cursor-pointer group flex flex-col relative"
                        >
                          <div className="absolute top-1 right-1 z-10 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => launchExternalPlayer(e, channel.stream_url, channel.name)}
                              className="p-1 bg-black/70 hover:bg-black rounded-md text-slate-200 hover:text-white backdrop-blur-md transition-colors"
                            >
                              <ExternalLink size={14} />
                            </button>
                            <button
                              onClick={(e) => removeFavorite(e, channel.id)}
                              className="p-1 bg-black/70 hover:bg-red-500/90 rounded-md text-slate-200 hover:text-white backdrop-blur-md transition-colors"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          <div className="aspect-video bg-[#0b0c10] relative flex items-center justify-center p-2">
                            {channel.logo_url ? (
                              <img 
                                src={channel.logo_url} 
                                alt={channel.name} 
                                loading="lazy"
                                decoding="async"
                                className="max-h-full max-w-full object-contain pointer-events-none drop-shadow-lg group-hover:scale-110 transition-transform duration-300"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                }}
                              />
                            ) : null}
                            <div className={`font-bold text-slate-600 text-2xl absolute ${channel.logo_url ? 'hidden' : ''}`}>
                              {channel.name.charAt(0).toUpperCase()}
                            </div>
                            
                            <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/20 transition-colors flex items-center justify-center">
                              {!isExternalOnly && (
                                <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-lg">
                                  <Play size={14} className="ml-0.5" />
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="p-2 border-t border-slate-800/50 flex-1 flex flex-col justify-between">
                            <h3 className="text-slate-200 font-medium text-xs line-clamp-2 leading-tight group-hover:text-blue-400 transition-colors">
                              {channel.name}
                            </h3>
                            <div className="mt-1 text-[9px] text-slate-500 font-semibold truncate uppercase tracking-wide">
                              {channel.source_name}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    // ==========================================
                    // LIST VIEW ROW
                    // ==========================================
                    return (
                      <div 
                        key={channel.id}
                        onMouseDown={() => handleTouchStart(channel.stream_url)} 
                        onMouseUp={handleTouchEnd} 
                        onMouseLeave={handleTouchEnd} 
                        onTouchStart={() => handleTouchStart(channel.stream_url)} 
                        onTouchEnd={handleTouchEnd}
                        onClick={(e) => { 
                          if(!isExternalOnly) playChannel(channel.stream_url, channel.name); 
                          else launchExternalPlayer(e, channel.stream_url, channel.name); 
                        }}
                        className="flex flex-col sm:flex-row sm:items-center justify-between w-full p-2.5 sm:p-3 bg-[#12141a] border border-slate-800/60 rounded-xl hover:border-slate-600 transition-all cursor-pointer group"
                      >
                        <div className="flex items-center gap-3 sm:gap-4 overflow-hidden flex-1">
                          <div className="w-12 h-12 bg-[#0b0c10] border border-slate-800/50 rounded-lg flex items-center justify-center shrink-0 overflow-hidden relative shadow-inner">
                            {channel.logo_url ? (
                              <img 
                                src={channel.logo_url} 
                                alt="" 
                                loading="lazy"
                                decoding="async" 
                                className="w-full h-full object-contain pointer-events-none p-1" 
                                onError={(e) => { 
                                  (e.target as HTMLImageElement).style.display = 'none'; 
                                  (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); 
                                }} 
                              />
                            ) : null}
                            <div className={`font-bold text-slate-600 text-xl absolute ${channel.logo_url ? 'hidden' : ''}`}>
                              {channel.name.charAt(0).toUpperCase()}
                            </div>
                          </div>
                          
                          <div className="flex flex-col flex-1 min-w-0 pr-2">
                            <span className="font-medium text-slate-200 text-base leading-tight truncate group-hover:text-blue-400 transition-colors">
                              {channel.name}
                            </span>
                            <span className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider font-semibold mt-1 truncate">
                              {channel.source_name}
                            </span>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1.5 mt-3 sm:mt-0 ml-[3.75rem] sm:ml-0 shrink-0">
                          <button 
                            onClick={(e) => removeFavorite(e, channel.id)} 
                            className="p-2 sm:p-2.5 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                          
                          <button 
                            onClick={(e) => launchExternalPlayer(e, channel.stream_url, channel.name)} 
                            className="p-2 sm:p-2.5 bg-slate-800/50 text-slate-300 hover:bg-purple-600 hover:text-white rounded-lg transition-colors"
                          >
                            <ExternalLink size={18} />
                          </button>
                          
                          {!isExternalOnly && (
                            <button 
                              onClick={(e) => { e.stopPropagation(); playChannel(channel.stream_url, channel.name); }} 
                              className="p-2 sm:p-2.5 bg-blue-600/10 text-blue-500 hover:bg-blue-600 hover:text-white rounded-lg transition-colors ml-1"
                            >
                              <Play size={18} className="fill-current" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ERROR / SUCCESS TOAST */}
      {toast && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 text-white px-6 py-3 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center gap-2 font-medium animate-in slide-in-from-bottom-5 fade-in z-[100] border ${toast.type === 'error' ? 'bg-red-900/95 border-red-700' : 'bg-slate-800/95 border-slate-700'}`}>
          {toast.type === 'success' ? <CheckCircle size={18} className="text-green-400 shrink-0" /> : <AlertCircle size={18} className="text-red-400 shrink-0" />}
          <span className="truncate max-w-[250px] text-sm">{toast.msg}</span>
        </div>
      )}
    </div>
  );
}