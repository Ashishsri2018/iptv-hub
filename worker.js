const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function generateSafeId(sourceId, url, count) {
  let hash = 5381;
  for (let i = 0; i < url.length; i++) hash = (hash * 33) ^ url.charCodeAt(i);
  const hashStr = (hash >>> 0).toString(36);
  const tail = url.replace(/[^a-zA-Z0-9]/g, '').slice(-15);
  return `${sourceId}_${hashStr}_${tail}_${count}`;
}

async function insertDatabaseBatch(env, channels, sourceId, name, type, sourceUrl) {
  if (channels.length === 0) throw new Error("Parser finished, but found 0 readable channels.");
  
  // Use ON CONFLICT so background auto-refreshes don't crash when re-syncing an existing source
  await env.DB.prepare(`
    INSERT INTO sources (id, name, type, url, channel_count) 
    VALUES (?, ?, ?, ?, 0) 
    ON CONFLICT(id) DO UPDATE SET last_updated = CURRENT_TIMESTAMP
  `).bind(sourceId, name, type, sourceUrl).run();

  const stmts = channels.map(ch => 
    env.DB.prepare(`
      INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url) 
      VALUES (?, ?, ?, ?, ?, ?) 
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url
    `).bind(ch.id, ch.source_id, ch.name, ch.channel_group, ch.logo_url, ch.stream_url)
  );
  
  let successCount = 0;
  let batchSize = 100; 
  for (let i = 0; i < stmts.length; i += batchSize) {
    let retries = 3;
    while (retries > 0) {
      try { 
        await env.DB.batch(stmts.slice(i, i + batchSize)); 
        successCount += stmts.slice(i, i + batchSize).length; 
        break; 
      } catch (batchErr) { 
        retries--; 
        if (retries === 0) console.error(`Batch failed: ${batchErr.message}`); 
        else await new Promise(resolve => setTimeout(resolve, 200)); 
      }
    }
    await new Promise(resolve => setTimeout(resolve, 30)); 
  }
  
  await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
  return successCount;
}

