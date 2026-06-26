// ----------------------------------------------------
// THE UNIFIED SHARED M3U PARSER (TypeScript)
// ----------------------------------------------------

export interface Channel {
  id: string;
  source_id: string;
  name: string;
  channel_group: string;
  logo_url: string | null;
  stream_url: string;
  raw_metadata: Record<string, any>;
}

export interface PlaylistMetadata {
  name?: string;
  [key: string]: any;
}

export function generateStableId(sourceId: string, streamUrl: string, count: number): string {
  let hash = 5381;
  for (let i = 0; i < streamUrl.length; i++) {
    hash = (hash * 33) ^ streamUrl.charCodeAt(i);
  }
  const hashStr = (hash >>> 0).toString(36);
  const tail = streamUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-15);
  return `${sourceId}_${hashStr}_${tail}_${count}`;
}

function cleanChannelName(name: string): string {
  return name
    .replace(/\s+/g, ' ')
    .replace(/^\s*-\s*|\s*-\s*$/g, '')
    .trim()
    .normalize("NFC") 
    .slice(0, 120);
}

function resetCurrentChannel(): Partial<Channel> {
  return { 
    name: 'Unknown', 
    channel_group: 'Other', 
    logo_url: null, 
    stream_url: undefined, 
    raw_metadata: {}
  };
}

// RELAXED VOD FIREWALL: Now requires explicit proof to avoid dropping live Movie networks.
export function isVod(streamUrl: string, metadata: Record<string, any>): boolean {
  const lowerUrl = (streamUrl || '').toLowerCase();
  const type = (metadata['tvg-type'] || metadata.type || '').toLowerCase().trim();
  const group = (metadata['group-title'] || metadata['tvg-group'] || metadata['group'] || '').toLowerCase().trim();

  // 1. Explicit VOD file extensions
  if (/\.(mp4|mkv|avi|mov|wmv|flv)$/i.test(lowerUrl.split('?')[0])) return true;

  // 2. Xtream API Path markers
  if (lowerUrl.includes('/movie/') || lowerUrl.includes('/series/') || lowerUrl.includes('/vod/')) return true;

  // 3. Strict Metadata Types
  if (['vod', 'movie', 'series'].includes(type)) return true;

  // 4. Strict Group Matching (Generic groups like "Movies" or "Cinema" are now allowed as Live TV)
  if (group === 'vod' || group === 'vods' || group === 'series') return true;

  return false; 
}

function parseExtInf(line: string, current: Partial<Channel>) {
  const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let match;
  
  while ((match = attrRegex.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] || match[3] || match[4] || '').trim();
    
    // Explicitly preserve tvg-name alongside the display name
    if (current.raw_metadata) {
      current.raw_metadata[key] = value;
    }

    // Comprehensive category extraction
    if (['group-title', 'tvg-group', 'group', 'category', 'genre', 'group_name', 'playlist-group'].includes(key)) {
        current.channel_group = value;
    }
    
    if (key === 'tvg-logo' || key === 'logo') current.logo_url = value;
    if (key === 'catchup' || key === 'timeshift') {
      if (current.raw_metadata) current.raw_metadata.catchup = value;
    }
  }

  const commaIndex = line.lastIndexOf(',');
  if (commaIndex !== -1) {
    let namePart = line.substring(commaIndex + 1).trim();
    if (namePart && namePart !== '-1') {
      current.name = cleanChannelName(namePart);
    }
  }
}

function parsePlayerOption(line: string, metadata: Record<string, any>) {
  const match = line.match(/#(?:EXTVLCOPT|KODIPROP|EXTHTTP):([^=]+)=(.*)/i);
  if (!match) return;
  
  let key = match[1].trim(); 
  let val = match[2].trim();
  
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  
  // Safely pack duplicate tags (like multiple http-headers) into arrays
  if (metadata[key]) {
    if (Array.isArray(metadata[key])) {
      metadata[key].push(val);
    } else {
      metadata[key] = [metadata[key], val];
    }
  } else {
    metadata[key] = val;
  }
}

function pushChannel(channels: Channel[], current: Partial<Channel>, sourceId: string, urlCounts: Map<string, number>) {
  if (!current.stream_url) return;
  
  if (isVod(current.stream_url, current.raw_metadata || {})) {
    return;
  }

  const count = (urlCounts.get(current.stream_url) || 0) + 1;
  urlCounts.set(current.stream_url, count);

  channels.push({
    id: generateStableId(sourceId, current.stream_url, count),
    source_id: sourceId, 
    name: current.name || 'Unknown',
    channel_group: current.channel_group || 'Other',
    logo_url: current.logo_url || null, 
    stream_url: current.stream_url,
    raw_metadata: current.raw_metadata || {}
  });
}

// ----------------------------------------------------
// THE MASTER EXPORT FUNCTION
// ----------------------------------------------------
export function parseM3UString(text: string, sourceId: string, fallbackName = 'Unknown Playlist'): { playlistMetadata: PlaylistMetadata, channels: Channel[] } {
  // Strip BOM to prevent matching failures
  text = text.replace(/^\uFEFF/, ''); 

  const channels: Channel[] = [];
  const urlCounts = new Map<string, number>();
  const playlistMetadata: PlaylistMetadata = { name: fallbackName };
  
  let current = resetCurrentChannel();
  let pendingGroup: string | null = null;

  // Stream iterator logic replaces .split() for massive memory savings
  const lineRegex = /([^\r\n]+)/g;
  let match;

  while ((match = lineRegex.exec(text)) !== null) {
    const line = match[1].trim();
    if (!line) continue;

    if (line.startsWith('#EXTM3U')) {
      const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
      let m;
      while ((m = attrRegex.exec(line)) !== null) {
        const key = m[1].toLowerCase();
        const value = (m[2] || m[3] || m[4] || '').trim();
        playlistMetadata[key] = value;
      }
      continue;
    }

    if (line.startsWith('#EXTGRP:')) { 
      pendingGroup = line.substring(8).trim(); 
      continue; 
    }

    if (line.startsWith('#EXTINF:')) {
      parseExtInf(line, current);
    } 
    else if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#KODIPROP:') || line.startsWith('#EXTHTTP:')) {
      if (current.raw_metadata) parsePlayerOption(line, current.raw_metadata);
    } 
    else if (!line.startsWith('#')) {
      // Valid URI scheme checker covers http, rtmp, udp:239, file, etc.
      if (/^[a-z][a-z0-9+\-.]*:/i.test(line)) {
        current.stream_url = line;
        
        if (pendingGroup) { 
          current.channel_group = pendingGroup; 
          pendingGroup = null; 
        }
        
        // Push only when a URL is confirmed, preventing duplicate insertions
        pushChannel(channels, current, sourceId, urlCounts);
        current = resetCurrentChannel();
      }
    }
  }

  return { playlistMetadata, channels };
}
