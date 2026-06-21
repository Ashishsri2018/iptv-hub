import { useState, useEffect, useRef, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import Fuse from 'fuse.js';
import { Search, Play, Star, ChevronRight, ChevronDown, Folder, Loader2, AlertCircle, ExternalLink, CheckCircle, X } from 'lucide-react';
import { useAppStore } from '../store';
import { API_URL } from '../config';

interface Channel { id: string; source_id: string; name: string; channel_group: string; logo_url: string | null; stream_url: string; source_name?: string; isFavorite?: boolean; }
interface Source { id: string; name: string; }

type VirtualRow = 
  | { type: 'header'; id: string; name: string; count: number }
  | { type: 'subheader'; id: string; letter: string }
  | { type: 'channel'; id: string; data: Channel }
  | { type: 'spacer'; id: string };

export default function Channels() {
  const { playChannel } = useAppStore(); 
  
  const [channels, setChannels] = useState<Channel[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('All');
  
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  
  const parentRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    const fetchLiveData = async () => {
      try {
        const [channelsRes, sourcesRes, favsRes] = await Promise.all([
          fetch(`${API_URL}/api/channels`), fetch(`${API_URL}/api/sources`), fetch(`${API_URL}/api/favorites`)
        ]);

        const rawChannels = await channelsRes.json();
        const rawSources = await sourcesRes.json();
        const favs = await favsRes.json();

        if (rawChannels.error) throw new Error(`Channels DB Error: ${rawChannels.error}`);
        if (rawSources.error) throw new Error(`Sources DB Error: ${rawSources.error}`);

        const sortedSources = [...rawSources].sort((a, b) => a.id.localeCompare(b.id));
        setSources(sortedSources);

        const favIds = new Set(Array.isArray(favs) ? favs.map(f => f.id) : []);

        if (Array.isArray(rawChannels)) {
          const mappedChannels = rawChannels.map(ch => {
            const src = rawSources.find((s: Source) => s.id === ch.source_id);
            return { ...ch, source_name: src ? src.name : 'Unknown Playlist', isFavorite: favIds.has(ch.id) };
          });
          setChannels(mappedChannels);
        }
      } catch (error: any) {
        console.error("Fetch Data Error:", error);
        setErrorMsg(`System Error: ${error.message || "Failed to fetch data."}`);
      } finally {
        setLoading(false);
      }
    };
    fetchLiveData();
  }, []);

  const handleTouchStart = (url: string) => {
    pressTimer.current = setTimeout(() => {
      navigator.clipboard.writeText(url)
        .then(() => showToast("Link Copied!", 'success'))
        .catch(err => showToast(`Copy Failed: ${err.message}`, 'error'));
    }, 800); 
  };

  const handleTouchEnd = () => { if (pressTimer.current) clearTimeout(pressTimer.current); };

  const toggleFavorite = async (e: React.MouseEvent, channelId: string, currentlyFavorite: boolean) => {
    e.stopPropagation();
    setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, isFavorite: !currentlyFavorite } : ch));
    try {
      let res;
      if (currentlyFavorite) res = await fetch(`${API_URL}/api/favorites/${channelId}`, { method: 'DELETE' });
      else res = await fetch(`${API_URL}/api/favorites`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel_id: channelId }) });
      
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
    } catch (err: any) {
      setChannels(prev => prev.map(ch => ch.id === channelId ? { ...ch, isFavorite: currentlyFavorite } : ch));
      showToast(`Save Failed: ${err.message}`, 'error');
    }
  };

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
          // We removed the forced VLC package. The OS will now securely handle the handoff.
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

  const filteredChannels = useMemo(() => {
    if (searchQuery) return channels;
    if (selectedSourceId === 'All') return channels;
    return channels.filter(ch => ch.source_id === selectedSourceId);
  }, [channels, selectedSourceId, searchQuery]);

  const groupedData = useMemo(() => {
    const groups: Record<string, Channel[]> = {};
    filteredChannels.forEach(ch => {
      let groupName = ch.channel_group || 'Other';
      if (!groups[groupName]) groups[groupName] = [];
      groups[groupName].push(ch);
    });

    return Object.keys(groups).sort((a, b) => a.localeCompare(b)).map(name => {
      const letterGroups: Record<string, Channel[]> = {};
      groups[name].forEach(ch => {
        let firstChar = ch.name.charAt(0).toUpperCase();
        if (!/[A-Z0-9]/.test(firstChar)) firstChar = '#';
        if (!letterGroups[firstChar]) letterGroups[firstChar] = [];
        letterGroups[firstChar].push(ch);
      });

      const letters = Object.keys(letterGroups)
        .sort((a, b) => a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b))
        .map(letter => ({
          letter,
          channels: letterGroups[letter].sort((a, b) => a.name.localeCompare(b.name))
        }));

      return { name, count: groups[name].length, letters };
    });
  }, [filteredChannels]);

  const searchResults = useMemo(() => {
    if (!searchQuery) return null;
    const fuse = new Fuse(filteredChannels, { keys: ['name', 'channel_group', 'source_name'], threshold: 0.3, useExtendedSearch: true });
    const formattedQuery = searchQuery.split(' ').map(word => `'${word}`).join(' ');
    return fuse.search(formattedQuery).map(res => res.item);
  }, [filteredChannels, searchQuery]);

  const virtualRows: VirtualRow[] = useMemo(() => {
    if (searchResults) return searchResults.map(ch => ({ type: 'channel', id: ch.id, data: ch }));
    const rows: VirtualRow[] = [];
    groupedData.forEach(group => {
      rows.push({ type: 'header', id: `header-${group.name}`, name: group.name, count: group.count });
      
      if (expandedGroups.has(group.name)) {
        group.letters.forEach(lg => {
          rows.push({ type: 'subheader', id: `sub-${group.name}-${lg.letter}`, letter: lg.letter });
          lg.channels.forEach(ch => rows.push({ type: 'channel', id: ch.id, data: ch }));
        });
        rows.push({ type: 'spacer', id: `spacer-${group.name}` });
      }
    });
    return rows;
  }, [groupedData, searchResults, expandedGroups]);

  const virtualizer = useVirtualizer({ 
    count: virtualRows.length, 
    getScrollElement: () => parentRef.current, 
    estimateSize: (index) => {
      if (virtualRows[index].type === 'header') return 56;
      if (virtualRows[index].type === 'subheader') return 32;
      if (virtualRows[index].type === 'spacer') return 24; 
      return 76; 
    }, 
    overscan: 10 
  });

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  if (errorMsg) return (
    <div className="flex flex-col items-center justify-center h-full p-6 text-center">
      <AlertCircle size={48} className="text-red-500 mb-4" />
      <h2 className="text-xl font-bold text-slate-100 mb-2">Connection Failed</h2>
      <p className="text-red-400 bg-red-950/30 p-4 rounded-lg font-mono text-sm break-all">{errorMsg}</p>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-slate-900 relative">
      
      <div className="border-b border-slate-800 bg-slate-950 shrink-0 z-10 shadow-sm flex flex-col">
        <div className="p-4 pb-3 relative max-w-2xl mx-auto w-full flex items-center">
          <Search className="absolute left-7 text-slate-400" size={18} />
          <input 
            type="text" placeholder="Search across all lists..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-10 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors shadow-inner"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-7 p-1 text-slate-400 hover:text-white transition-colors bg-slate-800 hover:bg-slate-700 rounded-full"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {!searchQuery && (
          <div className="flex overflow-x-auto gap-2 px-4 py-3 custom-scrollbar items-center bg-slate-900/30">
            <button 
              onClick={() => setSelectedSourceId('All')} 
              className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all shadow-sm border ${selectedSourceId === 'All' ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
            >
              All Channels
            </button>
            {sources.map(s => (
              <button 
                key={s.id} onClick={() => setSelectedSourceId(s.id)} 
                className={`px-4 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all shadow-sm border ${selectedSourceId === s.id ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto p-2 sm:p-4 pb-32 custom-scrollbar bg-slate-900/50 select-none">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }} className="max-w-4xl mx-auto">
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const row = virtualRows[virtualItem.index];

            if (row.type === 'spacer') {
              return <div key={virtualItem.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '24px', transform: `translateY(${virtualItem.start}px)` }} />;
            }

            if (row.type === 'header') {
              const isExpanded = expandedGroups.has(row.name);
              return (
                <div key={virtualItem.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '56px', transform: `translateY(${virtualItem.start}px)` }} className="px-2 py-1 box-border">
                  <button 
                    onClick={() => {
                      setExpandedGroups(prev => {
                        const next = new Set(prev);
                        if (next.has(row.name)) next.delete(row.name); else next.add(row.name);
                        return next;
                      });
                    }} 
                    className={`w-full h-full flex items-center justify-between px-3 rounded-lg border transition-all ${isExpanded ? 'bg-blue-900/20 border-blue-800/50 text-blue-100' : 'bg-slate-950 border-slate-800 hover:border-slate-600 text-slate-200'}`}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Folder size={18} className={`shrink-0 ${isExpanded ? 'text-blue-400' : 'text-slate-500'}`} />
                      <span className="font-semibold text-lg truncate max-w-[200px] sm:max-w-xs md:max-w-md text-left">{row.name}</span>
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 text-xs font-medium text-slate-400 shrink-0">{row.count}</span>
                    </div>
                    {isExpanded ? <ChevronDown size={20} className="text-blue-400 shrink-0" /> : <ChevronRight size={20} className="text-slate-500 shrink-0" />}
                  </button>
                </div>
              );
            }

            if (row.type === 'subheader') {
              return (
                <div key={virtualItem.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '32px', transform: `translateY(${virtualItem.start}px)` }} className="px-4 flex items-end ml-4 border-l-2 border-slate-800 box-border pb-1">
                   <span className="text-sm font-bold text-slate-500 uppercase leading-none">{row.letter}</span>
                </div>
              );
            }

            const isExternalOnly = !row.data.stream_url.startsWith('http');
            
            return (
              <div key={virtualItem.key} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '76px', transform: `translateY(${virtualItem.start}px)` }} className="px-2 py-1 box-border">
                <div 
                  onMouseDown={() => handleTouchStart(row.data.stream_url)} onMouseUp={handleTouchEnd} onMouseLeave={handleTouchEnd} onTouchStart={() => handleTouchStart(row.data.stream_url)} onTouchEnd={handleTouchEnd}
                  className="flex items-center justify-between px-3 bg-slate-900 border border-slate-800/80 rounded-lg hover:bg-slate-800 transition-colors ml-4 sm:ml-8 cursor-pointer h-full"
                >
                  <div className="flex items-center gap-3 sm:gap-4 overflow-hidden" onClick={(e) => { 
                    e.stopPropagation(); 
                    if(!isExternalOnly) playChannel(row.data.stream_url, row.data.name); 
                    else launchExternalPlayer(e, row.data.stream_url, row.data.name); 
                  }}>
                    <div className="w-12 h-12 bg-slate-950 rounded border border-slate-800 flex items-center justify-center shrink-0 overflow-hidden relative">
                      {row.data.logo_url ? <img src={row.data.logo_url} alt="" loading="lazy" className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden'); }} /> : null}
                      <div className={`font-bold text-slate-500 absolute ${row.data.logo_url ? 'hidden' : ''}`}>{row.data.name.charAt(0).toUpperCase()}</div>
                    </div>
                    <div className="truncate pr-4 flex flex-col justify-center">
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-slate-100 truncate text-base sm:text-lg leading-tight">{row.data.name}</h3>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-wider font-semibold mt-1 truncate">{row.data.source_name}</p>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={(e) => toggleFavorite(e, row.data.id, !!row.data.isFavorite)} className={`p-1.5 transition-colors ${row.data.isFavorite ? 'text-yellow-400' : 'text-slate-500 hover:text-yellow-400'}`}>
                      <Star size={18} className={row.data.isFavorite ? "fill-yellow-400" : ""} />
                    </button>
                    
                    {isExternalOnly ? (
                      <button onClick={(e) => launchExternalPlayer(e, row.data.stream_url, row.data.name)} className="p-1.5 bg-purple-600/10 text-purple-500 hover:bg-purple-600 hover:text-white rounded-lg transition-colors ml-1" title="External Player Only">
                        <ExternalLink size={18} />
                      </button>
                    ) : (
                      <>
                        <button onClick={(e) => launchExternalPlayer(e, row.data.stream_url, row.data.name)} className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors" title="Play Externally (VLC)">
                          <ExternalLink size={18} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); playChannel(row.data.stream_url, row.data.name); }} className="p-1.5 bg-blue-600/10 text-blue-500 hover:bg-blue-600 hover:text-white rounded-lg transition-colors ml-1" title="Play in Browser">
                          <Play size={18} className="fill-current" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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