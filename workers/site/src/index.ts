export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_BASE_URL: string;
  AUTH_APP_ID: string;
  AUTH_APP_SECRET: string;
  ADMIN_PASSWORDS: string;
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

type JwtPayload = { expire_at?: number; user_email?: string };

// 验签通过且没过期返回 payload，否则 null。播放埋点要从 payload 里取 user_email
// 当观众标识——这个值只能来自服务端验过签的 cookie，不接受客户端自报。
async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
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
  if (!valid) return null;
  const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as JwtPayload;
  const fresh = typeof payload.expire_at === "number" && payload.expire_at > Date.now() / 1000;
  return fresh ? payload : null;
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

async function getSession(request: Request, env: Env): Promise<JwtPayload | null> {
  const jwt = getCookie(request, COOKIE_NAME);
  return jwt ? verifyJwt(jwt, env.AUTH_APP_SECRET) : null;
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

// Max-Age=0 让浏览器立刻丢掉 cookie。Domain/Path 必须跟当初 Set 的完全一致，
// 否则浏览器会认为是另一条 cookie，原来那条纹丝不动。
function handleLogout(): Response {
  const cookie = [
    `${COOKIE_NAME}=`,
    `Domain=${COOKIE_DOMAIN}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0",
  ].join("; ");
  return new Response(null, { status: 302, headers: { Location: "/", "Set-Cookie": cookie } });
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
  poster_file_id: string | null;
};

const VIDEO_SELECT = `
  SELECT v.slug, v.title, v.date, v.duration_seconds, v.segment_count,
         v.franchise_slug, v.franchise_name, v.live_slug, v.live_name, v.poster_file_id,
         (SELECT COUNT(*) FROM segments s WHERE s.slug = v.slug) AS uploaded_segments
  FROM videos v
`;

// poster.jpg 的 URL 只按 slug 固定，但海报内容可以被重新上传替换；
// 不带版本号的话，边缘缓存和浏览器缓存（Cache-Control immutable）会一直吐旧图。
// 带上 file_id 的尾巴当版本号，海报一换 URL 就变，天然绕开缓存，不用手动清缓存。
function posterVersion(fileId: string | null): string {
  return fileId ? `?v=${encodeURIComponent(fileId.slice(-16))}` : "";
}

function toFileSummary(v: VideoRow, progress = 0) {
  return {
    slug: v.slug,
    title: v.title,
    date: v.date,
    duration_seconds: v.duration_seconds,
    segment_count: v.segment_count,
    uploaded_segments: v.uploaded_segments,
    poster_url: `${MEDIA_BASE}/${v.slug}/poster.jpg${posterVersion(v.poster_file_id)}`,
    // 当前登录用户在这个文件上到达过的最远位置。列表卡片据此画进度条，
    // 播放页据此续播——之前这个数只有 /me 页面能看到，从首页点进去永远从 0 开始。
    progress_seconds: progress,
  };
}

// 某个观众在每个 slug 上的最远进度。没登录或没记录就是空表，调用方按 0 处理。
async function getViewerProgress(env: Env, viewerHash: string | null): Promise<Map<string, number>> {
  if (!viewerHash) return new Map();
  const { results } = await env.DB.prepare(
    "SELECT slug, MAX(max_position) AS pos FROM playback_sessions WHERE viewer_hash = ? GROUP BY slug"
  )
    .bind(viewerHash)
    .all<{ slug: string; pos: number }>();
  return new Map((results ?? []).map((r) => [r.slug, r.pos]));
}

// 没有企划/场次归属信息的旧数据兜底分到"未分类"，不会在列表里凭空消失
const UNSORTED_FRANCHISE = { slug: "unsorted", name: "未分类" };

async function buildVideoTree(env: Env, viewerHash: string | null = null) {
  const { results } = await env.DB.prepare(
    `${VIDEO_SELECT} ORDER BY v.franchise_slug, v.date, v.slug`
  ).all<VideoRow>();
  const rows = results ?? [];
  const progress = await getViewerProgress(env, viewerHash);

  const { results: posterRows } = await env.DB.prepare(
    "SELECT franchise_slug, live_slug, poster_file_id FROM live_posters"
  ).all<{ franchise_slug: string; live_slug: string; poster_file_id: string }>();
  const livePosters = new Map(
    (posterRows ?? []).map((r) => [`${r.franchise_slug}/${r.live_slug}`, r.poster_file_id])
  );

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
    franchise.lives.get(lSlug)!.files.push(toFileSummary(row, progress.get(row.slug) ?? 0));
  }

  return franchiseOrder.map((fSlug) => {
    const franchise = franchises.get(fSlug)!;
    return {
      slug: franchise.slug,
      name: franchise.name,
      lives: franchise.liveOrder.map((lSlug) => {
        const live = franchise.lives.get(lSlug)!;
        const livePosterFileId = livePosters.get(`${fSlug}/${lSlug}`);
        const poster_url = livePosterFileId
          ? `${MEDIA_BASE}/live-poster/${fSlug}/${lSlug}.jpg${posterVersion(livePosterFileId)}`
          : live.files[0]?.poster_url ?? "";
        return {
          slug: live.slug,
          name: live.name,
          poster_url,
          files: live.files,
        };
      }),
    };
  });
}

async function handleVideoNav(env: Env, viewerHash: string | null): Promise<Response> {
  const tree = await buildVideoTree(env, viewerHash);
  return json({ franchises: tree });
}

async function handleVideoDetail(
  slug: string,
  env: Env,
  viewerHash: string | null
): Promise<Response> {
  const row = await env.DB.prepare(`${VIDEO_SELECT} WHERE v.slug = ?`)
    .bind(slug)
    .first<VideoRow>();
  if (!row) return json({ error: "not found" }, 404);
  const { poster_file_id, ...rest } = row;
  const progress = await getViewerProgress(env, viewerHash);
  return json({
    ...rest,
    poster_url: `${MEDIA_BASE}/${row.slug}/poster.jpg${posterVersion(poster_file_id)}`,
    m3u8_url: `${MEDIA_BASE}/${row.slug}/master.m3u8`,
    progress_seconds: progress.get(row.slug) ?? 0,
  });
}

// 完播判定阈值：到达 90% 就算看完，留出片尾/演职员表不看完的余量
const COMPLETION_THRESHOLD = 0.9;

async function sha256Hex16(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function handlePlaybackBeacon(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);

  const body = (await request.json().catch(() => null)) as {
    session_id?: string;
    slug?: string;
    watched_seconds?: number;
    position?: number;
    duration?: number;
  } | null;

  const sessionId = body?.session_id;
  const slug = body?.slug;
  if (!sessionId || !slug) return json({ error: "bad request" }, 400);

  const duration = Math.max(0, Number(body?.duration) || 0);
  // 客户端上报的数字一律夹紧：position 不超过片长，watched 不超过片长的 3 倍
  // （允许会话内反复重看），避免脏数据把统计拉飞
  const position = Math.min(Math.max(0, Number(body?.position) || 0), duration || Infinity);
  const watchedCap = duration > 0 ? duration * 3 : 86400;
  const watched = Math.min(Math.max(0, Number(body?.watched_seconds) || 0), watchedCap);

  const viewerHash = session.user_email ? await sha256Hex16(session.user_email) : null;
  const now = Math.floor(Date.now() / 1000);

  // 心跳是幂等 upsert：同一 session_id 反复写同一行，累计值取 MAX 防乱序回退
  await env.DB.prepare(
    `INSERT INTO playback_sessions
       (id, slug, viewer_hash, started_at, updated_at, watched_seconds, max_position, duration_seconds)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at,
       watched_seconds = MAX(playback_sessions.watched_seconds, excluded.watched_seconds),
       max_position = MAX(playback_sessions.max_position, excluded.max_position),
       duration_seconds = MAX(playback_sessions.duration_seconds, excluded.duration_seconds)`
  )
    .bind(sessionId, slug, viewerHash, now, now, watched, position, duration)
    .run();

  return json({ ok: true });
}

// 个人观看数据：viewer_hash 一律由服务端从 cookie 里的邮箱现算，
// 绝不接受客户端传入，否则任何人都能把别人的 hash 填进来看别人的记录。
async function handleMyPlayback(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user_email) return json({ error: "unauthorized" }, 401);
  const viewerHash = await sha256Hex16(session.user_email);

  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_views,
       COUNT(DISTINCT slug) AS watched_videos,
       COALESCE(SUM(watched_seconds), 0) AS total_watch_seconds,
       COALESCE(MAX(updated_at), 0) AS last_viewed_at
     FROM playback_sessions WHERE viewer_hash = ?`
  )
    .bind(viewerHash)
    .first<{
      total_views: number;
      watched_videos: number;
      total_watch_seconds: number;
      last_viewed_at: number;
    }>();

  // 每个视频取该用户所有会话里到达过的最远位置当作"我的进度"
  const { results: videos } = await env.DB.prepare(
    `SELECT
       p.slug,
       COALESCE(v.title, p.slug) AS title,
       v.date AS date,
       COUNT(*) AS views,
       COALESCE(SUM(p.watched_seconds), 0) AS watch_seconds,
       MAX(p.max_position) AS max_position,
       MAX(p.duration_seconds) AS duration_seconds,
       MAX(p.updated_at) AS last_viewed_at
     FROM playback_sessions p
     LEFT JOIN videos v ON v.slug = p.slug
     WHERE p.viewer_hash = ?
     GROUP BY p.slug
     ORDER BY last_viewed_at DESC`
  )
    .bind(viewerHash)
    .all<{
      slug: string;
      title: string;
      date: string | null;
      views: number;
      watch_seconds: number;
      max_position: number;
      duration_seconds: number;
      last_viewed_at: number;
    }>();

  const rows = videos ?? [];
  const completed = rows.filter(
    (r) => r.duration_seconds > 0 && r.max_position >= r.duration_seconds * COMPLETION_THRESHOLD
  ).length;

  return json({
    total_views: totals?.total_views ?? 0,
    watched_videos: totals?.watched_videos ?? 0,
    total_watch_seconds: totals?.total_watch_seconds ?? 0,
    last_viewed_at: totals?.last_viewed_at ?? 0,
    completed_videos: completed,
    completion_threshold: COMPLETION_THRESHOLD,
    videos: rows,
  });
}

// 观众自己清空观看记录。同样只认服务端从 cookie 算出来的 hash，
// 所以谁也删不掉别人的。删完统计口径里那部分播放量也一起消失，这是有意的——
// 声称"你能删"就不能偷偷在别处留一份。
async function handleDeleteMyPlayback(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session?.user_email) return json({ error: "unauthorized" }, 401);
  const viewerHash = await sha256Hex16(session.user_email);
  const result = await env.DB.prepare("DELETE FROM playback_sessions WHERE viewer_hash = ?")
    .bind(viewerHash)
    .run();
  return json({ ok: true, deleted: result.meta?.changes ?? 0 });
}

