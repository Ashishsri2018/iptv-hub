import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Trash2, Plus, Globe, RefreshCw } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_DIRECTORY_URL;

interface DirectoryLink {
  id: number;
  title: string;
  url: string;
  description: string;
  is_starred: boolean;
  status: string;
}

interface Category {
  id: number;
  name: string;
  sort_order: number;
  links: DirectoryLink[];
}

export default function Directory() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDirectory();
  }, []);

  const fetchDirectory = async () => {
    try {
      const response = await fetch(`${API_URL}/directory`);
      if (!response.ok) throw new Error('Failed to fetch directory');
      const data = await response.json();
      setCategories(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const forceStatusCheck = async () => {
    setIsChecking(true);
    try {
      await fetch(`${API_URL}/check-status`, { method: 'POST' });
      await fetchDirectory(); 
    } catch (err: any) {
      console.error("Failed to check status", err);
    } finally {
      setIsChecking(false);
    }
  };

  const toggleStar = async (categoryId: number, linkId: number) => {
    setCategories(prev => prev.map(cat => {
      if (cat.id === categoryId) {
        return {
          ...cat,
          links: cat.links.map(link => 
            link.id === linkId ? { ...link, is_starred: !link.is_starred } : link
          )
        };
      }
      return cat;
    }));

    try {
      await fetch(`${API_URL}/links/${linkId}/star`, { method: 'PUT' });
    } catch (err) {
      console.error("Failed to update star status", err);
      fetchDirectory(); 
    }
  };

  const deleteLink = async (categoryId: number, linkId: number) => {
    if (!window.confirm("Are you sure you want to delete this site?")) return;

    setCategories(prev => prev.map(cat => {
      if (cat.id === categoryId) {
        return {
          ...cat,
          links: cat.links.filter(link => link.id !== linkId)
        };
      }
      return cat;
    }));

    try {
      await fetch(`${API_URL}/links/${linkId}`, { method: 'DELETE' });
    } catch (err) {
      console.error("Failed to delete link", err);
      fetchDirectory();
    }
  };

  const sortLinks = (links: DirectoryLink[]) => {
    return [...links].sort((a, b) => {
      if (a.is_starred !== b.is_starred) {
        return a.is_starred ? -1 : 1;
      }
      return a.title.localeCompare(b.title);
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 md:p-6">
      <div className="max-w-[1400px] mx-auto">
        
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-2">
            <Globe className="text-blue-500" size={24} />
            <h1 className="text-2xl font-bold text-slate-100">Web Directory</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={forceStatusCheck}
              disabled={isChecking}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
              title="Verify if sites are live"
            >
              <RefreshCw size={16} className={isChecking ? "animate-spin text-blue-400" : ""} />
              <span className="hidden sm:inline">{isChecking ? 'Checking...' : 'Check Status'}</span>
            </button>
            
            <Link 
              to="/directory/add" 
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            >
              <Plus size={16} />
              <span className="hidden sm:inline">Add Resource</span>
            </Link>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-3 rounded-md mb-4 text-sm">
            {error}
          </div>
        )}

        {categories.length === 0 && !error ? (
          <div className="text-center py-12 text-slate-400">
            <Globe size={36} className="mx-auto mb-3 opacity-50" />
            <p className="text-base">Your directory is empty.</p>
            <p className="text-xs mt-1">Click "Add Resource" to start building your hub.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {categories.map((category) => (
              <div key={category.id} className="bg-slate-950/40 rounded-lg border border-slate-800 p-4">
                <h2 className="text-lg font-bold text-slate-200 border-b border-slate-800 pb-2 mb-3">
                  {category.name}
                </h2>
                
                {category.links && category.links.length > 0 ? (
                  /* HIGH DENSITY GRID */
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
                    {sortLinks(category.links).map((link) => (
                      <div 
                        key={link.id} 
                        className="group flex flex-col justify-between bg-slate-900/80 border border-slate-700 hover:border-slate-500 rounded-md p-3 transition-all"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-0.5">
                            <a 
                              href={link.url}
                              target="_self"
                              className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors line-clamp-1 pr-2"
                              title={link.title}
                            >
                              {link.title}
                            </a>
                            <div className="flex items-center gap-1 shrink-0">
                              <button 
                                onClick={() => toggleStar(category.id, link.id)}
                                className="p-1 rounded hover:bg-slate-800 transition-colors"
                              >
                                <Star 
                                  size={14} 
                                  className={link.is_starred ? "fill-yellow-500 text-yellow-500" : "text-slate-500"} 
                                />
                              </button>
                              <button 
                                onClick={() => deleteLink(category.id, link.id)}
                                className="p-1 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          
                          <p className="text-[10px] text-slate-500 mb-1.5 truncate">
                            {link.url}
                          </p>
                          
                          {link.description && (
                            <p className="text-xs text-slate-400 line-clamp-2 mt-1 leading-relaxed">
                              {link.description}
                            </p>
                          )}
                        </div>

                        <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            link.status === 'live' ? 'bg-green-500' : 
                            link.status === 'dead' ? 'bg-red-500' : 'bg-slate-500'
                          }`}></span>
                          <span className="text-slate-500 capitalize">
                            {link.status === 'unknown' ? 'Unchecked' : link.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-slate-500 text-xs italic py-1">No links in this category yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
