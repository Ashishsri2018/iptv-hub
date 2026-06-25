import React, { useState } from 'react';
import { Plus, Link as LinkIcon, FileText, Upload, Loader2, AlertCircle, CheckCircle, Tv, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { API_URL } from '../config';

export default function AddSource() {
  const [activeTab, setActiveTab] = useState<'url' | 'file' | 'xtream' | 'stalker'>('url');
  
  // URL State
  const [urlInput, setUrlInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  
  // File State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileNameInput, setFileNameInput] = useState('');
  
  // API States
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [macAddress, setMacAddress] = useState('');
  
  // UI States
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });
  
  // DUPLICATE HANDLER STATE
  const [duplicateSource, setDuplicateSource] = useState<any>(null);

  const resetForm = () => {
    setUrlInput(''); setNameInput('');
    setSelectedFile(null); setFileNameInput('');
    setServerUrl(''); setUsername(''); setPassword(''); setMacAddress('');
    setShowPassword(false);
  };

  const generateStableId = (sourceId: string, streamUrl: string, count: number) => {
    let hash = 5381;
    for (let i = 0; i < streamUrl.length; i++) hash = (hash * 33) ^ streamUrl.charCodeAt(i);
    const hashStr = (hash >>> 0).toString(36);
    const tail = streamUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-15);
    return `${sourceId}_${hashStr}_${tail}_${count}`;
  };

  const cleanChannelName = (name: string) => {
    return name.replace(/[\[\]\(\)\{\}]/g, ' ').replace(/\s+/g, ' ').replace(/^\s*-\s*|\s*-\s*$/g, '').trim().slice(0, 120);
  };

  // STRICT FIREWALL: Looks ONLY at the provider's URL API path (No extension checking!)
  const isVodOrRadio = (streamUrl: string) => {
    const lowerUrl = streamUrl.toLowerCase();
    
    if (lowerUrl.includes('/movie/') || lowerUrl.includes('/series/') || lowerUrl.includes('/vod/') || lowerUrl.includes('/radio/')) {
      return true;
    }
    return false;
  };

  const pushChannelLocally = (channels: any[], current: any, sourceId: string, urlCounts: Map<string, number>) => {
    if (!current.stream_url) return;
    
    // URL-Only Firewall: Drop VOD/Movies/Radio instantly
    if (isVodOrRadio(current.stream_url)) {
      return; 
    }

    const count = (urlCounts.get(current.stream_url) || 0) + 1;
    urlCounts.set(current.stream_url, count);

    channels.push({
      id: generateStableId(sourceId, current.stream_url, count),
      source_id: sourceId, 
      name: current.name || 'Unknown',
      channel_group: current.channel_group || 'Other',
      logo_url: current.logo_url, 
      stream_url: current.stream_url,
      raw_metadata: JSON.stringify(current.raw_metadata) 
    });
  };

  // CLIENT-SIDE ADVANCED PARSER (Runs on Phone/Browser)
  const parseM3ULocally = (text: string, sourceId: string) => {
    const lines = text.split(/\r?\n/);
    const channels: any[] = [];
    const urlCounts = new Map<string, number>();
    
    let currentChannel: any = { name: 'Unknown', channel_group: 'Other', logo_url: null, stream_url: null, raw_metadata: {} };
    let pendingGroup: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#EXTM3U')) continue;

      if (line.startsWith('#EXTGRP:')) { 
        pendingGroup = line.substring(8).trim(); 
        continue; 
      }

      if (line.startsWith('#EXTINF:')) {
        if (currentChannel.stream_url) {
           pushChannelLocally(channels, currentChannel, sourceId, urlCounts);
           currentChannel = { name: 'Unknown', channel_group: 'Other', logo_url: null, stream_url: null, raw_metadata: {} };
        }
        
        const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
        let match;
        while ((match = attrRegex.exec(line)) !== null) {
          const key = match[1].toLowerCase();
          const value = (match[2] || match[3] || match[4] || '').trim();
          currentChannel.raw_metadata[key] = value;

          if (key === 'group-title') currentChannel.channel_group = value;
          if (key === 'tvg-logo' || key === 'logo') currentChannel.logo_url = value;
          if (key === 'tvg-name' || key === 'tvg-id' || key === 'name') currentChannel.name = value;
          if (key === 'catchup' || key === 'timeshift') currentChannel.raw_metadata.catchup = value;
        }

        const commaIndex = line.lastIndexOf(',');
        if (commaIndex !== -1) {
          let namePart = line.substring(commaIndex + 1).trim();
          if (namePart && namePart !== '-1' && namePart.length > 1) {
            currentChannel.name = cleanChannelName(namePart);
          }
        }

        if (pendingGroup) { 
          currentChannel.channel_group = pendingGroup; 
          pendingGroup = null; 
        }
      } 
      else if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#KODIPROP:') || line.startsWith('#EXTHTTP:')) {
        const match = line.match(/#(?:EXTVLCOPT|KODIPROP|EXTHTTP):([^=]+)=(.*)/i);
        if (match) {
          let key = match[1].trim(); let val = match[2].trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
          currentChannel.raw_metadata[key] = val;
        }
      } 
      else if (/^(http|https|rtmp|udp|acestream|rtsp):\/\//i.test(line)) {
        currentChannel.stream_url = line.trim();
        if (pendingGroup) { 
          currentChannel.channel_group = pendingGroup; 
          pendingGroup = null; 
        }
        pushChannelLocally(channels, currentChannel, sourceId, urlCounts);
        currentChannel = { name: 'Unknown', channel_group: 'Other', logo_url: null, stream_url: null, raw_metadata: {} };
      }
    }
    
    // Push the final channel if exists
    if (currentChannel.stream_url) pushChannelLocally(channels, currentChannel, sourceId, urlCounts);
    
    return channels;
  };

  // --- M3U URL DUPLICATE CHECKER & EXECUTER ---
  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput) return setStatus({ type: 'error', message: 'URL is required.' });

    try {
      const res = await fetch(`${API_URL}/api/sources`);
      if (res.ok) {
        const existingSources = await res.json();
        const existing = existingSources.find((s: any) => s.url === urlInput.trim());
        if (existing) {
          setDuplicateSource(existing);
          return;
        }
      }
    } catch (err) {
      console.warn("Failed duplicate check", err);
    }

    executeUrlImport();
  };

  const executeUrlImport = async (forceSourceId?: string) => {
    setLoading(true);
    setStatus({ type: null, message: 'Testing connection from device...' });

    let finalName = nameInput.trim() || 'My Playlist';
    const tempSourceId = forceSourceId || `src_${crypto.randomUUID()}`;

    try {
      let clientText = null;
      let clientFetchSuccess = false;

      try {
        const response = await fetch(urlInput);
        if (response.ok) {
          clientText = await response.text();
          clientFetchSuccess = true;
          setStatus({ type: null, message: 'Device fetch successful. Parsing locally...' });
        }
      } catch (err) {
        console.log("Client fetch failed. Falling back to Cloudflare Worker.", err);
      }

      if (clientFetchSuccess && clientText && clientText.includes('#EXTM3U')) {
        const channels = parseM3ULocally(clientText, tempSourceId);
        if (channels.length === 0) throw new Error("File read successfully, but no valid channels found.");

        setStatus({ type: null, message: `Parsed ${channels.length} channels. Uploading to Database...` });

        const CHUNK_SIZE = 5000;
        for (let i = 0; i < channels.length; i += CHUNK_SIZE) {
           const chunk = channels.slice(i, i + CHUNK_SIZE);
           const res = await fetch(`${API_URL}/api/sources/import-bulk`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ sourceId: tempSourceId, name: finalName, type: 'M3U URL', channels: chunk, url: urlInput })
           });
           if (!res.ok) throw new Error(`Database rejected upload chunk: ${res.status}`);
        }
        
        setStatus({ type: 'success', message: `Successfully added ${channels.length} channels using Home IP!` });
        resetForm();
      } else {
        setStatus({ type: null, message: 'Routing fetch through Cloudflare Server...' });
        
        const res = await fetch(`${API_URL}/api/sources/import`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistUrl: urlInput, name: finalName, type: 'M3U URL', sourceId: forceSourceId })
        });
        
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "Server failed to process URL.");
        
        setStatus({ type: 'success', message: `Successfully imported ${data.count} channels via Cloudflare!` });
        resetForm();
      }
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message || 'Import failed. Check URL or provider blocks.' });
    } finally {
      setLoading(false);
    }
  };

  // --- API DUPLICATE CHECKER & EXECUTER ---
  const handleApiSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverUrl) return setStatus({ type: 'error', message: 'Server URL required.' });

    try {
      const res = await fetch(`${API_URL}/api/sources`);
      if (res.ok) {
        const existingSources = await res.json();
        const cleanUrl = serverUrl.replace(/\/$/, '');
        const existing = existingSources.find((s: any) => s.url === cleanUrl);
        if (existing) {
          setDuplicateSource(existing);
          return;
        }
      }
    } catch (err) {
      console.warn("Failed duplicate check", err);
    }

    executeApiImport();
  };

  const executeApiImport = async (forceSourceId?: string) => {
    setLoading(true);
    setStatus({ type: null, message: 'Connecting to Server API...' });

    let endpoint = activeTab === 'xtream' ? '/api/sources/import-xtream' : '/api/sources/import-stalker';
    let payload: any = { serverUrl, name: nameInput || `${activeTab.toUpperCase()} Server`, sourceId: forceSourceId };
    
    if (activeTab === 'xtream') {
      if (!username || !password) { setLoading(false); return setStatus({ type: 'error', message: 'Username & Password required.' }); }
      payload.username = username; payload.password = password;
    } else {
      if (!macAddress) { setLoading(false); return setStatus({ type: 'error', message: 'MAC Address required.' }); }
      payload.macAddress = macAddress;
    }

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "API Connection failed.");
      
      setStatus({ type: 'success', message: `Connected! Imported ${data.count} channels.` });
      resetForm();
    } catch (error: any) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  // --- LOCAL FILE SUBMIT ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
      if (!fileNameInput) {
        setFileNameInput(e.target.files[0].name.replace('.m3u', '').replace('.m3u8', ''));
      }
    }
  };

  const handleFileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return setStatus({ type: 'error', message: 'Please select an M3U file.' });
    
    setLoading(true);
    setStatus({ type: null, message: 'Reading file locally...' });
    
    try {
      const text = await selectedFile.text();
      if (!text.includes('#EXTM3U')) throw new Error("Invalid M3U file format.");
      
      const sourceId = `src_local_${crypto.randomUUID()}`;
      const finalName = fileNameInput.trim() || selectedFile.name;
      
      const channels = parseM3ULocally(text, sourceId);
      
      if (channels.length === 0) throw new Error("No readable channels found in file.");
      
      setStatus({ type: null, message: `Uploading ${channels.length} channels to Database...` });
      
      const CHUNK_SIZE = 5000;
      for (let i = 0; i < channels.length; i += CHUNK_SIZE) {
         const chunk = channels.slice(i, i + CHUNK_SIZE);
         const res = await fetch(`${API_URL}/api/sources/import-bulk`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ sourceId, name: finalName, type: 'M3U File', channels: chunk })
         });
         if (!res.ok) throw new Error("Database upload failed.");
      }
      
      setStatus({ type: 'success', message: `Uploaded ${channels.length} channels successfully!` });
      resetForm();
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-2xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      <div className="flex items-center gap-3 mb-8">
        <Plus className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Add New Source</h2>
      </div>

      <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 mb-8 overflow-x-auto custom-scrollbar">
        {[
          { id: 'url', icon: LinkIcon, label: 'M3U URL' },
          { id: 'file', icon: FileText, label: 'Local File' },
          { id: 'xtream', icon: Tv, label: 'Xtream API' },
          { id: 'stalker', icon: Tv, label: 'Stalker Portal' }
        ].map(tab => (
          <button 
            key={tab.id} onClick={() => { setActiveTab(tab.id as any); setStatus({ type: null, message: '' }); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-md text-sm font-medium transition-all min-w-[120px] ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {status.message && (
        <div className={`mb-6 flex items-center gap-3 px-4 py-3 rounded-lg border text-sm font-medium animate-in fade-in ${status.type === 'error' ? 'bg-red-950/30 text-red-400 border-red-900/50' : status.type === 'success' ? 'bg-green-950/30 text-green-400 border-green-900/50' : 'bg-blue-950/30 text-blue-400 border-blue-900/50'}`}>
          {status.type === 'error' ? <AlertCircle size={18} /> : status.type === 'success' ? <CheckCircle size={18} /> : <Loader2 size={18} className="animate-spin" />}
          <span className="flex-1 break-words">{status.message}</span>
        </div>
      )}

      {/* M3U URL FORM */}
      {activeTab === 'url' && (
        <form onSubmit={handleUrlSubmit} className="space-y-5 bg-slate-900 border border-slate-800 p-5 md:p-6 rounded-xl shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Playlist Name</label>
            <input type="text" value={nameInput} onChange={e => setNameInput(e.target.value)} disabled={loading} placeholder="e.g. My Premium IPTV" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">M3U URL <span className="text-red-500">*</span></label>
            <input type="url" required value={urlInput} onChange={e => setUrlInput(e.target.value)} disabled={loading} placeholder="http://example.com/playlist.m3u" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <button type="submit" disabled={loading || !urlInput} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {loading ? 'Processing...' : 'Import Playlist'}
          </button>
        </form>
      )}

      {/* LOCAL FILE FORM */}
      {activeTab === 'file' && (
        <form onSubmit={handleFileSubmit} className="space-y-5 bg-slate-900 border border-slate-800 p-5 md:p-6 rounded-xl shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Playlist Name</label>
            <input type="text" value={fileNameInput} onChange={e => setFileNameInput(e.target.value)} disabled={loading} placeholder="e.g. Local Backup" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Select M3U File <span className="text-red-500">*</span></label>
            <div className="relative border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-lg bg-slate-950 transition-colors group">
              <input type="file" accept=".m3u,.m3u8,text/plain" onChange={handleFileChange} disabled={loading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <FileText size={32} className={`mb-3 ${selectedFile ? 'text-blue-500' : 'text-slate-500 group-hover:text-blue-400'}`} />
                <p className="text-sm font-medium text-slate-300">{selectedFile ? selectedFile.name : 'Click or drag file here'}</p>
                <p className="text-xs text-slate-500 mt-1">Supports .m3u, .m3u8</p>
              </div>
            </div>
          </div>
          <button type="submit" disabled={loading || !selectedFile} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {loading ? 'Uploading...' : 'Upload & Parse File'}
          </button>
        </form>
      )}

      {/* XTREAM & STALKER FORMS */}
      {(activeTab === 'xtream' || activeTab === 'stalker') && (
        <form onSubmit={handleApiSubmit} className="space-y-5 bg-slate-900 border border-slate-800 p-5 md:p-6 rounded-xl shadow-sm">
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Playlist Name</label>
            <input type="text" value={nameInput} onChange={e => setNameInput(e.target.value)} disabled={loading} placeholder="e.g. My Provider" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1.5">Server URL <span className="text-red-500">*</span></label>
            <input type="url" required value={serverUrl} onChange={e => setServerUrl(e.target.value)} disabled={loading} placeholder="http://server.com:8080" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500" />
          </div>

          {activeTab === 'xtream' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Username <span className="text-red-500">*</span></label>
                <input type="text" required value={username} onChange={e => setUsername(e.target.value)} disabled={loading} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1.5">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <input 
                    type={showPassword ? "text" : "password"} 
                    required 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    disabled={loading} 
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-11 py-3 text-slate-100 focus:outline-none focus:border-blue-500" 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)} 
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors focus:outline-none"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1.5">MAC Address <span className="text-red-500">*</span></label>
              <input type="text" required value={macAddress} onChange={e => setMacAddress(e.target.value)} disabled={loading} placeholder="00:1A:79:..." className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500 font-mono" />
            </div>
          )}

          <p className="text-xs text-slate-500">Credentials will be securely saved to enable automatic background refreshing.</p>

          <button type="submit" disabled={loading || !serverUrl} className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors mt-2">
            {loading ? <Loader2 size={18} className="animate-spin" /> : <LinkIcon size={18} />}
            {loading ? 'Connecting...' : 'Connect to Server'}
          </button>
        </form>
      )}

      {/* --- DUPLICATE URL MODAL OVERLAY --- */}
      {duplicateSource && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="p-5 md:p-6">
              <div className="flex items-center gap-3 mb-3">
                <AlertCircle className="text-yellow-500" size={24} />
                <h3 className="text-xl font-bold text-slate-100">Playlist Already Exists</h3>
              </div>
              <p className="text-slate-300 text-sm mb-6 leading-relaxed">
                This URL is already saved in your library as "<span className="font-bold text-white">{duplicateSource.name}</span>". What would you like to do?
              </p>
              
              <div className="flex flex-col gap-3">
                <button
                  onClick={async () => {
                    const src = duplicateSource;
                    setDuplicateSource(null);
                    setLoading(true);
                    setStatus({ type: null, message: `Refreshing existing playlist "${src.name}"...` });
                    try {
                      let payload = {};
                      if (activeTab === 'xtream') payload = { username, password };
                      else if (activeTab === 'stalker') payload = { macAddress };
                      
                      const res = await fetch(`${API_URL}/api/sources/${src.id}/refresh`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                      });
                      const data = await res.json();
                      if (!res.ok || data.error) throw new Error(data.error || "Refresh failed.");
                      
                      setStatus({ type: 'success', message: `Successfully refreshed! Found ${data.count} channels.` });
                      resetForm();
                    } catch (error: any) {
                      setStatus({ type: 'error', message: error.message });
                    } finally {
                      setLoading(false);
                    }
                  }}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <RefreshCw size={18} /> Refresh Existing Data
                </button>
                
                <button
                  onClick={() => {
                    setDuplicateSource(null);
                    const newId = `src_${crypto.randomUUID()}`;
                    if (activeTab === 'url') executeUrlImport(newId);
                    else executeApiImport(newId);
                  }}
                  className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-medium py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Plus size={18} /> Add as New Playlist
                </button>
                
                <button
                  onClick={() => setDuplicateSource(null)}
                  className="w-full bg-transparent hover:bg-slate-800 text-slate-400 hover:text-slate-200 font-medium py-3 rounded-lg transition-colors mt-1"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
