import { generateStableId, parseM3UString } from './shared/m3uParser.js';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", 
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ----------------------------------------------------
// SECURITY & VALIDATION UTILS
// ----------------------------------------------------
function validateUrl(target) {
  if (!target || typeof target !== 'string' || target.length > 5000) {
    throw new Error("Invalid URL provided.");
  }
  try {
    const u = new URL(target);
    if (!['http:', 'https:'].includes(u.protocol)) {
      throw new Error("Invalid protocol. Only HTTP and HTTPS are allowed.");
    }
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.startsWith('10.') || host.startsWith('192.168.') || host.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)) {
      throw new Error("Access to private IP addresses is strictly forbidden.");
    }
    return target;
  } catch (e) {
    throw new Error(`URL Validation Failed: ${e.message}`);
  }
}

async function safeFetch(url, options = {}) {
  const target = validateUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(target, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw new Error(error.name === 'AbortError' ? 'Connection timed out after 15 seconds' : error.message);
  }
}

async function getOrCreateSourceId(env, url) {
  const existing = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(url).first();
  return existing ? existing.id : `src_${crypto.randomUUID()}`;
}

// ----------------------------------------------------
// THE TRUE SYNC ENGINE 
// ----------------------------------------------------
async function insertDatabaseBatch(env, channels, sourceId, name, type, sourceUrl, playlistMetadata = '{}', accountInfo = '{}') {
  if (!channels || channels.length === 0) throw new Error("No live channels found (VODs were skipped).");
  
  await env.DB.prepare(`
    INSERT INTO sources (id, name, type, url, channel_count, playlist_metadata, account_info) 
    VALUES (?, ?, ?, ?, 0, ?, ?) 
    ON CONFLICT(id) DO UPDATE SET 
      last_updated = CURRENT_TIMESTAMP, 
      name = excluded.name,
      playlist_metadata = excluded.playlist_metadata,
      account_info = excluded.account_info
  `).bind(sourceId, name, type, sourceUrl, playlistMetadata, accountInfo).run();

  const { results: existing } = await env.DB.prepare("SELECT id FROM channels WHERE source_id = ?").bind(sourceId).all();
  const existingIds = new Set(existing.map(r => r.id));
  const newIds = new Set(channels.map(r => r.id));
  
  const toDelete = [...existingIds].filter(id => !newIds.has(id));

  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    if (chunk.length === 0) continue;
    const placeholders = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM favorites WHERE channel_id IN (${placeholders})`).bind(...chunk).run();
    await env.DB.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).bind(...chunk).run();
  }

  const stmts = channels.map(ch => 
    env.DB.prepare(`
      INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) 
      VALUES (?, ?, ?, ?, ?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET 
        name = excluded.name, 
        channel_group = excluded.channel_group, 
        logo_url = excluded.logo_url, 
        stream_url = excluded.stream_url, 
        raw_metadata = excluded.raw_metadata
    `).bind(ch.id, ch.source_id, ch.name, ch.channel_group, ch.logo_url, ch.stream_url, ch.raw_metadata || '{}')
  );
  
  let successCount = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    let retries = 3;
    while (retries > 0) {
      try { 
        await env.DB.batch(stmts.slice(i, i + 50)); 
        successCount += stmts.slice(i, i + 50).length; 
        break; 
      } catch (batchErr) { 
        retries--; 
        if (retries === 0) throw new Error(`Database batch insertion failed: ${batchErr.message}`); 
        else await new Promise(resolve => setTimeout(resolve, 200)); 
      }
    }
  }
  
  await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
  return successCount;
}

// ----------------------------------------------------
// THE CLOUDFLARE FETCH & ROUTE ENGINE
// ----------------------------------------------------
async function processImportUrl(url, sourceId, name) {
  try {
    const response = await safeFetch(url, { 
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IPTVParser/2.0)" } 
    });
    
    // 1. STRICT PING CHECK
    if (!response.ok) {
      throw new Error(`URL connection rejected (Status ${response.status}). Verify the link is active.`);
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();

    // 2. EXPLICIT INVALID HEADERS (Instantly block APIs and Webpages)
    if (contentType.includes('application/json') || contentType.includes('text/html')) {
        throw new Error("Invalid format. The link returned an HTML webpage or JSON API, not a playlist.");
    }

    // 3. EXPLICIT MEDIA BYPASS (Audio/Video streams)
    if (contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/dash+xml') {
       return { playlistMetadata: {}, channels: createDirectChannel(sourceId, url, name || 'Direct Channel') };
    }

    // 4. PEEK AT THE DATA STREAM
    if (response.body) {
       const peekResponse = response.clone();
       const reader = peekResponse.body.getReader();
       const { value } = await reader.read();
       
       const firstChunkText = new TextDecoder().decode(value || new Uint8Array());
       const lowerText = firstChunkText.trimStart().toLowerCase();
       
       // HTML Soft 404 Blocker (Fallback check)
       if (lowerText.startsWith('<html') || lowerText.startsWith('<!doctype')) {
           throw new Error("Invalid format. The link returned an HTML webpage (Soft 404), not a video stream.");
       }
       
       // HLS Manifest (.m3u8 single channel)
       if (firstChunkText.includes('#EXT-X-TARGETDURATION') || firstChunkText.includes('#EXT-X-STREAM-INF')) {
           return { playlistMetadata: {}, channels: createDirectChannel(sourceId, url, name || 'HLS Stream') };
       }

       // Full M3U Playlist - Pass to the Shared Parser
       if (firstChunkText.trimStart().startsWith('#EXTM3U')) {
           const fullText = await response.text();
           return parseM3UString(fullText, sourceId, name);
       }
    }

    // 5. STRICT CATCH-ALL
    // Only allow unidentifiable formats if the server explicitly states it is raw binary data or lacks a content-type.
    if (contentType.includes('application/octet-stream') || contentType === '') {
        return { playlistMetadata: {}, channels: createDirectChannel(sourceId, url, name || 'Direct Channel') };
    }

    throw new Error("Invalid format. The URL did not return a valid M3U playlist or recognized media stream.");

  } catch (err) {
    throw new Error(err.message || "Failed to process the URL.");
  }
}

function createDirectChannel(sourceId, streamUrl, displayName) {
  return [{
    id: generateStableId(sourceId, streamUrl, 1), 
    source_id: sourceId, 
    name: displayName,
    channel_group: 'Direct Streams', 
    logo_url: null, 
    stream_url: streamUrl, 
    raw_metadata: {}
  }];
}

// ----------------------------------------------------
// FULLY AUTONOMOUS AUTO-REFRESH DAEMON
// ----------------------------------------------------
async function runAutoRefresh(env) {
  try {
    const settings = await env.DB.prepare("SELECT * FROM settings WHERE id = 'global'").first();
    if (!settings || !settings.auto_refresh_interval || settings.auto_refresh_interval === 'never') return;

    let hours = 0;
    if (settings.auto_refresh_interval === 'daily') hours = 24;
    else if (settings.auto_refresh_interval === '3days') hours = 72;
    else if (settings.auto_refresh_interval === 'weekly') hours = 168;

    if (hours === 0) return;

    const { results: sources } = await env.DB.prepare(`SELECT * FROM sources WHERE type IN ('M3U URL', 'Xtream API', 'Stalker API') ORDER BY last_updated ASC LIMIT 5`).all();
    
    for (const source of sources) {
      const lastUpdated = Date.parse(source.last_updated.endsWith('Z') ? source.last_updated : source.last_updated + 'Z');
      
      if (Date.now() - lastUpdated > hours * 60 * 60 * 1000) {
        let accountInfo = source.account_info ? JSON.parse(source.account_info) : {};
        delete accountInfo.sync_error;
        
        try {
          if (source.type === 'M3U URL') {
            const parsedData = await processImportUrl(source.url, source.id, source.name);
            await insertDatabaseBatch(env, parsedData.channels, source.id, source.name, source.type, source.url, JSON.stringify(parsedData.playlistMetadata), JSON.stringify(accountInfo));
          } 
          else if (source.type === 'Xtream API') {
            if (!accountInfo.credentials || !accountInfo.credentials.username) throw new Error("No Xtream credentials saved.");
            const cleanUrl = accountInfo.credentials.serverUrl;
            const u = accountInfo.credentials.username;
            const p = accountInfo.credentials.password;
            
            const headers = { "User-Agent": "IPTVSmarters/1.0" };
            let catMap = {};
            try {
              const catRes = await safeFetch(`${cleanUrl}/player_api.php?username=${u}&password=${p}&action=get_live_categories`, { headers });
              const catData = await catRes.json();
              if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
            } catch (e) {}

            const response = await safeFetch(`${cleanUrl}/player_api.php?username=${u}&password=${p}&action=get_live_streams`, { headers });
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream.");
            
            const channels = data.map((ch, idx) => ({ 
              id: `${source.id}_xtream_${ch.stream_id || idx}`, source_id: source.id, name: ch.name || `Channel ${idx}`, 
              channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', logo_url: ch.stream_icon || null, 
              stream_url: `${cleanUrl}/${u}/${p}/${ch.stream_id}`, raw_metadata: ch
            }));
            await insertDatabaseBatch(env, channels, source.id, source.name, "Xtream API", cleanUrl, '{}', JSON.stringify(accountInfo));
          } 
          else if (source.type === 'Stalker API') {
            if (!accountInfo.credentials || !accountInfo.credentials.macAddress) throw new Error("No Stalker MAC saved.");
            const cleanUrl = accountInfo.credentials.serverUrl;
            const headers = { "Cookie": `mac=${accountInfo.credentials.macAddress}`, "User-Agent": "Mozilla/5.0" };
            const handshakeRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
            const handshake = await handshakeRes.json();
            if (handshake?.js?.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
            
            const chRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
            const chData = await chRes.json();
            if (!chData?.js?.data || !Array.isArray(chData.js.data)) throw new Error("Invalid Stalker response.");

            const channels = chData.js.data.map((ch, idx) => ({ 
              id: `${source.id}_stalker_${ch.id || idx}`, source_id: source.id, name: ch.name || `Channel ${idx}`, 
              channel_group: ch.tv_genre?.title || 'Live TV', logo_url: ch.logo || null, stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}`, raw_metadata: ch
            }));
            await insertDatabaseBatch(env, channels, source.id, source.name, "Stalker API", cleanUrl, '{}', JSON.stringify(accountInfo));
          }
        } catch (e) {
          console.error(`Auto-Refresh failed for [${source.name}]:`, e);
          accountInfo.sync_error = e.message;
          await env.DB.prepare("UPDATE sources SET account_info = ? WHERE id = ?").bind(JSON.stringify(accountInfo), source.id).run();
        }
      }
    }
  } catch (err) {
    console.error("Auto-Refresh Global Error:", err);
  }
}

