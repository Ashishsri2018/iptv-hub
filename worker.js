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

// Stable ID Generator (Ensures URLs always generate the exact same ID so favorites survive refreshes)
function generateStableId(sourceId, streamUrl, count) {
  let hash = 5381;
  for (let i = 0; i < streamUrl.length; i++) hash = (hash * 33) ^ streamUrl.charCodeAt(i);
  const hashStr = (hash >>> 0).toString(36);
  const tail = streamUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-15);
  return `${sourceId}_${hashStr}_${tail}_${count}`;
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

// Check for Duplicates BEFORE creating a new Source
async function getOrCreateSourceId(env, url) {
  const existing = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(url).first();
  return existing ? existing.id : `src_${crypto.randomUUID()}`;
}

// ----------------------------------------------------
// THE TRUE SYNC ENGINE (Adds, Updates, AND Deletes)
// ----------------------------------------------------
async function insertDatabaseBatch(env, channels, sourceId, name, type, sourceUrl) {
  if (!channels || channels.length === 0) throw new Error("Parser finished, but found 0 readable channels.");
  
  // 1. Upsert the Source (Includes new JSON columns)
  await env.DB.prepare(`
    INSERT INTO sources (id, name, type, url, channel_count, playlist_metadata, account_info) 
    VALUES (?, ?, ?, ?, 0, '{}', '{}') 
    ON CONFLICT(id) DO UPDATE SET last_updated = CURRENT_TIMESTAMP, name = excluded.name
  `).bind(sourceId, name, type, sourceUrl).run();

  // 2. Identify Dead Channels (Sync Deletion)
  const { results: existing } = await env.DB.prepare("SELECT id FROM channels WHERE source_id = ?").bind(sourceId).all();
  const existingIds = new Set(existing.map(r => r.id));
  const newIds = new Set(channels.map(r => r.id));
  
  const toDelete = [...existingIds].filter(id => !newIds.has(id));

  // 3. Purge Dead Channels & Their Zombie Favorites
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM favorites WHERE channel_id IN (${placeholders})`).bind(...chunk).run();
    await env.DB.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).bind(...chunk).run();
  }

  // 4. Batch Insert/Update New Channels (Now handles raw_metadata)
  const stmts = channels.map(ch => 
    env.DB.prepare(`
      INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) 
      VALUES (?, ?, ?, ?, ?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url, raw_metadata = excluded.raw_metadata
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
  
  // 5. Update Exact Channel Count
  await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
  return successCount;
}

// ----------------------------------------------------
// UNIVERSAL IMPORT ENGINE
// ----------------------------------------------------
async function processImportUrl(url, sourceId, name) {
  try {
    const response = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    
    if (!response.ok) {
      return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Direct Link', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    
    if (contentLength > 50000000) {
      return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Large Media Stream', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];
    }

    const isMedia = contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/dash+xml';
    const isMpegUrl = contentType.includes('mpegurl');

    if (isMedia && !isMpegUrl) {
      return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Media Stream', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];
    }

    const text = await response.text();

    if (text.includes('#EXT-X-TARGETDURATION') || text.includes('#EXT-X-STREAM-INF')) {
      return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'HLS Stream', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];
    }

    if (text.trimStart().startsWith('#EXTM3U')) {
      const lines = text.split('\n');
      const channels = [];
      let currentChannel = {};
      const urlCounts = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          // THE SPONGE LOGIC: Extract all attributes to metadata
          const metadata = {};
          const attributes = line.matchAll(/([a-zA-Z0-9-]+)="([^"]+)"/g);
          for (const match of attributes) {
            metadata[match[1]] = match[2];
          }
          
          currentChannel.raw_metadata = JSON.stringify(metadata);
          currentChannel.channel_group = metadata['group-title'] || 'Other';
          currentChannel.logo_url = metadata['tvg-logo'] || null;
          
          const commaSplit = line.split(',');
          currentChannel.name = commaSplit.length > 1 ? commaSplit[commaSplit.length - 1].trim() : 'Unknown';
        } else if (line.match(/^(http|https|rtmp|udp|acestream):\/\//i)) {
          currentChannel.stream_url = line;
          currentChannel.source_id = sourceId;
          urlCounts[line] = (urlCounts[line] || 0) + 1;
          currentChannel.id = generateStableId(sourceId, line, urlCounts[line]);
          
          if (!currentChannel.raw_metadata) currentChannel.raw_metadata = '{}';
          channels.push({ ...currentChannel });
          currentChannel = {};
        }
      }
      if (channels.length > 0) return channels;
    }

    return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Direct Link', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];

  } catch (err) {
    return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Direct Link', channel_group: 'Direct Streams', logo_url: null, stream_url: url, raw_metadata: '{}' }];
  }
}

