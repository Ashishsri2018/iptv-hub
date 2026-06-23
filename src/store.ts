import { create } from 'zustand';
import { API_URL } from './config';

export interface Channel {
  id: string;
  name: string;
  group: string;
  logo: string;
  url: string;
  isFavorite: boolean;
}

export interface Source {
  id: string;
  name: string;
  type: string;
  channelCount: number;
}

export interface AppSettings {
  default_quality: string;
  auto_refresh_interval: string;
  default_audio: string;
  default_subtitle: string;
}

interface AppState {
  streamUrl: string | null;
  channelName: string | null;
  logoUrl: string | null;
  setPlayingChannel: (url: string, name: string, logo: string | null) => void;
  playChannel: (url: string, name: string) => void;
  closePlayer: () => void;

  settings: AppSettings;
  fetchSettings: () => Promise<void>;

  channels: Channel[];
  sources: Source[];
  toggleFavorite: (id: string) => void;
}

const generateDummyChannels = (): Channel[] => {
  const groups = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const channels: Channel[] = [];
  groups.forEach(group => {
    for (let i = 1; i <= 200; i++) {
      channels.push({
        id: `${group}-${i}`, name: `${group} Channel ${i} HD`, group: group,
        logo: '', url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8", isFavorite: false,
      });
    }
  });
  return channels;
};

export const useAppStore = create<AppState>((set) => ({
  streamUrl: null,
  channelName: null,
  logoUrl: null,
  setPlayingChannel: (url, name, logo) => set({ streamUrl: url, channelName: name, logoUrl: logo }),
  playChannel: (url, name) => set({ streamUrl: url, channelName: name }),
  closePlayer: () => set({ streamUrl: null, channelName: null, logoUrl: null }),

  // GLOBAL SETTINGS CACHE
  settings: {
    default_quality: 'auto',
    auto_refresh_interval: 'never',
    default_audio: '',
    default_subtitle: ''
  },
  fetchSettings: async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings`);
      if (res.ok) {
        const data = await res.json();
        set({ settings: {
          default_quality: data.default_quality || 'auto',
          auto_refresh_interval: data.auto_refresh_interval || 'never',
          default_audio: data.default_audio || '',
          default_subtitle: data.default_subtitle || ''
        }});
      }
    } catch (error) { console.error("Store failed to fetch settings:", error); }
  },

  channels: generateDummyChannels(),
  sources: [
    { id: '1', name: 'Premium IPTV', type: 'M3U URL', channelCount: 5200 },
    { id: '2', name: 'Local Backup', type: 'M3U FILE', channelCount: 300 },
  ],
  toggleFavorite: (id) => set((state) => ({
    channels: state.channels.map(ch => ch.id === id ? { ...ch, isFavorite: !ch.isFavorite } : ch)
  })),
}));
