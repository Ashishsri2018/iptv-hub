import { useState, useRef, useEffect } from 'react';
import { AlertTriangle, ExternalLink, WifiOff, RefreshCw, ShieldAlert, CheckCircle2, type LucideIcon } from 'lucide-react';
import type { ErrorState } from '../utils/errorHandler';

interface PlayerErrorUIProps {
  errorUI: ErrorState;
  onRetry: () => void;
  onRetryProxy: () => void;
  onPlayExternalProxy: () => void;
  onPlayExternalNative: () => void;
  proxyUrl: string;
  nativeUrl: string;
}

// FIX: Custom hook prevents memory leaks, race conditions, and isolates timer logic
const useLongPressCopy = () => {
  const [copiedFeedback, setCopiedFeedback] = useState<string | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLongPress = useRef(false);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  const start = (text: string, label: string) => {
    if (!text) return;
    isLongPress.current = false;
    pressTimer.current = setTimeout(() => {
      isLongPress.current = true;
      navigator.clipboard.writeText(text).catch(() => {});
      setCopiedFeedback(`Copied ${label}!`);
      setTimeout(() => setCopiedFeedback(null), 2000); 
    }, 600);
  };

  const end = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  // FIX: Proper TypeScript typing for the MouseEvent
  const wrapClick = (action: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    if (isLongPress.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    action();
  };

  return { copiedFeedback, start, end, wrapClick };
};

// FIX: Reusable button component drastically reduces HTML bloat and standardizes behavior
interface ErrorActionButtonProps {
  onClick: () => void;
  onCopyStart: () => void;
  onCopyEnd: () => void;
  wrapClick: (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => void;
  icon: LucideIcon;
  label: string;
  colorClass: string;
}

const ErrorActionButton = ({ onClick, onCopyStart, onCopyEnd, wrapClick, icon: Icon, label, colorClass }: ErrorActionButtonProps) => (
  <button 
    onClick={wrapClick(onClick)}
    onPointerDown={onCopyStart}
    onPointerUp={onCopyEnd}
    onPointerLeave={onCopyEnd}
    onContextMenu={(e) => e.preventDefault()}
    className={`px-5 py-3 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all select-none touch-none ${colorClass}`}
  >
    <Icon size={18} /> {label}
  </button>
);

export default function PlayerErrorUI({ errorUI, onRetry, onRetryProxy, onPlayExternalProxy, onPlayExternalNative, proxyUrl, nativeUrl }: PlayerErrorUIProps) {
  const { copiedFeedback, start, end, wrapClick } = useLongPressCopy();

  const openInNewTab = () => window.open(nativeUrl, '_blank', 'noopener,noreferrer');
  
  const isFatalBlock = errorUI.title.includes("Proxy Blocked") || errorUI.title.includes("Geo-Blocked");

  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0c10]/95 backdrop-blur-sm text-center p-6 animate-in fade-in duration-300">
      
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
        
        {errorUI.title.includes("Mixed Content") && (
          <ErrorActionButton
            onClick={openInNewTab}
            onCopyStart={() => start(nativeUrl, 'Original URL')}
            onCopyEnd={end}
            wrapClick={wrapClick}
            icon={ExternalLink}
            label="Open in New Tab"
            colorClass="bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-900/20"
          />
        )}

        {/* FIX: Hide normal retry if the provider actively blocks the current connection method */}
        {!isFatalBlock && (
          <ErrorActionButton
            onClick={onRetry}
            onCopyStart={() => start(errorUI.raw, 'Error Log')}
            onCopyEnd={end}
            wrapClick={wrapClick}
            icon={RefreshCw}
            label="Retry Connection"
            colorClass="bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-900/20"
          />
        )}

        <ErrorActionButton
          onClick={onRetryProxy}
          onCopyStart={() => start(errorUI.raw, 'Error Log')}
          onCopyEnd={end}
          wrapClick={wrapClick}
          icon={RefreshCw}
          label="Retry with Proxy"
          colorClass="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-900/20"
        />

        <ErrorActionButton
          onClick={onPlayExternalProxy}
          onCopyStart={() => start(proxyUrl, 'Proxied URL')}
          onCopyEnd={end}
          wrapClick={wrapClick}
          icon={ExternalLink}
          label="Play External (with Proxy)"
          colorClass="bg-purple-600 hover:bg-purple-700"
        />

        <ErrorActionButton
          onClick={onPlayExternalNative}
          onCopyStart={() => start(nativeUrl, 'Original URL')}
          onCopyEnd={end}
          wrapClick={wrapClick}
          icon={ExternalLink}
          label="Play External (without Proxy)"
          colorClass="bg-slate-700 hover:bg-slate-600 border border-slate-600 shadow-[0_0_15px_rgba(255,255,255,0.1)]"
        />
      </div>
    </div>
  );
}
