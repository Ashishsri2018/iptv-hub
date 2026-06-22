import { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Save, MonitorPlay, RefreshCw, Loader2, CheckCircle, AlertCircle, Languages, Subtitles } from 'lucide-react';
import { API_URL } from '../config';

interface AppSettings {
  default_quality: string;
  auto_refresh_interval: string;
  default_audio: string;
  default_subtitle: string;
}

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    default_quality: 'auto',
    auto_refresh_interval: 'never',
    default_audio: '',
    default_subtitle: ''
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_URL}/api/settings`);
        const data = await res.json();
        if (data && !data.error) {
          setSettings({
            default_quality: data.default_quality || 'auto',
            auto_refresh_interval: data.auto_refresh_interval || 'never',
            default_audio: data.default_audio || '',
            default_subtitle: data.default_subtitle || ''
          });
        }
      } catch (error) {
        console.error("Failed to load settings", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus({ type: null, message: '' });

    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      if (!res.ok) throw new Error("Failed to save settings");

      setStatus({ type: 'success', message: 'Settings saved successfully!' });
      setTimeout(() => setStatus({ type: null, message: '' }), 3000);
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save settings to the database.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Application Settings</h2>
      </div>

      <div className="space-y-6">
        
        {/* Playback Settings Card */}
        <div className="bg-[#12141a] border border-slate-800/60 rounded-xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/50 pb-3">
            <MonitorPlay className="text-slate-400" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">Playback Preferences</h3>
          </div>
          
          <div className="space-y-5">
            {/* Quality */}
            <div>
              <label className="block text-sm font-medium text-slate-400">Default Video Quality</label>
              <p className="text-xs text-slate-500 mb-2">Forces the player to use a specific stream quality if available.</p>
              <select 
                value={settings.default_quality}
                onChange={(e) => setSettings({ ...settings, default_quality: e.target.value })}
                className="w-full md:w-1/2 bg-[#1a1e26] border border-slate-700/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none text-sm"
              >
                <option value="auto">Auto (Adaptive Bitrate - Recommended)</option>
                <option value="high">High Quality (Max Resolution)</option>
                <option value="low">Low Quality (Data Saver)</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-2">
              {/* Default Audio */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  <Languages size={16} /> Default Audio Language
                </label>
                <p className="text-[11px] text-slate-500 mb-2 mt-1">Type standard codes like <b>eng</b>, <b>hin</b>, <b>spa</b>, or leave blank.</p>
                <input 
                  type="text"
                  placeholder="e.g. eng, hindi, english"
                  value={settings.default_audio}
                  onChange={(e) => setSettings({ ...settings, default_audio: e.target.value })}
                  className="w-full bg-[#1a1e26] border border-slate-700/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>

              {/* Default Subtitles */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  <Subtitles size={16} /> Default Subtitles
                </label>
                <p className="text-[11px] text-slate-500 mb-2 mt-1">Type standard codes like <b>eng</b>, <b>hin</b>, <b>spa</b>, or leave blank.</p>
                <input 
                  type="text"
                  placeholder="e.g. eng, hindi, english"
                  value={settings.default_subtitle}
                  onChange={(e) => setSettings({ ...settings, default_subtitle: e.target.value })}
                  className="w-full bg-[#1a1e26] border border-slate-700/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Data & Sync Settings Card */}
        <div className="bg-[#12141a] border border-slate-800/60 rounded-xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800/50 pb-3">
            <RefreshCw className="text-slate-400" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">Data & Synchronization</h3>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-slate-400">Auto-Refresh Sources</label>
            <p className="text-xs text-slate-500 mb-3">
              The server will automatically fetch the latest channel links in the background.
            </p>
            <select 
              value={settings.auto_refresh_interval}
              onChange={(e) => setSettings({ ...settings, auto_refresh_interval: e.target.value })}
              className="w-full md:w-1/2 bg-[#1a1e26] border border-slate-700/50 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none text-sm"
            >
              <option value="never">Never (Manual Refresh Only)</option>
              <option value="daily">Daily</option>
              <option value="3days">Every 3 Days</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-8 pt-4">
          <div className="flex-1">
            {status.type && (
              <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border animate-in fade-in ${
                status.type === 'success' ? 'bg-green-900/20 text-green-400 border-green-900/50' : 'bg-red-900/20 text-red-400 border-red-900/50'
              }`}>
                {status.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
                {status.message}
              </div>
            )}
          </div>

          <button 
            onClick={handleSave}
            disabled={saving}
            className="w-full sm:w-auto px-8 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-900/20"
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </div>
    </div>
  );
}