async function getPlaybackStats(env: Env) {
  const totals = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total_views,
       COUNT(DISTINCT viewer_hash) AS unique_viewers,
       COALESCE(SUM(watched_seconds), 0) AS total_watch_seconds,
       COUNT(DISTINCT slug) AS watched_videos
     FROM playback_sessions`
  ).first<{
    total_views: number;
    unique_viewers: number;
    total_watch_seconds: number;
    watched_videos: number;
  }>();

  // 完播率只在知道片长的会话里算，duration=0 的脏会话不参与分母
  const completion = await env.DB.prepare(
    `SELECT
       COUNT(*) AS rated_views,
       SUM(CASE WHEN max_position >= duration_seconds * ? THEN 1 ELSE 0 END) AS completed_views,
       COALESCE(AVG(MIN(max_position / duration_seconds, 1.0)), 0) AS avg_progress
     FROM playback_sessions
     WHERE duration_seconds > 0`
  )
    .bind(COMPLETION_THRESHOLD)
    .first<{ rated_views: number; completed_views: number; avg_progress: number }>();

  const { results: top } = await env.DB.prepare(
    `SELECT
       p.slug,
       COALESCE(v.title, p.slug) AS title,
       COUNT(*) AS views,
       COUNT(DISTINCT p.viewer_hash) AS unique_viewers,
       COALESCE(SUM(p.watched_seconds), 0) AS watch_seconds,
       COALESCE(AVG(CASE WHEN p.duration_seconds > 0
                         THEN MIN(p.max_position / p.duration_seconds, 1.0) END), 0) AS avg_progress,
       SUM(CASE WHEN p.duration_seconds > 0 AND p.max_position >= p.duration_seconds * ?
                THEN 1 ELSE 0 END) AS completed_views,
       SUM(CASE WHEN p.duration_seconds > 0 THEN 1 ELSE 0 END) AS rated_views,
       MAX(p.updated_at) AS last_viewed_at
     FROM playback_sessions p
     LEFT JOIN videos v ON v.slug = p.slug
     GROUP BY p.slug
     ORDER BY views DESC, watch_seconds DESC
     LIMIT 20`
  )
    .bind(COMPLETION_THRESHOLD)
    .all<{
      slug: string;
      title: string;
      views: number;
      unique_viewers: number;
      watch_seconds: number;
      avg_progress: number;
      completed_views: number;
      rated_views: number;
      last_viewed_at: number;
    }>();

  const since7d = Math.floor(Date.now() / 1000) - 7 * 86400;
  const recent = await env.DB.prepare(
    `SELECT
       COUNT(*) AS views_7d,
       COALESCE(SUM(watched_seconds), 0) AS watch_seconds_7d
     FROM playback_sessions WHERE updated_at >= ?`
  )
    .bind(since7d)
    .first<{ views_7d: number; watch_seconds_7d: number }>();

  return {
    total_views: totals?.total_views ?? 0,
    unique_viewers: totals?.unique_viewers ?? 0,
    total_watch_seconds: totals?.total_watch_seconds ?? 0,
    watched_videos: totals?.watched_videos ?? 0,
    views_7d: recent?.views_7d ?? 0,
    watch_seconds_7d: recent?.watch_seconds_7d ?? 0,
    rated_views: completion?.rated_views ?? 0,
    completed_views: completion?.completed_views ?? 0,
    avg_progress: completion?.avg_progress ?? 0,
    completion_threshold: COMPLETION_THRESHOLD,
    top_videos: top ?? [],
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

function checkAdminPassword(password: string, env: Env): boolean {
  const validPasswords = env.ADMIN_PASSWORDS.split(",").map((p) => p.trim()).filter(Boolean);
  return validPasswords.length > 0 && validPasswords.some((p) => timingSafeEqual(password, p));
}

// 密码只在"换 token"的那一次出现。前端存的是这个有期限的 token，不是密码本身，
// 被 XSS 或共用浏览器捞走也只是有限时间的读权限，且改一次 ADMIN_PASSWORDS 无法吊销
// ——所以额外用 AUTH_APP_SECRET 签名，密钥一换全部 token 立刻失效。
const ADMIN_TOKEN_TTL_SECONDS = 12 * 60 * 60;
const ADMIN_MAX_FAILURES = 8;
const ADMIN_FAILURE_WINDOW_SECONDS = 15 * 60;

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function issueAdminToken(env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ADMIN_TOKEN_TTL_SECONDS;
  return `${exp}.${await hmacHex(env.AUTH_APP_SECRET, `admin:${exp}`)}`;
}

async function verifyAdminToken(token: string, env: Env): Promise<boolean> {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp <= Date.now() / 1000 || !sig) return false;
  return timingSafeEqual(sig, await hmacHex(env.AUTH_APP_SECRET, `admin:${exp}`));
}

async function recentAdminFailures(env: Env, ip: string): Promise<number> {
  const since = Math.floor(Date.now() / 1000) - ADMIN_FAILURE_WINDOW_SECONDS;
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM admin_login_attempts WHERE ip = ? AND ts >= ?"
  )
    .bind(ip, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** 认证结果：ok 时带上新签的 token（用密码换来的那次才有）；失败时直接是要返回的响应。 */
type AdminAuth = { token?: string } | Response;

async function authorizeAdmin(request: Request, env: Env, body: unknown): Promise<AdminAuth> {
  const { password = "", token = "" } = (body ?? {}) as { password?: string; token?: string };

  if (token && (await verifyAdminToken(token, env))) return {};
  if (!password) return json({ error: "unauthorized" }, 401);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  if ((await recentAdminFailures(env, ip)) >= ADMIN_MAX_FAILURES) {
    return json({ error: "too many attempts, try again later" }, 429);
  }

  if (!checkAdminPassword(password, env)) {
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO admin_login_attempts (ip, ts) VALUES (?, ?)").bind(ip, now),
      // 顺手清掉过期记录，不另开定时任务
      env.DB.prepare("DELETE FROM admin_login_attempts WHERE ts < ?").bind(
        now - ADMIN_FAILURE_WINDOW_SECONDS
      ),
    ]);
    return json({ error: "unauthorized" }, 401);
  }

  await env.DB.prepare("DELETE FROM admin_login_attempts WHERE ip = ?").bind(ip).run();
  return { token: await issueAdminToken(env) };
}

async function getContentStats(env: Env) {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(DISTINCT COALESCE(franchise_slug, 'unsorted')) AS franchises,
       COUNT(DISTINCT COALESCE(franchise_slug, 'unsorted') || '/' || COALESCE(live_slug, slug)) AS lives,
       COUNT(*) AS videos,
       COALESCE(SUM(duration_seconds), 0) AS total_duration_seconds,
       COALESCE(SUM(segment_count), 0) AS total_segments,
       COALESCE(MIN(date), '') AS earliest_date,
       COALESCE(MAX(date), '') AS latest_date
     FROM videos`
  ).first<{
    franchises: number;
    lives: number;
    videos: number;
    total_duration_seconds: number;
    total_segments: number;
    earliest_date: string;
    latest_date: string;
  }>();

  // 已上传分段数走 segments 表实时算，跟 videos.segment_count（切片时写死的目标值）
  // 对比就是全站上传进度；未完成的视频数也从这个差值来，不另存状态列。
  const progress = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM segments) AS uploaded_segments,
       (SELECT COUNT(*) FROM videos v
         WHERE (SELECT COUNT(*) FROM segments s WHERE s.slug = v.slug) < v.segment_count
       ) AS incomplete_videos`
  ).first<{ uploaded_segments: number; incomplete_videos: number }>();

  const posters = await env.DB.prepare(
    "SELECT COUNT(*) AS custom_live_posters FROM live_posters"
  ).first<{ custom_live_posters: number }>();

  return {
    ...row,
    uploaded_segments: progress?.uploaded_segments ?? 0,
    incomplete_videos: progress?.incomplete_videos ?? 0,
    custom_live_posters: posters?.custom_live_posters ?? 0,
  };
}

// 上游 auth 网关只认密码。用 token 进来的请求手里没有密码，就拿本地配置的第一个顶上
// ——本 worker 已经独立验过身份了，这一步只是代它去取账号数据。
function upstreamAdminPassword(env: Env, provided: string): string {
  return provided || env.ADMIN_PASSWORDS.split(",")[0]?.trim() || "";
}

async function handleAdminStats(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { password?: string; token?: string } | null;
  const auth = await authorizeAdmin(request, env, body);
  if (auth instanceof Response) return auth;

  const password = upstreamAdminPassword(env, body?.password ?? "");
  const [content, videos, playback, userStatsRes] = await Promise.all([
    getContentStats(env),
    buildVideoTree(env),
    getPlaybackStats(env).catch(() => null),
    fetch(`${env.AUTH_BASE_URL}/api/admin/stats`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    }).catch(() => null),
  ]);

  const users = userStatsRes?.ok ? await userStatsRes.json() : null;

  return json({ content, videos, playback, users, token: auth.token });
}

// 账号明细列表单独一个接口：数据量比统计大，只有前端切到"账号"页签才拉，
// 密码同样只在服务端转发给 auth 网关，不经浏览器直连跨域。
async function handleAdminUsers(request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => null)) as
    | { password?: string; token?: string; limit?: number; offset?: number; query?: string }
    | null;
  const auth = await authorizeAdmin(request, env, body);
  if (auth instanceof Response) return auth;

  const res = await fetch(`${env.AUTH_BASE_URL}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      password: upstreamAdminPassword(env, body?.password ?? ""),
      limit: body?.limit ?? 50,
      offset: body?.offset ?? 0,
      query: body?.query ?? "",
    }),
  }).catch(() => null);

  if (!res?.ok) {
    return json({ error: "auth gateway unavailable", results: [], count: 0 }, 502);
  }
  return json(await res.json());
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
    // 登出要在鉴权之前：cookie 已经过期的人同样得能把它清掉
    if (pathname === "/api/logout") {
      return handleLogout();
    }

    if (pathname === "/api/admin/stats" && request.method === "POST") {
      return handleAdminStats(request, env);
    }
    if (pathname === "/api/admin/users" && request.method === "POST") {
      return handleAdminUsers(request, env);
    }

    if (pathname.startsWith("/api/")) {
      const session = await getSession(request, env);
      if (!session) {
        return json({ error: "unauthorized" }, 401);
      }
      const viewerHash = session.user_email ? await sha256Hex16(session.user_email) : null;
      if (pathname === "/api/videos") {
        return handleVideoNav(env, viewerHash);
      }
      if (pathname === "/api/playback" && request.method === "POST") {
        return handlePlaybackBeacon(request, env);
      }
      if (pathname === "/api/me/playback") {
        return request.method === "DELETE"
          ? handleDeleteMyPlayback(request, env)
          : handleMyPlayback(request, env);
      }
      const detailMatch = pathname.match(/^\/api\/videos\/([^/]+)$/);
      if (detailMatch) {
        return handleVideoDetail(detailMatch[1], env, viewerHash);
      }
      return json({ error: "not found" }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};