// ----------------------------------------------------
// MAIN ROUTER
// ----------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);

    if (request.method === "GET" && (url.pathname === "/api/channels" || url.pathname === "/api/sources")) {
      ctx.waitUntil(runAutoRefresh(env).catch(e => console.error(e)));
    }

    try {
      if (url.pathname === "/api/sources" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM sources ORDER BY last_updated DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.playlistUrl) throw new Error("Playlist URL is required.");
        
        const sourceId = body.sourceId || await getOrCreateSourceId(env, body.playlistUrl);
        const parsedData = await processImportUrl(body.playlistUrl, sourceId, body.name);
        const count = await insertDatabaseBatch(env, parsedData.channels, sourceId, body.name, body.type, body.playlistUrl, JSON.stringify(parsedData.playlistMetadata));
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-bulk" && request.method === "POST") {
        const { sourceId, name, type, channels: rawChannels, url: sourceUrl, playlistMetadata } = await request.json();
        const uniqueUrl = sourceUrl || `local://${sourceId}`;
        const metaStr = playlistMetadata ? JSON.stringify(playlistMetadata) : '{}';

        await env.DB.prepare("INSERT OR IGNORE INTO sources (id, name, type, url, channel_count, playlist_metadata, account_info) VALUES (?, ?, ?, ?, 0, ?, '{}')").bind(sourceId, name, type, uniqueUrl, metaStr).run();
        
        await env.DB.prepare("UPDATE sources SET playlist_metadata = ? WHERE id = ?").bind(metaStr, sourceId).run();

        const stmts = rawChannels.map(ch => 
          env.DB.prepare(`
            INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) 
            VALUES (?, ?, ?, ?, ?, ?, ?) 
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url, raw_metadata = excluded.raw_metadata
          `).bind(ch.id, sourceId, ch.name, ch.channel_group, ch.logo_url, ch.stream_url, JSON.stringify(ch.raw_metadata || {}))
        );
        
        for (let i = 0; i < stmts.length; i += 50) { 
          try { await env.DB.batch(stmts.slice(i, i + 50)); } catch(e) { throw new Error(`File chunk processing failed: ${e.message}`); }
        }
        await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-xtream" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.serverUrl || !body.username || !body.password) throw new Error("Missing Xtream credentials.");
        
        const cleanUrl = validateUrl(body.serverUrl.replace(/\/$/, ''));
        const sourceId = body.sourceId || await getOrCreateSourceId(env, cleanUrl);
        const headers = { "User-Agent": "IPTVSmarters/1.0" };
        
        let catMap = {};
        try {
          const catRes = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_categories`, { headers });
          const catData = await catRes.json();
          if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
        } catch (e) {}

        let accountInfo = { credentials: { username: body.username, password: body.password, serverUrl: cleanUrl } };
        try {
          const accRes = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}`, { headers });
          const accData = await accRes.json();
          if (accData.user_info) accountInfo = { ...accountInfo, ...accData.user_info };
        } catch (e) {}

        const response = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_streams`, { headers });
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API.");
        
        const channels = data.map((ch, idx) => ({ 
          id: `${sourceId}_xtream_${ch.stream_id || idx}`, source_id: sourceId, name: ch.name || `Channel ${idx}`, 
          channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', logo_url: ch.stream_icon || null, 
          stream_url: `${cleanUrl}/${body.username}/${body.password}/${ch.stream_id}`, raw_metadata: ch 
        }));
        
        const count = await insertDatabaseBatch(env, channels, sourceId, body.name, "Xtream API", cleanUrl, '{}', JSON.stringify(accountInfo));
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-stalker" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.serverUrl || !body.macAddress) throw new Error("Missing Stalker credentials.");

        const cleanUrl = validateUrl(body.serverUrl.replace(/\/$/, ''));
        const sourceId = body.sourceId || await getOrCreateSourceId(env, cleanUrl);
        const headers = { "Cookie": `mac=${body.macAddress}`, "User-Agent": "Mozilla/5.0" };
        
        const handshakeRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
        const handshake = await handshakeRes.json();
        if (handshake?.js?.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
        
        let accountInfo = { credentials: { macAddress: body.macAddress, serverUrl: cleanUrl } };
        try {
          const profRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=get_profile`, { headers });
          const profData = await profRes.json();
          if (profData?.js) accountInfo = { ...accountInfo, ...profData.js };
        } catch (e) {}

        const chRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
        const chData = await chRes.json();
        if (!chData?.js?.data || !Array.isArray(chData.js.data)) throw new Error("Invalid Stalker API response format.");

        const channels = chData.js.data.map((ch, idx) => ({ 
          id: `${sourceId}_stalker_${ch.id || idx}`, source_id: sourceId, name: ch.name || `Channel ${idx}`, 
          channel_group: ch.tv_genre?.title || 'Live TV', logo_url: ch.logo || null, 
          stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}`, raw_metadata: ch 
        }));
        
        const count = await insertDatabaseBatch(env, channels, sourceId, body.name, "Stalker API", cleanUrl, '{}', JSON.stringify(accountInfo));
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      const sourceMatch = url.pathname.match(/^\/api\/sources\/(src_[^\/]+)(?:\/(.*))?$/);
      if (sourceMatch) {
        const sourceId = sourceMatch[1];
        const action = sourceMatch[2]; 

        if (request.method === "DELETE" && !action) {
          await env.DB.prepare(`DELETE FROM favorites WHERE channel_id IN (SELECT id FROM channels WHERE source_id = ?)`).bind(sourceId).run();
          await env.DB.prepare(`DELETE FROM channels WHERE source_id = ?`).bind(sourceId).run();
          await env.DB.prepare(`DELETE FROM sources WHERE id = ?`).bind(sourceId).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }

        if (request.method === "PUT" && !action) {
          const body = await request.json();
          if (body && body.name) {
             await env.DB.prepare("UPDATE sources SET name = ? WHERE id = ?").bind(body.name, sourceId).run();
             return Response.json({ success: true }, { headers: corsHeaders });
          }
          throw new Error("Name is required");
        }

        if (request.method === "POST" && action === "refresh") {
          const source = await env.DB.prepare("SELECT * FROM sources WHERE id = ?").bind(sourceId).first();
          if (!source) throw new Error("Source not found");
          
          let accountInfo = source.account_info ? JSON.parse(source.account_info) : {};
          delete accountInfo.sync_error; 

          let body = {};
          try { body = await request.json(); } catch(e) {}

          if (source.type === 'M3U URL') {
            const parsedData = await processImportUrl(source.url, source.id, source.name);
            const count = await insertDatabaseBatch(env, parsedData.channels, source.id, source.name, source.type, source.url, JSON.stringify(parsedData.playlistMetadata), JSON.stringify(accountInfo));
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Xtream API') {
            const u = body.username || accountInfo.credentials?.username;
            const p = body.password || accountInfo.credentials?.password;
            if (!u || !p) throw new Error("Xtream credentials required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "User-Agent": "IPTVSmarters/1.0" };
            
            let catMap = {};
            try {
              const catRes = await safeFetch(`${cleanUrl}/player_api.php?username=${u}&password=${p}&action=get_live_categories`, { headers });
              const catData = await catRes.json();
              if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
            } catch (e) {}

            try {
              const accRes = await safeFetch(`${cleanUrl}/player_api.php?username=${u}&password=${p}`, { headers });
              const accData = await accRes.json();
              if (accData.user_info) accountInfo = { ...accountInfo, ...accData.user_info };
            } catch (e) {}

            const response = await safeFetch(`${cleanUrl}/player_api.php?username=${u}&password=${p}&action=get_live_streams`, { headers });
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API.");
            
            const channels = data.map((ch, idx) => ({ 
              id: `${source.id}_xtream_${ch.stream_id || idx}`, source_id: source.id, name: ch.name || `Channel ${idx}`, 
              channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', logo_url: ch.stream_icon || null, 
              stream_url: `${cleanUrl}/${u}/${p}/${ch.stream_id}`, raw_metadata: ch 
            }));
            
            accountInfo.credentials = { username: u, password: p, serverUrl: cleanUrl };
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Xtream API", cleanUrl, '{}', JSON.stringify(accountInfo));
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Stalker API') {
            const mac = body.macAddress || accountInfo.credentials?.macAddress;
            if (!mac) throw new Error("MAC Address required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "Cookie": `mac=${mac}`, "User-Agent": "Mozilla/5.0" };
            const handshakeRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
            const handshake = await handshakeRes.json();
            if (handshake?.js?.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
            
            try {
              const profRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=get_profile`, { headers });
              const profData = await profRes.json();
              if (profData?.js) accountInfo = { ...accountInfo, ...profData.js };
            } catch (e) {}

            const chRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
            const chData = await chRes.json();
            if (!chData?.js?.data || !Array.isArray(chData.js.data)) throw new Error("Invalid Stalker response.");

            const channels = chData.js.data.map((ch, idx) => ({ 
              id: `${source.id}_stalker_${ch.id || idx}`, source_id: source.id, name: ch.name || `Channel ${idx}`, 
              channel_group: ch.tv_genre?.title || 'Live TV', logo_url: ch.logo || null, 
              stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}`, raw_metadata: ch 
            }));
            
            accountInfo.credentials = { macAddress: mac, serverUrl: cleanUrl };
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Stalker API", cleanUrl, '{}', JSON.stringify(accountInfo));
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else {
            throw new Error("Local Uploads cannot be refreshed.");
          }
        }
      }

      if (url.pathname === "/api/settings/metadata" && request.method === "PUT") {
        const body = await request.json();
        if (body && typeof body.global_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE settings SET global_metadata = ? WHERE id = 'global'").bind(body.global_metadata).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload");
      }

      const sourceMetaMatch = url.pathname.match(/^\/api\/sources\/(src_[^\/]+)\/metadata$/);
      if (sourceMetaMatch && request.method === "PUT") {
        const body = await request.json();
        if (body && typeof body.playlist_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE sources SET playlist_metadata = ? WHERE id = ?").bind(body.playlist_metadata, sourceMetaMatch[1]).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload");
      }

      const channelMetaMatch = url.pathname.match(/^\/api\/channels\/([^\/]+)\/metadata$/);
      if (channelMetaMatch && request.method === "PUT") {
        const body = await request.json();
        if (body && typeof body.raw_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE channels SET raw_metadata = ? WHERE id = ?").bind(body.raw_metadata, channelMetaMatch[1]).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload");
      }

      if (url.pathname === "/api/categories" && request.method === "GET") {
        const sourceId = url.searchParams.get("sourceId");
        let query = "SELECT channel_group as name, COUNT(*) as count FROM channels";
        let params = [];
        if (sourceId && sourceId !== "All") { query += " WHERE source_id = ?"; params.push(sourceId); }
        query += " GROUP BY channel_group ORDER BY channel_group ASC";
        const { results } = await env.DB.prepare(query).bind(...params).all();
        const total = results.reduce((sum, row) => sum + row.count, 0);
        return Response.json({ categories: results, total }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/channels" && request.method === "GET") {
        const sourceId = url.searchParams.get("sourceId");
        const category = url.searchParams.get("category");
        const search = url.searchParams.get("search");
        const limit = parseInt(url.searchParams.get("limit") || "100");
        const offset = parseInt(url.searchParams.get("offset") || "0");

        let query = "SELECT * FROM channels"; let countQuery = "SELECT COUNT(*) as total FROM channels";
        let conditions = []; let params = [];

        if (sourceId && sourceId !== "All") { conditions.push("source_id = ?"); params.push(sourceId); }
        if (category && category !== "All" && category !== "undefined") { conditions.push("channel_group = ?"); params.push(category); }
        if (search && search.trim() !== "") { conditions.push("name LIKE ?"); params.push(`%${search}%`); }

        if (conditions.length > 0) {
          const whereClause = " WHERE " + conditions.join(" AND ");
          query += whereClause; countQuery += whereClause;
        }

        query += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
        const totalResult = await env.DB.prepare(countQuery).bind(...params).first();
        params.push(limit, offset);
        const { results } = await env.DB.prepare(query).bind(...params).all();

        return Response.json({ data: results, total: totalResult.total, hasMore: offset + results.length < totalResult.total }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/favorites" && request.method === "GET") {
        const { results } = await env.DB.prepare(`SELECT c.*, s.name as source_name FROM favorites f JOIN channels c ON f.channel_id = c.id JOIN sources s ON c.source_id = s.id ORDER BY c.name ASC`).all();
        return Response.json(results, { headers: corsHeaders });
      }
      if (url.pathname === "/api/favorites" && request.method === "POST") {
        const body = await request.json();
        if(body && body.channel_id) {
          await env.DB.prepare("INSERT OR IGNORE INTO favorites (channel_id) VALUES (?)").bind(body.channel_id).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }
      if (url.pathname.startsWith("/api/favorites/") && request.method === "DELETE") {
        const channelId = url.pathname.split("/").pop();
        await env.DB.prepare("DELETE FROM favorites WHERE channel_id = ?").bind(channelId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }
      
      if (url.pathname === "/api/settings" && request.method === "GET") {
        const settings = await env.DB.prepare("SELECT * FROM settings WHERE id = 'global'").first();
        return Response.json(settings, { headers: corsHeaders });
      }

      if (url.pathname === "/api/settings" && request.method === "PUT") {
        const body = await request.json();
        if(body) {
          await env.DB.prepare("UPDATE settings SET default_quality = ?, auto_refresh_interval = ?, default_audio = ?, default_subtitle = ? WHERE id = 'global'")
            .bind(body.default_quality, body.auto_refresh_interval, body.default_audio || '', body.default_subtitle || '').run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
      }

      if (!url.pathname.startsWith("/api/")) {
        try {
          const assetResponse = await env.ASSETS.fetch(request);
          if (assetResponse.status !== 404) return assetResponse;
          return env.ASSETS.fetch(new Request(url.origin + "/", request));
        } catch (e) {
          return new Response("Frontend not found", { status: 404 });
        }
      }

      return Response.json({ status: "API Live" }, { headers: corsHeaders });
    } catch (error) {
      console.error("Backend Error:", error);
      return Response.json({ error: error.message || "Internal Server Error" }, { status: 500, headers: corsHeaders });
    }
  },
  
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoRefresh(env));
  }
};
