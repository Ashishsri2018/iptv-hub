const corsHeaders = {
  "Access-Control-Allow-Origin": "*", 
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function validateUrl(target) {
  if (!target || typeof target !== 'string' || target.length > 5000) throw new Error("Invalid URL provided.");
  try {
    const u = new URL(target);
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error("Invalid protocol.");
    const host = u.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('10.') || host.startsWith('192.168.')) throw new Error("Private IP forbidden.");
    return target;
  } catch (e) { throw new Error(`URL Validation Failed: ${e.message}`); }
}

function generateStableId(sourceId, streamUrl, count) {
  let hash = 5381;
  for (let i = 0; i < streamUrl.length; i++) hash = (hash * 33) ^ streamUrl.charCodeAt(i);
  const hashStr = (hash >>> 0).toString(36);
  const tail = streamUrl.replace(/[^a-zA-Z0-9]/g, '').slice(-15);
  return `${sourceId}_${hashStr}_${tail}_${count}`;
}

async function safeFetch(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) { clearTimeout(timeoutId); throw error; }
}

async function getOrCreateSourceId(env, url) {
  const existing = await env.DB.prepare("SELECT id FROM sources WHERE url = ?").bind(url).first();
  return existing ? existing.id : `src_${crypto.randomUUID()}`;
}

async function insertDatabaseBatch(env, channels, sourceId, name, type, sourceUrl) {
  if (!channels || channels.length === 0) throw new Error("Parser found 0 channels.");
  
  await env.DB.prepare(`INSERT INTO sources (id, name, type, url, channel_count) VALUES (?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET last_updated = CURRENT_TIMESTAMP, name = excluded.name`).bind(sourceId, name, type, sourceUrl).run();

  const { results: existing } = await env.DB.prepare("SELECT id FROM channels WHERE source_id = ?").bind(sourceId).all();
  const existingIds = new Set(existing.map(r => r.id));
  const newIds = new Set(channels.map(r => r.id));
  const toDelete = [...existingIds].filter(id => !newIds.has(id));

  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    const placeholders = chunk.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM favorites WHERE channel_id IN (${placeholders})`).bind(...chunk).run();
    await env.DB.prepare(`DELETE FROM channels WHERE id IN (${placeholders})`).bind(...chunk).run();
  }

  const stmts = channels.map(ch => 
    env.DB.prepare(`INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url, raw_metadata = excluded.raw_metadata`).bind(ch.id, sourceId, ch.name, ch.channel_group, ch.logo_url, ch.stream_url, ch.raw_metadata || '{}')
  );
  
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  
  await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
  return channels.length;
}

async function processImportUrl(url, sourceId, name) {
  try {
    const response = await safeFetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    const text = await response.text();

    if (text.trimStart().startsWith('#EXTM3U')) {
      const lines = text.split('\n');
      const channels = [];
      let currentChannel = {};
      const urlCounts = {};

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('#EXTINF:')) {
          const metadata = {};
          const attributes = line.matchAll(/([a-zA-Z0-9-]+)="([^"]+)"/g);
          for (const match of attributes) metadata[match[1]] = match[2];
          
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
          channels.push({ ...currentChannel });
          currentChannel = {};
        }
      }
      return channels;
    }
    return [{ id: generateStableId(sourceId, url, 1), source_id: sourceId, name: name || 'Direct Link', channel_group: 'Direct', logo_url: null, stream_url: url, raw_metadata: '{}' }];
  } catch (e) { throw e; }
}

async function runAutoRefresh(env) {
  const { results: sources } = await env.DB.prepare(`SELECT * FROM sources WHERE type = 'M3U URL'`).all();
  for (const source of sources) {
    try {
      const channels = await processImportUrl(source.url, source.id, source.name);
      await insertDatabaseBatch(env, channels, source.id, source.name, source.type, source.url);
    } catch (e) { console.error(e); }
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);

    try {
      if (url.pathname === "/api/sources" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM sources ORDER BY last_updated DESC").all();
        return Response.json(results, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import" && request.method === "POST") {
        const body = await request.json();
        const sourceId = await getOrCreateSourceId(env, body.playlistUrl);
        const channels = await processImportUrl(body.playlistUrl, sourceId, body.name);
        await insertDatabaseBatch(env, channels, sourceId, body.name, body.type, body.playlistUrl);
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/sources/import-bulk" && request.method === "POST") {
        const { sourceId, name, type, channels: rawChannels } = await request.json();
        const uniqueUrl = `local://${sourceId}`;
        await env.DB.prepare("INSERT OR IGNORE INTO sources (id, name, type, url, channel_count) VALUES (?, ?, ?, ?, 0)").bind(sourceId, name, type, uniqueUrl).run();
        
        // Ensure channels get raw_metadata from upload
        const stmts = rawChannels.map(ch => env.DB.prepare(`INSERT INTO channels (id, source_id, name, channel_group, logo_url, stream_url, raw_metadata) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, channel_group = excluded.channel_group, logo_url = excluded.logo_url, stream_url = excluded.stream_url, raw_metadata = excluded.raw_metadata`).bind(ch.id, sourceId, ch.name, ch.channel_group, ch.logo_url, ch.stream_url, ch.raw_metadata || '{}'));
        for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
        await env.DB.prepare("UPDATE sources SET channel_count = (SELECT COUNT(*) FROM channels WHERE source_id = ?), last_updated = CURRENT_TIMESTAMP WHERE id = ?").bind(sourceId, sourceId).run();
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      if (url.pathname === "/api/channels" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM channels").all();
        return Response.json({ data: results }, { headers: corsHeaders });
      }

      if (!url.pathname.startsWith("/api/")) {
        const assetResponse = await env.ASSETS.fetch(request);
        return assetResponse.status !== 404 ? assetResponse : env.ASSETS.fetch(new Request(url.origin + "/", request));
      }

      return Response.json({ status: "API Live" }, { headers: corsHeaders });
    } catch (error) { return Response.json({ error: error.message }, { status: 500, headers: corsHeaders }); }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(runAutoRefresh(env)); }
};