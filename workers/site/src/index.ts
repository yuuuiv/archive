export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_BASE_URL: string;
  AUTH_APP_ID: string;
  AUTH_APP_SECRET: string;
}

const COOKIE_NAME = "archive_jwt";
const COOKIE_DOMAIN = ".cerise-bouquet.xyz";
const MEDIA_BASE = "https://media.cerise-bouquet.xyz";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // token_expire_days=30，与 auth 网关配置保持一致

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

async function requireAuth(request: Request, env: Env): Promise<boolean> {
  const jwt = getCookie(request, COOKIE_NAME);
  return jwt ? verifyJwt(jwt, env.AUTH_APP_SECRET) : false;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleLogin(env: Env): Promise<Response> {
  const url = new URL(`${env.AUTH_BASE_URL}/`);
  url.searchParams.set("app_id", env.AUTH_APP_ID);
  return Response.redirect(url.toString(), 302);
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const tokenRes = await fetch(`${env.AUTH_BASE_URL}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: env.AUTH_APP_ID, app_secret: env.AUTH_APP_SECRET, code }),
  });
  if (!tokenRes.ok) {
    return new Response(`Auth exchange failed: ${await tokenRes.text()}`, { status: 502 });
  }
  const { jwt } = (await tokenRes.json()) as { jwt: string };

  const cookie = [
    `${COOKIE_NAME}=${jwt}`,
    `Domain=${COOKIE_DOMAIN}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
  ].join("; ");

  return new Response(null, {
    status: 302,
    headers: { Location: "/", "Set-Cookie": cookie },
  });
}

type VideoRow = {
  slug: string;
  title: string;
  date: string | null;
  duration_seconds: number;
  segment_count: number;
  uploaded_segments: number;
  franchise_slug: string | null;
  franchise_name: string | null;
  live_slug: string | null;
  live_name: string | null;
};

const VIDEO_SELECT = `
  SELECT v.slug, v.title, v.date, v.duration_seconds, v.segment_count,
         v.franchise_slug, v.franchise_name, v.live_slug, v.live_name,
         (SELECT COUNT(*) FROM segments s WHERE s.slug = v.slug) AS uploaded_segments
  FROM videos v
`;

function toFileSummary(v: VideoRow) {
  return {
    slug: v.slug,
    title: v.title,
    date: v.date,
    duration_seconds: v.duration_seconds,
    segment_count: v.segment_count,
    uploaded_segments: v.uploaded_segments,
    poster_url: `${MEDIA_BASE}/${v.slug}/poster.jpg`,
  };
}

// 没有企划/场次归属信息的旧数据兜底分到"未分类"，不会在列表里凭空消失
const UNSORTED_FRANCHISE = { slug: "unsorted", name: "未分类" };

async function handleVideoNav(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `${VIDEO_SELECT} ORDER BY v.franchise_slug, v.live_slug, v.date, v.slug`
  ).all<VideoRow>();
  const rows = results ?? [];

  const franchiseOrder: string[] = [];
  const franchises = new Map<
    string,
    { slug: string; name: string; liveOrder: string[]; lives: Map<string, { slug: string; name: string; files: ReturnType<typeof toFileSummary>[] }> }
  >();

  for (const row of rows) {
    const fSlug = row.franchise_slug || UNSORTED_FRANCHISE.slug;
    const fName = row.franchise_name || UNSORTED_FRANCHISE.name;
    const lSlug = row.live_slug || row.slug;
    const lName = row.live_name || row.title;

    if (!franchises.has(fSlug)) {
      franchises.set(fSlug, { slug: fSlug, name: fName, liveOrder: [], lives: new Map() });
      franchiseOrder.push(fSlug);
    }
    const franchise = franchises.get(fSlug)!;
    if (!franchise.lives.has(lSlug)) {
      franchise.lives.set(lSlug, { slug: lSlug, name: lName, files: [] });
      franchise.liveOrder.push(lSlug);
    }
    franchise.lives.get(lSlug)!.files.push(toFileSummary(row));
  }

  const tree = franchiseOrder.map((fSlug) => {
    const franchise = franchises.get(fSlug)!;
    return {
      slug: franchise.slug,
      name: franchise.name,
      lives: franchise.liveOrder.map((lSlug) => {
        const live = franchise.lives.get(lSlug)!;
        return {
          slug: live.slug,
          name: live.name,
          poster_url: live.files[0]?.poster_url ?? "",
          files: live.files,
        };
      }),
    };
  });

  return json({ franchises: tree });
}

async function handleVideoDetail(slug: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(`${VIDEO_SELECT} WHERE v.slug = ?`)
    .bind(slug)
    .first<VideoRow>();
  if (!row) return json({ error: "not found" }, 404);
  return json({
    ...row,
    poster_url: `${MEDIA_BASE}/${row.slug}/poster.jpg`,
    m3u8_url: `${MEDIA_BASE}/${row.slug}/master.m3u8`,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/api/login") {
      return handleLogin(env);
    }
    if (pathname === "/api/callback") {
      return handleCallback(request, env);
    }

    if (pathname.startsWith("/api/")) {
      if (!(await requireAuth(request, env))) {
        return json({ error: "unauthorized" }, 401);
      }
      if (pathname === "/api/videos") {
        return handleVideoNav(env);
      }
      const detailMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
      if (detailMatch) {
        return handleVideoDetail(detailMatch[1], env);
      }
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
