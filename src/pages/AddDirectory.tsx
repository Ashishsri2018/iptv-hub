import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, Link as LinkIcon, ArrowLeft, Save } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_DIRECTORY_URL;

interface Category {
  id: number;
  name: string;
}

export default function AddDirectory() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  
  // States for New Category Form
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);

  // States for New Link Form
  const [linkData, setLinkData] = useState({
    category_id: '',
    title: '',
    url: '',
    description: ''
  });
  const [isSubmittingLink, setIsSubmittingLink] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Fetch categories on load for the dropdown
  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_URL}/directory`);
      if (response.ok) {
        const data = await response.json();
        setCategories(data.map((cat: any) => ({ id: cat.id, name: cat.name })));
      }
    } catch (err) {
      console.error("Failed to load categories", err);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCategory(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCategoryName, sort_order: 0 })
      });

      if (!response.ok) throw new Error('Failed to add category');
      
      setMessage({ type: 'success', text: 'Category created successfully!' });
      setNewCategoryName('');
      fetchCategories(); // Refresh the dropdown list
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmittingCategory(false);
    }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLink(true);
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch(`${API_URL}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category_id: parseInt(linkData.category_id),
          title: linkData.title,
          url: linkData.url,
          description: linkData.description
        })
      });

      if (!response.ok) throw new Error('Failed to add link');
      
      setMessage({ type: 'success', text: 'Link added successfully!' });
      setLinkData({ category_id: linkData.category_id, title: '', url: '', description: '' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmittingLink(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8">
      <div className="max-w-3xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <button 
            onClick={() => navigate('/directory')}
            className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <h1 className="text-2xl font-bold text-slate-100">Add to Web Directory</h1>
        </div>

        {/* Status Message */}
        {message.text && (
          <div className={`p-4 rounded-lg mb-6 border ${
            message.type === 'error' ? 'bg-red-900/50 border-red-500 text-red-200' : 'bg-green-900/50 border-green-500 text-green-200'
          }`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
          
          {/* LEFT COLUMN: Add Link (Main Focus) */}
          <div className="md:col-span-3 bg-slate-950/50 rounded-xl border border-slate-800 p-6">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
              <LinkIcon className="text-blue-500" size={24} />
              <h2 className="text-xl font-semibold text-slate-200">Save a Website</h2>
            </div>

            <form onSubmit={handleAddLink} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Category</label>
                <select 
                  required
                  value={linkData.category_id}
                  onChange={(e) => setLinkData({...linkData, category_id: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="" disabled>Select a category...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Website Title</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. FMHY, GitHub, Netflix"
                  value={linkData.title}
                  onChange={(e) => setLinkData({...linkData, title: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">URL (Must include https://)</label>
                <input 
                  type="url" 
                  required
                  placeholder="https://..."
                  value={linkData.url}
                  onChange={(e) => setLinkData({...linkData, url: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Description (Optional)</label>
                <textarea 
                  rows={3}
                  placeholder="What is this site used for?"
                  value={linkData.description}
                  onChange={(e) => setLinkData({...linkData, description: e.target.value})}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <button 
                type="submit" 
                disabled={isSubmittingLink || !linkData.category_id}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white p-3 rounded-lg font-medium transition-colors mt-4"
              >
                <Save size={20} />
                {isSubmittingLink ? 'Saving...' : 'Save Website'}
              </button>
            </form>
          </div>

          {/* RIGHT COLUMN: Add Category */}
          <div className="md:col-span-2 bg-slate-950/50 rounded-xl border border-slate-800 p-6 h-fit">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
              <FolderPlus className="text-emerald-500" size={24} />
              <h2 className="text-xl font-semibold text-slate-200">New Category</h2>
            </div>

            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Category Name</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. Utilities, Streaming, Tools"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <button 
                type="submit" 
                disabled={isSubmittingCategory}
                className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-white p-2.5 rounded-lg font-medium transition-colors"
              >
                <FolderPlus size={18} />
                {isSubmittingCategory ? 'Creating...' : 'Create Category'}
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
