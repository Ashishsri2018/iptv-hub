import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Star, Tv, PlusSquare, FolderGit2, Settings as SettingsIcon, Menu, X } from 'lucide-react';
import VideoPlayer from './components/VideoPlayer';
import Favorites from './pages/Favorites';
import Channels from './pages/Channels';
import AddSource from './pages/AddSource';
import Sources from './pages/Sources';
import Settings from './pages/Settings';
import { useAppStore } from './store';

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isPipActive, setIsPipActive] = useState(false);
  const { streamUrl, channelName, closePlayer } = useAppStore();

  const navItems = [
    { path: '/', label: 'Favorites', icon: <Star size={20} /> },
    { path: '/channels', label: 'Channels', icon: <Tv size={20} /> },
    { path: '/add', label: 'Add Source', icon: <PlusSquare size={20} /> },
    { path: '/sources', label: 'Sources', icon: <FolderGit2 size={20} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
  ];

  const closeMenu = () => setIsMobileMenuOpen(false);

  // THE FIX: Aggressive Failsafe. If the player unmounts for ANY reason, unlock the screen UI.
  useEffect(() => {
    if (!streamUrl) {
      setIsPipActive(false);
    }
  }, [streamUrl]);

  // Hardware Back Button Logic
  useEffect(() => {
    if (streamUrl) {
      window.history.pushState({ playerOpen: true }, '');
      const handlePopState = () => {
        setIsPipActive(false); // Un-shrink the UI before closing
        closePlayer();
      };
      window.addEventListener('popstate', handlePopState);
      return () => window.removeEventListener('popstate', handlePopState);
    }
  }, [streamUrl, closePlayer]);

  const handleManualClose = () => {
    if (window.history.state?.playerOpen) {
      window.history.back(); 
    } else {
      setIsPipActive(false);
      closePlayer();
    }
  };

  // Global PiP Listener & Strict Force Close
  useEffect(() => {
    const handlePipChange = (e: Event) => setIsPipActive((e as CustomEvent).detail);
    
    const handleForceClose = () => {
      setIsPipActive(false); // Instantly resets UI state so the next channel isn't born invisible
      closePlayer();
      
      // Silently clean up Android back-button history so it doesn't get stuck
      if (window.history.state?.playerOpen) {
        window.history.go(-1);
      }
    };

    window.addEventListener('pip-status', handlePipChange);
    window.addEventListener('force-close-player', handleForceClose);
    
    return () => {
      window.removeEventListener('pip-status', handlePipChange);
      window.removeEventListener('force-close-player', handleForceClose);
    };
  }, [closePlayer]);

  return (
    <HashRouter>
      <div className="flex h-screen w-full overflow-hidden bg-slate-900 text-slate-100">
        
        {/* Mobile Header */}
        <div className="md:hidden absolute top-0 left-0 w-full h-16 px-4 flex justify-between items-center bg-slate-950 z-40 border-b border-slate-800 shadow-md">
          <h1 className="text-xl font-bold tracking-wider text-blue-500">IPTV HUB</h1>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 -mr-2 text-slate-300">
            {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>

        {/* Sidebar Navigation */}
        <nav className={`fixed md:relative top-0 left-0 z-30 w-64 h-full bg-slate-950 border-r border-slate-800 transition-transform duration-300 ease-in-out pt-16 md:pt-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="hidden md:block p-6">
            <h1 className="text-2xl font-bold tracking-wider text-blue-500">IPTV HUB</h1>
          </div>
          <ul className="flex flex-col gap-2 p-4">
            {navItems.map((item) => (
              <li key={item.path}>
                <NavLink to={item.path} onClick={closeMenu} className={({ isActive }) => `flex items-center gap-4 p-3 rounded-lg transition-colors ${isActive ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'}`}>
                  {item.icon}
                  <span className="font-medium">{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Main Content Area */}
        <main className="flex-1 h-full w-full overflow-hidden relative pt-16 md:pt-0">
          <Routes>
            <Route path="/" element={<Favorites />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/add" element={<AddSource />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        {/* Global Video Player Modal */}
        {streamUrl && (
          <div className={`transition-all duration-300 ${
            isPipActive 
              ? 'fixed bottom-0 right-0 w-0 h-0 opacity-0 pointer-events-none z-0' 
              : 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-sm p-0 md:p-6 pointer-events-auto animate-in fade-in duration-200'
          }`}>
            <div className={`flex flex-col w-full max-w-5xl h-full md:h-[85vh] bg-black md:border border-slate-700 md:rounded-xl shadow-2xl overflow-hidden relative animate-in zoom-in-95 duration-200 ${isPipActive ? 'hidden' : ''}`}>
              
              {/* Header Bar */}
              <div className="flex justify-between items-center px-4 py-3 bg-gradient-to-b from-black/80 to-transparent absolute top-0 w-full z-20 transition-opacity">
                <div className="flex items-center gap-3 overflow-hidden drop-shadow-md">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <h2 className="text-lg font-bold text-white truncate pr-4">{channelName}</h2>
                </div>
                <button onClick={handleManualClose} className="p-2 ml-2 text-white/70 hover:text-white hover:bg-white/10 rounded-lg transition-colors shrink-0 backdrop-blur-md">
                  <X size={24} />
                </button>
              </div>
              
              {/* Video Player Component */}
              <div className="flex-1 w-full h-full bg-black relative">
                <VideoPlayer streamUrl={streamUrl} />
              </div>

            </div>
          </div>
        )}

        {isMobileMenuOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden" onClick={closeMenu} />}
      </div>
    </HashRouter>
  );
}