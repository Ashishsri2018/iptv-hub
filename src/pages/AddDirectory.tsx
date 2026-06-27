import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, Settings2 } from 'lucide-react';

import { DIRECTORY_API as API_URL } from '../config';

interface DirectoryLink { id: number; title: string; url: string; description?: string; tags?: string[]; mirrors?: DirectoryLink[]; }
interface Category { id: number; name: string; links: DirectoryLink[]; }

type MainTab = 'add' | 'edit' | 'delete';
type SubTab = 'site' | 'mirror' | 'category';

export default function AddDirectory() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<Category[]>([]);
  
  const [mainTab, setMainTab] = useState<MainTab>('add');
  const [subTab, setSubTab] = useState<SubTab>('site');
  
  const [message, setMessage] = useState({ type: '', text: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [form, setForm] = useState({
    categoryId: '',
    parentId: '',
    linkId: '',
    title: '',
    url: '',
    description: '',
    tags: '',
    categoryName: ''
  });

  useEffect(() => { fetchCategories(); }, []);

  // Auto-populate logic when Edit tab selections change
  useEffect(() => {
    if (mainTab !== 'edit') return;
    
    if (subTab === 'category' && form.categoryId) {
      const cat = categories.find(c => c.id.toString() === form.categoryId);
      if (cat) setForm(f => ({ ...f, categoryName: cat.name }));
    }
    
    if ((subTab === 'site' || subTab === 'mirror') && form.linkId && form.categoryId) {
      const cat = categories.find(c => c.id.toString() === form.categoryId);
      if (cat) {
        let target: DirectoryLink | null = null;
        for (const l of cat.links) {
          if (l.id.toString() === form.linkId) target = l;
          if (l.mirrors) {
            const m = l.mirrors.find(mir => mir.id.toString() === form.linkId);
            if (m) target = m;
          }
        }
        if (target) {
          setForm(f => ({
            ...f,
            title: target?.title || '',
            url: target?.url || '',
            description: target?.description || '',
            tags: target?.tags ? target?.tags.join(', ') : ''
          }));
        }
      }
    }
  }, [form.categoryId, form.linkId, mainTab, subTab, categories]);

  const fetchCategories = async () => {
    try {
      const response = await fetch(`${API_URL}/directory`);
      if (response.ok) setCategories(await response.json());
    } catch (err) { console.error(err); }
  };

  const resetForm = () => {
    setForm({ categoryId: '', parentId: '', linkId: '', title: '', url: '', description: '', tags: '', categoryName: '' });
    setMessage({ type: '', text: '' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage({ type: '', text: 'Processing...' });

    try {
      // ----------- ADD LOGIC -----------
      if (mainTab === 'add') {
        if (subTab === 'category') {
          const res = await fetch(`${API_URL}/categories`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.categoryName, sort_order: 0 }) });
          if (!res.ok) throw new Error('Failed to create category');
          setMessage({ type: 'success', text: 'Category created!' });
        } else {
          const payload = subTab === 'mirror' 
            ? { category_id: parseInt(form.categoryId), title: form.title, url: form.url, parent_id: parseInt(form.parentId), tags: "" }
            : { category_id: parseInt(form.categoryId), title: form.title, url: form.url, description: form.description, tags: form.tags };
          const res = await fetch(`${API_URL}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
          if (!res.ok) throw new Error('Failed to create entry');
          setMessage({ type: 'success', text: `${subTab === 'mirror' ? 'Mirror' : 'Website'} added successfully!` });
        }
      }
      // ----------- EDIT LOGIC -----------
      else if (mainTab === 'edit') {
        if (subTab === 'category') {
          const res = await fetch(`${API_URL}/categories/${form.categoryId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.categoryName }) });
          if (!res.ok) throw new Error('Failed to update category');
          setMessage({ type: 'success', text: 'Category updated!' });
        } else {
          const res = await fetch(`${API_URL}/links/${form.linkId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: form.title, url: form.url, description: form.description, tags: form.tags }) });
          if (!res.ok) throw new Error('Failed to update entry');
          setMessage({ type: 'success', text: 'Entry updated!' });
        }
      }
      // ----------- DELETE LOGIC -----------
      else if (mainTab === 'delete') {
        if (subTab === 'category') {
          if (!window.confirm("Are you sure? This deletes the category and ALL websites inside it.")) { setIsSubmitting(false); setMessage({type:'', text:''}); return; }
          const res = await fetch(`${API_URL}/categories/${form.categoryId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete category');
          setMessage({ type: 'success', text: 'Category deleted!' });
        } else {
          const msg = subTab === 'mirror' ? "Are you sure you want to delete this mirror?" : "Are you sure? This deletes the website and its mirrors.";
          if (!window.confirm(msg)) { setIsSubmitting(false); setMessage({type:'', text:''}); return; }
          const res = await fetch(`${API_URL}/links/${form.linkId}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Failed to delete entry');
          setMessage({ type: 'success', text: 'Entry deleted!' });
        }
      }
      
      if (mainTab !== 'edit') resetForm();
      await fetchCategories();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeCatLinks = categories.find(c => c.id.toString() === form.categoryId)?.links || [];
  const activeParentMirrors = activeCatLinks.find(l => l.id.toString() === form.parentId)?.mirrors || [];

  return (
    <div className="h-full overflow-y-auto p-4 md:p-8 pb-28 md:pb-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <button onClick={() => navigate('/directory')} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-100 transition-colors"><ArrowLeft size={24} /></button>
          <h1 className="text-2xl font-bold text-slate-100">Control Panel</h1>
        </div>

        {/* MAIN TABS */}
        <div className="flex border-b border-slate-800 mb-6 bg-slate-950/50 rounded-t-lg">
          {(['add', 'edit', 'delete'] as MainTab[]).map(tab => (
            <button key={tab} onClick={() => { setMainTab(tab); resetForm(); }} className={`flex-1 py-3 font-semibold text-sm capitalize border-b-2 transition-colors ${mainTab === tab ? 'border-blue-500 text-blue-400 bg-slate-900/50' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
              {tab}
            </button>
          ))}
        </div>

        {/* SUB TABS */}
        <div className="flex gap-2 mb-6">
          {(['site', 'mirror', 'category'] as SubTab[]).map(tab => (
            <button key={tab} onClick={() => { setSubTab(tab); resetForm(); }} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${subTab === tab ? 'bg-slate-800 text-white' : 'bg-slate-950/50 border border-slate-800 text-slate-400 hover:text-slate-200'}`}>
              {mainTab === 'add' ? `New ${tab}` : `${mainTab} ${tab}`}
            </button>
          ))}
        </div>

        {message.text && (
          <div className={`p-4 rounded-lg mb-6 border ${message.type === 'error' ? 'bg-red-900/50 border-red-500 text-red-200' : 'bg-green-900/50 border-green-500 text-green-200'}`}>
            {message.text}
          </div>
        )}

        {/* UNIFIED FORM CONTAINER */}
        <div className="bg-slate-950/50 rounded-xl border border-slate-800 p-6">
          <div className="flex items-center gap-3 mb-6 border-b border-slate-800 pb-4">
            <Settings2 className="text-blue-500" size={24} />
            <h2 className="text-xl font-semibold text-slate-200 capitalize">{mainTab} {subTab}</h2>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            
            {/* SELECTION ROW (Always needed except for Add Category) */}
            {!(mainTab === 'add' && subTab === 'category') && (
              <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-800 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Select Category</label>
                  <select required value={form.categoryId} onChange={(e) => { setForm(f => ({...f, categoryId: e.target.value, parentId: '', linkId: ''})); }} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 outline-none">
                    <option value="" disabled>Choose category...</option>
                    {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </select>
                </div>

                {subTab === 'site' && mainTab !== 'add' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Select Site</label>
                    <select required value={form.linkId} onChange={(e) => setForm(f => ({...f, linkId: e.target.value}))} disabled={!form.categoryId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50">
                      <option value="" disabled>Choose site...</option>
                      {activeCatLinks.map(link => <option key={link.id} value={link.id}>{link.title}</option>)}
                    </select>
                  </div>
                )}

                {subTab === 'mirror' && (
                  <>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">Select Parent Site</label>
                      <select required value={form.parentId} onChange={(e) => setForm(f => ({...f, parentId: e.target.value, linkId: ''}))} disabled={!form.categoryId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50">
                        <option value="" disabled>Choose parent site...</option>
                        {activeCatLinks.map(link => <option key={link.id} value={link.id}>{link.title}</option>)}
                      </select>
                    </div>
                    {mainTab !== 'add' && (
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Select Mirror</label>
                        <select required value={form.linkId} onChange={(e) => setForm(f => ({...f, linkId: e.target.value}))} disabled={!form.parentId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-sm text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50">
                          <option value="" disabled>Choose mirror...</option>
                          {activeParentMirrors.map(m => <option key={m.id} value={m.id}>{m.title} ({m.url})</option>)}
                        </select>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* INPUT FIELDS (Only show if Adding or Editing) */}
            {mainTab !== 'delete' && (
              <div className="space-y-4 pt-2">
                {subTab === 'category' ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1">Category Name</label>
                    <input type="text" required value={form.categoryName} onChange={(e) => setForm(f => ({...f, categoryName: e.target.value}))} disabled={mainTab === 'edit' && !form.categoryId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50"/>
                  </div>
                ) : (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">{subTab === 'mirror' ? 'Mirror Name (e.g. Server 2)' : 'Title'}</label>
                      <input type="text" required value={form.title} onChange={(e) => setForm(f => ({...f, title: e.target.value}))} disabled={mainTab === 'edit' && !form.linkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">URL (Must include https://)</label>
                      <input type="url" required value={form.url} onChange={(e) => setForm(f => ({...f, url: e.target.value}))} disabled={mainTab === 'edit' && !form.linkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50"/>
                    </div>
                    
                    {subTab === 'site' && (
                      <>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">Tags (Comma separated)</label>
                          <input type="text" value={form.tags} onChange={(e) => setForm(f => ({...f, tags: e.target.value}))} disabled={mainTab === 'edit' && !form.linkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none disabled:opacity-50"/>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-slate-400 mb-1">Description (Optional)</label>
                          <textarea rows={2} value={form.description} onChange={(e) => setForm(f => ({...f, description: e.target.value}))} disabled={mainTab === 'edit' && !form.linkId} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-slate-200 focus:border-blue-500 outline-none resize-none disabled:opacity-50"/>
                        </div>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            <button type="submit" disabled={isSubmitting || (mainTab === 'edit' && subTab === 'category' && !form.categoryId) || (mainTab === 'edit' && subTab !== 'category' && !form.linkId) || (mainTab === 'delete' && subTab === 'category' && !form.categoryId) || (mainTab === 'delete' && subTab !== 'category' && !form.linkId)} className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-medium transition-colors mt-4 text-white ${mainTab === 'add' ? 'bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700' : mainTab === 'edit' ? 'bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700' : 'bg-red-600 hover:bg-red-700 disabled:bg-slate-700'}`}>
              {mainTab === 'add' ? <Plus size={20} /> : mainTab === 'edit' ? <Save size={20} /> : <Trash2 size={20} />}
              {isSubmitting ? 'Processing...' : mainTab === 'add' ? `Save New ${subTab}` : mainTab === 'edit' ? `Save Changes` : `Delete ${subTab}`}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
