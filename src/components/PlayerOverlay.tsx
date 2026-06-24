import { useState, useEffect } from 'react';
import { X, AlertTriangle, ExternalLink } from 'lucide-react';
import { useAppStore } from '../store';
import VideoEngine from './VideoEngine';

export default function PlayerOverlay() {
  const { streamUrl, channelName, closePlayer } = useAppStore();
  const [isPipActive, setIsPipActive] = useState(false);
  const [terminalError, setTerminalError] = useState<{title: string, desc: string, raw: string} | null>(null);

  useEffect(() => {
    if (!streamUrl) {
      setIsPipActive(false);
      setTerminalError(null);
      return;
    }

    // TIER 1 ERROR: Catch unplayable protocols instantly
    if (!streamUrl.startsWith('http')) {
      setTerminalError({
        title: "External Protocol",
        desc: "This stream uses a special format and must be opened in an external player.",
        raw: `Unsupported protocol: ${streamUrl.split(':')[0]}`
      });
    } else {
      setTerminalError(null);
    }

    // Hardware Back Button Integration
    window.history.pushState({ playerOpen: true }, '');
    const handlePopState = () => {
      setIsPipActive(false);
      closePlayer();
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [streamUrl, closePlayer]);

  useEffect(() => {
    const handlePipChange = (e: Event) => setIsPipActive((e as CustomEvent).detail);
    const handleForceClose = () => {
      setIsPipActive(false);
      closePlayer();
      if (window.history.state?.playerOpen) window.history.go(-1);
    };
    window.addEventListener('pip-status', handlePipChange);
    window.addEventListener('force-close-player', handleForceClose);
    return () => {
      window.removeEventListener('pip-status', handlePipChange);
      window.removeEventListener('force-close-player', handleForceClose);
    };
  }, [closePlayer]);

  if (!streamUrl) return null;

  const handleManualClose = () => {
    if (window.history.state?.playerOpen) window.history.back(); 
    else { setIsPipActive(false); closePlayer(); }
  };

  const launchExternalPlayer = () => {
    try {
      const isAndroid = /Android/i.test(navigator.userAgent);
      let targetUrl = streamUrl;
      if (isAndroid) {
        const match = streamUrl.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
        if (match) {
          const scheme = match[1];
          const path = match[2];
          targetUrl = `intent://${path}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(channelName || 'Live Channel')};end;`;
        }
      } else {
        targetUrl = `vlc://${streamUrl}`;
      }
      window.location.href = targetUrl;
    } catch (error) { console.error(error); }
  };

  return (
    <div className={`transition-all duration-300 ${
      isPipActive 
        ? 'fixed bottom-0 right-0 w-0 h-0 opacity-0 pointer-events-none z-0' 
        : 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm p-0 md:p-6 pointer-events-auto animate-in fade-in duration-200'
    }`}>
      <div className={`flex flex-col w-full max-w-5xl h-full md:h-[85vh] bg-black md:border border-slate-700 md:rounded-xl shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-200 ${isPipActive ? 'hidden' : ''}`}>
        
        {/* Header Bar */}
        <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-b from-black/80 to-transparent absolute top-0 w-full z-40 pointer-events-auto transition-opacity">
          <div className="flex items-center gap-3 overflow-hidden drop-shadow-md">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
            <h2 className="text-lg font-bold text-white truncate pr-4">{channelName}</h2>
          </div>
          <button onClick={handleManualClose} className="p-2 ml-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0 backdrop-blur-md">
            <X size={24} />
          </button>
        </div>
        
        <div className="flex-1 w-full h-full bg-black relative">
          {terminalError ? (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-[#0a0c10] text-center p-6">
              <AlertTriangle size={64} className="text-yellow-500 mb-5 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)]" />
              <h3 className="text-2xl font-bold text-white mb-2 tracking-wide">{terminalError.title}</h3>
              <p className="text-slate-300 mb-6 max-w-md text-sm sm:text-base leading-relaxed">{terminalError.desc}</p>
              <div className="bg-black/50 border border-slate-800/50 rounded-lg p-3.5 mb-8 w-full max-w-lg shadow-inner">
                <p className="text-red-400 font-mono text-xs break-all text-left">{terminalError.raw}</p>
              </div>
              <button onClick={launchExternalPlayer} className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-3 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:scale-105">
                <ExternalLink size={20} /> Open External
              </button>
            </div>
          ) : (
            <VideoEngine streamUrl={streamUrl} />
          )}
        </div>

      </div>
    </div>
  );
}