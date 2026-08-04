# TDS API

Base URL on the LAN:

```text
http://127.0.0.1:8080
```

## Health

```http
GET /health
GET /ready
```

## Observation Ingestion

```http
POST /v1/observations
x-tds-api-key: change-me
content-type: application/json
```

Example:

```json
{
  "timestamp": "2026-07-21T20:10:00Z",
  "source": "synthetic",
  "sensor_id": "front-door",
  "zone_id": "entrance",
  "protocol": "ble",
  "identity_hint": "demo-ble-tag-001",
  "rssi": -48,
  "known": false,
  "metadata": { "generator": "tds.synthetic.v1" },
  "raw_payload": { "addr": "demo-ble-tag-001" }
}
```

## Dashboard Reads

```http
GET /v1/dashboard/summary
GET /v1/observations?source=synthetic&limit=50
GET /v1/events?zone_id=entrance&type=unknown_device_nearby&limit=50
GET /v1/sensors
GET /v1/zones
GET /v1/collectors
GET /v1/integrations
GET /v1/rules
GET /v1/state?source=unifi&kind=client&limit=50
```

Responses use:

```json
{
  "items": [],
  "count": 0
}
```

where practical. Dashboard summary returns counts and recent events.

## Current State

Collector payloads can include `metadata.state_key` and
`metadata.state_fingerprint`. TDS uses those fields to maintain a current-state
row and skip duplicate observation inserts when a scheduled poll returns an
unchanged snapshot.

```http
GET /v1/state
GET /v1/state?source=openwrt
GET /v1/state?source=unifi&kind=device
GET /v1/state?source=kismet
GET /v1/state?source=intercept
```

Current state is the preferred dashboard source for latest device/router/AP
status. Observation history remains append-only and is reserved for first-seen
or changed snapshots.

See `docs/capture-map.md` for the canonical source ownership matrix. Dashboard
views should prefer source-scoped current-state reads such as:

```http
GET /v1/state?source=openwrt
GET /v1/state?source=unifi
GET /v1/state?source=kismet
GET /v1/state?source=intercept
```

## MQTT

Generated events publish to:

```text
rf/events
```

Event payloads match the JSON returned by `GET /v1/events`.

## OpenWrt Collector

OpenWrt is ingested through the existing observation endpoint. The collector uses
authenticated ubus JSON-RPC for safe surfaces only:

- `system board`
- `luci-rpc getDHCPLeases`
- `luci-rpc getHostHints`
- `network.interface dump`
- `iwinfo devices`
- `iwinfo assoclist`

It intentionally avoids broad wireless config dumps because those can expose
wireless credentials. See `docs/openwrt.md` for the read-only ACL setup.

```bash
cd /opt/tds/TDS
.venv/bin/python tools/openwrt_collect.py
```

Use `--dry-run` to inspect normalized observations without submitting them.

## UniFi

UniFi Alarm Manager webhooks are accepted at:

```http
GET /v1/webhooks/unifi/alarm
POST /v1/webhooks/unifi/alarm
x-tds-webhook-token: replace-with-long-random-token
```

GET query parameters or POST JSON payloads create `unifi_alarm` events. The
UniFi poller submits client and device state through `POST /v1/observations`
with source `unifi` and current-state de-dup metadata.

UniFi webhook events include normalized fields under `payload.normalized` while
preserving the original UniFi body under `payload.raw`.

```bash
cd /opt/tds/TDS
.venv/bin/python tools/unifi_collect.py --dry-run
```

See `docs/unifi.md` for UDM SE API key and Alarm Manager setup.

## Kismet Passive RF

Kismet passive RF observations are submitted through `POST /v1/observations`
with source `kismet`.

Initial normalized kinds:

- `device` for Wi-Fi and Bluetooth devices
- `aircraft` for ADS-B devices
- `datasource` for Kismet capture source health
- `server_status` for Kismet server health

```bash
cd /opt/tds/TDS
.venv/bin/python tools/kismet_collect.py --dry-run
```

## Intercept RF Platform

Intercept RF platform observations are submitted through `POST /v1/observations`
with source `intercept`.

Initial normalized kinds:

- `server_status` for Intercept process/database/counter health
- `sdr_device` for RTL-SDR, HackRF, and other detected SDR devices

```bash
cd /opt/tds/TDS
.venv/bin/python tools/intercept_collect.py --dry-run
```

## Next Adapter Phase

After backend task 10, add real source adapters in this order unless priorities change:

1. OpenWrt infrastructure state
2. UniFi infrastructure and Protect context
3. Kismet passive RF observations
4. Intercept RF observations
5. AntiHunter RF observations
