import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Search, Tv2, Loader2, Image as ImageIcon, Folder } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';
import { useNavigate } from 'react-router-dom';

export default function Channels() {
  const navigate = useNavigate();
  const { setPlayingChannel } = useAppStore();
  
  // UI Data States
  const [sources, setSources] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(['All']);
  const [channels, setChannels] = useState<any[]>([]);
  
  // Selection States
  const [activeSourceId, setActiveSourceId] = useState('All');
  const [activeCategory, setActiveCategory] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  
  // Pagination States
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Background Tracker
  const engineRefs = useRef({
    offset: 0,
    isFetching: false,
    hasMore: true,
    sourceId: 'All',
    category: 'All',
    search: ''
  });

  // 1. Fetch Playlists (Sources) on initial load
  useEffect(() => {
    fetch(`${API_URL}/api/sources`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          setSources(data);
          if (data.length > 0) setActiveSourceId(data[0].id); // Auto-select first playlist
        }
      })
      .catch(err => console.error("Failed to load sources", err));
  }, []);

  // 2. Fetch Categories whenever the active Playlist changes
  useEffect(() => {
    if (activeSourceId) {
      fetch(`${API_URL}/api/categories?sourceId=${activeSourceId}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            setCategories(['All', ...data]);
            setActiveCategory('All'); // Reset category to 'All' when swapping playlists
          }
        })
        .catch(err => console.error("Failed to load categories", err));
    }
  }, [activeSourceId]);

  // 3. Debounce Search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 500);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // 4. Keep engine synced
  useEffect(() => {
    engineRefs.current.sourceId = activeSourceId;
    engineRefs.current.category = activeCategory;
    engineRefs.current.search = debouncedSearch;
  }, [activeSourceId, activeCategory, debouncedSearch]);

  // 5. Core Fetching Engine
  const loadMoreChannels = useCallback(async (reset = false) => {
    const engine = engineRefs.current;

    if (engine.isFetching) return;
    if (!reset && !engine.hasMore) return;

    engine.isFetching = true;
    setIsLoading(true);

    try {
      if (reset) engine.offset = 0;

      const url = new URL('/api/channels', window.location.origin);
      url.searchParams.append('limit', '100');
      url.searchParams.append('offset', engine.offset.toString());
      
      if (engine.sourceId !== 'All') url.searchParams.append('sourceId', engine.sourceId);
      if (engine.category !== 'All') url.searchParams.append('category', engine.category);
      if (engine.search.trim() !== '') url.searchParams.append('search', engine.search.trim());

      const response = await fetch(url.toString());
      const data = await response.json();

      // Safe fallback logic just in case
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
      console.error("Failed to fetch channels", error);
    } finally {
      engine.isFetching = false;
      setIsLoading(false);
    }
  }, []);

  // 6. Trigger channel reload when selections change
  useEffect(() => {
    setChannels([]); 
    loadMoreChannels(true);
  }, [activeSourceId, activeCategory, debouncedSearch, loadMoreChannels]);

  const handlePlay = (channel: any) => {
    setPlayingChannel(channel.stream_url, channel.name, channel.logo_url);
    navigate('/');
  };

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
            placeholder="Search all playlists globally..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-full pl-10 pr-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 transition-all"
          />
        </div>
      </div>

      {/* DOUBLE NAVIGATION BARS (Hidden during Global Search) */}
      {!isSearching && (
        <div className="mb-4">
          {/* Main Tabs: Playlists (Sources) */}
          <div className="flex overflow-x-auto pb-3 gap-2 custom-scrollbar shrink-0 border-b border-slate-800/50 mb-3">
            {sources.length > 1 && (
              <button
                onClick={() => setActiveSourceId('All')}
                className={`whitespace-nowrap px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                  ${activeSourceId === 'All' 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
              >
                <Folder size={16} /> All Playlists
              </button>
            )}
            {sources.map((src) => (
              <button
                key={src.id}
                onClick={() => setActiveSourceId(src.id)}
                className={`whitespace-nowrap px-5 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all
                  ${activeSourceId === src.id 
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' 
                    : 'bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                  }`}
              >
                <Folder size={16} /> {src.name}
              </button>
            ))}
          </div>

          {/* Sub-Tabs: Categories inside the active Playlist */}
          <div className="flex overflow-x-auto pb-4 gap-2 custom-scrollbar shrink-0">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors border
                  ${activeCategory === cat 
                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                    : 'bg-slate-900 border-slate-700/50 text-slate-400 hover:text-slate-300'
                  }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Global Search Header (Shows if typing) */}
      {isSearching && (
        <div className="mb-6 text-sm text-blue-400 font-medium">
          Showing global search results for "{debouncedSearch}"...
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
                onClick={() => handlePlay(channel)}
                className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden hover:border-blue-500/50 transition-all cursor-pointer group flex flex-col"
              >
                <div className="aspect-video bg-slate-950 relative flex items-center justify-center p-4">
                  {channel.logo_url ? (
                    <img 
                      src={channel.logo_url} 
                      alt={channel.name} 
                      className="max-h-full max-w-full object-contain drop-shadow-lg group-hover:scale-110 transition-transform duration-300"
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