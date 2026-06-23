import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Tv2, Loader2, Image as ImageIcon, Folder, Star, ExternalLink, AlertCircle, X, Check } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';

// Custom Marquee Component for continuous scrolling text
const MarqueeText = ({ text }: { text: string }) => (
  <div className="overflow-hidden whitespace-nowrap flex w-full relative">
    <div className="animate-marquee-custom min-w-full flex">
      <span className="pr-12">{text || 'Unknown'}</span>
      <span className="pr-12">{text || 'Unknown'}</span>
    </div>
  </div>
);

export default function Channels() {
  const { setPlayingChannel } = useAppStore();
  
  // UI Data States
  const [sources, setSources] = useState<any[]>([]);
  const [categories, setCategories] = useState<{name: string, count: number}[]>([{name: 'All', count: 0}]);
  const [channels, setChannels] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  
  // Selection States
  const [activeSourceId, setActiveSourceId] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState(''); // REPLACED DEBOUNCE
  
  // Pagination, Touch, Error & Toast States
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLongPress, setIsLongPress] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  const pressTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);

  const engineRefs = useRef({
    offset: 0,
    isFetching: false,
    hasMore: true,
    sourceId: 'All',
    category: 'All',
    search: ''
  });

  const handleError = (context: string, err: any) => {
    console.error(context, err);
    setErrorMessage(`${context}: ${err?.message || 'Unknown error occurred'}`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 3000); 
  };

  // 1. Fetch Sources & Favorites on initial load
  useEffect(() => {
    fetch(`${API_URL}/api/sources`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setSources(data);
          if (data.length > 0) setActiveSourceId(data[0].id);
        }
      })
      .catch(err => handleError("Failed to load playlists", err));

    fetch(`${API_URL}/api/favorites`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          setFavorites(new Set(data.map(f => f.id || f.channel_id)));
        }
      })
      .catch(err => handleError("Failed to load favorites", err));
  }, []);

  // 2. Fetch Categories
  useEffect(() => {
    if (activeSourceId) {
      fetch(`${API_URL}/api/categories?sourceId=${activeSourceId}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data && Array.isArray(data.categories)) {
            setCategories([{ name: 'All', count: data.total }, ...data.categories]);
            setActiveCategory('All');
          }
        })
        .catch(err => handleError("Failed to load categories", err));
    }
  }, [activeSourceId]);

  // 3. Keep engine synced with selections and SUBMITTED search
  useEffect(() => {
    engineRefs.current.sourceId = activeSourceId;
    engineRefs.current.category = activeCategory;
    engineRefs.current.search = submittedSearch;
  }, [activeSourceId, activeCategory, submittedSearch]);

  // 4. Fetch Channels
  const loadMoreChannels = useCallback(async (reset = false) => {
    const engine = engineRefs.current;
    if (engine.isFetching) return;
    if (!reset && !engine.hasMore) return;

    engine.isFetching = true;
    setIsLoading(true);
    setErrorMessage(null); 

    try {
      if (reset) engine.offset = 0;
      const url = new URL('/api/channels', window.location.origin);
      url.searchParams.append('limit', '100');
      url.searchParams.append('offset', engine.offset.toString());
      if (engine.sourceId !== 'All') url.searchParams.append('sourceId', engine.sourceId);
      if (engine.category !== 'All') url.searchParams.append('category', engine.category);
      
      // MULTI-WORD SEARCH FIX: Convert spaces to SQL wildcard '%'
      if (engine.search.trim() !== '') {
        const backendSearchTerm = engine.search.trim().replace(/\s+/g, '%');
        url.searchParams.append('search', backendSearchTerm);
      }

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      
      const data = await response.json();

      if (Array.isArray(data)) {
        let filtered = data;
        if (engine.sourceId !== 'All') filtered = filtered.filter(c => c.source_id === engine.sourceId);
        if (engine.category !== 'All') filtered = filtered.filter(c => c.channel_group === engine.category);
        
        // MULTI-WORD SEARCH FIX (Client-side fallback)
        if (engine.search.trim() !== '') {
          const searchTerms = engine.search.toLowerCase().split(/\s+/).filter(Boolean);
          filtered = filtered.filter(c => {
            const nameLower = c.name?.toLowerCase() || '';
            return searchTerms.every(term => nameLower.includes(term));
          });
        }
        
        const chunk = filtered.slice(engine.offset, engine.offset + 100);
        setChannels(prev => reset ? chunk : [...prev, ...chunk]);
        engine.hasMore = engine.offset + 100 < filtered.length;
        setHasMore(engine.hasMore);
      } else {
        setChannels(prev => reset ? data.data : [...prev, ...data.data]);
        engine.hasMore = data.hasMore;
        setHasMore(data.hasMore);
      }
      engine.offset += 100;
    } catch (error) {
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

  // ==========================================
  // SEARCH ACTIONS
  // ==========================================
  const handleSearchSubmit = () => {
    setSubmittedSearch(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSubmittedSearch('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  // ==========================================
  // CARD ACTIONS
  // ==========================================
  const handleCardClick = (e: React.MouseEvent, channel: any) => {
    if (isLongPress) {
      e.preventDefault();
      return; 
    }
    setPlayingChannel(channel.stream_url, channel.name, channel.logo_url);
  };

  const handleTouchStart = (url: string) => {
    setIsLongPress(false);
    // LONG PRESS FIX: Reduced to 800ms
    pressTimer.current = window.setTimeout(() => {
      navigator.clipboard.writeText(url).then(() => {
        setIsLongPress(true);
        if (navigator.vibrate) navigator.vibrate(50); 
        showToast('Stream link copied to clipboard');
      }).catch(err => {
        handleError("Failed to copy link", err);
      });
    }, 800);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current);
  };

  const toggleFavorite = async (e: React.MouseEvent, channel: any) => {
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
      window.location.href = intentUrl;
    } else {
      window.open(url, '_blank');
    }
  };

  const activeSourceName = activeSourceId === 'All' ? 'all playlists' : sources.find(s => s.id === activeSourceId)?.name || 'this playlist';
  const isSearching = submittedSearch.trim() !== '';

  // PLAYLIST SORTING FIX: Alphanumeric
  const sortedSources = [...sources].sort((a, b) => 
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  );

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto py-4 sm:py-6 relative overflow-hidden bg-[#0f1115]">
      
      {/* CSS INJECTION FOR MARQUEE & SCROLLBAR */}
      <style>{`
        @keyframes marquee-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .animate-marquee-custom {
          animation: marquee-scroll 10s linear infinite;
        }
        .animate-marquee-custom:hover {
          animation-play-state: paused;
        }
        .hide-scroll::-webkit-scrollbar {
          display: none;
        }
        .hide-scroll {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>

      {/* FLOATING TOAST BANNER */}
      {toastMessage && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] bg-slate-800 text-slate-200 px-5 py-2.5 rounded-full shadow-[0_10px_40px_rgba(0,0,0,0.5)] border border-slate-700 font-medium text-sm flex items-center gap-2 animate-in slide-in-from-bottom-4 fade-in duration-300">
          <Check className="text-blue-500" size={16} />
          {toastMessage}
        </div>
      )}

      {/* HEADER & SEARCH BAR (Fixed at top) */}
      <div className="px-4 sm:px-6 mb-4 shrink-0">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Tv2 className="text-blue-500" /> Channels
          </h1>
          <div className="relative w-full flex items-center">
            {/* Clickable Search Icon */}
            <button 
              onClick={handleSearchSubmit}
              className="absolute left-2 p-1.5 text-slate-400 hover:text-white transition-colors rounded-full hover:bg-slate-800"
            >
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
            
            {/* Clickable Clear X Icon */}
            {searchQuery && (
              <button 
                onClick={handleClearSearch} 
                className="absolute right-3 p-1.5 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ERROR BANNER */}
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

      {/* PLAYLIST TABS (Horizontal Scroll) */}
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

      {/* ========================================== */}
      {/* SIDE-BY-SIDE SPLIT LAYOUT */}
      {/* ========================================== */}
      <div className="flex-1 flex overflow-hidden w-full relative">
        
        {/* LEFT PANE: Categories Column */}
        <div className="w-[38%] sm:w-56 flex flex-col border-r border-slate-800/50 bg-[#12141a] overflow-y-auto hide-scroll pb-24">
          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => setActiveCategory(cat.name)}
              className={`flex items-center justify-between px-3 py-3.5 text-sm transition-colors border-l-2
                ${activeCategory === cat.name 
                  ? 'bg-[#2a303c] border-blue-500 text-blue-400' 
                  : 'border-transparent text-slate-300 hover:bg-slate-800'
                }`}
            >
              {/* Category Marquee */}
              <div className="flex-1 overflow-hidden mr-2">
                <MarqueeText text={cat.name} />
              </div>
              <span className="text-[10px] sm:text-xs font-mono opacity-60 shrink-0">{cat.count}</span>
            </button>
          ))}
        </div>

        {/* RIGHT PANE: Channels List Column */}
        <div className="flex-1 flex flex-col bg-[#0f1115] overflow-y-auto hide-scroll pb-24 relative">
          {channels.length === 0 && !isLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 p-4 text-center">
              <Tv2 size={40} className="mb-3 opacity-20" />
              <p className="text-sm">No channels found here.</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {channels.map((channel, index) => (
                <div 
                  key={`${channel.id}-${index}`} 
                  onClick={(e) => handleCardClick(e, channel)}
                  onTouchStart={() => handleTouchStart(channel.stream_url)}
                  onTouchEnd={handleTouchEnd}
                  onMouseDown={() => handleTouchStart(channel.stream_url)}
                  onMouseUp={handleTouchEnd}
                  onMouseLeave={handleTouchEnd}
                  className="flex items-center p-2 sm:p-3 border-b border-slate-800/50 hover:bg-[#1a1e26] transition-colors cursor-pointer select-none group"
                >
                  {/* Channel Logo */}
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

                  {/* Channel Name Marquee */}
                  <div className="flex-1 overflow-hidden ml-3 mr-2">
                    <div className="text-slate-200 text-sm sm:text-base font-medium">
                      <MarqueeText text={channel.name} />
                    </div>
                  </div>

                  {/* Action Icons */}
                  <div className="flex items-center gap-1.5 shrink-0 opacity-80 group-hover:opacity-100">
                    <button
                      onClick={(e) => openExternal(e, channel.stream_url)}
                      className="p-2 sm:p-2.5 bg-[#171a21] hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors"
                    >
                      <ExternalLink size={16} />
                    </button>
                    <button
                      onClick={(e) => toggleFavorite(e, channel)}
                      className="p-2 sm:p-2.5 bg-[#171a21] hover:bg-slate-700 rounded-lg transition-colors"
                    >
                      <Star 
                        size={16} 
                        className={favorites.has(channel.id) ? "fill-yellow-400 text-yellow-400" : "text-slate-300 hover:text-white"} 
                      />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Load More Button inside the Right Pane */}
          {hasMore && channels.length > 0 && (
            <div className="w-full p-6 flex justify-center">
              <button
                onClick={() => loadMoreChannels(false)}
                disabled={isLoading}
                className="px-6 py-2.5 bg-[#1e232d] hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-full border border-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="animate-spin text-blue-500" size={18} /> Loading...
                  </>
                ) : (
                  'Load More'
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}