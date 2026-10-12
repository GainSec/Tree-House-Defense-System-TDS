#!/usr/bin/env node
/**
 * Demo seeder for a real TDS backend. It feeds realistic but SYNTHETIC
 * observations through the public ingestion API (POST /v1/observations, the
 * UniFi alarm webhook, the presence watchlist), so data flows through the real
 * pipeline: ingestion -> rules/events -> current state -> map endpoints.
 *
 * The site label is "Seeded demo site" so the data is identifiable. Stop the
 * seeder (compose profile "seed") when real collectors are attached.
 *
 * Env: TDS_API (http://api:8080), TDS_INGEST_API_KEY (required),
 *      TDS_SEED_INTERVAL_SECONDS (60), TDS_SEED_LAT / TDS_SEED_LON.
 */
const API = (process.env.TDS_API ?? "http://api:8080").replace(/\/$/, "");
const KEY = process.env.TDS_INGEST_API_KEY ?? "";
const INTERVAL = Number(process.env.TDS_SEED_INTERVAL_SECONDS ?? 60) * 1000;
const SITE = { latitude: Number(process.env.TDS_SEED_LAT ?? 35.1), longitude: Number(process.env.TDS_SEED_LON ?? -75.17) };
const M_LAT = 111_320;
const M_LON = M_LAT * Math.cos((SITE.latitude * Math.PI) / 180);

if (!KEY) {
  console.error("[tds-seed] TDS_INGEST_API_KEY is required");
  process.exit(1);
}

const at = (east, north) => ({ lat: SITE.latitude + north / M_LAT, lon: SITE.longitude + east / M_LON });
const iso = (secondsAgo = 0) => new Date(Date.now() - secondsAgo * 1000).toISOString();

async function call(method, path, body, headers = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json().catch(() => null);
}

const observe = (observation) => call("POST", "/v1/observations", observation, { "x-tds-api-key": KEY });

function obs({ source, sensor, zone = "site", protocol, kind, key, name, rssi, known = true, coords = null, secondsAgo = 0, extra = {}, raw = {}, identity = null, fingerprint = "v1" }) {
  return {
    timestamp: iso(secondsAgo),
    source,
    sensor_id: sensor,
    zone_id: zone,
    protocol,
    identity_hint: identity,
    rssi,
    known,
    metadata: { kind, state_key: key, state_fingerprint: fingerprint, name, ...(coords ? { lat: coords.lat, lon: coords.lon } : {}), ...extra },
    raw_payload: raw
  };
}

// ------------------------------------------------------------------ fixed population

