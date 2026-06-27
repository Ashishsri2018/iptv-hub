import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Tv2, Loader2, Image as ImageIcon, Folder, Star, ExternalLink, AlertCircle, X, Check } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';

// STRICT TYPESCRIPT INTERFACES
interface Channel {
  id: string;
  source_id: string;
  name: string;
  channel_group: string;
  logo_url: string | null;
  stream_url: string;
}

interface Source {
  id: string;
  name: string;
  type: string;
  url: string;
  channel_count: number;
}

interface Category {
  name: string;
  count: number;
}

// INTELLIGENT MARQUEE: Only animates if text physically overflows the container
const SmartMarquee = ({ text, className = "" }: { text: string, className?: string }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    setIsOverflowing(false); 
  }, [text]);

  useEffect(() => {
    if (!isOverflowing && containerRef.current && textRef.current) {
      if (textRef.current.scrollWidth > containerRef.current.clientWidth) {
        setIsOverflowing(true);
      }
    }
  }, [text, isOverflowing]);

  return (
    <div ref={containerRef} className={`overflow-hidden flex w-full ${className}`} title={text}>
      {isOverflowing ? (
        <div className="animate-marquee-custom flex min-w-max">
          <span className="pr-12">{text}</span>
          <span className="pr-12">{text}</span>
        </div>
      ) : (
        <span ref={textRef} className="truncate block w-full">{text}</span>
      )}
    </div>
  );
};

