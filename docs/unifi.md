# TDS UniFi Integration

TDS uses two UniFi Network inputs:

- Alarm Manager webhooks for real-time event pushes.
- The local Network Integration API for periodic client/device state polling.

## Target

- Controller: `https://unifi.example.invalid`
- API docs: `https://unifi.example.invalid/unifi-api/network`
- Hardware: UDM SE
- TDS API: `http://127.0.0.1:8080`

## Webhooks

TDS accepts UniFi Alarm Manager webhook calls at:

```text
http://127.0.0.1:8080/v1/webhooks/unifi/alarm
```

Use this header:

```text
x-tds-webhook-token: replace-with-long-random-token
```

Set the token on the collector host in `.env`:

```env
TDS_UNIFI_WEBHOOK_TOKEN=replace-with-long-random-token
```

In UniFi Network:

1. Open Alarm Manager.
2. Create an alarm for client/device/network events TDS should receive.
3. Add an Action.
4. Choose Webhook, then Custom Webhook.
5. Use HTTP POST if available; default HTTP GET is also accepted.
6. Add the TDS URL and `x-tds-webhook-token` header.
7. Save and test with a low-noise trigger first.

Recommended triggers:

- Client connected
- Client disconnected
- Wi-Fi client roaming
- Device offline
- Gateway offline
- WAN failover/outage
- High latency or packet loss
- Threat detected
- Honeypot triggered
- Firewall block

## Poller

Create a UniFi Network API key in the UDM SE dashboard and store it in
`.env`:

```env
TDS_UNIFI_URL=https://unifi.example.invalid
TDS_UNIFI_API_KEY=replace-with-unifi-api-key
TDS_UNIFI_SITE_ID=
TDS_UNIFI_VERIFY_TLS=true
```

Preview without ingesting:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/unifi_collect.py --dry-run
```

Submit observations:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/unifi_collect.py
```

The poller calls the local Network API with `X-API-Key`:

- `/proxy/network/integration/v1/sites`
- `/proxy/network/integration/v1/sites/{siteId}/clients`
- `/proxy/network/integration/v1/sites/{siteId}/devices`

## Notes

Webhooks are event pushes. They do not replace the poller because they do not
provide full current state for dashboards, reconciliation, or missed-event
recovery.

Webhook events are normalized into `payload.normalized` with fields such as
`event_name`, `client_mac`, `client_ip`, `ap_name`, `ap_mac`, `rssi`,
`wifi_name`, `network_name`, `network_subnet`, and `network_vlan`. The original
UniFi payload remains available under `payload.raw`.
