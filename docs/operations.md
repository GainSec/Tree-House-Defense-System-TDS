# TDS Operations

TDS runs on the collector host from the configured `TDS_ROOT` directory.

## Endpoints

- API LAN endpoint: `http://127.0.0.1:8080`
- Dashboard: `http://127.0.0.1:8080/dashboard`
- Postgres: `127.0.0.1:5432`
- MQTT: `127.0.0.1:1883`

## Start and Stop

```bash
cd /opt/tds/TDS
cp example.env .env
docker compose up -d
docker compose ps
docker compose logs --tail=100 api
docker compose down
```

## Configuration

TDS supports dashboard-managed settings and local `.env` configuration. Use
`example.env` or `.env.example` as the starting template. Docker Compose and
installed user systemd units read `.env`; collectors then merge dashboard
settings when `TDS_USE_DASHBOARD_SETTINGS=true`. Missing dashboard values do not
disable `.env` fallback.

## Database Migrations

```bash
cd /opt/tds/TDS/backend
TDS_DATABASE_URL="postgresql+psycopg://tds:tds_dev_password@127.0.0.1:5432/tds" ../.venv/bin/alembic upgrade head
```

## Tests

```bash
cd /opt/tds/TDS
.venv/bin/pytest -q
```

## Health Checks

```bash
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/ready
```

## Dashboard

The TDS Command Matrix is served by the API container at
`http://127.0.0.1:8080/dashboard`. It is a static command deck that polls
the existing read APIs:

- `GET /v1/dashboard/summary`
- `GET /v1/state?limit=300`
- `GET /v1/events?limit=60`
- `GET /v1/collectors`
- `GET /v1/integrations`

The dashboard is TDS-first: OpenWrt, UniFi, Kismet, and Intercept are shown as
evidence layers backing findings, posture, spatial zones, and recent decisions.

## Synthetic Observations

```bash
cd /opt/tds/TDS
.venv/bin/python tools/generate_observations.py --count 5 --zone entrance --sensor front-door --protocol ble --api-key change-me
```

Use synthetic observations to exercise ingestion, rule generation, event reads, and MQTT before wiring real OpenWrt, UniFi, Intercept, or AntiHunter adapters.

## OpenWrt Collection

The OpenWrt collector runs from the collector host and submits normalized observations
through the same ingest API as synthetic observations. It uses authenticated
ubus JSON-RPC rather than ongoing SSH. See `docs/openwrt.md` for the one-time
router setup.

```bash
cd /opt/tds/TDS
.venv/bin/python tools/openwrt_collect.py
```

For a non-writing preview:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/openwrt_collect.py --dry-run
```

Collected surfaces are board identity, DHCP leases, host hints, interface state,
and Wi-Fi station association RSSI. Do not use broad wireless config dumps as
collector input because they can include credentials.

## UniFi Collection

UniFi has two inputs: Alarm Manager webhooks and a Network API poller. Configure
the API key and webhook token in `.env`; see `docs/unifi.md`.

```bash
cd /opt/tds/TDS
.venv/bin/python tools/unifi_collect.py --dry-run
.venv/bin/python tools/unifi_collect.py
```

## Kismet Collection

Kismet is the V1 passive RF source of truth. Configure credentials in
`.env`:

```env
TDS_KISMET_URL=http://127.0.0.1:2501
TDS_KISMET_USERNAME=tds
TDS_KISMET_PASSWORD=replace-with-kismet-password
TDS_KISMET_VERIFY_TLS=false
```

Dry run:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/kismet_collect.py --dry-run
```

Submit:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/kismet_collect.py
```

Read current state:

```http
GET /v1/state?source=kismet
```

```bash
curl -fsS 'http://127.0.0.1:8080/v1/state?source=kismet&limit=20'
```

## Intercept Collection

Intercept is the V1 active/specialized RF platform source. Configure credentials
in `.env`:

```env
TDS_INTERCEPT_URL=http://127.0.0.1:5050
TDS_INTERCEPT_USERNAME=tds
TDS_INTERCEPT_PASSWORD=replace-with-intercept-password
TDS_INTERCEPT_VERIFY_TLS=false
```

Dry run:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/intercept_collect.py --dry-run
```

Submit:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/intercept_collect.py
```

Read current state:

```http
GET /v1/state?source=intercept
```

```bash
curl -fsS 'http://127.0.0.1:8080/v1/state?source=intercept&limit=20'
```

## RF Tooling

Intercept and Kismet are staged on the collector host; see `docs/rf-tooling.md`.
The source ownership map for dashboard work is in `docs/capture-map.md`.

- Intercept: `http://127.0.0.1:5050`, managed by `intercept.service`.
- Kismet: installed with Wi-Fi, Bluetooth, rtl433, and rtladsb capture helpers;
  `tools/kismet_collect.py` normalizes Kismet API output into TDS observations.
- RTL-SDR userspace access is prepared with udev rules and DVB driver
  blacklisting.

Capture ownership summary:

- `openwrt`: router identity, DHCP leases, host hints, interface state, and
  OpenWrt Wi-Fi station association RSSI.
- `unifi`: UniFi Network API clients/devices plus Alarm Manager webhook events.
- `kismet`: passive Wi-Fi, Linux Bluetooth, ADS-B, rtl433 datasource state,
  GPS datasource context, datasource health, and server health.
