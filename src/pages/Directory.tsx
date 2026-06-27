import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Plus, Globe, RefreshCw, Search, Ghost } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_DIRECTORY_URL;

interface DirectoryLink {
  id: number; title: string; url: string; description: string;
  is_starred: boolean; status: string; tags: string[]; mirrors?: DirectoryLink[];
}
interface Category { id: number; name: string; links: DirectoryLink[]; }

export default function Directory() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(() => { fetchDirectory(); }, []);

  const fetchDirectory = async () => {
    try {
      const response = await fetch(`${API_URL}/directory`);
      if (response.ok) setCategories(await response.json());
    } catch (err) { console.error(err); } 
    finally { setIsLoading(false); }
  };

  const forceStatusCheck = async () => {
    setIsChecking(true);
    try { await fetch(`${API_URL}/check-status`, { method: 'POST' }); await fetchDirectory(); } 
    catch (err) { console.error(err); } finally { setIsChecking(false); }
  };

  const toggleStar = async (categoryId: number, linkId: number) => {
    setCategories(prev => prev.map(cat => cat.id === categoryId ? { ...cat, links: cat.links.map(link => link.id === linkId ? { ...link, is_starred: !link.is_starred } : link) } : cat));
    try { await fetch(`${API_URL}/links/${linkId}/star`, { method: 'PUT' }); } 
    catch (err) { fetchDirectory(); }
  };

  const sortLinks = (links: DirectoryLink[]) => {
    return [...links].sort((a, b) => a.is_starred !== b.is_starred ? (a.is_starred ? -1 : 1) : a.title.localeCompare(b.title));
  };

  const filteredCategories = categories.map(cat => ({
    ...cat,
    links: cat.links.filter(link => 
      link.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
      link.url.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (link.description && link.description.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (link.tags && link.tags.some(tag => tag.toLowerCase().includes(searchTerm.toLowerCase())))
    )
  })).filter(cat => cat.links.length > 0 || cat.name.toLowerCase().includes(searchTerm.toLowerCase()));

  if (isLoading) return <div className="flex h-full items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div></div>;

  return (
    <div className="h-full overflow-y-auto p-3 md:p-6 pb-28 md:pb-6">
      <div className="max-w-[1400px] mx-auto">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Globe className="text-blue-500" size={24} />
            <h1 className="text-2xl font-bold text-slate-100">Web Directory</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={forceStatusCheck} disabled={isChecking} className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
              <RefreshCw size={16} className={isChecking ? "animate-spin text-blue-400" : ""} />
              <span className="hidden sm:inline">{isChecking ? 'Checking...' : 'Check Status'}</span>
            </button>
            <Link to="/directory/add" className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors">
              <Plus size={16} /> <span className="hidden sm:inline">Manage</span>
            </Link>
          </div>
        </div>

        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input type="text" placeholder="Search websites, URLs, tags, or categories..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-900/80 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-slate-200 focus:outline-none focus:border-blue-500 text-sm"/>
        </div>

        {filteredCategories.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Globe size={36} className="mx-auto mb-3 opacity-50" />
            <p className="text-base">No results found.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {filteredCategories.map((category) => (
              <div key={category.id} className="bg-slate-950/40 rounded-lg border border-slate-800 p-4">
                <div className="border-b border-slate-800 pb-2 mb-3">
                  <h2 className="text-lg font-bold text-slate-200">{category.name}</h2>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 max-h-[220px] overflow-y-auto overflow-x-hidden p-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700 [&::-webkit-scrollbar-thumb]:rounded-full">
                  {sortLinks(category.links).map((link) => (
                    <div key={link.id} className="group flex flex-col justify-between bg-slate-900/80 border border-slate-700 hover:border-slate-500 rounded-md p-2.5 transition-all">
                      <div>
                        <div className="relative mb-1">
                          
                          {/* INLINE MIRROR UI */}
                          <div className="flex flex-wrap items-baseline gap-0.5 pr-8 overflow-hidden">
                            <a href={link.url} target="_blank" rel="noreferrer" className={`text-sm font-semibold truncate ${link.status === 'dead' ? 'text-slate-400 line-through' : 'text-blue-400 hover:text-blue-300'}`}>
                              {link.title}
                            </a>
                            
                            {link.mirrors && link.mirrors.map((m, i) => (
                              <span key={m.id} className="text-sm font-semibold text-slate-400">
                                , <a href={m.url} target="_blank" rel="noreferrer" title={m.title} className={`${m.status === 'dead' ? 'text-slate-500 line-through' : 'text-purple-400 hover:text-purple-300'}`}>{i + 2}</a>
                              </span>
                            ))}

                            {link.status === 'dead' && (
                              <a href={`https://web.archive.org/web/*/${link.url}`} target="_blank" rel="noreferrer" className="ml-1 text-slate-400 hover:text-slate-200 transition-colors" title="Search Wayback Machine Archive">
                                <Ghost size={12} />
                              </a>
                            )}
                            
                            <span className="text-[10px] text-slate-500 ml-1 truncate">
                              ({link.url.replace(/^https?:\/\//, '')})
                            </span>
                          </div>

                          <div className="flex items-center absolute right-0 top-0 bg-slate-900/90 pl-1 rounded-bl">
                            <button onClick={() => toggleStar(category.id, link.id)} className="p-1 rounded hover:bg-slate-800 transition-colors">
                              <Star size={14} className={link.is_starred ? "fill-yellow-500 text-yellow-500" : "text-slate-500"} />
                            </button>
                          </div>
                        </div>
                        
                        {link.description && <p className="text-xs text-slate-400 line-clamp-1 mt-1">{link.description}</p>}
                        
                        {link.tags && link.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {link.tags.map((tag, idx) => (
                              <span key={idx} className="text-[9px] font-medium bg-slate-800/50 text-slate-400 border border-slate-700 px-1.5 py-0.5 rounded">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                        <span className={`w-1.5 h-1.5 rounded-full ${link.status === 'live' ? 'bg-green-500' : link.status === 'dead' ? 'bg-red-500' : 'bg-slate-500'}`}></span>
                        <span className="text-slate-500 capitalize">{link.status === 'unknown' ? 'Unchecked' : link.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
