import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderPlus, Link as LinkIcon, ArrowLeft, Save, Copy, Pencil, Trash2, Plus } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_DIRECTORY_URL;

interface DirectoryLink { id: number; title: string; url: string; description?: string; tags?: string[]; mirrors?: DirectoryLink[]; }
interface Category { id: number; name: string; links: DirectoryLink[]; }

export default function AddDirectory() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeTab, setActiveTab] = useState<'add' | 'edit'>('add');
  const [message, setMessage] = useState({ type: '', text: '' });

  // Category State
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSubmittingCategory, setIsSubmittingCategory] = useState(false);

  // Add Link State
  const [isMirrorMode, setIsMirrorMode] = useState(false);
  const [linkData, setLinkData] = useState({ category_id: '', parent_id: '', title: '', url: '', description: '', tags: '' });
  const [isSubmittingLink, setIsSubmittingLink] = useState(false);

  // Edit Link State
  const [editCategoryId, setEditCategoryId] = useState('');
  const [editLinkId, setEditLinkId] = useState('');
  const [editFormData, setEditFormData] = useState({ title: '', url: '', description: '', tags: '' });
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);

  useEffect(() => { fetchCategories(); }, []);

  useEffect(() => {
    if (!editLinkId || !editCategoryId) {
      setEditFormData({ title: '', url: '', description: '', tags: '' });
      return;
    }
    const cat = categories.find(c => c.id === parseInt(editCategoryId));
    if (cat) {
      let target: DirectoryLink | null = null;
      for (const l of cat.links) {
        if (l.id === parseInt(editLinkId)) target = l;
        if (l.mirrors) {
          const m = l.mirrors.find(mir => mir.id === parseInt(editLinkId));
          if (m) target = m;
        }
      }
      if (target) {
        setEditFormData({
          title: target.title || '',
          url: target.url || '',
          description: target.description || '',
          tags: target.tags ? target.tags.join(', ') : ''
        });
      }
    }
  }, [editLinkId, editCategoryId, categories]);

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

  const editCategory = async (categoryId: number, oldName: string) => {
    const newName = window.prompt("Enter new category name:", oldName);
    if (!newName || newName === oldName) return;
    try {
      await fetch(`${API_URL}/categories/${categoryId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName })
      });
      fetchCategories();
    } catch (err) { console.error(err); }
  };

  const deleteCategory = async (categoryId: number, categoryName: string) => {
    if (!window.confirm(`Delete "${categoryName}" and ALL its links?`)) return;
    try { 
      await fetch(`${API_URL}/categories/${categoryId}`, { method: 'DELETE' }); 
      fetchCategories();
    } catch (err) { console.error(err); }
  };

  const handleAddLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingLink(true);
    setMessage({ type: '', text: 'Checking connection and saving...' });
    try {
      const payload = {
        category_id: parseInt(linkData.category_id),
        title: linkData.title,
        url: linkData.url,
        description: isMirrorMode ? "" : linkData.description,
        tags: isMirrorMode ? "" : linkData.tags,
        parent_id: isMirrorMode ? parseInt(linkData.parent_id) : undefined
      };

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

  const handleEditLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingEdit(true);
    setMessage({ type: '', text: 'Saving changes...' });
    try {
      const response = await fetch(`${API_URL}/links/${editLinkId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({
          title: editFormData.title,
          url: editFormData.url,
          description: editFormData.description,
          tags: editFormData.tags
        })
      });
      if (!response.ok) throw new Error('Failed to update link');
      setMessage({ type: 'success', text: 'Entry updated successfully!' });
      fetchCategories();
    } catch (err: any) { setMessage({ type: 'error', text: err.message }); } 
    finally { setIsSubmittingEdit(false); }
  };

  const activeParentLinks = categories.find(c => c.id === parseInt(linkData.category_id))?.links || [];
  const editCategoryLinks = categories.find(c => c.id === parseInt(editCategoryId))?.links || [];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 pb-28 md:pb-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/directory')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"><ArrowLeft size={24} /></button>
            <h1 className="text-2xl font-bold text-slate-100">Manage Directory</h1>
          </div>
          
          <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-800 w-fit">
            <button onClick={() => { setActiveTab('add'); setMessage({ type: '', text: '' }); }} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'add' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              Add New
            </button>
            <button onClick={() => { setActiveTab('edit'); setMessage({ type: '', text: '' }); }} className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${activeTab === 'edit' ? 'bg-orange-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
              Edit Existing
            </button>
          </div>
        </div>

        {message.text && (
          <div className={`p-4 rounded-lg mb-6 border ${message.type === 'error' ? 'bg-red-900/50 border-red-500 text-red-200' : 'bg-green-900/50 border-green-500 text-green-200'}`}>
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          
          {/* LEFT COLUMN: ADD / EDIT LINKS */}
          <div className="md:col-span-3">
            {activeTab === 'add' ? (
              <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-5">
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

                  {/* Title input is now always visible so you can name your Mirrors */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">
                      {isMirrorMode ? 'Mirror Name (e.g. Server 2, Backup)' : 'Website Title'}
                    </label>
                    <input type="text" required placeholder="e.g. FMHY" value={linkData.title} onChange={(e) => setLinkData({...linkData, title: e.target.value})} className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 outline-none ${isMirrorMode ? 'focus:border-purple-500' : 'focus:border-blue-500'}`}/>
                  </div>

                  {!isMirrorMode && (
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Tags (Comma separated)</label>
                      <input type="text" placeholder="e.g. Movies, VPN, Torrent" value={linkData.tags} onChange={(e) => setLinkData({...linkData, tags: e.target.value})} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none"/>
                    </div>
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
            ) : (
              <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-5 border-t-4 border-t-orange-500">
                <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
                  <Pencil className="text-orange-500" size={24} />
                  <h2 className="text-xl font-semibold text-slate-200">Edit Existing Entry</h2>
                </div>

                <form onSubmit={handleEditLink} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">1. Select Category</label>
                      <select required value={editCategoryId} onChange={(e) => { setEditCategoryId(e.target.value); setEditLinkId(''); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:border-orange-500 outline-none">
                        <option value="" disabled>Choose category...</option>
                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">2. Select Link to Edit</label>
                      <select required value={editLinkId} onChange={(e) => setEditLinkId(e.target.value)} disabled={!editCategoryId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:border-orange-500 outline-none disabled:opacity-50">
                        <option value="" disabled>Choose site or mirror...</option>
                        {editCategoryLinks.map(link => (
                          <optgroup key={link.id} label={link.title}>
                            <option value={link.id}>{link.title}</option>
                            {link.mirrors?.map(m => (
                              <option key={m.id} value={m.id}>↳ {m.title} ({m.url})</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="pt-2">
                    <label className="block text-sm font-medium text-slate-400 mb-1">Title</label>
                    <input type="text" required value={editFormData.title} onChange={(e) => setEditFormData({...editFormData, title: e.target.value})} disabled={!editLinkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-orange-500 outline-none disabled:opacity-50"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">URL</label>
                    <input type="url" required value={editFormData.url} onChange={(e) => setEditFormData({...editFormData, url: e.target.value})} disabled={!editLinkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-orange-500 outline-none disabled:opacity-50"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Tags (Comma separated)</label>
                    <input type="text" value={editFormData.tags} onChange={(e) => setEditFormData({...editFormData, tags: e.target.value})} disabled={!editLinkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-orange-500 outline-none disabled:opacity-50"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Description</label>
                    <textarea rows={2} value={editFormData.description} onChange={(e) => setEditFormData({...editFormData, description: e.target.value})} disabled={!editLinkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-orange-500 outline-none resize-none disabled:opacity-50"/>
                  </div>

                  <button type="submit" disabled={isSubmittingEdit || !editLinkId} className="w-full flex items-center justify-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 text-white p-3 rounded-lg font-medium transition-colors mt-4">
                    <Save size={20} /> {isSubmittingEdit ? 'Saving Changes...' : 'Save Changes'}
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: MANAGE CATEGORIES */}
          <div className="md:col-span-2 bg-slate-950/50 rounded-xl border border-slate-800 p-5 h-fit">
            <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
              <FolderPlus className="text-emerald-500" size={24} />
              <h2 className="text-xl font-semibold text-slate-200">Manage Categories</h2>
            </div>
            
            <form onSubmit={handleAddCategory} className="space-y-4 mb-6">
              <div>
                <input type="text" required placeholder="New Category Name..." value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-emerald-500 outline-none"/>
              </div>
              <button type="submit" disabled={isSubmittingCategory} className="w-full flex justify-center gap-2 bg-slate-800 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-white p-2.5 rounded-lg font-medium transition-colors">
                <Plus size={18} /> {isSubmittingCategory ? 'Creating...' : 'Create'}
              </button>
            </form>

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-700">
              {categories.map(cat => (
                 <div key={cat.id} className="flex justify-between items-center bg-slate-900 border border-slate-800 p-2.5 rounded-lg">
                   <span className="text-sm text-slate-300 font-medium truncate pr-2">{cat.name}</span>
                   <div className="flex gap-1 shrink-0">
                     <button onClick={() => editCategory(cat.id, cat.name)} className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-orange-400 transition-colors" title="Rename Category"><Pencil size={14} /></button>
                     <button onClick={() => deleteCategory(cat.id, cat.name)} className="p-1.5 rounded hover:bg-slate-800 text-slate-500 hover:text-red-400 transition-colors" title="Delete Category"><Trash2 size={14} /></button>
                   </div>
                 </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
