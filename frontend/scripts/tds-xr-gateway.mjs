#!/usr/bin/env node
/**
 * TDS XR gateway: the only thing that should face the network (or a public
 * HTTPS reverse proxy). Zero dependencies.
 *
 *  - Requires a login (password -> signed, HttpOnly session cookie).
 *  - Serves the built frontend (backend/app/static) for /vr, /dashboard, ...
 *  - Proxies an allowlist of /v1 routes to the TDS API (or the mock backend).
 *    Reads are allowed; writes depend on TDS_GATEWAY_ALLOW_WRITES. Ingestion
 *    (/v1/observations) and webhooks are never forwarded: collectors talk to
 *    the API directly on the LAN.
 *  - Accepts XR diagnostic logs from headsets at POST /xr-log and appends them
 *    to TDS_GATEWAY_LOG_DIR/xr-YYYY-MM-DD.jsonl (readable over SSH).
 *
 * Environment:
 *   TDS_GATEWAY_PORT (8089)  TDS_GATEWAY_HOST (0.0.0.0)
 *   TDS_GATEWAY_UPSTREAM (http://127.0.0.1:8080)  TDS_GATEWAY_STATIC (dir)
 *   TDS_GATEWAY_AUTH on|off (off). TDS is meant to be hosted locally, so there is
 *     no login by default; "on" adds a single-password login page.
 *   TDS_GATEWAY_PASSWORD, TDS_GATEWAY_SECRET (32+ chars): required when AUTH is on
 *   TDS_GATEWAY_ALLOW_WRITES none|presence|all (presence)
 *   TDS_GATEWAY_LOG_DIR (./logs)  TDS_GATEWAY_SESSION_DAYS (30)
 *   TDS_GATEWAY_TRUSTED_PROXIES  comma-separated reverse-proxy IPs whose
 *     X-Forwarded-For is trusted (default: none; the socket address is used)
 *   TDS_GATEWAY_LOG_MAX_MB (20 per day)  TDS_GATEWAY_LOG_KEEP_DAYS (14)
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHmac, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const env = process.env;
const PORT = Number(env.TDS_GATEWAY_PORT ?? 8089);
const HOST = env.TDS_GATEWAY_HOST ?? "0.0.0.0";
const UPSTREAM = new URL(env.TDS_GATEWAY_UPSTREAM ?? "http://127.0.0.1:8080");
const STATIC_DIR = env.TDS_GATEWAY_STATIC ? resolve(env.TDS_GATEWAY_STATIC) : null;
const AUTH = (env.TDS_GATEWAY_AUTH ?? "off").toLowerCase() === "on";
const PASSWORD = env.TDS_GATEWAY_PASSWORD ?? "";
const SECRET = env.TDS_GATEWAY_SECRET ?? "";
const WRITES = env.TDS_GATEWAY_ALLOW_WRITES ?? "presence";
const LOG_DIR = resolve(env.TDS_GATEWAY_LOG_DIR ?? "./logs");
const SESSION_MS = Number(env.TDS_GATEWAY_SESSION_DAYS ?? 30) * 86_400_000;
const COOKIE = "tds_session";
const TRUSTED_PROXIES = new Set((env.TDS_GATEWAY_TRUSTED_PROXIES ?? "").split(",").map((value) => value.trim()).filter(Boolean));
const LOG_MAX_BYTES = Number(env.TDS_GATEWAY_LOG_MAX_MB ?? 20) * 1024 * 1024;
const LOG_KEEP_DAYS = Number(env.TDS_GATEWAY_LOG_KEEP_DAYS ?? 14);


// ------------------------------------------------------------------ policy (exported for tests)

const PRESENCE_WRITE_PATTERNS = [
  /^\/v1\/presence\/watchlist(\/[^/]+)?$/,
  /^\/v1\/presence\/cases\/notes$/,
  /^\/v1\/presence\/identity-decisions$/,
  /^\/v1\/presence\/entities\/[^/]+\/(annotations|enrichment)$/,
  /^\/v1\/presence\/playbooks\/[^/]+\/runs$/
];
const NEVER_FORWARD = [/^\/v1\/observations(\/|$)/, /^\/v1\/webhooks(\/|$)/];

/**
 * Decode and canonicalise a request path ONCE so the policy sees what the
 * upstream will route. Returns null for anything ambiguous (malformed escapes,
 * backslashes, NUL, empty or dot segments), which is then rejected.
 */