export default function Channels() {
  const { setPlayingChannel } = useAppStore();
  
  // UI Data States
  const [sources, setSources] = useState<Source[]>([]);
  const [categories, setCategories] = useState<Category[]>([{name: 'All', count: 0}]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  
  // Selection States
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState(''); 
  
  // Pagination, Touch, Error & Toast States
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // TIMERS & REFS FOR MEMORY SAFETY & RACE CONDITION FIXES
  const pressTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const isLongPressRef = useRef(false);
  const fetchControllerRef = useRef<AbortController | null>(null);

  const engineRefs = useRef({
    offset: 0,
    isFetching: false,
    hasMore: true,
    sourceId: null as string | null,
    category: 'All',
    search: ''
  });

  // CLEANUP ON UNMOUNT
  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (pressTimer.current) window.clearTimeout(pressTimer.current);
      if (fetchControllerRef.current) fetchControllerRef.current.abort();
    };
  }, []);

  const handleError = (context: string, err: any) => {
    if (err.name === 'AbortError') return; // Ignore canceled requests silently
    console.error(context, err);
    setErrorMessage(`${context}: ${err?.message || 'Unknown error occurred'}`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 3000); 
  };

  // 1. Fetch Sources & Determine Default Playlist
  useEffect(() => {
    fetch(`${API_URL}/api/sources`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setSources(data);
          if (data.length > 0) {
            const sorted = [...data].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
            setActiveSourceId(sorted[0].id); 
          } else {
            setActiveSourceId('All');
          }
        }
      })
      .catch(err => handleError("Failed to load playlists", err));

    // Fetch favorites strictly for the UI stars
    fetch(`${API_URL}/api/favorites`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) setFavorites(new Set(data.map(f => f.id || f.channel_id)));
      })
      .catch(err => handleError("Failed to load favorites", err));
  }, []);

  // 2. Safely Fetch Categories
  useEffect(() => {
    setSearchQuery('');
    setSubmittedSearch('');
    setActiveCategory('All');

    if (activeSourceId) {
      fetch(`${API_URL}/api/categories?sourceId=${activeSourceId}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data && Array.isArray(data.categories)) {
            setCategories([{ name: 'All', count: data.total }, ...data.categories]);
          }
        })
        .catch(err => handleError("Failed to load categories", err));
    } else {
      setCategories([{name: 'All', count: 0}]);
    }
  }, [activeSourceId]);

  // 3. Keep engine synced with selections
  useEffect(() => {
    engineRefs.current.sourceId = activeSourceId;
    engineRefs.current.category = activeCategory;
    engineRefs.current.search = submittedSearch;
  }, [activeSourceId, activeCategory, submittedSearch]);

  // 4. Fetch Channels
  const loadMoreChannels = useCallback(async (reset = false) => {
    const engine = engineRefs.current;
    
    if (engine.sourceId === null) return; 
    if (!reset && engine.isFetching) return;
    if (!reset && !engine.hasMore) return;

    if (reset) {
      if (fetchControllerRef.current) fetchControllerRef.current.abort();
      fetchControllerRef.current = new AbortController();
      engine.offset = 0;
    }

    engine.isFetching = true;
    setIsLoading(true);
    if (reset) setErrorMessage(null); 

    try {
      // Safely construct the URL using your config's API_URL
const baseUrl = API_URL || window.location.origin;
const url = new URL('/api/channels', baseUrl);

      url.searchParams.append('limit', '100');
      url.searchParams.append('offset', engine.offset.toString());
      
      if (engine.sourceId !== 'All') url.searchParams.append('sourceId', engine.sourceId);
      if (engine.category !== 'All') url.searchParams.append('category', engine.category);
      
      if (engine.search.trim() !== '') {
        const escapedSearch = engine.search.trim().replace(/[%_]/g, '\\$&');
        const backendSearchTerm = escapedSearch.replace(/\s+/g, '%');
        url.searchParams.append('search', backendSearchTerm);
      }

      const res = await fetch(url.toString(), { signal: fetchControllerRef.current?.signal });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      let newChannels = [];
      let more = false;

      if (Array.isArray(data)) {
        newChannels = data.slice(engine.offset, engine.offset + 100);
        more = engine.offset + 100 < data.length;
      } else {
        newChannels = data.data;
        more = data.hasMore;
      }

      setChannels(prev => reset ? newChannels : [...prev, ...newChannels]);
      engine.hasMore = more;
      setHasMore(more);
      engine.offset += 100;

    } catch (error: any) {
      handleError("Failed to fetch channels", error);
    } finally {
      engine.isFetching = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setChannels([]); 
    loadMoreChannels(true);
  }, [activeSourceId, activeCategory, submittedSearch, loadMoreChannels]);

  // User Actions
  const handleSearchSubmit = () => setSubmittedSearch(searchQuery);
  const handleClearSearch = () => { setSearchQuery(''); setSubmittedSearch(''); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') handleSearchSubmit(); };

  const handlePointerDown = (url: string) => {
    isLongPressRef.current = false;
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
    
    pressTimer.current = window.setTimeout(() => {
      navigator.clipboard.writeText(url).then(() => {
        isLongPressRef.current = true;
        if (navigator.vibrate) navigator.vibrate(50); 
        showToast('Stream link copied to clipboard');
      }).catch(err => handleError("Failed to copy link", err));
    }, 600);
  };

  const handlePointerUpOrLeave = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };

  const handleCardClick = (e: React.MouseEvent, channel: Channel) => {
    if (isLongPressRef.current) { e.preventDefault(); e.stopPropagation(); return; }
    setPlayingChannel(channel.stream_url, channel.name, channel.logo_url);
  };

  const toggleFavorite = async (e: React.MouseEvent, channel: Channel) => {
    e.stopPropagation(); 
    const isFav = favorites.has(channel.id);
    
    setFavorites(prev => {
      const next = new Set(prev);
      isFav ? next.delete(channel.id) : next.add(channel.id);
      return next;
    });

    try {
      const response = await fetch(`${API_URL}/api/favorites${isFav ? `/${encodeURIComponent(channel.id)}` : ''}`, {
        method: isFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: isFav ? undefined : JSON.stringify({ channel_id: channel.id })
      });
      if (!response.ok) throw new Error("Database rejected favorite sync");
    } catch (error) {
      setFavorites(prev => {
        const revert = new Set(prev);
        isFav ? revert.add(channel.id) : revert.delete(channel.id);
        return revert;
      });
      handleError("Failed to save favorite", error);
    }
  };

  const openExternal = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    const isAndroid = /Android/i.test(navigator.userAgent);
    if (isAndroid) {
      const isHttps = url.startsWith('https://');
      const cleanUrl = url.replace(/^https?:\/\//, '');
      const scheme = isHttps ? 'https' : 'http';
      const intentUrl = `intent://${cleanUrl}#Intent;action=android.intent.action.VIEW;scheme=${scheme};type=video/*;end;`;
      try { window.location.href = intentUrl; } catch (e) { window.open(url, '_blank'); }
    } else { window.open(url, '_blank'); }
  };

  const activeSourceName = activeSourceId === 'All' ? 'all playlists' : sources.find(s => s.id === activeSourceId)?.name || 'loading...';
  const isSearching = submittedSearch.trim() !== '';
  const sortedSources = [...sources].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto py-4 sm:py-6 relative overflow-hidden bg-[#0f1115]">
      
      <style>{`
        .hide-scroll::-webkit-scrollbar { display: none; }
        .hide-scroll { -ms-overflow-style: none; scrollbar-width: none; }
        @keyframes marquee-custom {
          0% { transform: translateX(0%); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee-custom { animation: marquee-custom 12s linear infinite; }
      `}</style>

      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-slate-200 px-5 py-2.5 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-slate-700 font-medium text-sm flex items-center gap-2 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <Check className="text-blue-500" size={16} />
          {toastMessage}
        </div>
      )}

      {/* HEADER & SEARCH */}
      <div className="px-4 sm:px-6 mb-4 shrink-0">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Tv2 className="text-blue-500" /> Channels
          </h1>
          <div className="relative w-full flex items-center">
            <button onClick={handleSearchSubmit} className="absolute left-2 p-1.5 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-slate-800">
              <Search size={18} />
            </button>
            <input
              type="text"
              placeholder={`Search in ${activeSourceName}... (Press Enter)`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-[#1e232d] border border-slate-700/50 rounded-full pl-10 pr-10 py-2.5 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all shadow-inner"
            />
            {searchQuery && (
              <button onClick={handleClearSearch} className="absolute right-3 p-1.5 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {errorMessage && (
        <div className="mx-4 sm:mx-6 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start sm:items-center justify-between gap-3 animate-in fade-in shrink-0">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm font-medium text-red-200">{errorMessage}</p>
          </div>
          <button onClick={() => setErrorMessage(null)} className="p-1 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-colors">
            <X size={18} />
          </button>
        </div>
      )}

      {/* TOP TABS (Playlists Only) */}
      <div className="px-4 sm:px-6 mb-2 shrink-0">
        <div className="flex overflow-x-auto pb-3 gap-2 hide-scroll border-b border-slate-800/50">
          {sortedSources.length > 1 && (
            <button
              onClick={() => setActiveSourceId('All')}
              className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                ${activeSourceId === 'All' ? 'bg-blue-600 text-white shadow-lg' : 'bg-transparent text-slate-400 hover:bg-slate-800'}`}
            >
              <Folder size={16} /> All Playlists
            </button>
          )}
          
          {sortedSources.map((src) => (
            <button
              key={src.id}
              onClick={() => setActiveSourceId(src.id)}
              className={`whitespace-nowrap px-4 py-1.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                ${activeSourceId === src.id ? 'bg-blue-600 text-white shadow-lg' : 'bg-transparent text-slate-400 hover:bg-slate-800'}`}
            >
              <Folder size={16} /> {src.name}
            </button>
          ))}
        </div>
      </div>

      {isSearching && (
        <div className="px-4 sm:px-6 mb-2 text-sm text-blue-400 font-medium shrink-0">
          Showing results for "{submittedSearch}"...
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        
        {/* CLEAN SIDEBAR (Categories Only) */}
        <div className="w-[38%] sm:w-56 flex flex-col border-r border-slate-800/50 bg-[#12141a] overflow-y-auto hide-scroll pb-24">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={`flex items-center justify-between px-3 py-3.5 text-sm transition-colors border-l-2
                ${activeCategory === cat.name ? 'bg-[#2a303c] border-blue-500 text-blue-400' : 'border-transparent text-slate-300 hover:bg-slate-800'}`}
            >
              <div className="flex-1 flex items-center gap-2 overflow-hidden mr-2 text-left">
                {cat.name === 'All' && <span className="shrink-0 opacity-70"><Tv2 size={16} /></span>}
                <div className="flex-1 overflow-hidden"><SmartMarquee text={cat.name} /></div>
              </div>
              <span className="text-[10px] sm:text-xs font-mono opacity-60 shrink-0">{cat.count}</span>
            </button>
          ))}
        </div>

        {/* CHANNEL LIST */}
        <div className="flex-1 flex flex-col bg-[#0f1115] overflow-y-auto hide-scroll pb-24 relative">
          {channels.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4 text-center">
              <Tv2 size={40} className="mb-3 opacity-20" />
              <p className="text-sm">No channels found here.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {channels.map((channel) => (
                <div 
                  key={channel.id} 
                  onClick={(e) => handleCardClick(e, channel)}
                  onPointerDown={() => handlePointerDown(channel.stream_url)}
                  onPointerUp={handlePointerUpOrLeave}
                  onPointerLeave={handlePointerUpOrLeave}
                  className="flex items-center p-2 sm:p-3 border-b border-slate-800/50 hover:bg-[#1a1e26] transition-colors cursor-pointer select-none group"
                >
                  <div className="w-12 h-12 sm:w-14 sm:h-14 bg-[#1e232d] rounded-xl flex items-center justify-center shrink-0 overflow-hidden shadow-inner relative">
                    {channel.logo_url ? (
                      <img 
                        src={channel.logo_url} 
                        alt="" 
                        className="max-h-full max-w-full object-contain pointer-events-none"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`text-slate-600 ${channel.logo_url ? 'hidden' : ''}`}>
                      <ImageIcon size={24} />
                    </div>
                  </div>

                  <div className="flex-1 overflow-hidden ml-3 mr-2">
                    <SmartMarquee text={channel.name} className="text-slate-200 text-sm sm:text-base font-medium" />
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 opacity-80 group-hover:opacity-100">
                    <button onClick={(e) => openExternal(e, channel.stream_url)} className="p-2 sm:p-2.5 bg-[#171a21] hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors">
                      <ExternalLink size={16} />
                    </button>
                    <button onClick={(e) => toggleFavorite(e, channel)} className="p-2 sm:p-2.5 bg-[#171a21] hover:bg-slate-700 rounded-lg transition-colors">
                      <Star size={16} className={favorites.has(channel.id) ? "fill-yellow-400 text-yellow-400" : "text-slate-300 hover:text-white"} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {hasMore && channels.length > 0 && (
            <div className="w-full p-6 flex justify-center">
              <button
                onClick={() => loadMoreChannels(false)}
                disabled={isLoading}
                className="px-6 py-2.5 bg-[#1e232d] hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-full border border-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {isLoading ? <><Loader2 className="animate-spin text-blue-500" size={18} /> Loading...</> : 'Load More'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