function rfPopulation(cycle) {
  const items = [];
  const jitter = (base, amount) => Math.round(base + Math.sin(cycle * 0.7 + base) * amount);
  // Known Wi-Fi clients and APs (Kismet), some with real coordinates.
  const wifi = [
    ["Kitchen tablet", 4, 6, -48, true],
    ["Office laptop", -6, -12, -55, true],
    ["Living room TV", 2, 14, -58, true],
    ["Neighbor AP", 30, -22, -81, false],
    ["Garage camera", -12, 20, -66, true],
    ["Printer", -3, -4, -61, false],
    ["Street AP 'xfinitywifi'", 45, 30, -86, false],
    ["Thermostat", 1, 2, -63, false]
  ];
  wifi.forEach(([name, e, n, rssi, real], index) =>
    items.push(obs({ source: "kismet", sensor: "seed-kismet-wlan0", protocol: "wifi", kind: "device", key: `kismet:device:wifi${index}`, name, rssi: jitter(rssi, 3), coords: real ? at(e, n) : null, extra: { channel: index % 2 ? "36" : "6", manufacturer: "Seeded" } }))
  );
  // BLE devices; one tracked by the operator.
  const ble = [
    ["Fitness band", -5, 9, -64],
    ["Earbuds", 3, -7, -59],
    ["BLE tag stairwell", -3, 18, -71],
    ["Unknown beacon", 18, -14, -77]
  ];
  ble.forEach(([name, e, n, rssi], index) => items.push(obs({ source: "kismet", sensor: "seed-kismet-hci0", protocol: "ble", kind: "device", key: `kismet:device:ble${index}`, name, rssi: jitter(rssi, 4) })));
  items.push(
    obs({
      source: "kismet",
      sensor: "seed-kismet-hci0",
      protocol: "ble",
      kind: "device",
      key: "kismet:device:tracked-phone",
      name: "Visitor phone",
      rssi: jitter(-57, 6),
      coords: at(8 + Math.sin(cycle / 3) * 6, 3 + Math.cos(cycle / 3) * 6),
      extra: { operator_read: "Tracked: recurring visitor phone" }
    })
  );
  // Zigbee mesh.
  items.push(obs({ source: "kismet", sensor: "seed-kismet-zb", protocol: "zigbee", kind: "device", key: "kismet:device:zigbee-hub", name: "Zigbee hub", rssi: -58, coords: at(2, -4) }));
  items.push(obs({ source: "kismet", sensor: "seed-kismet-zb", protocol: "zigbee", kind: "device", key: "kismet:device:zigbee-sensor", name: "Door sensor", rssi: -69 }));
  // Utility meter via rtl_433 (Intercept).
  items.push(obs({ source: "intercept", sensor: "seed-intercept-rtl", protocol: "rtl433", kind: "device", key: "intercept:rtl433:meter", name: "Utility meter", rssi: -74, extra: { frequency: "915.00" } }));
  // Unknown RF spectrum peaks (need review).
  items.push(obs({ source: "intercept", sensor: "seed-intercept-sdr", protocol: "sdr", kind: "spectrum_peak", key: "intercept:peak:433", name: "Unknown 433 MHz burst", rssi: jitter(-76, 4), extra: { frequency: "433.92" } }));
  items.push(obs({ source: "intercept", sensor: "seed-intercept-sdr", protocol: "sdr", kind: "spectrum_peak", key: "intercept:peak:315", name: "Unknown 315 MHz", rssi: -83, extra: { frequency: "315.00" } }));
  // Receiver infrastructure.
  items.push(obs({ source: "intercept", sensor: "seed-intercept", protocol: "infrastructure", kind: "server_status", key: "intercept:server", name: "Intercept receiver", rssi: -30 }));
  items.push(obs({ source: "kismet", sensor: "seed-kismet", protocol: "infrastructure", kind: "datasource", key: "kismet:datasource:wlan0", name: "Kismet wlan0", rssi: -30 }));
  return items;
}

function networkState() {
  const leases = [
    ["Kitchen tablet", "192.168.1.21", "AA:BB:CC:10:00:01"],
    ["Office laptop", "192.168.1.22", "AA:BB:CC:10:00:02"],
    ["Living room TV", "192.168.1.23", "AA:BB:CC:10:00:03"],
    ["Printer", "192.168.1.30", "AA:BB:CC:10:00:04"],
    ["Thermostat", "192.168.1.40", "AA:BB:CC:10:00:05"]
  ];
  const items = leases.map(([hostname, ip, mac]) =>
    obs({ source: "openwrt", sensor: "seed-openwrt", protocol: "router", kind: "dhcp_lease", key: `openwrt:lease:${mac}`, name: hostname, rssi: -40, identity: mac, extra: { ip_address: ip, hostname } })
  );
  // UniFi deliberately ~25 minutes stale so collector degradation is visible.
  leases.slice(0, 3).forEach(([hostname, ip, mac]) =>
    items.push(obs({ source: "unifi", sensor: "seed-unifi", protocol: "wifi", kind: "client", key: `unifi:client:${mac}`, name: hostname, rssi: -52, identity: mac, secondsAgo: 25 * 60, extra: { ip_address: ip, network: "HomeNet" } }))
  );
  return items;
}