- `intercept`: Intercept service health plus HackRF/RTL-SDR inventory.
- `wch_capture`: WCH BLE Analyzer Pro PCAP capture only; not ingested into TDS
  yet.

## LTESniffer / LibreSDR

LTESniffer support is staged for the Lab CBRS/Open5GS LTE testbed using the
LibreSDR B220mini/B210. The TDS wrapper is safe by default: `probe` mode only
checks UHD/LibreSDR state and submits LTE sensor/decode-status observations.
Live PDSCH/PUSCH execution requires explicit private-testbed frequencies and
`TDS_LTESNIFFER_ENABLED=true`.

Install or update the external C++ tool:

```bash
cd /opt/tds/TDS
scripts/install-ltesniffer.sh
```

Probe without live LTE capture:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/ltesniffer_collect.py --dry-run --mode probe
```

Private-testbed downlink/PDSCH mode requires at least:

```env
TDS_LTESNIFFER_ENABLED=true
TDS_LTESNIFFER_MODE=downlink
TDS_LTESNIFFER_DL_FREQ_HZ=3560000000
TDS_LTESNIFFER_UHD_ARGS=serial=LIBRESDR001,num_recv_frames=512
```

Private-testbed uplink/PUSCH mode requires both LTE frequencies:

```env
TDS_LTESNIFFER_ENABLED=true
TDS_LTESNIFFER_MODE=uplink
TDS_LTESNIFFER_DL_FREQ_HZ=3560000000
TDS_LTESNIFFER_UL_FREQ_HZ=3480000000
TDS_LTESNIFFER_CELL_ID=379
TDS_LTESNIFFER_PRB=100
```

LTESniffer API output is optional and can be layered onto either direction with
`TDS_LTESNIFFER_API_MODE`. Use `3` for all API outputs: identity mapping, IMSI
collection, and UE capability profiling.

Downlink/PDSCH with all API outputs:

```env
TDS_LTESNIFFER_ENABLED=true
TDS_LTESNIFFER_MODE=downlink
TDS_LTESNIFFER_DL_FREQ_HZ=3560000000
TDS_LTESNIFFER_API_MODE=3
```

Uplink/PUSCH with all API outputs:

```env
TDS_LTESNIFFER_ENABLED=true
TDS_LTESNIFFER_MODE=uplink
TDS_LTESNIFFER_DL_FREQ_HZ=3560000000
TDS_LTESNIFFER_UL_FREQ_HZ=3480000000
TDS_LTESNIFFER_CELL_ID=379
TDS_LTESNIFFER_PRB=100
TDS_LTESNIFFER_API_MODE=3
```

After `.env` is configured for the private testbed, run one bounded live
collection manually with:

```bash
systemctl --user start tds-ltesniffer-live.service
```

Read TDS state:

```http
GET /v1/state?source=ltesniffer
```

```bash
curl -fsS 'http://127.0.0.1:8080/v1/state?source=ltesniffer&limit=20'
```

## Poller Timers

OpenWrt, UniFi, Kismet, Intercept, and rail RF pollers run as user-level
systemd timers for the service user. The HTTP pollers run every 30 seconds for
near-real-time dashboard state; rail RF runs every 15 seconds because train
voice/telemetry activity is bursty. Current-state de-dup metadata avoids
duplicate observation history when snapshots are unchanged. UniFi/OpenWrt
webhooks and the Intercept MQTT collector remain the true push/streaming paths.

Each oneshot poller has `TimeoutStartSec=25s` so a slow source cannot block the
next 30-second cycle indefinitely. The Kismet poller reads recently active
devices only, controlled by `TDS_KISMET_RECENT_SECONDS` and defaulting to 60
seconds, because full Kismet device-history pulls can take minutes on a busy RF
receiver.

```bash
cd /opt/tds/TDS
scripts/install-user-timers.sh
systemctl --user list-timers --all 'tds-*.timer'
systemctl --user status tds-openwrt-collect.timer
systemctl --user status tds-unifi-collect.timer
systemctl --user status tds-kismet-collect.timer
systemctl --user status tds-intercept-collect.timer
systemctl --user status tds-rail-rf-collect.timer
```

Installed timers:

- `tds-openwrt-collect.timer`: runs `tools/openwrt_collect.py` every 30 seconds.
- `tds-unifi-collect.timer`: runs `tools/unifi_collect.py` every 30 seconds.
- `tds-kismet-collect.timer`: runs `tools/kismet_collect.py` every 30 seconds.
- `tds-intercept-collect.timer`: runs `tools/intercept_collect.py` every 30 seconds.
- `tds-rail-rf-collect.timer`: runs `tools/rail_rf_collect.py` every 15 seconds.

Collector stdout is suppressed in the systemd services so raw network payloads
do not accumulate in the user journal. Errors still go to the journal.

Collectors include current-state de-dup fields. Repeated unchanged snapshots
update `GET /v1/state` without adding duplicate observation-history rows.

Manual one-shot runs:

```bash
systemctl --user start tds-openwrt-collect.service
systemctl --user start tds-unifi-collect.service
systemctl --user start tds-kismet-collect.service
systemctl --user start tds-intercept-collect.service
systemctl --user start tds-rail-rf-collect.service
```
