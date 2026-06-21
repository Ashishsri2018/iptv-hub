import { useState, useRef } from 'react';
import { Link, Upload, Server, Tv2, Loader2, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { API_URL } from '../config';

type Tab = 'm3u-url' | 'm3u-file' | 'xtream' | 'stalker';

export default function AddSource() {
  const [activeTab, setActiveTab] = useState<Tab>('m3u-url');
  
  // Shared States
  const [nameInput, setNameInput] = useState('');
  const [status, setStatus] = useState({ state: 'idle', message: '', details: '' });
  
  // Specific Form States
  const [urlInput, setUrlInput] = useState('');
  const [file, setFile] = useState<File | null>(null);
  
  const [xtreamUrl, setXtreamUrl] = useState('');
  const [xtreamUser, setXtreamUser] = useState('');
  const [xtreamPass, setXtreamPass] = useState('');
  
  const [stalkerUrl, setStalkerUrl] = useState('');
  const [stalkerMac, setStalkerMac] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleError = (error: any, context: string) => {
    console.error(context, error);
    setStatus({ 
      state: 'error', 
      message: `Failed to add ${activeTab} source.`, 
      details: error.message || "Unknown system error occurred."
    });
  };

  // 1. M3U URL Processor
  const processM3UUrl = async () => {
    if (!urlInput || !nameInput) return;
    setStatus({ state: 'loading', message: 'Commanding server to download and parse URL...', details: '' });

    try {
      const response = await fetch(`${API_URL}/api/sources/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: urlInput, name: nameInput, type: 'M3U URL' })
      });

      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

      setStatus({ state: 'success', message: `Success! Added ${data.count} channels.`, details: '' });
      setUrlInput(''); setNameInput('');
    } catch (error: any) { handleError(error, "M3U URL Error"); }
  };

  // 2. M3U File Processor (Local Parsing to bypass Cloudflare 1MB limits)
  const processM3UFile = async () => {
    if (!file || !nameInput) return;
    setStatus({ state: 'loading', message: 'Reading local file...', details: '' });

    try {
      const text = await file.text();
      setStatus({ state: 'loading', message: 'Parsing channels locally...', details: '' });

      const lines = text.split('\n');
      const channels = [];
      let currentChannel: any = {};
      const sourceId = `src_${Date.now()}`;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          const groupMatch = line.match(/group-title="([^"]+)"/i);
          currentChannel.channel_group = groupMatch ? groupMatch[1] : 'Other';
          const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
          currentChannel.logo_url = logoMatch ? logoMatch[1] : null;
          const commaSplit = line.split(',');
          currentChannel.name = commaSplit.length > 1 ? commaSplit[commaSplit.length - 1].trim() : 'Unknown';
        } else if (line.match(/^(http|https|rtmp|udp|acestream):\/\//i)) {
          currentChannel.stream_url = line;
          currentChannel.id = `${sourceId}_${i}`; // Temp ID, DB will overwrite based on URL
          channels.push({ ...currentChannel });
          currentChannel = {};
        }
      }

      if (channels.length === 0) throw new Error("No playable streams found in file.");

      setStatus({ state: 'loading', message: `Uploading ${channels.length} channels to database in chunks...`, details: '' });

      // Chunk array into batches of 500 to protect Cloudflare request limits
      const chunkSize = 500;
      for (let i = 0; i < channels.length; i += chunkSize) {
        const chunk = channels.slice(i, i + chunkSize);
        const res = await fetch(`${API_URL}/api/sources/import-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, name: nameInput, type: 'M3U File', channels: chunk })
        });
        if (!res.ok) {
           const errData = await res.json();
           throw new Error(errData.error || `Batch ${i} upload failed.`);
        }
      }

      setStatus({ state: 'success', message: `Success! Added ${channels.length} channels.`, details: '' });
      setFile(null); setNameInput('');
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (error: any) { handleError(error, "M3U File Error"); }
  };

  // 3. Xtream Codes Processor
  const processXtream = async () => {
    if (!xtreamUrl || !xtreamUser || !xtreamPass || !nameInput) return;
    setStatus({ state: 'loading', message: 'Authenticating with Xtream API...', details: '' });

    try {
      const response = await fetch(`${API_URL}/api/sources/import-xtream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: xtreamUrl, username: xtreamUser, password: xtreamPass, name: nameInput })
      });

      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

      setStatus({ state: 'success', message: `Success! Synced ${data.count} Xtream channels.`, details: '' });
      setXtreamUrl(''); setXtreamUser(''); setXtreamPass(''); setNameInput('');
    } catch (error: any) { handleError(error, "Xtream API Error"); }
  };

  // 4. Stalker Portal Processor
  const processStalker = async () => {
    if (!stalkerUrl || !stalkerMac || !nameInput) return;
    setStatus({ state: 'loading', message: 'Performing Stalker Portal Handshake...', details: '' });

    try {
      const response = await fetch(`${API_URL}/api/sources/import-stalker`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverUrl: stalkerUrl, macAddress: stalkerMac, name: nameInput })
      });

      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);

      setStatus({ state: 'success', message: `Success! Synced ${data.count} Stalker channels.`, details: '' });
      setStalkerUrl(''); setStalkerMac(''); setNameInput('');
    } catch (error: any) { handleError(error, "Stalker API Error"); }
  };

  const renderErrorBlock = () => (
    <div className="mt-4 p-4 bg-red-950/30 border border-red-900/50 rounded-lg flex flex-col gap-2 animate-in fade-in">
      <div className="flex items-center gap-2 text-red-400 font-bold">
        <AlertTriangle size={20} /> System Error Captured
      </div>
      <p className="text-red-300 text-sm">{status.message}</p>
      <div className="bg-black/50 p-2 rounded border border-red-900 overflow-x-auto">
        <code className="text-xs text-red-400 font-mono break-all">{status.details}</code>
      </div>
    </div>
  );

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      <h2 className="text-2xl font-semibold mb-6 text-slate-100">Add Data Source</h2>
      
      <div className="flex overflow-x-auto bg-slate-950 rounded-lg p-1 mb-6 border border-slate-800 shrink-0 custom-scrollbar">
        {[
          { id: 'm3u-url', label: 'M3U URL', icon: <Link size={18} /> },
          { id: 'm3u-file', label: 'M3U FILE', icon: <Upload size={18} /> },
          { id: 'xtream', label: 'XTREAM', icon: <Server size={18} /> },
          { id: 'stalker', label: 'STALKER', icon: <Tv2 size={18} /> }
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id as Tab); setStatus({ state: 'idle', message: '', details: '' }); }}
            className={`flex items-center gap-2 px-4 py-3 rounded-md text-sm font-medium transition-colors flex-1 justify-center whitespace-nowrap
              ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'}
            `}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 mb-8">
        
        {/* SHARED NAME INPUT */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-slate-400 mb-1">Source Label (Name)</label>
          <input 
            type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)}
            placeholder="e.g., My Premium Sports" 
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500" 
            disabled={status.state === 'loading'}
          />
        </div>

        {/* 1. M3U URL */}
        {activeTab === 'm3u-url' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Playlist URL</label>
              <input 
                type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/playlist.m3u" 
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 focus:outline-none focus:border-blue-500" 
                disabled={status.state === 'loading'}
              />
            </div>
            <button onClick={processM3UUrl} disabled={status.state === 'loading' || !urlInput || !nameInput} className="bg-blue-600 disabled:bg-blue-600/50 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 flex justify-center items-center gap-2">
              {status.state === 'loading' ? <Loader2 className="animate-spin" size={20} /> : 'Process on Server'}
            </button>
          </div>
        )}

        {/* 2. M3U FILE */}
        {activeTab === 'm3u-file' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Local Playlist File (.m3u)</label>
              <input 
                type="file" accept=".m3u,.m3u8,text/plain" ref={fileInputRef} onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-900/30 file:text-blue-400 hover:file:bg-blue-900/50 cursor-pointer" 
                disabled={status.state === 'loading'}
              />
            </div>
            <button onClick={processM3UFile} disabled={status.state === 'loading' || !file || !nameInput} className="bg-blue-600 disabled:bg-blue-600/50 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 flex justify-center items-center gap-2">
              {status.state === 'loading' ? <Loader2 className="animate-spin" size={20} /> : 'Parse & Upload File'}
            </button>
          </div>
        )}

        {/* 3. XTREAM CODES */}
        {activeTab === 'xtream' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Server URL</label>
              <input type="url" value={xtreamUrl} onChange={(e) => setXtreamUrl(e.target.value)} placeholder="http://domain.com:port" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100" disabled={status.state === 'loading'} />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-400 mb-1">Username</label>
                <input type="text" value={xtreamUser} onChange={(e) => setXtreamUser(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100" disabled={status.state === 'loading'} />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-slate-400 mb-1">Password</label>
                <input type="password" value={xtreamPass} onChange={(e) => setXtreamPass(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100" disabled={status.state === 'loading'} />
              </div>
            </div>
            <button onClick={processXtream} disabled={status.state === 'loading' || !xtreamUrl || !xtreamUser || !xtreamPass || !nameInput} className="bg-blue-600 disabled:bg-blue-600/50 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 flex justify-center items-center gap-2">
              {status.state === 'loading' ? <Loader2 className="animate-spin" size={20} /> : 'Connect to Xtream Server'}
            </button>
          </div>
        )}

        {/* 4. STALKER PORTAL */}
        {activeTab === 'stalker' && (
          <div className="flex flex-col gap-5">
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">Portal URL</label>
              <input type="url" value={stalkerUrl} onChange={(e) => setStalkerUrl(e.target.value)} placeholder="http://domain.com:port/c/" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100" disabled={status.state === 'loading'} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-1">MAC Address</label>
              <input type="text" value={stalkerMac} onChange={(e) => setStalkerMac(e.target.value)} placeholder="00:1A:79:XX:YY:ZZ" className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-3 text-slate-100 uppercase tracking-widest font-mono" disabled={status.state === 'loading'} maxLength={17} />
            </div>
            <button onClick={processStalker} disabled={status.state === 'loading' || !stalkerUrl || !stalkerMac || !nameInput} className="bg-blue-600 disabled:bg-blue-600/50 hover:bg-blue-700 text-white font-medium py-3 rounded-lg transition-colors mt-2 flex justify-center items-center gap-2">
              {status.state === 'loading' ? <Loader2 className="animate-spin" size={20} /> : 'Authorize MAC & Fetch Data'}
            </button>
          </div>
        )}

        {/* UI Feedback System */}
        {status.state === 'success' && (
          <div className="mt-4 p-4 bg-green-900/20 border border-green-900/50 rounded-lg flex items-center gap-3 text-green-400 animate-in fade-in">
            <CheckCircle size={20} className="shrink-0" />
            <span className="font-medium">{status.message}</span>
          </div>
        )}
        
        {status.state === 'error' && renderErrorBlock()}
      </div>
    </div>
  );
}