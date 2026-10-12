#!/usr/bin/env node
/**
 * Mock TDS backend for exercising the dashboard and XR board without Postgres,
 * collectors or hardware. Zero dependencies. DEVELOPMENT ONLY.
 *
 *   node scripts/mock-tds-backend.mjs [--port 8787] [--host 127.0.0.1] [--static ../backend/app/static] [--log-dir ./logs]
 *   TDS_DEV_BACKEND=http://127.0.0.1:8787 npm run dev
 *
 * Every entity it serves is synthetic. The site is tagged source:"mock", so the
 * frontend labels everything "DEMO · MOCK BACKEND", never LIVE.
 *
 * With --static it also serves a built frontend (/vr, /dashboard, /static/*) so a
 * single process hosts a complete demo, e.g. behind an HTTPS reverse proxy.
 *
 * Failure injection (to verify ERROR / STALE / reconnect presentation):
 *   curl 'http://127.0.0.1:8787/__mock/mode?set=error'   # every /v1 call returns 503
 *   curl 'http://127.0.0.1:8787/__mock/mode?set=live'    # recover
 *   curl 'http://127.0.0.1:8787/__mock/mode?set=rf-error'# only /v1/map/rf fails
 * Stop/restart the process to exercise disconnect/reconnect.
 */
import { createServer } from "node:http";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
}
const PORT = Number(arg("--port", process.env.PORT ?? 8787));
const HOST = arg("--host", process.env.HOST ?? "127.0.0.1");
// Optional: serve a built frontend (backend/app/static) so one process hosts the whole demo.
const STATIC_DIR = arg("--static", process.env.TDS_STATIC_DIR ?? null);
// Optional: accept headset diagnostics at POST /xr-log (same JSONL format as the gateway, 20 MB/day cap).
const LOG_DIR = arg("--log-dir", process.env.TDS_MOCK_LOG_DIR ?? null);
const LOG_MAX_BYTES = 20 * 1024 * 1024;
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
  const root = resolve(STATIC_DIR);
  let relative = null;
  if (pathname.startsWith("/static/")) relative = pathname.slice("/static/".length);
  else if (pathname === "/favicon.ico") relative = "favicon.ico";
  else if (SPA_ROUTES.has(pathname) || pathname.startsWith("/presence/")) relative = "index.html";
  if (relative === null) return false;
  const file = normalize(join(root, decodeURIComponent(relative)));
  if (file !== root && !file.startsWith(root + sep)) return false;
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": relative === "index.html" ? "no-cache" : "public, max-age=3600"
    });
    response.end(body);
    return true;
  } catch {
    return false;
  }
}
const SITE = { latitude: 39.1, longitude: -77.17, label: "Mock site (synthetic)", source: "mock" };
const METERS_PER_DEG_LAT = 111_320;
const METERS_PER_DEG_LON = METERS_PER_DEG_LAT * Math.cos((SITE.latitude * Math.PI) / 180);

let mode = "live";

function offset(eastMeters, northMeters) {
  return { latitude: SITE.latitude + northMeters / METERS_PER_DEG_LAT, longitude: SITE.longitude + eastMeters / METERS_PER_DEG_LON };
}

