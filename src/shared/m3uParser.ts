// ----------------------------------------------------
// THE UNIFIED SHARED M3U PARSER (TypeScript)
// Used by both the Browser (Frontend) and Cloudflare (Backend)
// ----------------------------------------------------

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
  return name.replace(/[\[\]\(\)\{\}]/g, ' ')
             .replace(/\s+/g, ' ')
             .replace(/^\s*-\s*|\s*-\s*$/g, '')
             .trim()
             .slice(0, 120);
}

function resetCurrentChannel(): any {
  return { 
    name: 'Unknown', 
    channel_group: 'Other', 
    logo_url: null, 
    stream_url: null, 
    raw_metadata: {} as Record<string, string>
  };
}

// THE DUAL FIREWALL: Checks URL path AND Metadata tags
export function isVod(streamUrl: string, metadata: any): boolean {
  const lowerUrl = (streamUrl || '').toLowerCase();
  const type = (metadata['tvg-type'] || metadata.type || '').toLowerCase().trim();
  const group = (metadata['group-title'] || metadata['tvg-group'] || metadata['group'] || '').toLowerCase().trim();

  // 1. URL Path markers (Catches M3U_Plus VODs & Series)
  if (lowerUrl.includes('/movie/') || lowerUrl.includes('/series/') || lowerUrl.includes('/vod/')) return true;

  // 2. Metadata Types
  if (['vod', 'movie', 'series', 'cinema', 'film'].includes(type)) return true;
  if (type.includes('vod') || type.includes('series') || type.includes('movie')) return true;

  // 3. Group Titles
  if (group === 'vod' || group === 'vods' || group === 'movies' || group === 'series' || group === 'cinema') return true;
  if (group.startsWith('vod ') || group.startsWith('vod-') || group.startsWith('movies ') || group.startsWith('movies-') || group.startsWith('series ') || group.startsWith('series-')) return true;

  // If it survives the checks, it's Live TV or Radio. Allow it.
  return false; 
}

function parseExtInf(line: string, current: any) {
  const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
  let match;
  
  while ((match = attrRegex.exec(line)) !== null) {
    const key = match[1].toLowerCase();
    const value = (match[2] || match[3] || match[4] || '').trim();
    current.raw_metadata[key] = value;

    // ROBUST CATEGORY EXTRACTION
    if (key === 'group-title' || key === 'tvg-group' || key === 'group' || key === 'category') current.channel_group = value;
    if (key === 'tvg-logo' || key === 'logo') current.logo_url = value;
    if (key === 'tvg-name' || key === 'tvg-id' || key === 'name') current.name = value;
    if (key === 'catchup' || key === 'timeshift') current.raw_metadata.catchup = value;
  }

  const commaIndex = line.lastIndexOf(',');
  if (commaIndex !== -1) {
    let namePart = line.substring(commaIndex + 1).trim();
    if (namePart && namePart !== '-1' && namePart.length > 1) {
      current.name = cleanChannelName(namePart);
    }
  }
}

function parsePlayerOption(line: string, metadata: any) {
  const match = line.match(/#(?:EXTVLCOPT|KODIPROP|EXTHTTP):([^=]+)=(.*)/i);
  if (!match) return;
  let key = match[1].trim(); 
  let val = match[2].trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  metadata[key] = val;
}

function pushChannel(channels: any[], current: any, sourceId: string, urlCounts: Map<string, number>): boolean {
  if (!current.stream_url) return false;
  
  // Trigger the Dual Firewall
  if (isVod(current.stream_url, current.raw_metadata)) {
    return false;
  }

  const count = (urlCounts.get(current.stream_url) || 0) + 1;
  urlCounts.set(current.stream_url, count);

  channels.push({
    id: generateStableId(sourceId, current.stream_url, count),
    source_id: sourceId, 
    name: current.name || 'Unknown',
    channel_group: current.channel_group || 'Other',
    logo_url: current.logo_url, 
    stream_url: current.stream_url,
    raw_metadata: JSON.stringify(current.raw_metadata) 
  });
  return true;
}

// ----------------------------------------------------
// THE MASTER EXPORT FUNCTION
// Returns: { playlistMetadata, channels }
// ----------------------------------------------------
export function parseM3UString(text: string, sourceId: string, fallbackName = 'Unknown Playlist') {
  const lines = text.split(/\r?\n/);
  const channels: any[] = [];
  const urlCounts = new Map<string, number>();
  const playlistMetadata: Record<string, string> = { name: fallbackName };
  
  let current = resetCurrentChannel();
  let pendingGroup: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // EPG & Global Header Extraction
    if (line.startsWith('#EXTM3U')) {
      const attrRegex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]+))/g;
      let match;
      while ((match = attrRegex.exec(line)) !== null) {
        const key = match[1].toLowerCase();
        const value = (match[2] || match[3] || match[4] || '').trim();
        playlistMetadata[key] = value;
      }
      continue;
    }

    if (line.startsWith('#EXTGRP:')) { 
      pendingGroup = line.substring(8).trim(); 
      continue; 
    }

    if (line.startsWith('#EXTINF:')) {
      if (current.stream_url) pushChannel(channels, current, sourceId, urlCounts);
      current = resetCurrentChannel();
      parseExtInf(line, current);
      if (pendingGroup) { 
        current.channel_group = pendingGroup; 
        pendingGroup = null; 
      }
    } 
    else if (line.startsWith('#EXTVLCOPT:') || line.startsWith('#KODIPROP:') || line.startsWith('#EXTHTTP:')) {
      parsePlayerOption(line, current.raw_metadata);
    } 
    else if (/^(http|https|rtmp|udp|acestream|rtsp):\/\//i.test(line)) {
      current.stream_url = line.trim();
      if (pendingGroup) { 
        current.channel_group = pendingGroup; 
        pendingGroup = null; 
      }
      pushChannel(channels, current, sourceId, urlCounts);
      current = resetCurrentChannel();
    }
  }
  
  // Catch the final channel
  if (current.stream_url) pushChannel(channels, current, sourceId, urlCounts);

  return { playlistMetadata, channels };
}
