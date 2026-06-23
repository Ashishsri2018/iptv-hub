import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { API_URL } from '../config';
import { Loader2, Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture, Settings2, Check, AlertTriangle, ExternalLink, AudioLines, Subtitles, WifiOff, X } from 'lucide-react';
import { useAppStore } from '../store';

interface VideoPlayerProps {
  streamUrl: string;
}

export default function VideoPlayer({ streamUrl }: VideoPlayerProps) {
  // Added setPlayingChannel so we can close the player from the error screen
  const { channelName, setPlayingChannel } = useAppStore();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  
  const [hasFatalError, setHasFatalError] = useState(false);
  
  // DYNAMIC ERROR STATE
  const [errorUI, setErrorUI] = useState({ title: '', desc: '', raw: '' });
  
  const [progress, setProgress] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState("00:00");
  const [durationDisplay, setDurationDisplay] = useState("00:00");
  const [isLive, setIsLive] = useState(true);
  
  const [showControls, setShowControls] = useState(true);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Menus & Tracks States
  const [activeMenu, setActiveMenu] = useState<'quality' | 'audio' | 'subtitles' | null>(null);
  const activeMenuRef = useRef<'quality' | 'audio' | 'subtitles' | null>(null);

  const [levels, setLevels] = useState<any[]>([]);
  const [currentLevel, setCurrentLevel] = useState<number>(-1);
  const [autoLevel, setAutoLevel] = useState<number>(-1); 

  const [audioTracks, setAudioTracks] = useState<any[]>([]);
  const [currentAudioTrack, setCurrentAudioTrack] = useState<number>(-1);

  const [subtitleTracks, setSubtitleTracks] = useState<any[]>([]);
  const [currentSubtitleTrack, setCurrentSubtitleTrack] = useState<number>(-1);

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || !isFinite(seconds)) return "00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        try { (window.screen.orientation as any).unlock(); } catch (err) {}
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // REAL-TIME INTERNET CONNECTION LISTENER
  useEffect(() => {
    const handleOffline = () => {
      setErrorUI({
        title: "Connection Lost",
        desc: "Your internet connection dropped while playing the stream. Please check your Wi-Fi or cellular data.",
        raw: "ERR_INTERNET_DISCONNECTED"
      });
      setHasFatalError(true);
      setIsBuffering(false);
    };

    window.addEventListener('offline', handleOffline);
    return () => window.removeEventListener('offline', handleOffline);
  }, []);

  useEffect(() => {
    setHasFatalError(false);
    setErrorUI({ title: '', desc: '', raw: '' });
    setActiveMenu(null);
    setAutoLevel(-1);
    activeMenuRef.current = null;
    
    if (containerRef.current) {
      containerRef.current.style.opacity = '1';
      containerRef.current.style.display = '';
    }

    const video = videoRef.current;
    if (!video) return;

    const handleEnterPip = () => window.dispatchEvent(new CustomEvent('pip-status', { detail: true }));
    const handleLeavePip = () => {
      setTimeout(() => {
        if (videoRef.current && videoRef.current.paused) {
          if (containerRef.current) {
            containerRef.current.style.opacity = '0';
            containerRef.current.style.display = 'none';
          }
          window.dispatchEvent(new CustomEvent('force-close-player'));
        } else {
          window.dispatchEvent(new CustomEvent('pip-status', { detail: false }));
        }
      }, 100);
    };

    video.addEventListener('enterpictureinpicture', handleEnterPip);
    video.addEventListener('leavepictureinpicture', handleLeavePip);

    const initializePlayer = async () => {
      let defaultQuality = 'auto';
      let defaultAudio = '';
      let defaultSubtitle = '';

      try {
        const res = await fetch(`${API_URL}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          defaultQuality = data.default_quality || 'auto';
          defaultAudio = data.default_audio || '';
          defaultSubtitle = data.default_subtitle || '';
        }
      } catch (e: any) { 
        console.error("Settings Fetch Error:", e); 
      }

      if (Hls.isSupported()) {
        const hls = new Hls({ maxMaxBufferLength: 30 });
        hlsRef.current = hls;

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        let initialAudioSet = false;
        let initialSubSet = false;

        hls.on(Hls.Events.MANIFEST_PARSED, (_: any, data: any) => {
          setLevels(data.levels);
          
          let targetLevel = -1; 
          if (data.levels.length > 0) {
            if (defaultQuality === 'high') targetLevel = data.levels.length - 1;
            else if (defaultQuality === 'low') targetLevel = 0;
          }

          if (targetLevel !== -1) {
            hls.startLevel = targetLevel;
            hls.nextLoadLevel = targetLevel;
            hls.currentLevel = targetLevel; 
          }
          setCurrentLevel(targetLevel);

          if (hls.audioTracks && hls.audioTracks.length > 0) {
            setAudioTracks(hls.audioTracks);
            if (defaultAudio) {
              const idx = hls.audioTracks.findIndex(t => 
                t.name?.toLowerCase().includes(defaultAudio.toLowerCase()) || 
                t.lang?.toLowerCase().includes(defaultAudio.toLowerCase())
              );
              if (idx !== -1) {
                hls.audioTrack = idx;
                setCurrentAudioTrack(idx);
                initialAudioSet = true;
              }
            }
            if (!initialAudioSet) setCurrentAudioTrack(hls.audioTrack);
          }

          if (hls.subtitleTracks && hls.subtitleTracks.length > 0) {
            setSubtitleTracks(hls.subtitleTracks);
            if (defaultSubtitle) {
              const idx = hls.subtitleTracks.findIndex(t => 
                t.name?.toLowerCase().includes(defaultSubtitle.toLowerCase()) || 
                t.lang?.toLowerCase().includes(defaultSubtitle.toLowerCase())
              );
              if (idx !== -1) {
                hls.subtitleTrack = idx;
                setCurrentSubtitleTrack(idx);
                initialSubSet = true;
              }
            }
            if (!initialSubSet) setCurrentSubtitleTrack(-1);
          }

          setIsBuffering(false);
          video.play().catch(() => setIsPlaying(false));
        });

        if ((Hls.Events as any).LEVEL_SWITCHED) {
          hls.on((Hls.Events as any).LEVEL_SWITCHED, (_: any, data: any) => {
            setAutoLevel(data.level);
          });
        }

        if ((Hls.Events as any).AUDIO_TRACKS_UPDATED) {
          hls.on((Hls.Events as any).AUDIO_TRACKS_UPDATED, (_: any, data: any) => {
            const tracks = data.audioTracks || [];
            setAudioTracks(tracks);
            if (defaultAudio && !initialAudioSet && tracks.length > 0) {
              const idx = tracks.findIndex((t: any) => 
                t.name?.toLowerCase().includes(defaultAudio.toLowerCase()) || 
                t.lang?.toLowerCase().includes(defaultAudio.toLowerCase())
              );
              if (idx !== -1) {
                hls.audioTrack = idx;
                setCurrentAudioTrack(idx);
                initialAudioSet = true;
              }
            }
          });
        }

        if ((Hls.Events as any).SUBTITLE_TRACKS_UPDATED) {
          hls.on((Hls.Events as any).SUBTITLE_TRACKS_UPDATED, (_: any, data: any) => {
            const tracks = data.subtitleTracks || [];
            setSubtitleTracks(tracks);
            if (defaultSubtitle && !initialSubSet && tracks.length > 0) {
              const idx = tracks.findIndex((t: any) => 
                t.name?.toLowerCase().includes(defaultSubtitle.toLowerCase()) || 
                t.lang?.toLowerCase().includes(defaultSubtitle.toLowerCase())
              );
              if (idx !== -1) {
                hls.subtitleTrack = idx;
                setCurrentSubtitleTrack(idx);
                initialSubSet = true;
              }
            }
          });
        }

        // INTELLIGENT ERROR PARSING
        hls.on(Hls.Events.ERROR, (_: any, data: any) => {
          if (data.fatal) {
            setIsBuffering(false);
            
            // 1. Check for physical internet drop first
            if (!navigator.onLine) {
              setErrorUI({
                title: "No Internet Connection",
                desc: "You appear to be offline. Please check your network connection and try again.",
                raw: "ERR_INTERNET_DISCONNECTED"
              });
              setHasFatalError(true);
              hls.destroy();
              return;
            }

            // 2. Identify specific network failures (CORS / 404 / 403)
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setErrorUI({
                title: "Connection Refused",
                desc: "The stream server rejected the request. This is usually caused by strict browser security (CORS) or a dead link.",
                raw: `Network Error: ${data.details}`
              });
              setHasFatalError(true);
              hls.destroy();
            }
            // 3. Attempt to bypass media corruption
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            }
            // 4. Catastrophic parsing/format failures
            else {
              setErrorUI({
                title: "Playback Error",
                desc: "The video format is not supported or the stream data is corrupted.",
                raw: `Media Error: ${data.details}`
              });
              setHasFatalError(true);
              hls.destroy();
            }
          }
        });
      } 
      else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        video.addEventListener('loadedmetadata', () => {
          setIsBuffering(false);
          video.play().catch(() => setIsPlaying(false));
        });
        video.addEventListener('error', () => {
          setIsBuffering(false);
          if (!navigator.onLine) {
            setErrorUI({ title: "No Internet Connection", desc: "You are offline.", raw: "ERR_INTERNET_DISCONNECTED" });
          } else {
            setErrorUI({ title: "Playback Error", desc: "The media format is unsupported by your browser or the connection failed.", raw: "Native Browser Error (MEDIA_ERR)" });
          }
          setHasFatalError(true);
        });
      }
    };

    initializePlayer();
    startControlHideTimer();

    return () => {
      if (hlsRef.current) {
        hlsRef.current.stopLoad(); 
        hlsRef.current.detachMedia();
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      video.removeEventListener('enterpictureinpicture', handleEnterPip);
      video.removeEventListener('leavepictureinpicture', handleLeavePip);
      if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
      video.pause();
      video.src = ""; 
      video.load(); 
    };
  }, [streamUrl]);

  // ==========================================
  // CONTROLS & MENUS
  // ==========================================
  const toggleMenu = (menu: 'quality' | 'audio' | 'subtitles') => {
    const nextMenu = activeMenu === menu ? null : menu;
    setActiveMenu(nextMenu);
    activeMenuRef.current = nextMenu;
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
      setCurrentSubtitleTrack(trackIndex);
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
    } else {
      startControlHideTimer();
    }
  };

  const togglePlay = () => {
    if (hasFatalError) return;
    if (videoRef.current?.paused) {
      videoRef.current.play();
      setIsPlaying(true);
    } else {
      videoRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
    setIsMuted(val === 0);
  };

  const toggleMute = () => {
    if (videoRef.current) {
      const nextMuted = !videoRef.current.muted;
      videoRef.current.muted = nextMuted;
      setIsMuted(nextMuted);
      
      if (!nextMuted && volume === 0) {
        setVolume(0.5);
        videoRef.current.volume = 0.5;
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
        await containerRef.current?.requestFullscreen();
        try { await (window.screen.orientation as any).lock('landscape'); } catch (err) {}
      } catch (e: any) { 
        console.warn("Fullscreen Error:", e); 
      }
    } else {
      document.exitFullscreen().catch(e => console.warn(e));
    }
  };

  const togglePiP = () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture();
    else videoRef.current?.requestPictureInPicture();
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
          const safeName = channelName || 'Live Channel';
          targetUrl = `intent://${path}#Intent;scheme=${scheme};action=android.intent.action.VIEW;type=video/*;S.title=${encodeURIComponent(safeName)};end;`;
        }
      } else {
        targetUrl = `vlc://${streamUrl}`;
      }
      
      window.location.href = targetUrl;
    } catch (error: any) {
      console.error("External Player Launch Error:", error);
    }
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
        className={`w-full h-full object-contain ${hasFatalError ? 'hidden' : ''}`}
        onTimeUpdate={handleTimeUpdate}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
      />

      {isBuffering && !hasFatalError && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <Loader2 size={48} className="animate-spin text-blue-500 drop-shadow-lg" />
        </div>
      )}

      {/* INTELLIGENT ERROR UI */}
      {hasFatalError && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0c10] text-center p-6 animate-in fade-in duration-300">
          
          {/* THE NEW CLOSE BUTTON */}
          <button 
            onClick={() => setPlayingChannel('', '', '')}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors z-50"
            title="Close Player"
          >
            <X size={20} />
          </button>

          {/* DYNAMIC ICON */}
          {errorUI.title === "No Internet Connection" || errorUI.title === "Connection Lost" ? (
            <WifiOff size={64} className="text-red-500 mb-5 drop-shadow-[0_0_15px_rgba(239,68,68,0.3)]" />
          ) : (
            <AlertTriangle size={64} className="text-yellow-500 mb-5 drop-shadow-[0_0_15px_rgba(234,179,8,0.3)]" />
          )}
          
          {/* DYNAMIC TEXT */}
          <h3 className="text-2xl font-bold text-white mb-2 tracking-wide">{errorUI.title}</h3>
          <p className="text-slate-300 mb-6 max-w-md text-sm sm:text-base leading-relaxed">
            {errorUI.desc}
          </p>
          
          {/* TECHNICAL DETAILS */}
          <div className="bg-black/50 border border-slate-800/50 rounded-lg p-3.5 mb-8 w-full max-w-lg shadow-inner">
            <p className="text-red-400 font-mono text-xs break-all text-left">{errorUI.raw}</p>
          </div>
          
          <button 
            onClick={launchExternalPlayer} 
            className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg flex items-center gap-3 transition-all shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:scale-105 active:scale-95"
          >
            <ExternalLink size={20} /> Open in External Player
          </button>
        </div>
      )}

      {/* Control Bar */}
      {!hasFatalError && (
        <div className={`absolute bottom-0 left-0 w-full bg-gradient-to-t from-black via-black/80 to-transparent transition-opacity duration-300 px-4 pb-4 pt-16 z-20 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="w-full h-2 bg-slate-700/50 rounded-full mb-4 cursor-pointer relative group/seek" onClick={handleSeek}>
            <div className="h-full rounded-full transition-all bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex items-center justify-between">
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
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-red-600/20 border border-red-600/50 select-none">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-xs font-bold text-red-500 uppercase tracking-wider">Live</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-sm font-medium text-slate-300 font-mono tracking-tight select-none">
                  <span>{currentTimeDisplay}</span><span className="text-slate-500">/</span><span>{durationDisplay}</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4 sm:gap-5 relative">
              
              {/* SUBTITLES MENU */}
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

              {/* AUDIO MENU */}
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

              {/* QUALITY MENU */}
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