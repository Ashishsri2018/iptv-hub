import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, Link as LinkIcon, ArrowLeft, Save, Copy } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_DIRECTORY_URL;

interface DirectoryLink { id: number; title: string; url: string; }
interface Category { id: number; name: string; links: DirectoryLink[]; }

export default function AddDirectory() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);

  const [isMirrorMode, setIsMirrorMode] = useState(false);
  const [linkData, setLinkData] = useState({ category_id: '', parent_id: '', title: '', url: '', description: '', tags: '' });
  const [isSubmittingLink, setIsSubmittingLink] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => { fetchCategories(); }, []);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_URL}/directory`);
      if (response.ok) setCategories(await response.json());
    } catch (err) { console.error(err); }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingCategory(true);
    setMessage({ type: '', text: '' });
    try {
      const response = await fetch(`${API_URL}/categories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newCategoryName, sort_order: 0 })
      });
      if (!response.ok) throw new Error('Failed to add category');
      setMessage({ type: 'success', text: 'Category created successfully!' });
      setNewCategoryName('');
      fetchCategories(); 
    } catch (err: any) { setMessage({ type: 'error', text: err.message }); } 
    finally { setIsSubmittingCategory(false); }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLink(true);
    setMessage({ type: '', text: 'Checking connection and saving...' });
    try {
      const payload = isMirrorMode 
        ? { category_id: parseInt(linkData.category_id), title: "Mirror", url: linkData.url, parent_id: parseInt(linkData.parent_id), tags: "" }
        : { category_id: parseInt(linkData.category_id), title: linkData.title, url: linkData.url, description: linkData.description, tags: linkData.tags };

      const response = await fetch(`${API_URL}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Failed to add link');
      setMessage({ type: 'success', text: isMirrorMode ? 'Mirror added successfully!' : 'Website added successfully!' });
      setLinkData({ category_id: linkData.category_id, parent_id: linkData.parent_id, title: '', url: '', description: '', tags: '' });
      fetchCategories();
    } catch (err: any) { setMessage({ type: 'error', text: err.message }); } 
    finally { setIsSubmittingLink(false); }
  };

  const activeParentLinks = categories.find(c => c.id === parseInt(linkData.category_id))?.links || [];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 pb-28 md:pb-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate('/directory')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"><ArrowLeft size={24} /></button>
          <h1 className="text-2xl font-bold text-slate-100">Add to Web Directory</h1>
        </div>

        {message.text && (
          <div className={`p-4 rounded-lg mb-6 border ${message.type === 'error' ? 'bg-red-900/50 border-red-500 text-red-200' : 'bg-green-900/50 border-green-500 text-green-200'}`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div className="md:col-span-3 bg-slate-950/50 rounded-xl border border-slate-800 p-5">
            <div className="flex items-center justify-between mb-6 border-b border-slate-800 pb-4">
              <div className="flex items-center gap-3">
                {isMirrorMode ? <Copy className="text-purple-500" size={24} /> : <LinkIcon className="text-blue-500" size={24} />}
                <h2 className="text-xl font-semibold text-slate-200">{isMirrorMode ? 'Add Mirror Link' : 'Save a Website'}</h2>
              </div>
              <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800">
                <button type="button" onClick={() => setIsMirrorMode(false)} className={`px-3 py-1 text-sm rounded-md transition-colors ${!isMirrorMode ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>New Site</button>
                <button type="button" onClick={() => setIsMirrorMode(true)} className={`px-3 py-1 text-sm rounded-md transition-colors ${isMirrorMode ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>Mirror</button>
              </div>
            </div>

            <form onSubmit={handleAddLink} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Category</label>
                <select required value={linkData.category_id} onChange={(e) => setLinkData({...linkData, category_id: e.target.value, parent_id: ''})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none">
                  <option value="" disabled>Select a category...</option>
                  {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                </select>
              </div>

              {isMirrorMode && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Select Original Site</label>
                  <select required value={linkData.parent_id} onChange={(e) => setLinkData({...linkData, parent_id: e.target.value})} disabled={!linkData.category_id} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-purple-500 outline-none disabled:opacity-50">
                    <option value="" disabled>Select site to attach mirror to...</option>
                    {activeParentLinks.map(link => <option key={link.id} value={link.id}>{link.title}</option>)}
                  </select>
                </div>
              )}

              {!isMirrorMode && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Website Title</label>
                    <input type="text" required placeholder="e.g. FMHY" value={linkData.title} onChange={(e) => setLinkData({...linkData, title: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Tags (Comma separated)</label>
                    <input type="text" placeholder="e.g. Movies, VPN, Torrent" value={linkData.tags} onChange={(e) => setLinkData({...linkData, tags: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none"/>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">URL (Must include https://)</label>
                <input type="url" required placeholder="https://..." value={linkData.url} onChange={(e) => setLinkData({...linkData, url: e.target.value})} className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 outline-none ${isMirrorMode ? 'focus:border-purple-500' : 'focus:border-blue-500'}`}/>
              </div>

              {!isMirrorMode && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-1">Description (Optional)</label>
                  <textarea rows={2} value={linkData.description} onChange={(e) => setLinkData({...linkData, description: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none resize-none"/>
                </div>
              )}

              <button type="submit" disabled={isSubmittingLink || !linkData.category_id || (isMirrorMode && !linkData.parent_id)} className={`w-full flex items-center justify-center gap-2 disabled:bg-slate-700 text-white p-3 rounded-lg font-medium transition-colors mt-4 ${isMirrorMode ? 'bg-purple-600 hover:bg-purple-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
                <Save size={20} /> {isSubmittingLink ? 'Verifying Link...' : isMirrorMode ? 'Save Mirror' : 'Save Website'}
              </button>
            </form>
          </div>

          <div className="md:col-span-2 bg-slate-950/50 rounded-xl border border-slate-800 p-5 h-fit">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
              <FolderPlus className="text-emerald-500" size={24} />
              <h2 className="text-xl font-semibold text-slate-200">New Category</h2>
            </div>
            <form onSubmit={handleAddCategory} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-1">Category Name</label>
                <input type="text" required value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-emerald-500 outline-none"/>
              </div>
              <button type="submit" disabled={isSubmittingCategory} className="w-full flex justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-white p-2.5 rounded-lg font-medium transition-colors">
                <FolderPlus size={18} /> {isSubmittingCategory ? 'Creating...' : 'Create Category'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
