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

export function generateStableId(sourceId: string, streamUrl: string, name: string, group: string): string {
  const rawString = `${sourceId}_${streamUrl}_${name}_${group}`;
  let hash = 5381;
  for (let i = 0; i < rawString.length; i++) {
    hash = (hash * 33) ^ rawString.charCodeAt(i);
  }
  return `${sourceId}_${(hash >>> 0).toString(36)}`;
}

function cleanChannelName(name: string): string {
  const cleaned = name
    .replace(/\s+/g, ' ')
    .replace(/^\s*-\s*|\s*-\s*$/g, '')
    .trim();
  
  return cleaned?.normalize?.("NFC") ?? cleaned;
}

function resetCurrentChannel(): Partial<Channel> {
  return { 
    name: 'Unknown', 
    channel_group: 'Other', 
    logo_url: null, 
    raw_metadata: {}
  };
}

// EXPORTED: Standalone firewall utility. Now supports JSON category names for API parsing.
export function isVod(streamUrl: string, metadata: Record<string, any>): boolean {
  const lowerUrl = (streamUrl || '').toLowerCase();
  const type = (metadata['tvg-type'] || metadata.type || '').toLowerCase().trim();
  const group = (metadata['group-title'] || metadata['tvg-group'] || metadata['group'] || metadata.category_name || metadata?.tv_genre?.title || '').toLowerCase().trim();

  if (/\.(mp4|mkv|avi|mov|wmv|flv)$/i.test(lowerUrl.split(/[?#]/)[0])) return true;
  if (/(^|\/)(movie|series|vod)(\/|$)/i.test(lowerUrl)) return true;
  if (['vod', 'movie', 'series'].includes(type)) return true;
  if (group === 'vod' || group === 'vods' || group === 'series') return true;

  return false; 
}

function parseExtInf(line: string, current: Partial<Channel>) {
  const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let match;
  
  while ((match = attrRegex.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] || match[3] || match[4] || '').trim();
    
    if (current.raw_metadata) {
      current.raw_metadata[key] = value;
    }

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
  
  const key = match[1].trim().toLowerCase(); 
  let val = match[2].trim();
  
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  
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

function pushChannel(channels: Channel[], current: Partial<Channel>, sourceId: string, keepVods: boolean) {
  if (!current.stream_url) return;
  
  // RESPECT THE BYPASS FLAG
  if (!keepVods && isVod(current.stream_url, current.raw_metadata || {})) {
    return;
  }

  channels.push({
    id: generateStableId(sourceId, current.stream_url, current.name || 'Unknown', current.channel_group || 'Other'),
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
export function parseM3UString(
  text: string, 
  sourceId: string, 
  options: { fallbackName?: string, keepVods?: boolean } = {}
): { playlistMetadata: PlaylistMetadata, channels: Channel[] } {
  
  const { fallbackName = 'Unknown Playlist', keepVods = false } = options;

  text = text.replace(/^\uFEFF/, ''); 

  const channels: Channel[] = [];
  const playlistMetadata: PlaylistMetadata = { name: fallbackName };
  
  let current = resetCurrentChannel();
  let pendingGroup: string | null = null;

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
      if (current.name !== 'Unknown' || Object.keys(current.raw_metadata || {}).length > 0) {
        current = resetCurrentChannel();
      }
      parseExtInf(line, current);
      continue;
    } 
    
    if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#KODIPROP:') || line.startsWith('#EXTHTTP:')) {
      if (current.raw_metadata) parsePlayerOption(line, current.raw_metadata);
      continue;
    } 

    if (line.startsWith('#')) {
      continue; 
    }

    const streamUrl = line.replace(/\s+#.*$/, "").trim();

    if (/^[a-z][a-z0-9+\-.]*:/i.test(streamUrl)) {
      current.stream_url = streamUrl;
      
      if (pendingGroup) { 
        current.channel_group = pendingGroup; 
        pendingGroup = null; 
      }
      
      pushChannel(channels, current, sourceId, keepVods);
      current = resetCurrentChannel();
    }
  }
  
  if (current.stream_url && (current.name !== 'Unknown' || current.stream_url)) {
    pushChannel(channels, current, sourceId, keepVods);
  }

  return { playlistMetadata, channels };
}