export function canonicalApiPath(rawPathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }
  if (/[\\\u0000-\u001f;]/.test(decoded)) return null;
  const segments = decoded.split("/").slice(1);
  if (segments.some((segment, index) => segment === "." || segment === ".." || (segment === "" && index < segments.length - 1))) return null;
  return "/" + segments.join("/");
}

/** Decide whether a /v1 request may be forwarded. Returns null when allowed, else a reason. */
export function apiPolicy(method, rawPathname, writes = WRITES) {
  const pathname = canonicalApiPath(rawPathname);
  if (pathname === null) return "malformed path";
  method = String(method).toUpperCase();
  if (!pathname.startsWith("/v1/")) return "not an API route";
  if (NEVER_FORWARD.some((pattern) => pattern.test(pathname))) {
    return method === "GET" && /^\/v1\/observations(\?|$)/.test(pathname) ? null : "ingestion and webhooks are LAN-only";
  }
  if (method === "GET" || method === "HEAD") return null;
  if (writes === "all") return null;
  if (writes === "presence" && PRESENCE_WRITE_PATTERNS.some((pattern) => pattern.test(pathname))) return null;
  return `writes are disabled for ${pathname} (TDS_GATEWAY_ALLOW_WRITES=${writes})`;
}

// ------------------------------------------------------------------ sessions

function sign(value) {
  return createHmac("sha256", SECRET).update(value).digest("base64url");
}

function issueSession() {
  const expires = String(Date.now() + SESSION_MS);
  return `${expires}.${sign(expires)}`;
}

function validSession(token) {
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = Buffer.from(sign(expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function cookies(request) {
  return Object.fromEntries(
    (request.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])
  );
}

function passwordMatches(candidate) {
  const a = createHmac("sha256", SECRET).update(String(candidate)).digest();
  const b = createHmac("sha256", SECRET).update(PASSWORD).digest();
  return timingSafeEqual(a, b);
}

const failures = new Map();
/**
 * Client address for rate limiting/logs. X-Forwarded-For is only trusted when the
 * connection comes from a configured reverse proxy (TDS_GATEWAY_TRUSTED_PROXIES);
 * then the LAST hop (added by that proxy) is used. Otherwise the socket address.
 */
function clientKey(request) {
  const remote = (request.socket.remoteAddress ?? "unknown").replace(/^::ffff:/, "");
  if (!TRUSTED_PROXIES.has(remote)) return remote;
  const hops = String(request.headers["x-forwarded-for"] ?? "").split(",").map((hop) => hop.trim()).filter(Boolean);
  return hops[hops.length - 1] || remote;
}

const WINDOW_MS = 15 * 60_000;
const PER_CLIENT_LIMIT = 10;
/** Global cap: even with many client addresses, at most this many failed logins per window. */
const GLOBAL_LIMIT = 100;
let globalFailures = { count: 0, first: Date.now() };

function rateLimited(key) {
  const now = Date.now();
  if (now - globalFailures.first > WINDOW_MS) globalFailures = { count: 0, first: now };
  if (globalFailures.count >= GLOBAL_LIMIT) return true;
  const entry = failures.get(key);
  return Boolean(entry && entry.count >= PER_CLIENT_LIMIT && now - entry.first < WINDOW_MS);
}
function recordFailure(key) {
  const now = Date.now();
  globalFailures.count += 1;
  if (failures.size > 5000) {
    // Evict expired entries so the map cannot grow without bound.
    for (const [candidate, entry] of failures) if (now - entry.first > WINDOW_MS) failures.delete(candidate);
    if (failures.size > 5000) failures.clear();
  }
  const entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: now });
  else entry.count += 1;
}

