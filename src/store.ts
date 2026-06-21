import { create } from 'zustand';

// Types
export interface Channel {
  id: string;
  name: string;
  group: string; // A, B, C, etc.
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

interface AppState {
  // Player State
  setPlayingChannel: (url: string, name: string, logo: string | null) => void;
  streamUrl: string | null;
  channelName: string | null;
  logoUrl: string | null; // <-- Added this so TypeScript knows it exists!
  playChannel: (url: string, name: string) => void;
  closePlayer: () => void;

  // Data State
  channels: Channel[];
  sources: Source[];
  toggleFavorite: (id: string) => void;
}

// Generate 5,000 dummy channels to test our Virtualizer's performance
const generateDummyChannels = (): Channel[] => {
  const groups = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const channels: Channel[] = [];
  
  groups.forEach(group => {
    for (let i = 1; i <= 200; i++) {
      channels.push({
        id: `${group}-${i}`,
        name: `${group} Channel ${i} HD`,
        group: group,
        logo: '', // Intentionally blank for lazy loading test
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        isFavorite: false,
      });
    }
  });
  return channels;
};

export const useAppStore = create<AppState>((set) => ({
  setPlayingChannel: (url, name, logo) => set({ streamUrl: url, channelName: name, logoUrl: logo }),
  streamUrl: null,
  channelName: null,
  logoUrl: null, // <-- Initialized it here
  playChannel: (url, name) => set({ streamUrl: url, channelName: name }),
  closePlayer: () => set({ streamUrl: null, channelName: null, logoUrl: null }), // <-- Clear it on close

  channels: generateDummyChannels(),
  sources: [
    { id: '1', name: 'Premium IPTV', type: 'M3U URL', channelCount: 5200 },
    { id: '2', name: 'Local Backup', type: 'M3U FILE', channelCount: 300 },
  ],

  toggleFavorite: (id) => set((state) => ({
    channels: state.channels.map(ch => 
      ch.id === id ? { ...ch, isFavorite: !ch.isFavorite } : ch
    )
  })),
}));