// ----------------------------------------------------
// BACKGROUND AUTO-REFRESH DAEMON
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

    const { results: sources } = await env.DB.prepare(`SELECT * FROM sources WHERE type = 'M3U URL' ORDER BY last_updated ASC LIMIT 5`).all();
    
    for (const source of sources) {
      const lastUpdated = Date.parse(source.last_updated.endsWith('Z') ? source.last_updated : source.last_updated + 'Z');
      
      if (Date.now() - lastUpdated > hours * 60 * 60 * 1000) {
        try {
          const channels = await processImportUrl(source.url, source.id, source.name);
          await insertDatabaseBatch(env, channels, source.id, source.name, source.type, source.url);
        } catch (e) {
          console.error(`Background refresh failed for source [${source.id}]:`, e);
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
        
        const sourceId = await getOrCreateSourceId(env, body.playlistUrl);
        const channels = await processImportUrl(body.playlistUrl, sourceId, body.name);
        const count = await insertDatabaseBatch(env, channels, sourceId, body.name, body.type, body.playlistUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-bulk" && request.method === "POST") {
        const { sourceId, name, type, channels: rawChannels } = await request.json();
        
        // Ensure new JSON columns are included in Local Upload sources
        const uniqueUrl = `local://${sourceId}`;
        await env.DB.prepare("INSERT OR IGNORE INTO sources (id, name, type, url, channel_count, playlist_metadata, account_info) VALUES (?, ?, ?, ?, 0, '{}', '{}')").bind(sourceId, name, type, uniqueUrl).run();
        
        const stmts = rawChannels.map(ch => 
          env.DB.prepare(`
            INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) 
            VALUES (?, ?, ?, ?, ?, ?, ?) 
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url, raw_metadata = excluded.raw_metadata
          `).bind(ch.id, sourceId, ch.name, ch.channel_group, ch.logo_url, ch.stream_url, ch.raw_metadata || '{}')
        );
        
        for (let i = 0; i < stmts.length; i += 50) { 
          try {
            await env.DB.batch(stmts.slice(i, i + 50)); 
          } catch(e) {
            throw new Error(`File chunk processing failed: ${e.message}`);
          }
        }
        await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-xtream" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.serverUrl || !body.username || !body.password) throw new Error("Missing Xtream credentials.");
        
        const cleanUrl = validateUrl(body.serverUrl.replace(/\/$/, ''));
        const sourceId = await getOrCreateSourceId(env, cleanUrl);
        const headers = { "User-Agent": "IPTVSmarters/1.0" };
        
        let catMap = {};
        try {
          const catRes = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_categories`, { headers });
          const catData = await catRes.json();
          if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
        } catch (e) {}

        const response = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_streams`, { headers });
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API.");
        
        const channels = data.map((ch, idx) => ({ 
          id: `${sourceId}_xtream_${ch.stream_id || idx}`, 
          source_id: sourceId, 
          name: ch.name || `Channel ${idx}`, 
          channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', 
          logo_url: ch.stream_icon || null, 
          stream_url: `${cleanUrl}/${body.username}/${body.password}/${ch.stream_id}`,
          raw_metadata: '{}'
        }));
        
        const count = await insertDatabaseBatch(env, channels, sourceId, body.name, "Xtream API", cleanUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-stalker" && request.method === "POST") {
        const body = await request.json();
        if (!body || !body.serverUrl || !body.macAddress) throw new Error("Missing Stalker credentials.");

        const cleanUrl = validateUrl(body.serverUrl.replace(/\/$/, ''));
        const sourceId = await getOrCreateSourceId(env, cleanUrl);
        const headers = { "Cookie": `mac=${body.macAddress}`, "User-Agent": "Mozilla/5.0" };
        
        const handshakeRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
        const handshake = await handshakeRes.json();
        if (handshake?.js?.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
        
        const chRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
        const chData = await chRes.json();
        
        if (!chData?.js?.data || !Array.isArray(chData.js.data)) throw new Error("Invalid Stalker API response format.");

        const channels = chData.js.data.map((ch, idx) => ({ 
          id: `${sourceId}_stalker_${ch.id || idx}`, 
          source_id: sourceId, 
          name: ch.name || `Channel ${idx}`, 
          channel_group: ch.tv_genre?.title || 'Live TV', 
          logo_url: ch.logo || null, 
          stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}`,
          raw_metadata: '{}'
        }));
        
        const count = await insertDatabaseBatch(env, channels, sourceId, body.name, "Stalker API", cleanUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      // ==========================================
      // SOURCE MANAGEMENT (Delete, Rename, Refresh)
      // ==========================================
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
          
          let body = {};
          try { body = await request.json(); } catch(e) {}

          if (source.type === 'M3U URL') {
            const channels = await processImportUrl(source.url, source.id, source.name);
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, source.type, source.url);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Xtream API') {
            if (!body.username || !body.password) throw new Error("Xtream credentials required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "User-Agent": "IPTVSmarters/1.0" };
            
            let catMap = {};
            try {
              const catRes = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_categories`, { headers });
              const catData = await catRes.json();
              if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
            } catch (e) {}

            const response = await safeFetch(`${cleanUrl}/player_api.php?username=${body.username}&password=${body.password}&action=get_live_streams`, { headers });
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API.");
            
            const channels = data.map((ch, idx) => ({ 
              id: `${source.id}_xtream_${ch.stream_id || idx}`, 
              source_id: source.id, 
              name: ch.name || `Channel ${idx}`, 
              channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', 
              logo_url: ch.stream_icon || null, 
              stream_url: `${cleanUrl}/${body.username}/${body.password}/${ch.stream_id}`,
              raw_metadata: '{}'
            }));
            
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Xtream API", cleanUrl);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Stalker API') {
            if (!body.macAddress) throw new Error("MAC Address required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "Cookie": `mac=${body.macAddress}`, "User-Agent": "Mozilla/5.0" };
            const handshakeRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
            const handshake = await handshakeRes.json();
            if (handshake?.js?.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
            
            const chRes = await safeFetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
            const chData = await chRes.json();
            if (!chData?.js?.data || !Array.isArray(chData.js.data)) throw new Error("Invalid Stalker response.");

            const channels = chData.js.data.map((ch, idx) => ({ 
              id: `${source.id}_stalker_${ch.id || idx}`, 
              source_id: source.id, 
              name: ch.name || `Channel ${idx}`, 
              channel_group: ch.tv_genre?.title || 'Live TV', 
              logo_url: ch.logo || null, 
              stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}`,
              raw_metadata: '{}'
            }));
            
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Stalker API", cleanUrl);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else {
            throw new Error("Local Uploads cannot be refreshed.");
          }
        }
      }

      // ==========================================
      // SEARCH & PAGINATION
      // ==========================================
      if (url.pathname === "/api/categories" && request.method === "GET") {
        const sourceId = url.searchParams.get("sourceId");
        let query = "SELECT channel_group as name, COUNT(*) as count FROM channels";
        let params = [];
        if (sourceId && sourceId !== "All") {
          query += " WHERE source_id = ?";
          params.push(sourceId);
        }
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

        let query = "SELECT * FROM channels";
        let countQuery = "SELECT COUNT(*) as total FROM channels";
        let conditions = [];
        let params = [];

        if (sourceId && sourceId !== "All") { conditions.push("source_id = ?"); params.push(sourceId); }
        if (category && category !== "All" && category !== "undefined") { conditions.push("channel_group = ?"); params.push(category); }
        if (search && search.trim() !== "") { conditions.push("name LIKE ?"); params.push(`%${search}%`); }

        if (conditions.length > 0) {
          const whereClause = " WHERE " + conditions.join(" AND ");
          query += whereClause;
          countQuery += whereClause;
        }

        query += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
        const totalResult = await env.DB.prepare(countQuery).bind(...params).first();
        params.push(limit, offset);
        const { results } = await env.DB.prepare(query).bind(...params).all();

        return Response.json({
          data: results,
          total: totalResult.total,
          hasMore: offset + results.length < totalResult.total
        }, { headers: corsHeaders });
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

      // ==========================================
      // ADVANCED METADATA OVERRIDES (THE 3 TIERS)
      // ==========================================

      // Tier 1: Global Metadata Save
      if (url.pathname === "/api/settings/metadata" && request.method === "PUT") {
        const body = await request.json();
        if (body && typeof body.global_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE settings SET global_metadata = ? WHERE id = 'global'")
            .bind(body.global_metadata).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload for global metadata");
      }

      // Tier 2: Playlist Metadata Save
      const sourceMetaMatch = url.pathname.match(/^\/api\/sources\/(src_[^\/]+)\/metadata$/);
      if (sourceMetaMatch && request.method === "PUT") {
        const sourceId = sourceMetaMatch[1];
        const body = await request.json();
        if (body && typeof body.playlist_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE sources SET playlist_metadata = ? WHERE id = ?")
            .bind(body.playlist_metadata, sourceId).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload for playlist metadata");
      }

      // Tier 3: Specific Channel Metadata Save
      const channelMetaMatch = url.pathname.match(/^\/api\/channels\/([^\/]+)\/metadata$/);
      if (channelMetaMatch && request.method === "PUT") {
        const channelId = channelMetaMatch[1];
        const body = await request.json();
        if (body && typeof body.raw_metadata !== 'undefined') {
          await env.DB.prepare("UPDATE channels SET raw_metadata = ? WHERE id = ?")
            .bind(body.raw_metadata, channelId).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }
        throw new Error("Invalid payload for channel metadata");
      }

      // FRONTEND ROUTING
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