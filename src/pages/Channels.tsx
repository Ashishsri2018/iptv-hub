import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Search, Tv2, Loader2, Image as ImageIcon, Folder, ChevronDown, Star, ExternalLink, AlertCircle, X } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';
import { useNavigate } from 'react-router-dom';

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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Pagination, Touch & Error States
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isLongPress, setIsLongPress] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // THE FIX: Use standard number for browser window.setTimeout
  const pressTimer = useRef<number | null>(null);

  const engineRefs = useRef({
    offset: 0,
    isFetching: false,
    hasMore: true,
    sourceId: 'All',
    category: 'All',
    search: ''
  });

  // Helper to safely extract error messages
  const handleError = (context: string, err: any) => {
    console.error(context, err);
    setErrorMessage(`${context}: ${err?.message || 'Unknown error occurred'}`);
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

  // 3. Debounce Search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  useEffect(() => {
    engineRefs.current.sourceId = activeSourceId;
    engineRefs.current.category = activeCategory;
    engineRefs.current.search = debouncedSearch;
  }, [activeSourceId, activeCategory, debouncedSearch]);

  // 4. Fetch Channels
  const loadMoreChannels = useCallback(async (reset = false) => {
    const engine = engineRefs.current;
    if (engine.isFetching) return;
    if (!reset && !engine.hasMore) return;

    engine.isFetching = true;
    setIsLoading(true);
    setErrorMessage(null); // Clear previous errors on new fetch

    try {
      if (reset) engine.offset = 0;
      const url = new URL('/api/channels', window.location.origin);
      url.searchParams.append('limit', '100');
      url.searchParams.append('offset', engine.offset.toString());
      if (engine.sourceId !== 'All') url.searchParams.append('sourceId', engine.sourceId);
      if (engine.category !== 'All') url.searchParams.append('category', engine.category);
      if (engine.search.trim() !== '') url.searchParams.append('search', engine.search.trim());

      const response = await fetch(url.toString());
      if (!response.ok) throw new Error(`Server returned ${response.status}`);
      
      const data = await response.json();

      if (Array.isArray(data)) {
        let filtered = data;
        if (engine.sourceId !== 'All') filtered = filtered.filter(c => c.source_id === engine.sourceId);
        if (engine.category !== 'All') filtered = filtered.filter(c => c.channel_group === engine.category);
        if (engine.search.trim() !== '') {
          const s = engine.search.toLowerCase();
          filtered = filtered.filter(c => c.name?.toLowerCase().includes(s));
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
  }, [activeSourceId, activeCategory, debouncedSearch, loadMoreChannels]);

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
    // Use window.setTimeout explicitly for browser-native typing
    pressTimer.current = window.setTimeout(() => {
      navigator.clipboard.writeText(url).then(() => {
        setIsLongPress(true);
        if (navigator.vibrate) navigator.vibrate(50); 
        alert('Copied stream link to clipboard!');
      }).catch(err => {
        handleError("Failed to copy link", err);
      });
    }, 2000);
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
      // Revert UI if server fails
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
    window.open(url, '_blank');
  };

  const activeSourceName = activeSourceId === 'All' ? 'all playlists' : sources.find(s => s.id === activeSourceId)?.name || 'this playlist';
  const isSearching = debouncedSearch.trim() !== '';

  return (
    <div className="h-full flex flex-col max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* HEADER & SEARCH BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
          <Tv2 className="text-blue-500" /> Channels
        </h1>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder={`Search in ${activeSourceName}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-full pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
          />
        </div>
      </div>

      {/* ERROR BANNER */}
      {errorMessage && (
        <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 flex items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center gap-3">
            <AlertCircle className="text-red-500 shrink-0" size={20} />
            <p className="text-sm font-medium text-red-200">{errorMessage}</p>
          </div>
          <button 
            onClick={() => setErrorMessage(null)}
            className="p-1 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300 transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* NAVIGATION BARS */}
      <div className="mb-4">
        <div className="flex overflow-x-auto pb-3 gap-2 custom-scrollbar shrink-0 border-b border-slate-800/50 mb-4">
          {sources.length > 1 && (
            <button
              onClick={() => setActiveSourceId('All')}
              className={`whitespace-nowrap px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                ${activeSourceId === 'All' ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              <Folder size={16} /> All Playlists
            </button>
          )}
          {sources.map((src) => (
            <button
              key={src.id}
              onClick={() => setActiveSourceId(src.id)}
              className={`whitespace-nowrap px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                ${activeSourceId === src.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              <Folder size={16} /> {src.name}
            </button>
          ))}
        </div>

        <div className="relative mb-5 w-full sm:w-72">
          <select
            value={activeCategory}
            onChange={(e) => setActiveCategory(e.target.value)}
            className="w-full appearance-none bg-slate-800 border border-slate-700 text-slate-200 px-4 py-2.5 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-medium cursor-pointer shadow-lg"
          >
            {categories.map((cat) => (
              <option key={cat.name} value={cat.name} className="bg-slate-900 text-slate-200">
                {cat.name} ({cat.count})
              </option>
            ))}
          </select>
          <div className="absolute inset-y-0 right-0 flex items-center px-4 pointer-events-none text-slate-400">
            <ChevronDown size={18} />
          </div>
        </div>
      </div>

      {isSearching && (
        <div className="mb-6 text-sm text-blue-400 font-medium">
          Showing results for "{debouncedSearch}"...
        </div>
      )}

      {/* CHANNEL GRID */}
      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-24">
        {channels.length === 0 && !isLoading ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-500">
            <Tv2 size={48} className="mb-4 opacity-20" />
            <p>No channels found here.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {channels.map((channel, index) => (
              <div 
                key={`${channel.id}-${index}`} 
                onClick={(e) => handleCardClick(e, channel)}
                onTouchStart={() => handleTouchStart(channel.stream_url)}
                onTouchEnd={handleTouchEnd}
                onTouchMove={handleTouchEnd}
                onMouseDown={() => handleTouchStart(channel.stream_url)}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
                className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer group flex flex-col relative select-none"
              >
                {/* ACTION ICONS (Favorites & External) */}
                <div className="absolute top-2 right-2 z-10 flex gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => openExternal(e, channel.stream_url)}
                    className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg text-slate-200 hover:text-white backdrop-blur-sm transition-colors"
                  >
                    <ExternalLink size={16} />
                  </button>
                  <button
                    onClick={(e) => toggleFavorite(e, channel)}
                    className="p-1.5 bg-black/60 hover:bg-black/80 rounded-lg backdrop-blur-sm transition-colors"
                  >
                    <Star 
                      size={16} 
                      className={favorites.has(channel.id) ? "fill-yellow-400 text-yellow-400" : "text-slate-200 hover:text-white"} 
                    />
                  </button>
                </div>

                <div className="aspect-video bg-slate-950 relative flex items-center justify-center p-4">
                  {channel.logo_url ? (
                    <img 
                      src={channel.logo_url} 
                      alt={channel.name} 
                      className="max-h-full max-w-full object-contain drop-shadow-lg group-hover:scale-110 transition-transform duration-300 pointer-events-none"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`text-slate-700 ${channel.logo_url ? 'hidden' : ''}`}>
                    <ImageIcon size={32} />
                  </div>
                  
                  <div className="absolute inset-0 bg-blue-600/0 group-hover:bg-blue-600/20 transition-colors flex items-center justify-center">
                    <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transform scale-75 group-hover:scale-100 transition-all shadow-lg">
                      <Play size={20} className="ml-1" />
                    </div>
                  </div>
                </div>
                
                <div className="p-3 border-t border-slate-800 flex-1 flex flex-col justify-between">
                  <h3 className="text-slate-200 font-medium text-sm line-clamp-2 leading-tight group-hover:text-blue-400 transition-colors">
                    {channel.name}
                  </h3>
                  <div className="mt-2 text-xs text-slate-500 font-medium truncate">
                    {channel.channel_group || 'Uncategorized'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LOAD MORE BUTTON */}
        {hasMore && channels.length > 0 && (
          <div className="w-full py-8 flex justify-center">
            <button
              onClick={() => loadMoreChannels(false)}
              disabled={isLoading}
              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-full border border-slate-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin text-blue-500" size={18} />
                  Loading...
                </>
              ) : (
                'Load More Channels'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}