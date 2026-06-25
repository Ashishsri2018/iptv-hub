import { useState, useRef } from 'react';
import { AlertTriangle, ExternalLink, WifiOff, RefreshCw, ShieldAlert, CheckCircle2 } from 'lucide-react';
import type { ErrorState } from '../utils/errorHandler';

interface PlayerErrorUIProps {
  errorUI: ErrorState;
  onRetryProxy: () => void;
  onPlayExternalProxy: () => void;
  onPlayExternalNative: () => void;
  proxyUrl: string;   // Defines the proxy URL prop
  nativeUrl: string;  // Defines the raw URL prop
}

export default function PlayerErrorUI({ errorUI, onRetryProxy, onPlayExternalProxy, onPlayExternalNative, proxyUrl, nativeUrl }: PlayerErrorUIProps) {
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  // Starts the 600ms timer when you touch the button
  const handlePressStart = (url: string, label: string) => {
    isLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      navigator.clipboard.writeText(url).catch(() => {});
      setCopiedFeedback(`Copied ${label}!`);
      setTimeout(() => setCopiedFeedback(null), 2000); // Hide toast after 2 seconds
    }, 600);
  };

  // Cancels the timer if you let go before 600ms
  const handlePressEnd = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // Prevents the normal "click" action if you just finished a long-press
  const handleClick = (action: () => void) => (e: React.MouseEvent) => {
    if (isLongPress.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    action();
  };

  const openInNewTab = () => {
    window.open(nativeUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0c10]/95 backdrop-blur-sm text-center p-6 animate-in fade-in duration-300">
      
      {/* Toast Notification for Copy Success */}
      {copiedFeedback && (
        <div className="absolute top-10 bg-green-600/95 text-white px-5 py-2.5 rounded-full flex items-center gap-2 animate-in slide-in-from-top-4 fade-in duration-300 z-[60] shadow-[0_0_20px_rgba(22,163,74,0.4)]">
          <CheckCircle2 size={18} />
          <span className="text-sm font-semibold">{copiedFeedback}</span>
        </div>
      )}

      {errorUI.title === "Connection Lost" ? (
        <WifiOff size={64} className="text-red-500 mb-5 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]" />
      ) : errorUI.title.includes("Proxy Blocked") ? (
        <ShieldAlert size={64} className="text-red-600 mb-5 drop-shadow-[0_0_15px_rgba(220,38,38,0.3)]" />
      ) : errorUI.title.includes("Geo-Blocked") ? (
        <ShieldAlert size={64} className="text-indigo-500 mb-5 drop-shadow-[0_0_15px_rgba(99,102,241,0.3)]" />
      ) : (
        <AlertTriangle size={64} className="text-yellow-500 mb-5 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)]" />
      )}
      
      <h3 className="text-xl sm:text-2xl font-bold text-white mb-2">{errorUI.title}</h3>
      <p className="text-slate-300 mb-4 max-w-md text-xs sm:text-sm">{errorUI.desc}</p>
      
      <div className="bg-black/50 border border-slate-800/50 rounded-lg p-3 mb-6 w-full max-w-lg">
        <p className="text-red-400 font-mono text-xs break-all text-left">{errorUI.raw}</p>
      </div>
      
      <div className="flex flex-col gap-3 w-full max-w-sm">
        
        {/* CONDITIONAL BUTTON: Only shows for Mixed Content errors */}
        {errorUI.title.includes("Mixed Content") && (
          <button 
            onClick={handleClick(openInNewTab)}
            onPointerDown={() => handlePressStart(nativeUrl, 'Original URL')}
            onPointerUp={handlePressEnd}
            onPointerLeave={handlePressEnd}
            onContextMenu={(e) => e.preventDefault()}
            className="px-5 py-3 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-teal-900/20 transition-all select-none touch-none"
          >
            <ExternalLink size={18} /> Open in New Tab
          </button>
        )}

        <button 
          onClick={handleClick(onRetryProxy)}
          onPointerDown={() => handlePressStart(proxyUrl, 'Proxied URL')}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 transition-all select-none touch-none"
        >
          <RefreshCw size={18} /> Retry with Proxy
        </button>
        <button 
          onClick={handleClick(onPlayExternalProxy)}
          onPointerDown={() => handlePressStart(proxyUrl, 'Proxied URL')}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          className="px-5 py-3 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all select-none touch-none"
        >
          <ExternalLink size={18} /> Play External (with Proxy)
        </button>
        <button 
          onClick={handleClick(onPlayExternalNative)}
          onPointerDown={() => handlePressStart(nativeUrl, 'Original URL')}
          onPointerUp={handlePressEnd}
          onPointerLeave={handlePressEnd}
          onContextMenu={(e) => e.preventDefault()}
          className="px-5 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)] select-none touch-none"
        >
          <ExternalLink size={18} /> Play External (without Proxy)
        </button>
      </div>
    </div>
  );
}