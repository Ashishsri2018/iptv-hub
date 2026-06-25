import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../store';
import VideoEngine from './VideoEngine';

export default function PlayerOverlay() {
  const { streamUrl, channelName, closePlayer } = useAppStore();
  const [isPipActive, setIsPipActive] = useState(false);

  useEffect(() => {
    if (!streamUrl) {
      setIsPipActive(false);
      return;
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
    
    window.addEventListener('pip-status', handlePipChange);
    return () => {
      window.removeEventListener('pip-status', handlePipChange);
    };
  }, []);

  if (!streamUrl) return null;

  const handleManualClose = () => {
    if (window.history.state?.playerOpen) window.history.back(); 
    else { setIsPipActive(false); closePlayer(); }
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
          <VideoEngine streamUrl={streamUrl} />
        </div>

      </div>
    </div>
  );
}