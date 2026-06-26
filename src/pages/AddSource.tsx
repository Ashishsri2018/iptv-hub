import React, { useState } from 'react';
import { Plus, Link as LinkIcon, FileText, Upload, Loader2, AlertCircle, CheckCircle, Tv, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { API_URL } from '../config';

// 1. IMPORT THE UNIFIED SHARED PARSER
import { parseM3UString, generateStableId } from '../shared/m3uParser';

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
    let finalName = nameInput.trim() || 'My Playlist';
    const tempSourceId = forceSourceId || `src_${crypto.randomUUID()}`;

    try {
      // 1. PRIMARY ROUTE: Pass URL strictly to Cloudflare Worker
      setStatus({ type: null, message: 'Routing fetch through Cloudflare Server...' });
      
      const res = await fetch(`${API_URL}/api/sources/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistUrl: urlInput, name: finalName, type: 'M3U URL', sourceId: forceSourceId })
      });
      
      const data = await res.json();
      
      if (res.ok && !data.error) {
        setStatus({ type: 'success', message: `Successfully imported ${data.count} channels via Cloudflare!` });
        resetForm();
        return; // Success! Exit early.
      }
      
      // If Cloudflare fails, throw to trigger fallback
      throw new Error(data.error || "Cloudflare Server failed to process URL.");

    } catch (cfError: any) {
      console.warn("Cloudflare fetch failed:", cfError.message);
      setStatus({ type: null, message: 'Cloudflare couldn\'t load the playlist. Falling back to Home IP...' });

      try {
        // 2. FALLBACK ROUTE: Fetch using Home IP
        const response = await fetch(urlInput);
        
        // STRICT PING CONNECTION CHECK
        if (!response.ok) {
           throw new Error(`Device connection rejected with status: ${response.status}`);
        }
        
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const isM3uMime = contentType.includes('mpegurl') || contentType.includes('m3u');
        
        // EXPLICIT INVALID HEADERS
        if ((contentType.includes('application/json') || contentType.includes('text/html')) && !isM3uMime) {
            throw new Error("Invalid format. The link returned a web page or JSON API, not a video stream.");
        }

        let channels: any[] = [];
        let playlistMetadata = {};

        // EXPLICIT MEDIA BYPASS
        if ((contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/dash+xml') && !isM3uMime) {
            channels = [{ id: generateStableId(tempSourceId, urlInput, finalName, 'Direct Streams'), source_id: tempSourceId, name: finalName, channel_group: 'Direct Streams', logo_url: null, stream_url: urlInput, raw_metadata: {} }];
        } else {
            // Read text safely
            const clientText = await response.text();
            const lowerText = clientText.trimStart().toLowerCase();

            // A. HTML Soft 404 Blocker
            if (lowerText.startsWith('<html') || lowerText.startsWith('<!doctype')) {
                throw new Error("The link returned an HTML error webpage (Soft 404), not a video stream.");
            } 
            // B. HLS Stream
            else if (clientText.includes('#EXT-X-TARGETDURATION') || clientText.includes('#EXT-X-STREAM-INF')) {
                channels = [{ id: generateStableId(tempSourceId, urlInput, finalName, 'Direct Streams'), source_id: tempSourceId, name: finalName, channel_group: 'Direct Streams', logo_url: null, stream_url: urlInput, raw_metadata: {} }];
            } 
            // C. Actual Playlist - KEEP VODS FOR M3U URL
            else if (clientText.trimStart().startsWith('#EXTM3U')) {
                setStatus({ type: null, message: 'Connected successfully! Parsing locally...' });
                const parsed = parseM3UString(clientText, tempSourceId, { fallbackName: finalName, keepVods: true });
                channels = parsed.channels;
                playlistMetadata = parsed.playlistMetadata;
            } 
            // D. STRICT CATCH-ALL
            else if (contentType.includes('octet-stream') || contentType === '') {
                channels = [{ id: generateStableId(tempSourceId, urlInput, finalName, 'Direct Streams'), source_id: tempSourceId, name: finalName, channel_group: 'Direct Streams', logo_url: null, stream_url: urlInput, raw_metadata: {} }];
            }
            // E. REJECT
            else {
                throw new Error("Invalid format. The URL did not return a valid M3U playlist or recognized media stream.");
            }
        }

        if (channels.length === 0) throw new Error("No live channels found (VODs were skipped).");

        setStatus({ type: null, message: `Processing ${channels.length} channel(s). Uploading to Database...` });

        // Bulk insert to Cloudflare in manageable chunks
        const CHUNK_SIZE = 5000;
        for (let i = 0; i < channels.length; i += CHUNK_SIZE) {
           const chunk = channels.slice(i, i + CHUNK_SIZE);
           
           // Safety: ensure raw_metadata is an object before sending, TS requires (c: any) here
           const chunkToSend = chunk.map((c: any) => ({
             ...c,
             raw_metadata: typeof c.raw_metadata === 'string' ? JSON.parse(c.raw_metadata) : c.raw_metadata
           }));

           const bulkRes = await fetch(`${API_URL}/api/sources/import-bulk`, {
             method: 'POST',
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ 
               sourceId: tempSourceId, 
               name: finalName, 
               type: 'M3U URL', 
               channels: chunkToSend, 
               url: urlInput,
               playlistMetadata // Send extracted EPG metadata to worker
             })
           });
           if (!bulkRes.ok) throw new Error(`Database rejected upload chunk: ${bulkRes.status}`);
        }
        
        setStatus({ type: 'success', message: `Successfully added ${channels.length} channel(s) using Home IP!` });
        resetForm();

      } catch (homeError: any) {
        setStatus({ 
          type: 'error', 
          message: `Import failed entirely.\nCloudflare: ${cfError.message}\nHome IP: ${homeError.message}` 
        });
      }
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
      
      // KEEP VODS FOR M3U FILE
      const parsed = parseM3UString(text, sourceId, { fallbackName: finalName, keepVods: true });
      const channels = parsed.channels;
      const playlistMetadata = parsed.playlistMetadata;
      
      if (channels.length === 0) throw new Error("No readable Live TV channels found in file (VODs skipped).");
      
      setStatus({ type: null, message: `Uploading ${channels.length} channels to Database...` });
      
      const CHUNK_SIZE = 5000;
      for (let i = 0; i < channels.length; i += CHUNK_SIZE) {
         const chunk = channels.slice(i, i + CHUNK_SIZE);
         
         // Safety check to prevent double-stringifying metadata, TS requires (c: any) here
         const chunkToSend = chunk.map((c: any) => ({
           ...c,
           raw_metadata: typeof c.raw_metadata === 'string' ? JSON.parse(c.raw_metadata) : c.raw_metadata
         }));

         const res = await fetch(`${API_URL}/api/sources/import-bulk`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ 
             sourceId, 
             name: finalName, 
             type: 'M3U File', 
             channels: chunkToSend,
             playlistMetadata // Send extracted EPG metadata to worker
           })
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
          <span className="flex-1 whitespace-pre-wrap">{status.message}</span>
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
                      // FIXED: Only attach payload if user typed it, otherwise send empty to trigger auto-fetch from DB
                      let payload: any = {};
                      if (activeTab === 'xtream') {
                        if (username) payload.username = username;
                        if (password) payload.password = password;
                      } else if (activeTab === 'stalker') {
                        if (macAddress) payload.macAddress = macAddress;
                      }
                      
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
