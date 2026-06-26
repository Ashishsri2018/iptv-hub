import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Star, Trash2, Plus, Globe } from 'lucide-react';

// Replace with your actual Cloudflare Worker URL
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

  const toggleStar = async (categoryId: number, linkId: number) => {
    // Optimistic UI update
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
      // If it fails, we fetch the true state back from the server
      fetchDirectory(); 
    }
  };

  const deleteLink = async (categoryId: number, linkId: number) => {
    if (!window.confirm("Are you sure you want to delete this site?")) return;

    // Optimistic UI update
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

  // Helper to enforce strict sorting on the frontend (Starred -> Alphabetical)
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        
        <div className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-3">
            <Globe className="text-blue-500" size={32} />
            <h1 className="text-3xl font-bold text-slate-100">Web Directory</h1>
          </div>
          <Link 
            to="/directory/add" 
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Plus size={20} />
            <span className="hidden sm:inline">Add Resource</span>
          </Link>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 p-4 rounded-lg mb-6">
            {error}
          </div>
        )}

        {categories.length === 0 && !error ? (
          <div className="text-center py-20 text-slate-400">
            <Globe size={48} className="mx-auto mb-4 opacity-50" />
            <p className="text-lg">Your directory is empty.</p>
            <p className="text-sm mt-2">Click "Add Resource" to start building your hub.</p>
          </div>
        ) : (
          <div className="space-y-10">
            {categories.map((category) => (
              <div key={category.id} className="bg-slate-950/50 rounded-xl border border-slate-800 p-6">
                <h2 className="text-xl font-bold text-slate-200 border-b border-slate-800 pb-3 mb-4">
                  {category.name}
                </h2>
                
                {category.links && category.links.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
                    {sortLinks(category.links).map((link) => (
                      <div 
                        key={link.id} 
                        className="group flex flex-col justify-between bg-slate-900 border border-slate-700 hover:border-slate-500 rounded-lg p-4 transition-all"
                      >
                        <div>
                          <div className="flex justify-between items-start mb-1">
                            <a 
                              href={link.url}
                              className="text-lg font-semibold text-blue-400 hover:text-blue-300 transition-colors line-clamp-1"
                              title={link.title}
                            >
                              {link.title}
                            </a>
                            <div className="flex items-center gap-2 ml-3">
                              <button 
                                onClick={() => toggleStar(category.id, link.id)}
                                className="p-1.5 rounded hover:bg-slate-800 transition-colors"
                              >
                                <Star 
                                  size={18} 
                                  className={link.is_starred ? "fill-yellow-500 text-yellow-500" : "text-slate-500"} 
                                />
                              </button>
                              <button 
                                onClick={() => deleteLink(category.id, link.id)}
                                className="p-1.5 rounded hover:bg-red-900/30 text-slate-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 size={18} />
                              </button>
                            </div>
                          </div>
                          
                          <p className="text-xs text-slate-500 mb-2 truncate">
                            {link.url}
                          </p>
                          
                          {link.description && (
                            <p className="text-sm text-slate-400 line-clamp-2 mt-2">
                              {link.description}
                            </p>
                          )}
                        </div>

                        {/* Status Indicator from the Background Worker */}
                        <div className="mt-4 flex items-center gap-2 text-xs">
                          <span className={`w-2 h-2 rounded-full ${
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
                  <p className="text-slate-500 text-sm italic py-2">No links in this category yet.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