// ------------------------------------------------------------------ responses

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY"
};

function send(response, status, body, headers = {}) {
  const isString = typeof body === "string";
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": isString ? "text/html; charset=utf-8" : "application/json",
    "cache-control": "no-store",
    ...headers
  });
  response.end(isString ? body : JSON.stringify(body));
}

function loginPage(next, error) {
  const escaped = (value) => String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TDS login</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#06080a;color:#dcefff;font:16px system-ui,sans-serif}
form{display:grid;gap:14px;padding:28px;border:1px solid #1d4a4f;border-radius:12px;background:#061114;width:min(340px,90vw)}
h1{margin:0;color:#7df2e6;font-size:22px}input,button{font:inherit;padding:14px;border-radius:8px;border:1px solid #1d4a4f}
input{background:#0b1d22;color:#dcefff}button{background:#7df2e6;color:#061114;font-weight:600;cursor:pointer}p{margin:0;color:#ff4d6d}
</style></head><body><form method="post" action="/login"><h1>TDS</h1>
<input type="hidden" name="next" value="${escaped(next)}">
<input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus required>
${error ? `<p>${escaped(error)}</p>` : ""}<button type="submit">Sign in</button></form></body></html>`;
}

/** Only same-origin, path-only redirect targets (no //host, no backslashes, no control chars). */
export function safeNext(value) {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\u0000-\u001f\u007f]/.test(value)) return "/vr";
  try {
    const url = new URL(value, "http://gateway.local");
    return url.origin === "http://gateway.local" ? url.pathname + url.search : "/vr";
  } catch {
    return "/vr";
  }
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ------------------------------------------------------------------ static files

const SPA_ROUTES = new Set(["/", "/dashboard", "/vr", "/mr", "/xr", "/lte", "/settings", "/setting", "/presence", "/presence/graph"]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".md": "text/plain; charset=utf-8"
};

async function serveStatic(pathname, response) {
  if (!STATIC_DIR) return false;
  let relative = null;
  if (pathname.startsWith("/static/")) relative = pathname.slice("/static/".length);
  else if (pathname === "/favicon.ico") relative = "favicon.ico";
  else if (SPA_ROUTES.has(pathname) || pathname.startsWith("/presence/")) relative = "index.html";
  if (relative === null) return false;
  let file;
  try {
    file = normalize(join(STATIC_DIR, decodeURIComponent(relative)));
  } catch {
    return false;
  }
  if (file !== STATIC_DIR && !file.startsWith(STATIC_DIR + sep)) return false;
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      // index.html must revalidate so headsets never keep a stale build.
      "cache-control": relative === "index.html" ? "no-cache, must-revalidate" : relative.startsWith("assets/") ? "public, max-age=31536000, immutable" : "public, max-age=300"
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ proxy

function proxy(request, response, url) {
  const client = UPSTREAM.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = { ...request.headers, host: UPSTREAM.host, "x-forwarded-for": clientKey(request) };
  delete headers.cookie;
  delete headers.authorization;
  const upstream = client(
    { protocol: UPSTREAM.protocol, hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: request.method, path: url.pathname + url.search, headers },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, { ...upstreamResponse.headers, ...SECURITY_HEADERS });
      upstreamResponse.pipe(response);
    }
  );
  upstream.on("error", (error) => send(response, 502, { detail: `TDS API unreachable: ${error.message}` }));
  request.pipe(upstream);
}

// ------------------------------------------------------------------ xr logs

async function acceptXRLog(request, response) {
  let payload;
  try {
    payload = JSON.parse(await readBody(request, 64 * 1024));
  } catch (error) {
    return send(response, 400, { detail: String(error.message ?? error) });
  }
  const entries = Array.isArray(payload?.entries) ? payload.entries.slice(0, 200) : [];
  const meta = {
    received: new Date().toISOString(),
    client: clientKey(request),
    session: String(payload?.session ?? "").slice(0, 64),
    page: String(payload?.page ?? "").slice(0, 200),
    ua: String(request.headers["user-agent"] ?? "").slice(0, 300)
  };
  const lines = entries.map((entry) => JSON.stringify({ ...meta, at: String(entry?.at ?? ""), level: String(entry?.level ?? "info"), message: String(entry?.message ?? "").slice(0, 2000) })).join("\n");
  if (lines) {
    await mkdir(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `xr-${meta.received.slice(0, 10)}.jsonl`);
    const size = await stat(file).then((info) => info.size).catch(() => 0);
    if (size + lines.length > LOG_MAX_BYTES) {
      return send(response, 429, { detail: "daily XR log cap reached" });
    }
    await appendFile(file, lines + "\n");
    void pruneOldLogs();
  }
  send(response, 204, "");
}

let lastPrune = 0;
async function pruneOldLogs() {
  if (Date.now() - lastPrune < 3_600_000) return;
  lastPrune = Date.now();
  const cutoff = new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  for (const name of await readdir(LOG_DIR).catch(() => [])) {
    const match = /^xr-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (match && match[1] < cutoff) await unlink(join(LOG_DIR, name)).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ server

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://gateway.local");
  const path = url.pathname;
  try {
    if (path === "/healthz") return send(response, 200, { status: "ok" });

    if (!AUTH && (path === "/login" || path === "/logout")) {
      return send(response, 303, "", { location: safeNext(url.searchParams.get("next")) });
    }
    if (path === "/login" && request.method === "GET") {
      return send(response, 200, loginPage(safeNext(url.searchParams.get("next")), null));
    }
    if (path === "/login" && request.method === "POST") {
      const key = clientKey(request);
      if (rateLimited(key)) return send(response, 429, loginPage("/vr", "Too many attempts. Wait 15 minutes."));
      const form = new URLSearchParams(await readBody(request, 4096));
      const next = safeNext(form.get("next"));
      if (!passwordMatches(form.get("password") ?? "")) {
        recordFailure(key);
        return send(response, 401, loginPage(next, "Wrong password."));
      }
      failures.delete(key);
      const secure = request.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
      return send(response, 303, "", {
        location: next,
        "set-cookie": `${COOKIE}=${encodeURIComponent(issueSession())}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`
      });
    }
    if (path === "/logout") {
      return send(response, 303, "", { location: "/login", "set-cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
    }

    if (AUTH && !validSession(cookies(request)[COOKIE])) {
      if (path.startsWith("/v1/") || path === "/xr-log") return send(response, 401, { detail: "login required" });
      if (path.startsWith("/static/")) return send(response, 401, { detail: "login required" });
      return send(response, 303, "", { location: `/login?next=${encodeURIComponent(path + url.search)}` });
    }

    if (path === "/xr-log" && request.method === "POST") return await acceptXRLog(request, response);
    if (path.startsWith("/v1/")) {
      const denied = apiPolicy(request.method ?? "GET", path);
      if (denied) return send(response, 403, { detail: denied });
      return proxy(request, response, url);
    }
    if (request.method === "GET" && (await serveStatic(path, response))) return;
    return send(response, 404, { detail: "not found" });
  } catch (error) {
    console.error("[tds-gateway]", error);
    if (!response.headersSent) send(response, 500, { detail: "gateway error" });
  }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  if (AUTH && (PASSWORD.length < 8 || SECRET.length < 32)) {
    console.error("[tds-gateway] refusing to start: set TDS_GATEWAY_PASSWORD (8+ chars) and TDS_GATEWAY_SECRET (32+ chars), or TDS_GATEWAY_AUTH=off");
    process.exit(1);
  }
  process.on("unhandledRejection", (error) => console.error("[tds-gateway] unhandled rejection", error));
  server.listen(PORT, HOST, () => {
    console.log(`[tds-gateway] http://${HOST}:${PORT} -> ${UPSTREAM.origin} (auth: ${AUTH ? "password" : "off"}, writes: ${WRITES}, logs: ${LOG_DIR}${STATIC_DIR ? `, static: ${STATIC_DIR}` : ""})`);
  });
}