function aircraft(cycle) {
  const flights = [
    { icao: "a1b2c3", callsign: "UAL421", type: "A320", owner: "United", reg: "N421UA", start: [-9000, 4000], velocity: [180, -40], alt: 12500, speed: 310 },
    { icao: "d4e5f6", callsign: "DAL88", type: "B738", owner: "Delta", reg: "N88DL", start: [12000, -18000], velocity: [-90, 160], alt: 34000, speed: 440 },
    { icao: "0a0b0c", callsign: "N123AB", type: "C172", owner: "Private", reg: "N123AB", start: [2000, -3000], velocity: [30, 25], alt: 2500, speed: 110 }
  ];
  return flights.map((flight) => {
    const t = cycle % 60;
    const east = flight.start[0] + flight.velocity[0] * t;
    const north = flight.start[1] + flight.velocity[1] * t;
    const heading = Math.round(((Math.atan2(flight.velocity[0], flight.velocity[1]) * 180) / Math.PI + 360) % 360);
    const coords = at(east, north);
    return obs({
      source: "kismet",
      sensor: "seed-rtl-adsb",
      zone: "sky",
      protocol: "adsb",
      kind: "aircraft",
      key: `kismet:aircraft:${flight.icao}`,
      name: flight.callsign,
      rssi: -80,
      coords,
      extra: { callsign: flight.callsign, heading, altitude: flight.alt },
      fingerprint: `pos${t}`,
      raw: {
        "adsb.device": {
          "adsb.device.callsign": flight.callsign,
          "adsb.device.squawk": "1200",
          "kismet.adsb.icao_record": { "adsb.icao.model": flight.type, "adsb.icao.type": flight.type, "adsb.icao.owner": flight.owner, "adsb.icao.registration": flight.reg, "adsb.icao.country": "US" }
        },
        "kismet.device.base.location": { "kismet.common.location.last": { "kismet.common.location.alt": Math.round(flight.alt * 0.3048), "kismet.common.location.speed": flight.speed, "kismet.common.location.heading": heading } }
      }
    });
  });
}

/** A brand-new unknown device near the house every few cycles: triggers the unknown_device_nearby rule. */
function transientUnknown(cycle) {
  const zones = ["front", "yard", "street"];
  return obs({
    source: "kismet",
    sensor: "seed-kismet-wlan0",
    zone: zones[cycle % zones.length],
    protocol: cycle % 2 ? "ble" : "wifi",
    kind: "device",
    key: `kismet:device:transient-${cycle}`,
    name: `Unknown device ${cycle}`,
    rssi: -50,
    known: false
  });
}

async function unifiAlarm(cycle) {
  await call("POST", "/v1/webhooks/unifi/alarm", {
    name: cycle === 0 ? "Rogue AP detected" : "Client signal degraded",
    message: cycle === 0 ? "Rogue AP broadcasting HomeNet on channel 11" : "Client RSSI below threshold",
    severity: cycle === 0 ? "critical" : "warning",
    site: "default",
    parameters: { UNIFIclientMac: "AA:BB:CC:00:11:22", UNIFIconnectedToDeviceName: "U6-Lite", UNIFIWiFiRssi: "-48", UNIFIwifiName: "HomeNet", UNIFInetworkName: "LAN" }
  });
}

// ------------------------------------------------------------------ loop

let cycle = 0;

async function setup() {
  await call("PUT", "/v1/control/site", { latitude: SITE.latitude, longitude: SITE.longitude, label: "Seeded demo site", floor_heading_degrees: 0 });
  await unifiAlarm(0).catch((error) => console.warn("[tds-seed] alarm:", error.message));
}

async function tick() {
  const batch = [...rfPopulation(cycle), ...networkState(), ...aircraft(cycle)];
  if (cycle % 3 === 0) {
    batch.push(transientUnknown(cycle));
  }
  let failed = 0;
  for (const observation of batch) {
    await observe(observation).catch((error) => {
      failed += 1;
      if (failed <= 3) console.warn("[tds-seed]", error.message);
    });
  }
  if (cycle === 0) {
    // Track the visitor phone (it exists in current state now).
    await call("POST", "/v1/presence/watchlist", { entity_key: "kismet:device:tracked-phone", label: "Visitor phone", protocol: "ble", source: "kismet", kind: "device" }).catch((error) =>
      console.warn("[tds-seed] watchlist:", error.message)
    );
  }
  if (cycle > 0 && cycle % 15 === 0) {
    await unifiAlarm(cycle).catch((error) => console.warn("[tds-seed] alarm:", error.message));
  }
  console.log(`[tds-seed] cycle ${cycle}: ${batch.length - failed}/${batch.length} observations`);
  cycle += 1;
}

async function main() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await call("GET", "/health");
      break;
    } catch {
      if (attempt % 10 === 0) console.log("[tds-seed] waiting for API...");
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  await setup();
  for (;;) {
    await tick().catch((error) => console.error("[tds-seed] tick failed:", error.message));
    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }
}

main();