function iso(secondsAgo) {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

function rf(identity, label, category, east, north, rssi, extra = {}) {
  return {
    identity,
    label,
    protocol: category === "unknown_rf" ? "subghz" : category === "utility" ? "ism" : category,
    kind: category === "unknown_rf" ? "spectrum_peak" : "device",
    source: extra.source ?? "kismet",
    category,
    ...offset(east, north),
    location_accuracy: extra.accuracy ?? "estimated",
    estimated: (extra.accuracy ?? "estimated") === "estimated",
    rssi,
    channel: category === "wifi" ? "36" : null,
    frequency: category === "unknown_rf" || category === "utility" ? "433.92" : null,
    manufacturer: extra.manufacturer ?? null,
    first_seen_at: iso(3600),
    last_seen_at: iso(extra.ageSeconds ?? 20),
    count: extra.count ?? 12,
    freshness: extra.freshness ?? "live",
    operator_context: extra.operator_context ?? null
  };
}

function rfItems() {
  const items = [
    rf("aa:bb:cc:00:00:01", "Kitchen tablet", "wifi", 4, 6, -48, { source: "kismet+unifi", accuracy: "real", manufacturer: "Mock Corp" }),
    rf("aa:bb:cc:00:00:02", "Office laptop", "wifi", -6, -12, -55, { source: "unifi" }),
    rf("aa:bb:cc:00:00:03", "Watched phone", "ble", 12, 3, -61, { operator_context: { headline: "Tracked: frequent visitor", chips: [{ label: "watch", tone: "warn" }] } }),
    rf("aa:bb:cc:00:00:04", "BLE tag stairwell", "ble", -3, 18, -70),
    rf("aa:bb:cc:00:00:05", "Neighbor AP", "wifi", 30, -22, -82, { source: "kismet" }),
    rf("unknown-433-front", "Unknown 433 MHz burst", "unknown_rf", 18, 25, -77, { source: "intercept" }),
    rf("unknown-915-rear", "Unknown 915 MHz", "unknown_rf", -25, -30, null, { source: "intercept", freshness: "stale", ageSeconds: 1800 }),
    rf("receiver-core", "Receiver core", "infrastructure", 0, 0, null, { source: "intercept", accuracy: "receiver" }),
    rf("meter-rear", "Utility meter", "utility", -14, -26, -74, { source: "intercept" }),
    rf("zigbee-hub", "Zigbee hub", "iot", 2, -4, -58),
    rf("old-phone", "Old phone (gone quiet)", "ble", 22, 14, -88, { freshness: "expired", ageSeconds: 7200 })
  ];
  for (let index = 0; index < 60; index += 1) {
    const angle = (index * 137.5 * Math.PI) / 180;
    const distance = 15 + ((index * 7) % 40);
    items.push(rf(`mock-wifi-${index}`, `Wi-Fi client ${index}`, index % 3 === 0 ? "ble" : "wifi", Math.sin(angle) * distance, Math.cos(angle) * distance, -60 - (index % 30), { freshness: index % 5 === 0 ? "stale" : "live" }));
  }
  return items;
}

function aircraftItems() {
  const make = (identity, callsign, east, north, altitude, heading, speed) => ({
    identity,
    callsign,
    model: "A320",
    owner: "Mock Air",
    icao_type: "A320",
    registration: `N${identity.slice(0, 4)}`,
    country: "United States",
    squawk: "1200",
    ...offset(east, north),
    altitude,
    speed,
    heading,
    source: "adsb",
    protocol: "adsb",
    first_seen_at: iso(600),
    last_seen_at: iso(5),
    count: 40
  });
  return [make("A1B2C3", "MCK101", 9000, 4000, 12500, 240, 310), make("D4E5F6", "MCK202", -15000, 22000, 34000, 120, 440), make("0A0B0C", "N123AB", 3000, -2500, 2500, 15, 110)];
}

function stateItems(source, ageSeconds) {
  return Array.from({ length: 6 }, (_, index) => ({
    state_key: `${source}:mock-${index}`,
    source,
    kind: "device",
    protocol: source === "intercept" ? "subghz" : "wifi",
    identity_hint: `aa:bb:cc:00:00:0${index + 1}`,
    sensor_id: `${source}-sensor`,
    zone_id: null,
    seen_count: 4,
    metadata: {},
    raw_payload: {},
    first_seen_at: iso(ageSeconds + 600),
    last_seen_at: iso(ageSeconds)
  }));
}

const events = () => [
  {
    id: "mock-evt-critical",
    type: "openwrt_alarm",
    severity: "critical",
    confidence: 0.9,
    zone_id: null,
    summary: "WAN link down (synthetic)",
    observation_refs: [],
    payload: { source: "openwrt", name: "wan_down" },
    created_at: iso(90)
  },
  {
    id: "mock-evt-info",
    type: "unifi_alarm",
    severity: "info",
    confidence: 0.5,
    zone_id: null,
    summary: "Client roamed (synthetic)",
    observation_refs: [],
    payload: { source: "unifi" },
    created_at: iso(30)
  }
];

const empty = { items: [], count: 0 };

function route(url) {
  const path = url.pathname;
  if (path === "/v1/map/rf") return { items: rfItems(), count: rfItems().length, site: SITE };
  if (path === "/v1/map/aircraft") return { items: aircraftItems(), count: 3, site: SITE };
  if (path === "/v1/dashboard/summary") return { counts: { observations: 1200, events: 2, current_state: 24, sensors: 4, zones: 3, collectors: 4 }, recent_events: [] };
  if (path === "/v1/presence/briefing/changes")
    return { window_seconds: 300, severity: "info", summary: "Synthetic mock briefing", new_entities: 2, recent_events: 2, departed_tracked: 0, top_sources: [{ source: "kismet", count: 40 }], items: [] };
  if (path === "/v1/presence/sensor-coverage") return { items: [], count: 0, live_sensors: 3, blind_spots: [] };
  if (path === "/v1/events") {
    const type = url.searchParams.get("type");
    const items = events().filter((event) => !type || event.type === type);
    return { items, count: items.length };
  }
  if (path === "/v1/state") {
    const source = url.searchParams.get("source");
    // Kismet is deliberately stale (2 h) so collector degradation is visible.
    const ages = { openwrt: 30, unifi: 45, kismet: 7200, intercept: 60 };
    if (source && source in ages) return { items: stateItems(source, ages[source]), count: 6 };
    return empty;
  }
  if (path === "/v1/network/clients") return empty;
  if (path.startsWith("/v1/presence/dossier") || path.startsWith("/v1/presence/entities")) return null;
  if (path.startsWith("/v1/")) return empty;
  return null;
}

async function acceptXRLog(request, send) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 64 * 1024) return send(413, { detail: "too large" });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return send(400, { detail: "invalid JSON" });
  }
  const meta = {
    received: new Date().toISOString(),
    client: String(request.headers["x-forwarded-for"] ?? request.socket.remoteAddress ?? "").slice(0, 100),
    session: String(payload?.session ?? "").slice(0, 64),
    page: String(payload?.page ?? "").slice(0, 200),
    ua: String(request.headers["user-agent"] ?? "").slice(0, 300)
  };
  const entries = Array.isArray(payload?.entries) ? payload.entries.slice(0, 200) : [];
  const lines = entries.map((entry) => JSON.stringify({ ...meta, at: String(entry?.at ?? ""), level: String(entry?.level ?? "info"), message: String(entry?.message ?? "").slice(0, 2000) })).join("\n");
  if (lines) {
    await mkdir(LOG_DIR, { recursive: true });
    const file = join(LOG_DIR, `xr-${meta.received.slice(0, 10)}.jsonl`);
    const size = await stat(file).then((info) => info.size).catch(() => 0);
    if (size + lines.length > LOG_MAX_BYTES) return send(429, { detail: "daily XR log cap reached" });
    await appendFile(file, lines + "\n");
  }
  return send(204);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const send = (status, body) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store"
    });
    response.end(body === undefined ? "" : JSON.stringify(body));
  };
  if (url.pathname === "/__mock/mode") {
    const next = url.searchParams.get("set");
    if (next && ["live", "error", "rf-error"].includes(next)) {
      mode = next;
      console.log(`[mock-tds] mode -> ${mode}`);
    }
    return send(200, { mode });
  }
  if (url.pathname === "/health") return send(mode === "error" ? 503 : 200, { status: mode === "error" ? "error" : "ok", mock: true });
  if (LOG_DIR && url.pathname === "/xr-log" && request.method === "POST") return acceptXRLog(request, send);
  if (request.method !== "GET") return send(405, { detail: "mock backend is read-only" });
  if (!url.pathname.startsWith("/v1/") && (await serveStatic(url.pathname, response))) return;
  if (mode === "error" && url.pathname.startsWith("/v1/")) return send(503, { detail: "mock backend: injected failure" });
  if (mode === "rf-error" && url.pathname === "/v1/map/rf") return send(503, { detail: "mock backend: injected RF failure" });
  const body = route(url);
  if (body === null) return send(404, { detail: "not found" });
  return send(200, body);
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-tds] synthetic TDS backend on http://${HOST}:${PORT} (mode=${mode})${STATIC_DIR ? ` serving ${STATIC_DIR}` : ""}`);
});
