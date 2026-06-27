import { useEffect, useRef, useState, useMemo } from 'react';
import Hls from 'hls.js';
import { Loader2, Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture, Settings2, Check, AudioLines, Subtitles } from 'lucide-react';
import { useAppStore } from '../store';
import PlayerErrorUI from './PlayerErrorUI';
import { getNativeError, getHlsError, type ErrorState } from '../utils/errorHandler';

interface VideoEngineProps {
  streamUrl: string;
}

const PROXY_WORKER_URL = "https://iptv-proxy.ashishsri2018.workers.dev/";

export default function VideoEngine({ streamUrl }: VideoEngineProps) {
  const store: any = useAppStore();
  const channelName = store.channelName;
  const settings = store.settings;
  const activeChannel = store.activeChannel;
  const sources = store.sources || [];

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [useProxy, setUseProxy] = useState(false);
  
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('iptv_volume');
    if (saved === null) return 1;
    const parsed = parseFloat(saved);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
  });
  const [isMuted, setIsMuted] = useState(() => localStorage.getItem('iptv_muted') === 'true');
  
  const [hasFatalError, setHasFatalError] = useState(false);
  const [errorUI, setErrorUI] = useState<ErrorState>({ title: '', desc: '', raw: '' });
  const [retryCount, setRetryCount] = useState(0);
  
  const [progress, setProgress] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState("00:00");
  const [durationDisplay, setDurationDisplay] = useState("00:00");
  const [isLive, setIsLive] = useState(true);
  
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeMenu, setActiveMenu] = useState<'quality' | 'audio' | 'subtitles' | null>(null);
  const activeMenuRef = useRef<'quality' | 'audio' | 'subtitles' | null>(null);

  const [levels, setLevels] = useState<any[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [autoLevel, setAutoLevel] = useState<number>(-1); 

  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);

  const [subtitleTracks, setSubtitleTracks] = useState<any[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1);
  const userTouchedSubtitles = useRef(false);

  const resolvedMetadata = useMemo(() => {
    try {
      const global = settings?.global_metadata ? JSON.parse(settings.global_metadata) : {};
      const source = sources.find((s: any) => s.id === activeChannel?.source_id);
      const playlist = source?.playlist_metadata ? JSON.parse(source.playlist_metadata) : {};
      const channel = activeChannel?.raw_metadata ? JSON.parse(activeChannel.raw_metadata) : {};
      return { ...global, ...playlist, ...channel };
    } catch (e) {
      console.error("Metadata parsing error:", e);
      return {};
    }
  }, [settings, sources, activeChannel]);

  const proxyConfig = { 
    url: streamUrl, 
    userAgent: resolvedMetadata['http-user-agent'] || resolvedMetadata['user-agent'] || resolvedMetadata['User-Agent'] || "VLC/3.0.0",
    referer: resolvedMetadata['http-referrer'] || resolvedMetadata['referer'] || resolvedMetadata['Referer'] || "",
    origin: resolvedMetadata['Origin'] || resolvedMetadata['origin'] || ""
  };
  const proxyEncoded = btoa(unescape(encodeURIComponent(JSON.stringify(proxyConfig))));
  const computedProxyUrl = `${PROXY_WORKER_URL}?cfg=${proxyEncoded}`;

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    setRetryCount(0);
    setUseProxy(false);
  }, [streamUrl]);

  useEffect(() => {
    const handleOffline = () => {
      setErrorUI({ title: "Connection Lost", desc: "Your internet connection dropped. Please check your Wi-Fi or cellular data.", raw: "ERR_INTERNET_DISCONNECTED" });
      setHasFatalError(true);
      setIsBuffering(false);
    };
    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;
    let watchdogTimer: ReturnType<typeof setTimeout>;
    
    setHasFatalError(false);
    setErrorUI({ title: '', desc: '', raw: '' });
    setActiveMenu(null);
    setAutoLevel(-1);
    setLevels([]);
    setAudioTracks([]);
    setSubtitleTracks([]);
    activeMenuRef.current = null;
    userTouchedSubtitles.current = false; 
    
    if (containerRef.current) {
      containerRef.current.style.opacity = '1';
      containerRef.current.style.display = '';
    }

    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = isMuted;

    const clearWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    };

    watchdogTimer = setTimeout(() => {
      if (isMounted && videoRef.current && (videoRef.current.readyState < 3 || videoRef.current.paused)) {
        setErrorUI({ title: "Stream Timeout", desc: "The stream is stuck loading or is dead.", raw: "ERR_STUCK_OR_TIMEOUT" });
        setHasFatalError(true);
        setIsBuffering(false);
        if (hlsRef.current) hlsRef.current.destroy();
      }
    }, 15000);

    const handleNativePlay = () => setIsPlaying(true);
    const handleNativePause = () => setIsPlaying(false);
    const handleNativeWaiting = () => setIsBuffering(true);
    const handleNativePlaying = () => {
      clearWatchdog();
      setIsBuffering(false);
    };
    
    const handleEnterPip = () => window.dispatchEvent(new CustomEvent('pip-status', { detail: true }));
    const handleLeavePip = () => window.dispatchEvent(new CustomEvent('pip-status', { detail: false }));

    const handleNativeMeta = () => {
      clearWatchdog();
      setIsBuffering(false);
      video.play().catch(() => setIsPlaying(false));
    };
    
    const handleNativeError = () => {
      clearWatchdog();
      setIsBuffering(false);
      setErrorUI(getNativeError(video.error?.code));
      setHasFatalError(true);
    };

    video.addEventListener('play', handleNativePlay);
    video.addEventListener('pause', handleNativePause);
    video.addEventListener('waiting', handleNativeWaiting);
    video.addEventListener('playing', handleNativePlaying);
    video.addEventListener('enterpictureinpicture', handleEnterPip);
    video.addEventListener('leavepictureinpicture', handleLeavePip);
    video.addEventListener('loadedmetadata', handleNativeMeta);
    video.addEventListener('error', handleNativeError);

    const initializePlayer = () => {
      let activeStreamUrl = streamUrl;
      
      if (useProxy) {
        activeStreamUrl = computedProxyUrl;
      }

      if (window.location.protocol === 'https:' && activeStreamUrl.startsWith('http://')) {
        clearWatchdog();
        setErrorUI({ title: "Mixed Content Blocked", desc: "Your browser blocked this HTTP stream for security. Retry with Proxy to tunnel it securely via HTTPS.", raw: "ERR_MIXED_CONTENT_HTTP" });
        setHasFatalError(true);
        setIsBuffering(false);
        return;
      }

      if (!activeStreamUrl.startsWith('http')) {
        clearWatchdog();
        setErrorUI({ title: "External Protocol", desc: "This stream uses a special protocol and must be opened in an external player.", raw: `Unsupported protocol: ${activeStreamUrl.split(':')[0]}` });
        setHasFatalError(true);
        setIsBuffering(false);
        return;
      }

      if (!isMounted) return;

      const isDirectMedia = !!streamUrl.match(/\.(mp4|mkv|webm|avi|mov|flv|wmv|ts)(\?|$)/i);

      if (Hls.isSupported() && !isDirectMedia) {
        // IMPORTANT FIX: renderTextTracksNatively: false stops subtitles from bypassing the custom loader
        const hlsConfig: any = { 
          maxMaxBufferLength: 30,
          renderTextTracksNatively: false 
        };

        // IMPORTANT FIX: The Interceptor. This catches video fragments (.ts) and subtitles (.vtt)
        if (useProxy) {
          const DefaultLoader: any = Hls.DefaultConfig.loader;
          hlsConfig.loader = class ProxyLoader extends DefaultLoader {
            constructor(config: any) {
              super(config);
              const originalLoad = this.load.bind(this);
              this.load = (context: any, loadConfig: any, callbacks: any) => {
                if (context.url && !context.url.startsWith(PROXY_WORKER_URL)) {
                  const pConfig = { 
                    url: context.url, 
                    userAgent: proxyConfig.userAgent,
                    referer: proxyConfig.referer,
                    origin: proxyConfig.origin
                  };
                  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(pConfig))));
                  context.url = `${PROXY_WORKER_URL}?cfg=${encoded}`;
                }
                originalLoad(context, loadConfig, callbacks);
              };
            }
          };
        }

        const hls = new Hls(hlsConfig);
        hlsRef.current = hls;

        hls.loadSource(activeStreamUrl);
        hls.attachMedia(video);

        let initialAudioSet = false;

        const processSubtitles = (tracks: any[]) => {
          setSubtitleTracks(tracks);
          if (userTouchedSubtitles.current) return; 
          if (tracks.length > 0) {
            let targetIdx = -1;
            if (settings.default_subtitle) {
              targetIdx = tracks.findIndex(t => t.name?.toLowerCase().includes(settings.default_subtitle.toLowerCase()) || t.lang?.toLowerCase().includes(settings.default_subtitle.toLowerCase()));
            }
            hls.subtitleTrack = targetIdx;
            if (hls.subtitleDisplay !== undefined) hls.subtitleDisplay = targetIdx !== -1;
            setCurrentSubtitleTrack(targetIdx);
          }
        };

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          clearWatchdog();
          setLevels(data.levels || []);
          let targetLevel = -1; 
          if (data.levels && data.levels.length > 0) {
            if (settings.default_quality === 'high') targetLevel = data.levels.length - 1;
            else if (settings.default_quality === 'low') targetLevel = 0;
          }
          if (targetLevel !== -1) {
            hls.startLevel = targetLevel;
            hls.nextLoadLevel = targetLevel;
            hls.currentLevel = targetLevel; 
          }
          setCurrentLevel(targetLevel);

          if (hls.audioTracks && hls.audioTracks.length > 0) {
            setAudioTracks(hls.audioTracks);
            if (settings.default_audio) {
              const idx = hls.audioTracks.findIndex(t => t.name?.toLowerCase().includes(settings.default_audio.toLowerCase()) || t.lang?.toLowerCase().includes(settings.default_audio.toLowerCase()));
              if (idx !== -1) {
                hls.audioTrack = idx;
                setCurrentAudioTrack(idx);
                initialAudioSet = true;
              }
            }
            if (!initialAudioSet) setCurrentAudioTrack(hls.audioTrack);
          }
          if (hls.subtitleTracks && hls.subtitleTracks.length > 0) processSubtitles(hls.subtitleTracks);
          setIsBuffering(false);
          video.play().catch(() => setIsPlaying(false));
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => setAutoLevel(data.level));
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          const tracks = data.audioTracks || [];
          setAudioTracks(tracks);
          if (settings.default_audio && !initialAudioSet && tracks.length > 0) {
            const idx = tracks.findIndex((t: any) => t.name?.toLowerCase().includes(settings.default_audio.toLowerCase()) || t.lang?.toLowerCase().includes(settings.default_audio.toLowerCase()));
            if (idx !== -1) {
              hls.audioTrack = idx;
              setCurrentAudioTrack(idx);
              initialAudioSet = true;
            }
          }
        });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => processSubtitles(data.subtitleTracks || []));

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return; 

          // Passes useProxy state to the newly updated handler
          const parsedError = getHlsError(data, useProxy);
          if (parsedError) {
            clearWatchdog();
            setIsBuffering(false);
            setErrorUI(parsedError);
            setHasFatalError(true);
            hls.destroy();
          }
        });
      } 
      else {
        video.src = activeStreamUrl;
        video.load(); 
      }
    };

    initializePlayer();
    startControlHideTimer();

    return () => {
      isMounted = false;
      clearWatchdog();
      abortController.abort();
      if (hlsRef.current) {
        hlsRef.current.stopLoad(); 
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('play', handleNativePlay);
      video.removeEventListener('pause', handleNativePause);
      video.removeEventListener('waiting', handleNativeWaiting);
      video.removeEventListener('playing', handleNativePlaying);
      video.removeEventListener('enterpictureinpicture', handleEnterPip);
      video.removeEventListener('leavepictureinpicture', handleLeavePip);
      video.removeEventListener('loadedmetadata', handleNativeMeta);
      video.removeEventListener('error', handleNativeError);
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
      video.removeAttribute('src'); 
      video.load();
    };
  }, [streamUrl, retryCount, settings, useProxy, computedProxyUrl]);

  const toggleMenu = (menu: 'quality' | 'audio' | 'subtitles') => {
    const nextMenu = activeMenu === menu ? null : menu;
    setActiveMenu(nextMenu);
    activeMenuRef.current = nextMenu;
  };

  const handleRetryNormal = () => {
    setHasFatalError(false);
    setErrorUI({ title: '', desc: '', raw: '' });
    setIsBuffering(true);
    setRetryCount(prev => prev + 1);
  };

  const handleRetryProxy = () => {
    setHasFatalError(false);
    setErrorUI({ title: '', desc: '', raw: '' });
    setIsBuffering(true);
    setUseProxy(true);
    setRetryCount(prev => prev + 1);
  };

  const changeQuality = (levelIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = levelIndex; 
      setCurrentLevel(levelIndex);
      setActiveMenu(null);
      activeMenuRef.current = null;
    }
  };

  const changeAudioTrack = (trackIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackIndex;
      setCurrentAudioTrack(trackIndex);
      setActiveMenu(null);
      activeMenuRef.current = null;
    }
  };

  const changeSubtitleTrack = (trackIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = trackIndex;
      if (hlsRef.current.subtitleDisplay !== undefined) hlsRef.current.subtitleDisplay = trackIndex !== -1;
      setCurrentSubtitleTrack(trackIndex);
      userTouchedSubtitles.current = true;
      setActiveMenu(null);
      activeMenuRef.current = null;
    }
  };

  const startControlHideTimer = () => {
    if (hasFatalError) return;
    setShowControls(true);
    if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
    hideControlsTimeout.current = setTimeout(() => {
      if (!activeMenuRef.current) setShowControls(false); 
    }, 3000);
  };

  const handleContainerTap = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName.toLowerCase() === 'video') {
      setActiveMenu(null);
      activeMenuRef.current = null;
      setShowControls(prev => !prev);
      if (!showControls) startControlHideTimer();
    } else startControlHideTimer();
  };

  const togglePlay = () => {
    if (hasFatalError || !videoRef.current) return;
    if (videoRef.current.paused) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    localStorage.setItem('iptv_volume', val.toString());
    if (videoRef.current) {
      videoRef.current.volume = val;
      const willMute = val === 0;
      videoRef.current.muted = willMute;
      if (!willMute && isMuted) { setIsMuted(false); localStorage.setItem('iptv_muted', 'false'); }
      else if (willMute && !isMuted) { setIsMuted(true); localStorage.setItem('iptv_muted', 'true'); }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !videoRef.current.muted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
      localStorage.setItem('iptv_muted', nextMuted.toString());
      if (!nextMuted) {
        let restoredVolume = volume;
        if (restoredVolume === 0) restoredVolume = 0.5;
        setVolume(restoredVolume);
        videoRef.current.volume = restoredVolume;
        localStorage.setItem('iptv_volume', restoredVolume.toString());
      }
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const duration = videoRef.current.duration;
    const currentTime = videoRef.current.currentTime;
    if (duration && isFinite(duration)) {
      if (isLive) setIsLive(false);
      setProgress((currentTime / duration) * 100);
      setCurrentTimeDisplay(formatTime(currentTime));
      setDurationDisplay(formatTime(duration));
    } else {
      if (!isLive) setIsLive(true);
      setProgress(100); 
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!videoRef.current) return;
    const duration = videoRef.current.duration;
    if (!duration || !isFinite(duration)) return; 
    const bounds = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - bounds.left) / bounds.width;
    videoRef.current.currentTime = percent * duration;
  };

  const toggleFullScreen = async () => {
    if (!document.fullscreenElement) {
      try {
        if (containerRef.current) {
          await containerRef.current.requestFullscreen();
          try { await (window.screen.orientation as any).lock('landscape'); } catch (err) {}
        }
      } catch (e: any) {}
    } else {
      try { await document.exitFullscreen(); } catch(e) {}
    }
  };

  const togglePiP = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && videoRef.current) await videoRef.current.requestPictureInPicture();
      else alert("Picture-in-Picture is not natively supported or is disabled in your current browser.");
    } catch (error) { console.warn("PiP Error:", error); }
  };

  const launchExternalPlayer = (forceProxy: boolean = false) => {
    try {
      const isAndroid = /Android/i.test(navigator.userAgent);
      
      let targetUrl = streamUrl;
      if (forceProxy) {
        targetUrl = computedProxyUrl;
      }
      
      if (isAndroid) {
        const match = targetUrl.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
        if (match) {
          const scheme = match[1];
          const path = match[2];
          const safeName = channelName || 'Live Channel';
          targetUrl = `intent://${path}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(safeName)};end;`;
        }
      } else targetUrl = `vlc://${targetUrl}`;
      window.location.href = targetUrl;
    } catch (error: any) { console.error("External Player Launch Error:", error); }
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full bg-black group transition-opacity duration-200"
      onMouseMove={startControlHideTimer}
      onClick={handleContainerTap}
      onMouseLeave={() => { if (!activeMenuRef.current && !hasFatalError) setShowControls(false); }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{ backgroundColor: 'black' }}
        className={`w-full h-full object-contain bg-black ${hasFatalError ? 'hidden' : ''}`}
        onTimeUpdate={handleTimeUpdate}
      />

      {isBuffering && !hasFatalError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <Loader2 size={48} className="animate-spin text-blue-500 drop-shadow-lg" />
        </div>
      )}

      {activeMenu && (
        <div 
          className="absolute inset-0 z-30" 
          onClick={(e) => { e.stopPropagation(); setActiveMenu(null); activeMenuRef.current = null; }}
        />
      )}

      {hasFatalError && (
        <PlayerErrorUI 
          errorUI={errorUI}
          onRetry={handleRetryNormal}
          onRetryProxy={handleRetryProxy}
          onPlayExternalProxy={() => launchExternalPlayer(true)}
          onPlayExternalNative={() => launchExternalPlayer(false)}
          proxyUrl={computedProxyUrl}
          nativeUrl={streamUrl}
        />
      )}

      {!hasFatalError && (
        <div className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent transition-opacity duration-300 px-4 pb-4 pt-16 z-40 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="w-full h-2 bg-slate-700/50 rounded-full mb-4 cursor-pointer relative group/seek pointer-events-auto" onClick={handleSeek}>
            <div className="h-full rounded-full transition-all bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex items-center justify-between pointer-events-auto">
            <div className="flex items-center gap-4 sm:gap-6">
              <button onClick={togglePlay} className="text-white hover:text-blue-400 transition-colors">
                {isPlaying ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current" />}
              </button>
              <div className="flex items-center gap-2 group/volume">
                <button onClick={toggleMute} className="text-white hover:text-blue-400 transition-colors">
                  {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                <input 
                  type="range" min="0" max="1" step="0.05" value={isMuted ? 0 : volume} onChange={handleVolumeChange}
                  className="w-0 sm:w-20 opacity-0 sm:opacity-100 group-hover/volume:w-20 group-hover/volume:opacity-100 transition-all accent-blue-500 h-1 cursor-pointer"
                />
              </div>
              {isLive ? (
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-600/20 border border-red-600/50">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-bold text-red-500 uppercase tracking-wider">Live</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-sm font-medium text-slate-300 font-mono">
                  <span>{currentTimeDisplay}</span><span className="text-slate-500">/</span><span>{durationDisplay}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 sm:gap-5 relative">
              {subtitleTracks.length > 0 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('subtitles'); }} className={`transition-colors ${activeMenu === 'subtitles' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <Subtitles size={20} />
                  </button>
                  {activeMenu === 'subtitles' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Subtitles</span></div>
                      <button onClick={() => changeSubtitleTrack(-1)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
                        Off {currentSubtitleTrack === -1 && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                      </button>
                      {subtitleTracks.map((track, idx) => (
                        <button key={idx} onClick={() => changeSubtitleTrack(idx)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between truncate">
                          {track.name || track.lang || `Track ${idx + 1}`} {currentSubtitleTrack === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {audioTracks.length > 1 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('audio'); }} className={`transition-colors ${activeMenu === 'audio' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <AudioLines size={20} />
                  </button>
                  {activeMenu === 'audio' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Audio Track</span></div>
                      {audioTracks.map((track, idx) => (
                        <button key={idx} onClick={() => changeAudioTrack(idx)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between truncate">
                          {track.name || track.lang || `Track ${idx + 1}`} {currentAudioTrack === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {levels.length > 0 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('quality'); }} className={`transition-colors ${activeMenu === 'quality' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <Settings2 size={20} />
                  </button>
                  {activeMenu === 'quality' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quality</span></div>
                      <button onClick={() => changeQuality(-1)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
                        Auto {currentLevel === -1 && autoLevel !== -1 && levels[autoLevel]?.height ? `(${levels[autoLevel].height}p)` : ''} 
                        {currentLevel === -1 && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                      </button>
                      {levels.map((level, idx) => (
                        <button key={idx} onClick={() => changeQuality(idx)} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
                          {level.height ? `${level.height}p` : `Level ${idx + 1}`} {currentLevel === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button onClick={togglePiP} className="text-white hover:text-blue-400 transition-colors"><PictureInPicture size={20} /></button>
              <button onClick={toggleFullScreen} className="text-white hover:text-blue-400 transition-colors"><Maximize size={20} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
