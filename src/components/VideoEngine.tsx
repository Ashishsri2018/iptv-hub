import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import Hls, { type Level } from 'hls.js';
import { Loader2, Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture, Settings2, Check, AudioLines, Subtitles } from 'lucide-react';
import { useAppStore } from '../store';
import PlayerErrorUI from './PlayerErrorUI';
import { getNativeError, getHlsError, type ErrorState } from '../utils/errorHandler';

interface VideoEngineProps {
  streamUrl: string;
}

interface MediaTrack {
  name?: string;
  lang?: string;
  [key: string]: any;
}

const PROXY_WORKER_URL = import.meta?.env?.VITE_PROXY_WORKER_URL || "https://iptv-proxy.ashishsri2018.workers.dev/";
const EMPTY_ARRAY: readonly never[] = []; 

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export default function VideoEngine({ streamUrl }: VideoEngineProps) {
  const channelName = useAppStore((s) => s.channelName);
  const settings = useAppStore((s) => s.settings);
  const activeChannel = useAppStore((s) => s.activeChannel);
  const sources = useAppStore((s) => s.sources || EMPTY_ARRAY);

  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  
  const isMounted = useRef(true);
  const isRetrying = useRef(false);
  const lastTimeRef = useRef(-1); 
  const lastDurationRef = useRef(-1);
  const lastVolumeRef = useRef(1); 

  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [useProxy, setUseProxy] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [isPiPSupported, setIsPiPSupported] = useState(false);
  
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('iptv_volume');
      if (saved === null) return 1;
      const parsed = parseFloat(saved);
      const finalVol = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 1;
      lastVolumeRef.current = finalVol > 0 ? finalVol : 0.5;
      return finalVol;
    } catch { return 1; }
  });
  
  const [isMuted, setIsMuted] = useState(() => {
    try { return localStorage.getItem('iptv_muted') === 'true'; } 
    catch { return false; }
  });
  
  const [hasFatalError, setHasFatalError] = useState(false);
  const [errorUI, setErrorUI] = useState<ErrorState>({ title: '', desc: '', raw: '' });
  
  const [progress, setProgress] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState("00:00");
  const [durationDisplay, setDurationDisplay] = useState("00:00");
  const [isLive, setIsLive] = useState(true);
  
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [activeMenu, setActiveMenu] = useState<'quality' | 'audio' | 'subtitles' | null>(null);
  const activeMenuRef = useRef<'quality' | 'audio' | 'subtitles' | null>(null);

  const [levels, setLevels] = useState<Level[]>([]);
  const [manualQualityLevel, setManualQualityLevel] = useState<number>(-1);
  const [autoLevel, setAutoLevel] = useState<number>(-1); 
  const [isAutoQuality, setIsAutoQuality] = useState(true);

  const [audioTracks, setAudioTracks] = useState<MediaTrack[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);

  const [subtitleTracks, setSubtitleTracks] = useState<MediaTrack[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1);
  
  const userTouchedSubtitles = useRef(false);
  const userTouchedAudio = useRef(false);

  const formatTime = useCallback((seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }, []);

  const resetUIState = useCallback(() => {
    setIsBuffering(true);
    setProgress(0);
    setCurrentTimeDisplay("00:00");
    setDurationDisplay("00:00");
    setIsLive(true);
    setHasFatalError(false);
    setErrorUI({ title: '', desc: '', raw: '' });
    setActiveMenu(null);
    activeMenuRef.current = null;
    setAutoLevel(-1);
    
    // FIX: Initialize isAutoQuality correctly from DB immediately
    const defaultQuality = settingsRef.current?.default_quality?.toLowerCase() ?? "auto";
    setIsAutoQuality(defaultQuality === "auto");
    
    setLevels([]);
    setAudioTracks([]);
    setSubtitleTracks([]);
    userTouchedSubtitles.current = false;
    userTouchedAudio.current = false;
    lastTimeRef.current = -1;
    lastDurationRef.current = -1;
  }, []);

  useEffect(() => {
    setUseProxy(false);
    setRetryCount(0);
    resetUIState();
  }, [streamUrl, resetUIState]);

  const resolvedMetadata = useMemo(() => {
    let global = {}, playlist = {}, channel = {};
    try { if (settings?.global_metadata) global = JSON.parse(settings.global_metadata); } catch (e) {}
    try { 
      const source = sources.find((s: any) => s.id === activeChannel?.source_id);
      if (source?.playlist_metadata) playlist = JSON.parse(source.playlist_metadata);
    } catch (e) {}
    try { if (activeChannel?.raw_metadata) channel = JSON.parse(activeChannel.raw_metadata); } catch (e) {}
    return { ...global, ...playlist, ...channel };
  }, [settings?.global_metadata, sources, activeChannel]);

  const proxyConfig = useMemo(() => ({ 
    url: streamUrl, 
    userAgent: resolvedMetadata['http-user-agent'] || resolvedMetadata['user-agent'] || resolvedMetadata['User-Agent'] || "",
    referer: resolvedMetadata['http-referrer'] || resolvedMetadata['referer'] || resolvedMetadata['Referer'] || "",
    origin: resolvedMetadata['Origin'] || resolvedMetadata['origin'] || ""
  }), [streamUrl, resolvedMetadata]);

  const proxyConfigRef = useRef(proxyConfig);
  useEffect(() => { proxyConfigRef.current = proxyConfig; }, [proxyConfig]);

  const computedProxyUrl = useMemo(() => {
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(proxyConfig));
      return `${PROXY_WORKER_URL}?cfg=${bytesToBase64(bytes)}`;
    } catch (e) {
      if (import.meta.env?.DEV) console.warn("Proxy Config Encoding Error:", e);
      return streamUrl;
    }
  }, [proxyConfig, streamUrl]);

  useEffect(() => {
    isMounted.current = true;
    const checkPiP = () => {
      const video = videoRef.current;
      setIsPiPSupported(!!document.pictureInPictureEnabled && !(video && (video as any).disablePictureInPicture));
    };
    checkPiP();
    
    const handleOffline = () => {
      setErrorUI({ title: "Connection Lost", desc: "Your internet connection dropped. Please check your Wi-Fi or cellular data.", raw: "ERR_INTERNET_DISCONNECTED" });
      setHasFatalError(true);
      setIsBuffering(false);
    };
    window.addEventListener('offline', handleOffline);
    return () => {
      isMounted.current = false;
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    let watchdogTimer: ReturnType<typeof setTimeout>;
    const video = videoRef.current;
    if (!video) return;

    video.volume = volume;
    video.muted = isMuted;

    const clearWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    };

    const startWatchdog = () => {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        if (videoRef.current && (videoRef.current.readyState < 3 || videoRef.current.paused)) {
          setErrorUI({ title: "Stream Timeout", desc: "The stream is stuck loading or is dead.", raw: "ERR_STUCK_OR_TIMEOUT" });
          setHasFatalError(true);
          setIsBuffering(false);
          if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
        }
      }, 30000);
    };
    
    startWatchdog();

    const handleNativePlay = () => setIsPlaying(true);
    const handleNativePause = () => setIsPlaying(false);
    const handleNativeWaiting = () => setIsBuffering(true);
    
    const handleNativePlaying = () => { clearWatchdog(); setIsBuffering(false); };
    const handleNativeProgress = () => { if (isBuffering) startWatchdog(); };
    const handleNativeLoadedData = () => { clearWatchdog(); setIsBuffering(false); };

    const handleEnterPip = () => window.dispatchEvent(new CustomEvent('pip-status', { detail: true }));
    const handleLeavePip = () => window.dispatchEvent(new CustomEvent('pip-status', { detail: false }));

    const handleNativeMeta = () => {
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
    video.addEventListener('progress', handleNativeProgress);
    video.addEventListener('loadeddata', handleNativeLoadedData);
    video.addEventListener('enterpictureinpicture', handleEnterPip);
    video.addEventListener('leavepictureinpicture', handleLeavePip);
    video.addEventListener('loadedmetadata', handleNativeMeta);
    video.addEventListener('error', handleNativeError);

    const initializePlayer = () => {
      let activeStreamUrl = streamUrl;
      if (useProxy) activeStreamUrl = computedProxyUrl;

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

      const isDirectMedia = !!streamUrl.match(/\.(mp4|mkv|webm|avi|mov|flv|wmv|ts|m4v|mpeg|mpg|m2ts|mts|mp3|aac|ogg|opus|wav)(\?|$)/i);

      if (Hls.isSupported() && !isDirectMedia) {
        
        const hlsConfig: any = { 
          maxMaxBufferLength: 30 
        };

        if (useProxy) {
          const DefaultLoader: any = Hls.DefaultConfig.loader;
          const ProxyLoaderClass = class ProxyLoader extends DefaultLoader {
            constructor(config: any) {
              super(config);
              const originalLoad = this.load.bind(this);
              
              this.load = (context: any, loadConfig: any, callbacks: any) => {
                if (context.url && !context.url.startsWith(PROXY_WORKER_URL)) {
                  const originalUrl = context.url;
                  try {
                    const pConfig = { 
                      url: originalUrl, 
                      userAgent: proxyConfigRef.current.userAgent,
                      referer: proxyConfigRef.current.referer,
                      origin: proxyConfigRef.current.origin
                    };
                    const bytes = new TextEncoder().encode(JSON.stringify(pConfig));
                    context.url = `${PROXY_WORKER_URL}?cfg=${bytesToBase64(bytes)}`;
                    
                    const wrappedCallbacks = {
                      ...callbacks,
                      onSuccess: callbacks.onSuccess ? (...args: any[]) => {
                        context.url = originalUrl;
                        if (args[0] && typeof args[0] === 'object' && 'url' in args[0]) {
                          args[0].url = originalUrl;
                        }
                        return callbacks.onSuccess(...args);
                      } : undefined,
                      onError: callbacks.onError ? (...args: any[]) => {
                        context.url = originalUrl;
                        return callbacks.onError(...args);
                      } : undefined,
                      onTimeout: callbacks.onTimeout ? (...args: any[]) => {
                        context.url = originalUrl;
                        return callbacks.onTimeout(...args);
                      } : undefined,
                      onAbort: callbacks.onAbort ? (...args: any[]) => {
                        context.url = originalUrl;
                        return callbacks.onAbort(...args);
                      } : undefined
                    };
                    
                    originalLoad(context, loadConfig, wrappedCallbacks);
                    return;
                  } catch (e) { 
                    context.url = originalUrl; 
                  }
                }
                originalLoad(context, loadConfig, callbacks);
              };
            }
          };

          hlsConfig.loader = ProxyLoaderClass;
          hlsConfig.pLoader = ProxyLoaderClass;
          hlsConfig.fLoader = ProxyLoaderClass;
          hlsConfig.audioLoader = ProxyLoaderClass;
          hlsConfig.subtitleLoader = ProxyLoaderClass;
        }

        const hls = new Hls(hlsConfig);
        hlsRef.current = hls;
        hls.loadSource(activeStreamUrl);
        hls.attachMedia(video);

        const processSubtitles = (tracks: MediaTrack[]) => {
          if (!isMounted.current) return;
          setSubtitleTracks(tracks);
          
          if (userTouchedSubtitles.current) return; 

          let targetIdx = -1;
          const defaultSub = settingsRef.current?.default_subtitle?.toLowerCase();
          
          if (defaultSub && defaultSub !== 'none' && defaultSub !== 'off') {
            targetIdx = tracks.findIndex(t => t.name?.toLowerCase().includes(defaultSub) || t.lang?.toLowerCase().includes(defaultSub));
          }
          
          if (hlsRef.current) hlsRef.current.subtitleTrack = targetIdx;
          setCurrentSubtitleTrack(targetIdx);
        };

        const processAudio = (tracks: MediaTrack[]) => {
          if (!isMounted.current) return;
          setAudioTracks(tracks);
          
          if (userTouchedAudio.current) return;

          let targetIdx = -1;
          const defaultAudio = settingsRef.current?.default_audio?.toLowerCase();
          
          if (defaultAudio && defaultAudio !== 'none' && defaultAudio !== 'off') {
            targetIdx = tracks.findIndex(t => t.name?.toLowerCase().includes(defaultAudio) || t.lang?.toLowerCase().includes(defaultAudio));
          }

          if (hlsRef.current) {
            if (targetIdx !== -1) {
              hlsRef.current.audioTrack = targetIdx;
              setCurrentAudioTrack(targetIdx);
            } else {
              setCurrentAudioTrack(hlsRef.current.audioTrack);
            }
          }
        };

        hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
          clearWatchdog();
          
          setLevels(data.levels || []);
          let targetLevel = -1;
          let isAuto = true;
          const defaultQ = settingsRef.current?.default_quality?.toLowerCase();
          
          if (data.levels && data.levels.length > 0 && defaultQ) {
            if (defaultQ === 'high') {
              targetLevel = data.levels.length - 1; 
              isAuto = false;
            } else if (defaultQ === 'low') {
              targetLevel = 0; 
              isAuto = false;
            } else if (defaultQ !== 'auto') {
              const targetHeight = parseInt(defaultQ);
              if (!isNaN(targetHeight)) {
                let closestIdx = 0;
                let minDiff = Infinity;
                data.levels.forEach((l, idx) => {
                  const diff = Math.abs((l.height || 0) - targetHeight);
                  if (diff < minDiff) { minDiff = diff; closestIdx = idx; }
                });
                targetLevel = closestIdx;
                isAuto = false;
              }
            }
          }
          
          hls.currentLevel = targetLevel;
          setIsAutoQuality(isAuto);
          setManualQualityLevel(targetLevel);

          if (hls.audioTracks) processAudio(hls.audioTracks);
          if (hls.subtitleTracks) processSubtitles(hls.subtitleTracks);
          setIsBuffering(false);
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          setAutoLevel(data.level);
        });
        
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
          processAudio(data.audioTracks || []);
        });
        
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
          processSubtitles(data.subtitleTracks || []);
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return; 
          const parsedError = getHlsError(data); 
          if (parsedError && isMounted.current) {
            clearWatchdog();
            setIsBuffering(false);
            
            if (useProxy && parsedError.title === "Network Error") {
              if (parsedError.raw.includes("521") || parsedError.raw.includes("522")) {
                 parsedError.title = "Proxy Blocked by Provider";
                 parsedError.desc = "This provider actively blocks Cloudflare Proxies. You MUST click 'Play External (without Proxy)'.";
              }
            }

            setErrorUI(parsedError);
            setHasFatalError(true);
            if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
          }
        });
      } 
      else {
        video.src = activeStreamUrl;
        video.load(); 
      }
      isRetrying.current = false;
    };

    initializePlayer();
    startControlHideTimer();

    return () => {
      clearWatchdog();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('play', handleNativePlay);
      video.removeEventListener('pause', handleNativePause);
      video.removeEventListener('waiting', handleNativeWaiting);
      video.removeEventListener('playing', handleNativePlaying);
      video.removeEventListener('progress', handleNativeProgress);
      video.removeEventListener('loadeddata', handleNativeLoadedData);
      video.removeEventListener('enterpictureinpicture', handleEnterPip);
      video.removeEventListener('leavepictureinpicture', handleLeavePip);
      video.removeEventListener('loadedmetadata', handleNativeMeta);
      video.removeEventListener('error', handleNativeError);
      
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
      
      if (document.pictureInPictureElement === video) {
        document.exitPictureInPicture().catch(() => {});
      }
      video.pause();
      video.removeAttribute('src'); 
      video.load();
    };
  }, [streamUrl, retryCount, useProxy, computedProxyUrl]);

  const toggleMenu = (menu: 'quality' | 'audio' | 'subtitles') => {
    const nextMenu = activeMenu === menu ? null : menu;
    setActiveMenu(nextMenu);
    activeMenuRef.current = nextMenu;
  };

  const handleRetryNormal = () => {
    if (isRetrying.current) return;
    isRetrying.current = true;
    resetUIState();
    setRetryCount(prev => prev + 1);
  };

  const handleRetryProxy = () => {
    if (isRetrying.current) return;
    isRetrying.current = true;
    resetUIState();
    setUseProxy(true);
    setRetryCount(prev => prev + 1);
  };

  // FIX: Applied specific currentLevel assignment and UI state updates
  const changeQuality = (levelIndex: number) => {
    if (!hlsRef.current) return;

    if (levelIndex === -1) {
      hlsRef.current.currentLevel = -1;
      // hlsRef.current.nextLevel = -1;
      // hlsRef.current.loadLevel = -1;
    } else {
      hlsRef.current.currentLevel = levelIndex; 
    }
    
    setManualQualityLevel(levelIndex);
    setIsAutoQuality(levelIndex === -1);
    
    setActiveMenu(null);
    activeMenuRef.current = null;
  };

  const changeAudioTrack = (trackIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackIndex;
      setCurrentAudioTrack(trackIndex);
      userTouchedAudio.current = true; 
      setActiveMenu(null);
      activeMenuRef.current = null;
    }
  };

  const changeSubtitleTrack = (trackIndex: number) => {
    if (hlsRef.current) {
      hlsRef.current.subtitleTrack = trackIndex;
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
    e.stopPropagation();
    const val = parseFloat(e.target.value);
    setVolume(val);
    try { localStorage.setItem('iptv_volume', val.toString()); } catch {}
    if (videoRef.current) {
      videoRef.current.volume = val;
      const willMute = val === 0;
      videoRef.current.muted = willMute;
      if (!willMute) {
        lastVolumeRef.current = val;
      }
      if (!willMute && isMuted) { 
        setIsMuted(false); 
        try { localStorage.setItem('iptv_muted', 'false'); } catch {} 
      } else if (willMute && !isMuted) { 
        setIsMuted(true); 
        try { localStorage.setItem('iptv_muted', 'true'); } catch {} 
      }
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !videoRef.current.muted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
      try { localStorage.setItem('iptv_muted', nextMuted.toString()); } catch {}
      if (!nextMuted) {
        const restoredVolume = lastVolumeRef.current > 0 ? lastVolumeRef.current : 0.5;
        setVolume(restoredVolume);
        videoRef.current.volume = restoredVolume;
        try { localStorage.setItem('iptv_volume', restoredVolume.toString()); } catch {}
      }
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const duration = videoRef.current.duration;
    const currentTime = videoRef.current.currentTime;
    
    if (duration && isFinite(duration)) {
      if (isLive) setIsLive(false);
      const currentInt = Math.floor(currentTime);
      if (currentInt !== lastTimeRef.current) {
        lastTimeRef.current = currentInt;
        setProgress((currentTime / duration) * 100);
        setCurrentTimeDisplay(formatTime(currentTime));
      }
      
      const durationInt = Math.floor(duration);
      if (durationInt !== lastDurationRef.current) {
         lastDurationRef.current = durationInt;
         setDurationDisplay(formatTime(duration));
      }
    } else {
      if (!isLive) setIsLive(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!videoRef.current) return;
    const duration = videoRef.current.duration;
    if (!duration || !isFinite(duration)) return; 
    const bounds = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - bounds.left) / bounds.width;
    videoRef.current.currentTime = percent * duration;
  };

  const toggleFullScreen = async (e: React.MouseEvent) => {
    e.stopPropagation();
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

  const togglePiP = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled && videoRef.current) await videoRef.current.requestPictureInPicture();
    } catch (error) { if (import.meta.env?.DEV) console.warn("PiP Error:", error); }
  };

  const launchExternalPlayer = (forceProxy: boolean = false) => {
    try {
      const isAndroid = /Android/i.test(navigator.userAgent);
      let targetUrl = streamUrl;
      if (forceProxy) targetUrl = computedProxyUrl;
      
      if (isAndroid) {
        const match = targetUrl.match(/^([a-zA-Z0-9]+):\/\/(.*)$/);
        if (match) {
          const scheme = match[1];
          const safePath = match[2].replace(/;/g, '%3B').replace(/#/g, '%23');
          const safeName = channelName || 'Live Channel';
          targetUrl = `intent://${safePath}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(safeName)};end;`;
        }
      } else targetUrl = `vlc://${targetUrl}`;
      window.location.href = targetUrl;
    } catch (error: any) { if (import.meta.env?.DEV) console.error("External Player Launch Error:", error); }
  };

  // Helper to smartly determine what to call the quality level
  const getLevelLabel = (level: Level | undefined, idx: number) => {
    if (!level) return '';
    if (level.height) return `${level.height}p`;
    if (level.name) return level.name;
    if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
    return `Level ${idx + 1}`;
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
              <button onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={isPlaying ? "Pause" : "Play"} className="text-white hover:text-blue-400 transition-colors">
                {isPlaying ? <Pause size={24} className="fill-current" /> : <Play size={24} className="fill-current" />}
              </button>
              <div className="flex items-center gap-2 group/volume">
                <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} aria-label={isMuted ? "Unmute" : "Mute"} className="text-white hover:text-blue-400 transition-colors">
                  {isMuted || volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                </button>
                <input 
                  type="range" min="0" max="1" step="0.05" value={volume} onChange={handleVolumeChange} aria-label="Volume"
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
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('subtitles'); }} aria-label="Subtitles" className={`transition-colors ${activeMenu === 'subtitles' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <Subtitles size={20} />
                  </button>
                  {activeMenu === 'subtitles' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Subtitles</span></div>
                      <button onClick={(e) => { e.stopPropagation(); changeSubtitleTrack(-1); }} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
                        Off {currentSubtitleTrack === -1 && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                      </button>
                      {subtitleTracks.map((track, idx) => (
                        <button key={idx} onClick={(e) => { e.stopPropagation(); changeSubtitleTrack(idx); }} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between truncate">
                          {track.name || track.lang || `Track ${idx + 1}`} {currentSubtitleTrack === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {audioTracks.length > 1 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('audio'); }} aria-label="Audio Tracks" className={`transition-colors ${activeMenu === 'audio' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <AudioLines size={20} />
                  </button>
                  {activeMenu === 'audio' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Audio Track</span></div>
                      {audioTracks.map((track, idx) => (
                        <button key={idx} onClick={(e) => { e.stopPropagation(); changeAudioTrack(idx); }} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between truncate">
                          {track.name || track.lang || `Track ${idx + 1}`} {currentAudioTrack === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {levels.length > 0 && (
                <div className="relative">
                  <button onClick={(e) => { e.stopPropagation(); toggleMenu('quality'); }} aria-label="Quality Settings" className={`transition-colors ${activeMenu === 'quality' ? 'text-blue-400' : 'text-white hover:text-blue-400'}`}>
                    <Settings2 size={20} />
                  </button>
                  {activeMenu === 'quality' && (
                    <div className="absolute bottom-full right-0 mb-4 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl py-2 min-w-[140px] z-50">
                      <div className="px-4 py-1.5 border-b border-slate-700 mb-1"><span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Quality</span></div>
                      
                      <button onClick={(e) => { e.stopPropagation(); changeQuality(-1); }} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
  Auto {isAutoQuality && autoLevel !== -1 && levels[autoLevel] ? `(${getLevelLabel(levels[autoLevel], autoLevel)})` : ''} 
  {isAutoQuality && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
</button>

{levels.map((level, idx) => (
  <button key={idx} onClick={(e) => { e.stopPropagation(); changeQuality(idx); }} className="w-full px-4 py-2 text-sm text-left text-white hover:bg-slate-800 flex items-center justify-between">
    {getLevelLabel(level, idx)} {!isAutoQuality && manualQualityLevel === idx && <Check size={14} className="text-blue-400 shrink-0 ml-2" />}
  </button>
                      
                      ))}
                    </div>
                  )}
                </div>
              )}

              {isPiPSupported && (
                <button onClick={togglePiP} aria-label="Picture in Picture" className="text-white hover:text-blue-400 transition-colors">
                  <PictureInPicture size={20} />
                </button>
              )}
              
              <button onClick={toggleFullScreen} aria-label="Full Screen" className="text-white hover:text-blue-400 transition-colors"><Maximize size={20} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}