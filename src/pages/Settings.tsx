import { useState, useEffect, useRef, useMemo } from 'react';
import { Settings as SettingsIcon, Save, MonitorPlay, RefreshCw, Loader2, CheckCircle, AlertCircle, Languages, Subtitles, ChevronDown, Database, Search, Code, Info } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';

interface AppSettings {
  default_quality: string;
  auto_refresh_interval: string;
  default_audio: string;
  default_subtitle: string;
  global_metadata: string;
}

type MetaLevel = 'global' | 'playlist' | 'channel';

export default function Settings() {
  const fetchGlobalSettings = useAppStore(state => state.fetchSettings);

  // --- BASIC SETTINGS STATE ---
  const [settings, setSettings] = useState<AppSettings>({
    default_quality: 'auto',
    auto_refresh_interval: 'never',
    default_audio: '',
    default_subtitle: '',
    global_metadata: '{}'
  });
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // --- METADATA EDITOR STATE ---
  const [metaLevel, setMetaLevel] = useState<MetaLevel>('global');
  const [sources, setSources] = useState<any[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>('');
  
  // Channel Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);

  // Editor State
  const [editorJson, setEditorJson] = useState<string>('{}');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaStatus, setMetaStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // Timers & Controllers
  const statusTimer = useRef<number | null>(null);
  const metaStatusTimer = useRef<number | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Initial Load (Settings & Sources)
  useEffect(() => {
    abortControllerRef.current = new AbortController();

    const fetchInitialData = async () => {
      try {
        // Fetch Settings
        const resSettings = await fetch(`${API_URL}/api/settings`, { signal: abortControllerRef.current?.signal });
        if (resSettings.ok) {
          const data = await resSettings.json();
          const loadedSettings = {
            default_quality: data.default_quality || 'auto',
            auto_refresh_interval: data.auto_refresh_interval || 'never',
            default_audio: data.default_audio || '',
            default_subtitle: data.default_subtitle || '',
            global_metadata: data.global_metadata || '{}'
          };
          setSettings(loadedSettings);
          setOriginalSettings(loadedSettings);
          setEditorJson(loadedSettings.global_metadata); // Default editor view
        }

        // Fetch Sources for Dropdown
        const resSources = await fetch(`${API_URL}/api/sources`, { signal: abortControllerRef.current?.signal });
        if (resSources.ok) {
          const sourcesData = await resSources.json();
          setSources(sourcesData);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Failed to load initial data:", error);
          setStatus({ type: 'error', message: 'Failed to load settings from server.' });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();

    return () => {
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
      if (metaStatusTimer.current) window.clearTimeout(metaStatusTimer.current);
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // --- METADATA SELECTION LOGIC ---
  useEffect(() => {
    if (metaLevel === 'global') {
      setEditorJson(settings.global_metadata || '{}');
      setSearchQuery('');
      setSelectedChannel(null);
    } else if (metaLevel === 'playlist') {
      const src = sources.find(s => s.id === selectedSourceId);
      setEditorJson(src?.playlist_metadata || '{}');
      setSearchQuery('');
      setSelectedChannel(null);
    } else if (metaLevel === 'channel') {
      setEditorJson(selectedChannel?.raw_metadata || '{}');
    }
  }, [metaLevel, selectedSourceId, selectedChannel, settings.global_metadata, sources]);

  // --- JSON VALIDATION ENGINE ---
  useEffect(() => {
    try {
      if (!editorJson || editorJson.trim() === '') {
        setJsonError('Metadata cannot be empty. Use {} for empty metadata.');
        return;
      }
      JSON.parse(editorJson);
      setJsonError(null);
    } catch (e: any) {
      setJsonError(`Invalid JSON: ${e.message}`);
    }
  }, [editorJson]);

  // --- LIVE CHANNEL SEARCH ---
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchQuery(val);
    
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    if (!val.trim() || !selectedSourceId) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`${API_URL}/api/channels?sourceId=${selectedSourceId}&search=${encodeURIComponent(val)}&limit=15`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.data || []);
        }
      } catch (err) {
        console.error("Search failed", err);
      } finally {
        setIsSearching(false);
      }
    }, 400);
  };

  // --- RESOLVED CONTEXT CALCULATOR ---
  const resolvedContext = useMemo(() => {
    try {
      const g = settings.global_metadata ? JSON.parse(settings.global_metadata) : {};
      if (metaLevel === 'global') return { message: "Global settings act as the ultimate baseline. They have no parent context." };
      
      const s = sources.find(src => src.id === selectedSourceId);
      const p = s?.playlist_metadata ? JSON.parse(s.playlist_metadata) : {};
      
      if (metaLevel === 'playlist') return { ...g }; // Context is Global
      
      if (metaLevel === 'channel') return { ...g, ...p }; // Context is Global + Playlist merged
      
      return {};
    } catch { return { error: "Failed to parse parent context." }; }
  }, [settings.global_metadata, metaLevel, selectedSourceId, sources]);

  // --- SAVING LOGIC (BASIC SETTINGS) ---
  const handleSaveBasic = async () => {
    setSaving(true);
    setStatus({ type: null, message: '' });
    if (statusTimer.current) window.clearTimeout(statusTimer.current);

    const payload: AppSettings = {
      default_quality: settings.default_quality,
      auto_refresh_interval: settings.auto_refresh_interval,
      default_audio: settings.default_audio.toLowerCase().trim(),
      default_subtitle: settings.default_subtitle.toLowerCase().trim(),
      global_metadata: settings.global_metadata // Keep existing global intact
    };

    setSettings(payload);

    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Server ignored save request.");

      setOriginalSettings(payload);
      fetchGlobalSettings();

      setStatus({ type: 'success', message: 'Playback settings saved!' });
      statusTimer.current = window.setTimeout(() => setStatus({ type: null, message: '' }), 3000);
    } catch (error: any) {
      setStatus({ type: 'error', message: `Failed to save: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  // --- SAVING LOGIC (ADVANCED METADATA) ---
  const handleSaveMetadata = async () => {
    if (jsonError) return;
    setMetaSaving(true);
    setMetaStatus({ type: null, message: '' });
    if (metaStatusTimer.current) window.clearTimeout(metaStatusTimer.current);

    try {
      // Normalize JSON format
      const cleanedJson = JSON.stringify(JSON.parse(editorJson));

      let endpoint = '';
      let payload = {};

      if (metaLevel === 'global') {
        endpoint = `${API_URL}/api/settings/metadata`;
        payload = { global_metadata: cleanedJson };
      } else if (metaLevel === 'playlist') {
        if (!selectedSourceId) throw new Error("Please select a playlist first.");
        endpoint = `${API_URL}/api/sources/${selectedSourceId}/metadata`;
        payload = { playlist_metadata: cleanedJson };
      } else if (metaLevel === 'channel') {
        if (!selectedChannel) throw new Error("Please select a channel first.");
        endpoint = `${API_URL}/api/channels/${selectedChannel.id}/metadata`;
        payload = { raw_metadata: cleanedJson };
      }

      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "Update rejected by server.");

      // Sync local state to reflect successful save
      if (metaLevel === 'global') {
        setSettings(prev => ({ ...prev, global_metadata: cleanedJson }));
        setOriginalSettings(prev => prev ? ({ ...prev, global_metadata: cleanedJson }) : null);
      } else if (metaLevel === 'playlist') {
        setSources(sources.map(s => s.id === selectedSourceId ? { ...s, playlist_metadata: cleanedJson } : s));
      } else if (metaLevel === 'channel') {
        setSelectedChannel({ ...selectedChannel, raw_metadata: cleanedJson });
      }

      fetchGlobalSettings(); // Force video player to grab new headers immediately

      setMetaStatus({ type: 'success', message: 'Metadata override saved and active!' });
      metaStatusTimer.current = window.setTimeout(() => setMetaStatus({ type: null, message: '' }), 4000);

    } catch (error: any) {
      setMetaStatus({ type: 'error', message: `Save Failed: ${error.message}` });
    } finally {
      setMetaSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  }

  const hasBasicChanges = JSON.stringify({ ...settings, global_metadata: '' }) !== JSON.stringify({ ...originalSettings, global_metadata: '' });

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Application Settings</h2>
      </div>

      <datalist id="lang-codes">
        <option value="eng">English</option>
        <option value="hin">Hindi</option>
        <option value="spa">Spanish</option>
      </datalist>

      <div className="space-y-6">
        
        {/* ========================================= */}
        {/* PLAYBACK & DATA SETTINGS                  */}
        {/* ========================================= */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <MonitorPlay className="text-slate-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-200">Playback</h3>
            </div>
            <div className="space-y-4 flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Default Quality</label>
                <div className="relative">
                  <select value={settings.default_quality} onChange={(e) => setSettings({ ...settings, default_quality: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 appearance-none text-sm">
                    <option value="auto">Auto (Adaptive Bitrate)</option>
                    <option value="high">High Quality</option>
                    <option value="low">Low Quality (Data Saver)</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-1"><Languages size={14} /> Audio</label>
                  <input type="text" list="lang-codes" value={settings.default_audio} onChange={(e) => setSettings({ ...settings, default_audio: e.target.value })} placeholder="e.g. eng" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 text-sm" />
                </div>
                <div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-400 mb-1"><Subtitles size={14} /> Subs</label>
                  <input type="text" list="lang-codes" value={settings.default_subtitle} onChange={(e) => setSettings({ ...settings, default_subtitle: e.target.value })} placeholder="e.g. eng" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-blue-500 text-sm" />
                </div>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
              <RefreshCw className="text-slate-400" size={20} />
              <h3 className="text-lg font-semibold text-slate-200">Synchronization</h3>
            </div>
            <div className="space-y-4 flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Auto-Refresh Sources</label>
                <div className="relative">
                  <select value={settings.auto_refresh_interval} onChange={(e) => setSettings({ ...settings, auto_refresh_interval: e.target.value })} className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 appearance-none text-sm">
                    <option value="never">Never (Manual Only)</option>
                    <option value="daily">Daily</option>
                    <option value="3days">Every 3 Days</option>
                    <option value="weekly">Weekly</option>
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                </div>
              </div>
              <div className="pt-4 flex items-end h-full">
                <button onClick={handleSaveBasic} disabled={saving || !hasBasicChanges} className={`w-full py-2.5 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${saving || !hasBasicChanges ? 'bg-slate-700 text-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 active:scale-95'}`}>
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  {saving ? 'Saving...' : 'Save Playback Settings'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================= */}
        {/* ADVANCED METADATA ENGINE                    */}
        {/* ========================================= */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 md:p-6 shadow-sm mt-8 relative overflow-hidden">
          {/* Background Glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-2 mb-6 border-b border-slate-800 pb-3 relative z-10">
            <Database className="text-indigo-400" size={22} />
            <h3 className="text-xl font-bold text-slate-200">Advanced Metadata Override</h3>
          </div>

          <div className="space-y-6 relative z-10">
            
            {/* TIER SELECTOR */}
            <div>
              <label className="block text-sm font-semibold text-slate-300 mb-3">1. Select Target Level</label>
              <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
                {[
                  { id: 'global', label: 'Global (All Sources)' },
                  { id: 'playlist', label: 'Specific Playlist' },
                  { id: 'channel', label: 'Specific Channel' }
                ].map(lvl => (
                  <button 
                    key={lvl.id} onClick={() => setMetaLevel(lvl.id as MetaLevel)}
                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${metaLevel === lvl.id ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
                  >
                    {lvl.label}
                  </button>
                ))}
              </div>
            </div>

            {/* CONTEXT FINDERS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(metaLevel === 'playlist' || metaLevel === 'channel') && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Target Playlist</label>
                  <div className="relative">
                    <select value={selectedSourceId} onChange={(e) => setSelectedSourceId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-indigo-500 appearance-none text-sm">
                      <option value="" disabled>-- Select a Playlist --</option>
                      {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
                  </div>
                </div>
              )}

              {metaLevel === 'channel' && selectedSourceId && (
                <div className="relative">
                  <label className="block text-sm font-medium text-slate-400 mb-1">Search Channel</label>
                  <div className="relative">
                    <input type="text" value={searchQuery} onChange={handleSearchChange} placeholder="Search by name..." className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-10 pr-4 py-2.5 text-slate-100 focus:outline-none focus:border-indigo-500 text-sm" />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                    {isSearching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-indigo-500 animate-spin" size={16} />}
                  </div>
                  
                  {searchResults.length > 0 && searchQuery && (
                    <div className="absolute top-full left-0 w-full mt-2 bg-slate-800 border border-slate-700 rounded-lg shadow-xl z-20 max-h-60 overflow-y-auto custom-scrollbar">
                      {searchResults.map(ch => (
                        <button 
                          key={ch.id} 
                          onClick={() => { setSelectedChannel(ch); setSearchQuery(ch.name); setSearchResults([]); }}
                          className="w-full text-left px-4 py-3 hover:bg-indigo-600/20 text-sm text-slate-200 border-b border-slate-700/50 last:border-0 truncate transition-colors"
                        >
                          {ch.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* EDITOR SECTION */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 pt-4">
              
              {/* Inherited Context (Read Only) */}
              <div className="lg:col-span-2 flex flex-col">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
                  <Info size={16} className="text-slate-500" /> Inherited Context
                </label>
                <div className="flex-1 bg-[#050505] border border-slate-800 rounded-lg p-4 font-mono text-[11px] text-slate-500 overflow-y-auto max-h-[300px] custom-scrollbar select-all">
                  <pre>{JSON.stringify(resolvedContext, null, 2)}</pre>
                </div>
              </div>

              {/* JSON Editor (Editable) */}
              <div className="lg:col-span-3 flex flex-col">
                <div className="flex justify-between items-end mb-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
                    <Code size={16} /> Your Overrides (JSON)
                  </label>
                  {jsonError && <span className="text-xs text-red-400 animate-pulse font-medium">Syntax Error</span>}
                </div>
                
                <textarea 
                  value={editorJson}
                  onChange={(e) => setEditorJson(e.target.value)}
                  disabled={(metaLevel === 'playlist' && !selectedSourceId) || (metaLevel === 'channel' && !selectedChannel)}
                  spellCheck="false"
                  className={`flex-1 min-h-[300px] w-full bg-[#0a0c10] border rounded-lg p-4 font-mono text-sm focus:outline-none transition-colors custom-scrollbar resize-y
                    ${jsonError ? 'border-red-500/50 text-red-200 focus:border-red-500' : 'border-indigo-900/50 text-indigo-100 focus:border-indigo-500'}
                    ${(metaLevel === 'playlist' && !selectedSourceId) || (metaLevel === 'channel' && !selectedChannel) ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                  placeholder={'{\n  "User-Agent": "VLC/3.0.0",\n  "Referer": "http://example.com"\n}'}
                />
                
                {jsonError && <div className="mt-2 text-xs text-red-400 bg-red-950/30 p-2 rounded border border-red-900/50">{jsonError}</div>}
              </div>
            </div>

            {/* Metadata Action Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
              <div className="flex-1">
                {metaStatus.type && (
                  <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border animate-in fade-in ${
                    metaStatus.type === 'success' ? 'bg-green-900/20 text-green-400 border-green-900/50' : 'bg-red-900/20 text-red-400 border-red-900/50'
                  }`}>
                    {metaStatus.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                    {metaStatus.message}
                  </div>
                )}
              </div>

              <button 
                onClick={handleSaveMetadata}
                disabled={metaSaving || !!jsonError || (metaLevel === 'playlist' && !selectedSourceId) || (metaLevel === 'channel' && !selectedChannel)}
                className={`w-full sm:w-auto px-8 py-2.5 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg 
                  ${metaSaving || !!jsonError || (metaLevel === 'playlist' && !selectedSourceId) || (metaLevel === 'channel' && !selectedChannel)
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed shadow-none' 
                    : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-900/20 active:scale-95'
                  }
                `}
              >
                {metaSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                {metaSaving ? 'Overwriting...' : 'Save Override'}
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}