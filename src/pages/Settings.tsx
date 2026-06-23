import { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon, Save, MonitorPlay, RefreshCw, Loader2, CheckCircle, AlertCircle, Languages, Subtitles, ChevronDown } from 'lucide-react';
import { API_URL } from '../config';
import { useAppStore } from '../store';

interface AppSettings {
  default_quality: string;
  auto_refresh_interval: string;
  default_audio: string;
  default_subtitle: string;
}

export default function Settings() {
  // Sync with global store so player updates immediately after saving
  const fetchGlobalSettings = useAppStore(state => state.fetchSettings);

  const [settings, setSettings] = useState<AppSettings>({
    default_quality: 'auto',
    auto_refresh_interval: 'never',
    default_audio: '',
    default_subtitle: ''
  });
  
  // Tracks unsaved changes
  const [originalSettings, setOriginalSettings] = useState<AppSettings | null>(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null, message: string }>({ type: null, message: '' });

  // Memory Leak Preventers
  const statusTimer = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (statusTimer.current) window.clearTimeout(statusTimer.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  useEffect(() => {
    abortControllerRef.current = new AbortController();

    const fetchSettings = async () => {
      try {
        const res = await fetch(`${API_URL}/api/settings`, { 
          signal: abortControllerRef.current?.signal 
        });
        
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        
        let data;
        try {
          data = await res.json();
        } catch {
          throw new Error('Invalid response format from server.');
        }

        if (data && !data.error) {
          const loadedSettings = {
            default_quality: data.default_quality || 'auto',
            auto_refresh_interval: data.auto_refresh_interval || 'never',
            default_audio: data.default_audio || '',
            default_subtitle: data.default_subtitle || ''
          };
          setSettings(loadedSettings);
          setOriginalSettings(loadedSettings);
        }
      } catch (error: any) {
        if (error.name !== 'AbortError') {
          console.error("Failed to load settings:", error);
          setStatus({ type: 'error', message: 'Failed to load settings from server.' });
        }
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus({ type: null, message: '' });
    if (statusTimer.current) window.clearTimeout(statusTimer.current);

    // Normalize user inputs before sending to DB
    const payload: AppSettings = {
      default_quality: settings.default_quality,
      auto_refresh_interval: settings.auto_refresh_interval,
      default_audio: settings.default_audio.toLowerCase().trim(),
      default_subtitle: settings.default_subtitle.toLowerCase().trim()
    };

    setSettings(payload); // Update UI to reflect clean data

    try {
      const res = await fetch(`${API_URL}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      
      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid response format from server.");
      }

      // Check strict success boolean from backend
      if (!data.success) throw new Error(data.error || "Server ignored save request.");

      setOriginalSettings(payload); // Reset dirty tracker
      fetchGlobalSettings(); // Sync to global Zustand store so video player catches it instantly

      setStatus({ type: 'success', message: 'Settings saved successfully!' });
      statusTimer.current = window.setTimeout(() => setStatus({ type: null, message: '' }), 3000);
      
    } catch (error: any) {
      console.error("Save Error:", error);
      setStatus({ type: 'error', message: `Failed to save: ${error.message}` });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="animate-spin text-blue-500" size={40} /></div>;
  }

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto h-full overflow-y-auto custom-scrollbar pb-32">
      <div className="flex items-center gap-3 mb-8">
        <SettingsIcon className="text-blue-500" size={28} />
        <h2 className="text-2xl font-bold text-slate-100 tracking-wide">Application Settings</h2>
      </div>

      {/* HTML5 Native Datalist for Language Suggestions */}
      <datalist id="lang-codes">
        <option value="eng">English</option>
        <option value="hin">Hindi</option>
        <option value="spa">Spanish</option>
        <option value="fre">French</option>
        <option value="ara">Arabic</option>
        <option value="ger">German</option>
        <option value="rus">Russian</option>
        <option value="por">Portuguese</option>
        <option value="jpn">Japanese</option>
        <option value="kor">Japanese</option>
      </datalist>

      <div className="space-y-6">
        
        {/* Playback Settings Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
            <MonitorPlay className="text-slate-400" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">Playback Preferences</h3>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-400">Default Video Quality</label>
              <p className="text-xs text-slate-500 mb-2">
                Forces the player to use a specific stream quality if the channel provides multiple options.
              </p>
              <div className="relative w-full md:w-1/2">
                <select 
                  value={settings.default_quality}
                  onChange={(e) => setSettings({ ...settings, default_quality: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none text-sm"
                >
                  <option value="auto">Auto (Adaptive Bitrate - Recommended)</option>
                  <option value="high">High Quality (Max Resolution)</option>
                  <option value="low">Low Quality (Data Saver)</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-3 border-t border-slate-800/50">
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  <Languages size={16} /> Default Audio Language
                </label>
                <p className="text-[11px] text-slate-500 mb-2 mt-1">Select from list or type custom 3-letter code.</p>
                <input 
                  type="text"
                  list="lang-codes"
                  value={settings.default_audio}
                  onChange={(e) => setSettings({ ...settings, default_audio: e.target.value })}
                  placeholder="e.g. eng, hin"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-400">
                  <Subtitles size={16} /> Default Subtitles
                </label>
                <p className="text-[11px] text-slate-500 mb-2 mt-1">Select from list or type custom 3-letter code.</p>
                <input 
                  type="text"
                  list="lang-codes"
                  value={settings.default_subtitle}
                  onChange={(e) => setSettings({ ...settings, default_subtitle: e.target.value })}
                  placeholder="e.g. eng, hin"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2.5 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Data & Sync Settings Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
            <RefreshCw className="text-slate-400" size={20} />
            <h3 className="text-lg font-semibold text-slate-200">Data & Synchronization</h3>
          </div>
          
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-400">Auto-Refresh Sources</label>
            <p className="text-xs text-slate-500 mb-3">
              The server will automatically fetch the latest channel links in the background.
            </p>
            <div className="relative w-full md:w-1/2">
              <select 
                value={settings.auto_refresh_interval}
                onChange={(e) => setSettings({ ...settings, auto_refresh_interval: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-4 pr-10 py-3 text-slate-100 focus:outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none text-sm"
              >
                <option value="never">Never (Manual Refresh Only)</option>
                <option value="daily">Daily</option>
                <option value="3days">Every 3 Days</option>
                <option value="weekly">Weekly</option>
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" size={16} />
            </div>
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
            
            {/* Unsaved Changes Indicator */}
            {!status.type && hasChanges && !saving && (
              <div className="flex items-center gap-2 text-yellow-500 text-sm font-medium animate-in fade-in pl-2">
                <AlertCircle size={16} /> You have unsaved changes
              </div>
            )}
          </div>

          <button 
            onClick={handleSave}
            disabled={saving || (!hasChanges && !status.type)}
            className={`w-full sm:w-auto px-8 py-3 text-white rounded-lg font-medium transition-all flex items-center justify-center gap-2 shadow-lg 
              ${saving || (!hasChanges && !status.type)
                ? 'bg-slate-700 text-slate-400 cursor-not-allowed shadow-none' 
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/20 active:scale-95'
              }
            `}
          >
            {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>

      </div>
    </div>
  );
}
