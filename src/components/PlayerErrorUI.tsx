import { AlertTriangle, ExternalLink, WifiOff, RefreshCw, ShieldAlert } from 'lucide-react';
import { ErrorState } from '../utils/errorHandler';

interface PlayerErrorUIProps {
  errorUI: ErrorState;
  onRetryProxy: () => void;
  onPlayExternalProxy: () => void;
  onPlayExternalNative: () => void;
}

export default function PlayerErrorUI({ errorUI, onRetryProxy, onPlayExternalProxy, onPlayExternalNative }: PlayerErrorUIProps) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0c10]/95 backdrop-blur-sm text-center p-6 animate-in fade-in duration-300">
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
        <button onClick={onRetryProxy} className="px-5 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 shadow-lg shadow-indigo-900/20 transition-all">
          <RefreshCw size={18} /> Retry with Proxy
        </button>
        <button onClick={onPlayExternalProxy} className="px-5 py-3 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all">
          <ExternalLink size={18} /> Play External (with Proxy)
        </button>
        <button onClick={onPlayExternalNative} className="px-5 py-3 bg-slate-700 hover:bg-slate-600 border border-slate-600 text-white text-sm font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)]">
          <ExternalLink size={18} /> Play External (without Proxy)
        </button>
      </div>
    </div>
  );
}