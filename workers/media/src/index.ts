export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  AUTH_APP_SECRET: string;
}

const COOKIE_NAME = "archive_jwt";
const SITE_ORIGIN = "https://archive.cerise-bouquet.xyz";
const SEGMENT_CACHE_SECONDS = 60 * 60 * 24 * 30; // 30 天，分段内容不可变
const FILE_PATH_CACHE_SECONDS = 60 * 50; // Telegram file_path 约 1 小时有效，缓存 50 分钟
const GROWING_PLAYLIST_CACHE_SECONDS = 6; // 上传中的视频，播放列表短缓存以便播放器尽快发现新分段
const COMPLETE_PLAYLIST_CACHE_SECONDS = SEGMENT_CACHE_SECONDS; // 已完结（有 ENDLIST）的播放列表不再变化
const TARGET_DURATION = 5; // 对应 process.ps1 的 -hls_time 4，取整数上界

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": SITE_ORIGIN,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
  };
}

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function verifyJwt(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) return false;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as {
    expire_at?: number;
  };
  return typeof payload.expire_at === "number" && payload.expire_at > Date.now() / 1000;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

async function getFilePath(fileId: string, token: string): Promise<string> {
  const cache = caches.default;
  const cacheKey = new Request(`https://cache-internal.local/filepath/${fileId}`);
  const cached = await cache.match(cacheKey);
  if (cached) return await cached.text();

  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = (await res.json()) as { ok: boolean; result?: { file_path?: string } };
  if (!data.ok || !data.result?.file_path) {
    throw new Error("telegram getFile failed");
  }
  const filePath = data.result.file_path;
  await cache.put(
    cacheKey,
    new Response(filePath, { headers: { "Cache-Control": `max-age=${FILE_PATH_CACHE_SECONDS}` } })
  );
  return filePath;
}

async function fetchTelegramFile(fileId: string, token: string): Promise<Response> {
  const filePath = await getFilePath(fileId, token);
  return fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)$/);
    if (!match) return new Response("Not found", { status: 404, headers: corsHeaders() });
    const [, slug, file] = match;

    const jwt = getCookie(request, COOKIE_NAME);
    const authorized = jwt ? await verifyJwt(jwt, env.AUTH_APP_SECRET) : false;
    if (!authorized) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders() });
    }

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) {
      const resp = new Response(cached.body, cached);
      for (const [k, v] of Object.entries(corsHeaders())) resp.headers.set(k, v);
      return resp;
    }

    let body: Response;
    let contentType: string;
    let cacheSeconds: number;
    let cacheImmutable = true;

    if (file === "master.m3u8") {
      const video = await env.DB.prepare("SELECT segment_count FROM videos WHERE slug = ?")
        .bind(slug)
        .first<{ segment_count: number }>();
      if (!video) return new Response("Not found", { status: 404, headers: corsHeaders() });
      const { results } = await env.DB.prepare(
        "SELECT seg_name, duration_seconds FROM segments WHERE slug = ? ORDER BY seg_name"
      )
        .bind(slug)
        .all<{ seg_name: string; duration_seconds: number }>();
      const uploaded = results ?? [];
      const complete = uploaded.length >= video.segment_count;

      const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${TARGET_DURATION}`];
      if (!complete) lines.push("#EXT-X-PLAYLIST-TYPE:EVENT");
      for (const seg of uploaded) {
        lines.push(`#EXTINF:${seg.duration_seconds.toFixed(6)},`);
        lines.push(`${url.origin}/${slug}/seg_${seg.seg_name}.ts`);
      }
      if (complete) lines.push("#EXT-X-ENDLIST");

      body = new Response(lines.join("\n") + "\n");
      contentType = "application/vnd.apple.mpegurl";
      cacheSeconds = complete ? COMPLETE_PLAYLIST_CACHE_SECONDS : GROWING_PLAYLIST_CACHE_SECONDS;
      cacheImmutable = complete;
    } else if (file === "poster.jpg") {
      const row = await env.DB.prepare("SELECT poster_file_id FROM videos WHERE slug = ?")
        .bind(slug)
        .first<{ poster_file_id: string | null }>();
      if (!row?.poster_file_id) return new Response("Not found", { status: 404, headers: corsHeaders() });
      body = await fetchTelegramFile(row.poster_file_id, env.TELEGRAM_BOT_TOKEN);
      contentType = "image/jpeg";
      cacheSeconds = SEGMENT_CACHE_SECONDS;
    } else if (/^seg_\d+\.ts$/.test(file)) {
      const segName = file.slice("seg_".length, -".ts".length);
      const row = await env.DB.prepare(
        "SELECT file_id FROM segments WHERE slug = ? AND seg_name = ?"
      )
        .bind(slug, segName)
        .first<{ file_id: string }>();
      if (!row) return new Response("Not found", { status: 404, headers: corsHeaders() });
      body = await fetchTelegramFile(row.file_id, env.TELEGRAM_BOT_TOKEN);
      contentType = "video/mp2t";
      cacheSeconds = SEGMENT_CACHE_SECONDS;
    } else {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const response = new Response(body.body, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": `public, max-age=${cacheSeconds}${cacheImmutable ? ", immutable" : ""}`,
        ...corsHeaders(),
      },
    });
    await cache.put(request, response.clone());
    return response;
  },
};
