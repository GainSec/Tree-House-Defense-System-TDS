# XR host: real TDS backend behind a read-only gateway

A lean deployment for using the XR board (`/vr`) against a **real** TDS backend
from a headset over your own HTTPS subdomain. TDS is meant to be hosted locally,
so the gateway has no login by default (`TDS_GATEWAY_AUTH=off`).

```
headset ──HTTPS──▶ your reverse proxy ──▶ gateway :8089 ──▶ api :8080 (loopback) ──▶ postgres
                                          (allowlist, optional login, ▲
                                           static app, /xr-log)      └── collectors / seeder on the LAN
```

| Service | Purpose |
| --- | --- |
| `postgres` | TDS database (volume `postgres_data`). |
| `api` | Unmodified TDS FastAPI image. MQTT off, no control sidecar. Published on `127.0.0.1` only. |
| `gateway` | `frontend/scripts/tds-xr-gateway.mjs` (zero dependencies). The only public port. |
| `seeder` | Optional (`--profile seed`). Synthetic observations through the real ingestion API every 60 s. |

## Run

```bash
cd deploy/xr-host
cp xr-host.env.example xr-host.env        # set the Postgres password and ingest key
docker compose --env-file xr-host.env up -d --build
docker compose --env-file xr-host.env --profile seed up -d   # optional demo data
```

Point the HTTPS subdomain at `http://<host>:8089` (`TDS_GATEWAY_PUBLIC_PORT`),
with a real certificate: WebXR needs a secure context.

## Gateway

- **Login (optional, off by default):** set `TDS_GATEWAY_AUTH=on` plus
  `TDS_GATEWAY_PASSWORD` and a 32+ character `TDS_GATEWAY_SECRET` to require a
  single password. It issues an HMAC-signed, HttpOnly, SameSite=Lax session
  cookie (30 days), `Secure` behind HTTPS (`X-Forwarded-Proto: https`).
- **Brute force (login on):**
  - Limits: 10 failed logins per client and 100 in total per 15 minutes, with a
    bounded memory footprint.
  - `X-Forwarded-For` is trusted only from the IPs in `TDS_GATEWAY_TRUSTED_PROXIES`;
    otherwise the socket address is used.
  - Set it to your reverse proxy's IP so clients are limited individually.
- **Logged out (login on):** pages redirect to `/login`, and the API and assets
  return 401. `/healthz` is the only open path.
- **Paths:** each path is decoded and canonicalised once before the policy check.
  Malformed escapes, backslashes, control characters, `;`, `//` and `.`/`..`
  segments are rejected, so `%61`-style encodings can't reach blocked routes.
- **Reads:** all `/v1` GETs are forwarded.
- **Writes**, set by `TDS_GATEWAY_ALLOW_WRITES`:
  - `none`: no writes forwarded.
  - `presence` (default): only watchlist, notes, identity decisions, annotations,
    enrichment and playbook runs.
  - `all`: every write.
- **Never forwarded:** `/v1/observations` (ingestion) and `/v1/webhooks`.
  Collectors post to the API directly on the LAN.
- **Login redirect:** only same-origin `next` paths are followed (no `//host`,
  `\`, or control characters).
- **XR logs:** capped at 20 MB per day (`TDS_GATEWAY_LOG_MAX_MB`) and kept for 14
  days (`TDS_GATEWAY_LOG_KEEP_DAYS`).
- **Static files:** path traversal is blocked. `index.html` is `no-cache` so
  headsets get new builds; hashed assets are cached as immutable.
- **Rotating access (login on):**
  - change `TDS_GATEWAY_SECRET` and run
    `docker compose --env-file xr-host.env up -d gateway` to sign everyone out
  - change `TDS_GATEWAY_PASSWORD` the same way to change the login

## Logs from the headset

The XR page posts its diagnostic log to `/xr-log`, which writes
`logs/xr-YYYY-MM-DD.jsonl`.

```bash
./read-xr-logs.sh 120          # last 120 lines
./read-xr-logs.sh 200 input    # only lines mentioning "input"
```

## Seeder

`seed/tds-seed.mjs` feeds the real pipeline (ingestion → rules/events → current
state → map). Each cycle it posts:
- Wi-Fi/BLE/Zigbee/rtl_433 devices, unknown spectrum peaks, receiver infrastructure
- OpenWrt leases and UniFi clients (deliberately ~25 minutes stale, so collector
  degradation shows)
- 3 moving aircraft
- a new unknown device every few cycles, which triggers the `unknown_device_nearby` rule
- UniFi alarms through the webhook

It also adds a tracked "Visitor phone" to the presence watchlist. The site is
labelled **"Seeded demo site"**. Stop the seeder when real collectors are
attached:

```bash
docker compose --env-file xr-host.env --profile seed stop seeder
```

## Updating

From a checkout:
1. `cd frontend && npm run build`
2. `rsync` the repo to the host.
3. Restart the gateway; the static files are bind-mounted, so a reload is enough.
   Run `docker compose ... up -d --build api` after backend changes.
