import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Star, Tv, PlusSquare, FolderGit2, Settings as SettingsIcon, Menu, X } from 'lucide-react';
import Favorites from './pages/Favorites';
import Channels from './pages/Channels';
import AddSource from './pages/AddSource';
import Sources from './pages/Sources';
import Settings from './pages/Settings';
import PlayerOverlay from './components/PlayerOverlay';
import { useAppStore } from './store';

export default function App() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const fetchSettings = useAppStore(state => state.fetchSettings);

  useEffect(() => {
    fetchSettings(); // Download settings once when app boots!
  }, [fetchSettings]);

  const navItems = [
    { path: '/', label: 'Favorites', icon: <Star size={20} /> },
    { path: '/channels', label: 'Channels', icon: <Tv size={20} /> },
    { path: '/add', label: 'Add Source', icon: <PlusSquare size={20} /> },
    { path: '/sources', label: 'Sources', icon: <FolderGit2 size={20} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
  ];

  const closeMenu = () => setIsMobileMenuOpen(false);

  return (
    <HashRouter>
      <div className="flex h-screen w-full overflow-hidden bg-slate-900 text-slate-100">
        
        <div className="md:hidden absolute top-0 left-0 w-full h-16 px-4 flex justify-between items-center bg-slate-950 z-40 border-b border-slate-800 shadow-md">
          <h1 className="text-xl font-bold tracking-wider text-blue-500">IPTV HUB</h1>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 -mr-2 text-slate-300">
            {isMobileMenuOpen ? <X size={28} /> : <Menu size={28} />}
          </button>
        </div>

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

        <main className="flex-1 h-full w-full overflow-hidden relative pt-16 md:pt-0">
          <Routes>
            <Route path="/" element={<Favorites />} />
            <Route path="/channels" element={<Channels />} />
            <Route path="/add" element={<AddSource />} />
            <Route path="/sources" element={<Sources />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <PlayerOverlay />

        {isMobileMenuOpen && <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 md:hidden" onClick={closeMenu} />}
      </div>
    </HashRouter>
  );
}