// ----------------------------------------------------
// UNIVERSAL IMPORT ENGINE (Playlist OR Single Stream)
// ----------------------------------------------------
async function processImportUrl(url, sourceId, name) {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    
    if (!response.ok) {
      // If the target server blocks the Cloudflare worker (403, 404), do not reject!
      // The user's browser or VLC player might still be able to play it directly.
      return [{
        id: generateSafeId(sourceId, url, 1),
        source_id: sourceId,
        name: name || 'Direct Link',
        channel_group: 'Direct Streams',
        logo_url: null,
        stream_url: url
      }];
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const isMedia = contentType.startsWith('video/') || contentType.startsWith('audio/') || contentType === 'application/dash+xml';
    const isMpegUrl = contentType.includes('mpegurl');

    // 1. FAST-PATH: Huge files or Explicit Media Files (e.g. .mp4, .mpd)
    // Avoid downloading large video files into Cloudflare memory. Add instantly as single stream.
    if ((contentLength > 25000000) || (isMedia && !isMpegUrl)) {
      return [{
        id: generateSafeId(sourceId, url, 1),
        source_id: sourceId,
        name: name || 'Media Stream',
        channel_group: 'Direct Streams',
        logo_url: null,
        stream_url: url
      }];
    }

    // 2. PARSE TEXT
    const text = await response.text();

    // 3. HLS STREAM DETECTION (.m3u8 live feeds vs IPTV Playlists)
    // If it contains TARGETDURATION, it is a single video feed, not a multi-channel playlist.
    if (text.includes('#EXT-X-TARGETDURATION') || text.includes('#EXT-X-STREAM-INF')) {
      return [{
        id: generateSafeId(sourceId, url, 1),
        source_id: sourceId,
        name: name || 'HLS Stream',
        channel_group: 'Direct Streams',
        logo_url: null,
        stream_url: url
      }];
    }

    // 4. STANDARD M3U PLAYLIST DECODING
    if (text.trimStart().startsWith('#EXTM3U')) {
      const lines = text.split('\n');
      const channels = [];
      let currentChannel = {};
      const urlCounts = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          const groupMatch = line.match(/group-title="([^"]+)"/i);
          currentChannel.channel_group = groupMatch ? groupMatch[1] : 'Other';
          const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
          currentChannel.logo_url = logoMatch ? logoMatch[1] : null;
          const commaSplit = line.split(',');
          currentChannel.name = commaSplit.length > 1 ? commaSplit[commaSplit.length - 1].trim() : 'Unknown';
        } else if (line.match(/^(http|https|rtmp|udp|acestream):\/\//i)) {
          currentChannel.stream_url = line;
          currentChannel.source_id = sourceId;
          urlCounts[line] = (urlCounts[line] || 0) + 1;
          currentChannel.id = generateSafeId(sourceId, line, urlCounts[line]);
          channels.push({ ...currentChannel });
          currentChannel = {};
        }
      }
      if (channels.length > 0) return channels;
    }

    // 5. ULTIMATE FALLBACK: Unknown format (e.g. extensionless URLs, HTML pages)
    // Assume the user knows what they pasted and try to play it.
    return [{
      id: generateSafeId(sourceId, url, 1),
      source_id: sourceId,
      name: name || 'Direct Link',
      channel_group: 'Direct Streams',
      logo_url: null,
      stream_url: url
    }];

  } catch (err) {
    // If fetch fully crashes (e.g. bad DNS, CORS error), still save the URL as a channel!
    return [{
      id: generateSafeId(sourceId, url, 1),
      source_id: sourceId,
      name: name || 'Direct Link',
      channel_group: 'Direct Streams',
      logo_url: null,
      stream_url: url
    }];
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

    const { results: sources } = await env.DB.prepare(`SELECT * FROM sources WHERE type = 'M3U URL'`).all();
    
    for (const source of sources) {
      const dateStr = source.last_updated.endsWith('Z') ? source.last_updated : source.last_updated + 'Z';
      const lastUpdated = new Date(dateStr).getTime();
      
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

    // "Lazy Cron": Trigger background sync asynchronously without blocking the user's UI
    if (request.method === "GET" && (url.pathname === "/api/channels" || url.pathname === "/api/sources")) {
      ctx.waitUntil(runAutoRefresh(env).catch(() => {}));
    }

    try {
      if (url.pathname === "/api/sources" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM sources ORDER BY last_updated DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      // UNIVERSAL IMPORTER
      if (url.pathname === "/api/sources/import" && request.method === "POST") {
        const { playlistUrl, name, type } = await request.json();
        const sourceId = `src_${Date.now()}`;
        
        // Pass everything through the universal engine
        const channels = await processImportUrl(playlistUrl, sourceId, name);
        const count = await insertDatabaseBatch(env, channels, sourceId, name, type, playlistUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-bulk" && request.method === "POST") {
        const { sourceId, name, type, channels: rawChannels } = await request.json();
        await env.DB.prepare("INSERT OR IGNORE INTO sources (id, name, type, url, channel_count) VALUES (?, ?, ?, 'Local Upload', 0)").bind(sourceId, name, type).run();
        const stmts = rawChannels.map(ch => env.DB.prepare(`INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url`).bind(ch.id, sourceId, ch.name, ch.channel_group, ch.logo_url, ch.stream_url));
        for (let i = 0; i < stmts.length; i += 100) { try { await env.DB.batch(stmts.slice(i, i + 100)); } catch(e) {} }
        await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-xtream" && request.method === "POST") {
        const { serverUrl, username, password, name } = await request.json();
        const sourceId = `src_${Date.now()}`;
        const cleanUrl = serverUrl.replace(/\/$/, '');
        const headers = { "User-Agent": "IPTVSmarters/1.0" };
        
        // 1. Fetch Categories Dictionary first
        const catRes = await fetch(`${cleanUrl}/player_api.php?username=${username}&password=${password}&action=get_live_categories`, { headers });
        if (!catRes.ok) throw new Error(`Xtream server rejected categories connection. HTTP Status: ${catRes.status}`);
        let catMap = {};
        try {
          const catData = await catRes.json();
          if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
        } catch (e) {
          console.warn("Failed to parse Xtream categories, proceeding with fallback.");
        }

        // 2. Fetch Streams and Map to Category Dictionary
        const targetApi = `${cleanUrl}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
        const response = await fetch(targetApi, { headers });
        if (!response.ok) throw new Error(`Xtream server rejected streams connection. HTTP Status: ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API. Expected an array of streams.");
        
        const channels = data.map((ch, idx) => ({ 
          id: `${sourceId}_xtream_${ch.stream_id || idx}`, 
          source_id: sourceId, 
          name: ch.name || `Channel ${idx}`, 
          channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', 
          logo_url: ch.stream_icon || null, 
          stream_url: `${cleanUrl}/${username}/${password}/${ch.stream_id}` 
        }));
        
        const count = await insertDatabaseBatch(env, channels, sourceId, name, "Xtream API", cleanUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-stalker" && request.method === "POST") {
        const { serverUrl, macAddress, name } = await request.json();
        const sourceId = `src_${Date.now()}`;
        const cleanUrl = serverUrl.replace(/\/$/, '');
        const headers = { "Cookie": `mac=${macAddress}`, "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200" };
        const handshakeRes = await fetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
        if (!handshakeRes.ok) throw new Error(`Stalker Handshake Failed.`);
        const handshake = await handshakeRes.json();
        if (handshake.js && handshake.js.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
        const chRes = await fetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
        const chData = await chRes.json();
        const channels = chData.js.data.map((ch, idx) => ({ id: `${sourceId}_stalker_${ch.id || idx}`, source_id: sourceId, name: ch.name || `Channel ${idx}`, channel_group: ch.tv_genre?.title || 'Live TV', logo_url: ch.logo || null, stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}` }));
        const count = await insertDatabaseBatch(env, channels, sourceId, name, "Stalker API", cleanUrl);
        return Response.json({ success: true, count }, { headers: corsHeaders });
      }

      // ==========================================
      // SOURCE MANAGEMENT (Delete, Rename, Refresh)
      // ==========================================
      const sourceMatch = url.pathname.match(/^\/api\/sources\/(src_[^\/]+)(?:\/(.*))?$/);
      if (sourceMatch) {
        const sourceId = sourceMatch[1];
        const action = sourceMatch[2]; // e.g., 'refresh' or undefined

        // DELETE
        if (request.method === "DELETE" && !action) {
          await env.DB.prepare(`DELETE FROM favorites WHERE channel_id IN (SELECT id FROM channels WHERE source_id = ?)`).bind(sourceId).run();
          await env.DB.prepare(`DELETE FROM channels WHERE source_id = ?`).bind(sourceId).run();
          await env.DB.prepare(`DELETE FROM sources WHERE id = ?`).bind(sourceId).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        }

        // RENAME
        if (request.method === "PUT" && !action) {
          const body = await request.json();
          if (body.name) {
             await env.DB.prepare("UPDATE sources SET name = ? WHERE id = ?").bind(body.name, sourceId).run();
             return Response.json({ success: true }, { headers: corsHeaders });
          }
          throw new Error("Name is required");
        }

        // REFRESH
        if (request.method === "POST" && action === "refresh") {
          const source = await env.DB.prepare("SELECT * FROM sources WHERE id = ?").bind(sourceId).first();
          if (!source) throw new Error("Source not found");
          
          let body = {};
          try { body = await request.json(); } catch(e) {}

          if (source.type === 'M3U URL') {
            // FIX: Removed the redundant fetch(). The processImportUrl engine does this safely now!
            const channels = await processImportUrl(source.url, source.id, source.name);
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, source.type, source.url);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Xtream API') {
            const { username, password } = body;
            if (!username || !password) throw new Error("Xtream credentials required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "User-Agent": "IPTVSmarters/1.0" };
            
            // Re-fetch Category Map
            const catRes = await fetch(`${cleanUrl}/player_api.php?username=${username}&password=${password}&action=get_live_categories`, { headers });
            if (!catRes.ok) throw new Error(`Xtream server rejected categories connection.`);
            let catMap = {};
            try {
              const catData = await catRes.json();
              if (Array.isArray(catData)) catData.forEach(c => { catMap[c.category_id] = c.category_name; });
            } catch (e) {}

            // Re-fetch Streams
            const targetApi = `${cleanUrl}/player_api.php?username=${username}&password=${password}&action=get_live_streams`;
            const response = await fetch(targetApi, { headers });
            if (!response.ok) throw new Error(`Xtream server rejected streams connection.`);
            const data = await response.json();
            if (!Array.isArray(data)) throw new Error("Invalid data format from Xtream API.");
            
            const channels = data.map((ch, idx) => ({ 
              id: `${source.id}_xtream_${ch.stream_id || idx}`, 
              source_id: source.id, 
              name: ch.name || `Channel ${idx}`, 
              channel_group: catMap[ch.category_id] || ch.category_name || 'Live TV', 
              logo_url: ch.stream_icon || null, 
              stream_url: `${cleanUrl}/${username}/${password}/${ch.stream_id}` 
            }));
            
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Xtream API", cleanUrl);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else if (source.type === 'Stalker API') {
            const { macAddress } = body;
            if (!macAddress) throw new Error("MAC Address required for refresh.");
            
            const cleanUrl = source.url.replace(/\/$/, '');
            const headers = { "Cookie": `mac=${macAddress}`, "User-Agent": "Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200" };
            const handshakeRes = await fetch(`${cleanUrl}/portal/server/load.php?type=stb&action=handshake`, { headers });
            if (!handshakeRes.ok) throw new Error(`Stalker Handshake Failed.`);
            const handshake = await handshakeRes.json();
            if (handshake.js && handshake.js.token) headers["Authorization"] = `Bearer ${handshake.js.token}`;
            
            const chRes = await fetch(`${cleanUrl}/portal/server/load.php?type=itv&action=get_all_channels`, { headers });
            const chData = await chRes.json();
            const channels = chData.js.data.map((ch, idx) => ({ id: `${source.id}_stalker_${ch.id || idx}`, source_id: source.id, name: ch.name || `Channel ${idx}`, channel_group: ch.tv_genre?.title || 'Live TV', logo_url: ch.logo || null, stream_url: ch.cmd || `${cleanUrl}/ch/${ch.id}` }));
            
            const count = await insertDatabaseBatch(env, channels, source.id, source.name, "Stalker API", cleanUrl);
            return Response.json({ success: true, count }, { headers: corsHeaders });
          }
          else {
            throw new Error("Local Uploads cannot be refreshed.");
          }
        }
      }

      // ==========================================
      // PLAYLIST (SOURCE) AWARE SEARCH & PAGINATION
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

      // Favorites and Settings
      if (url.pathname === "/api/favorites" && request.method === "GET") {
        const { results } = await env.DB.prepare(`SELECT c.*, s.name as source_name FROM favorites f JOIN channels c ON f.channel_id = c.id JOIN sources s ON c.source_id = s.id ORDER BY c.name ASC`).all();
        return Response.json(results, { headers: corsHeaders });
      }
      if (url.pathname === "/api/favorites" && request.method === "POST") {
        const { channel_id } = await request.json();
        await env.DB.prepare("INSERT OR IGNORE INTO favorites (channel_id) VALUES (?)").bind(channel_id).run();
        return Response.json({ success: true }, { headers: corsHeaders });
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
        await env.DB.prepare(
          "UPDATE settings SET default_quality = ?, auto_refresh_interval = ?, default_audio = ?, default_subtitle = ? WHERE id = 'global'"
        ).bind(
          body.default_quality, 
          body.auto_refresh_interval, 
          body.default_audio || '', 
          body.default_subtitle || ''
        ).run();
        return Response.json({ success: true }, { headers: corsHeaders });
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
      return Response.json({ error: error.message, stack: error.stack }, { status: 500, headers: corsHeaders });
    }
  },
  
  // NATIVE CLOUDFLARE CRON TRIGGER EXPORT (if configured in dashboard)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoRefresh(env));
  }
};