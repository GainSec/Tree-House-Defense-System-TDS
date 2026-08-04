# TDS Capture Map

This is the canonical ownership map for TDS capture surfaces on a local
collector host.
Use it when deciding where a signal belongs, which collector owns it, and which
API read path the dashboard should use.

## High-Level Architecture

```text
OpenWrt      UniFi          Kismet Passive RF        Intercept RF Platform       WCH BLE Analyzer
   |           |                    |                         |                         |
   v           v                    v                         v                         v
openwrt     unifi              kismet                    intercept               ble_analyzer
collector   collector          collector                 collector               collector
   |           |                    |                         |                         |
   +-----------+--------------------+-------------------------+-------------------------+
                                             |
                                             v
                                  POST /v1/observations
                               |
                               v
              PostgreSQL current state and history
                               |
                 +-------------+-------------+
                 |                           |
                 v                           v
          GET /v1/state              MQTT rf/events
          GET /v1/events
          GET /v1/dashboard/summary
```

`GET /v1/state` is the dashboard default for current device, RF, router, AP, and
collector status. `GET /v1/observations` remains the history view for first-seen
or changed snapshots. `GET /v1/events` is the rule output view.

## Source Ownership

| Surface | Primary collector | TDS source | Current status | Dashboard read |
| --- | --- | --- | --- | --- |
| Router board identity | OpenWrt ubus collector | `openwrt` | Live | `GET /v1/state?source=openwrt` |
| DHCP leases | OpenWrt ubus collector | `openwrt` | Live | `GET /v1/state?source=openwrt&kind=dhcp_lease` |
| Host hints | OpenWrt ubus collector | `openwrt` | Live | `GET /v1/state?source=openwrt` |
| Interface state | OpenWrt ubus collector | `openwrt` | Live | `GET /v1/state?source=openwrt` |
| Wi-Fi station association RSSI | OpenWrt ubus collector | `openwrt` | Live | `GET /v1/state?source=openwrt` |
| UniFi clients | UniFi Network API poller | `unifi` | Live | `GET /v1/state?source=unifi&kind=client` |
| UniFi network devices | UniFi Network API poller | `unifi` | Live | `GET /v1/state?source=unifi&kind=device` |
| UniFi alarms | UniFi Alarm Manager webhook | `unifi_webhook` event path | Live | `GET /v1/events?type=unifi_alarm` |
| Wi-Fi passive devices | Kismet collector | `kismet` | Live | `GET /v1/state?source=kismet&kind=device` |
| Linux Bluetooth passive devices | Kismet collector | `kismet` | Live | `GET /v1/state?source=kismet&kind=device` |
| ADS-B aircraft | Kismet collector | `kismet` | Live | `GET /v1/state?source=kismet&kind=aircraft` |
| rtl433 observations | Kismet datasource, then TDS Kismet collector | `kismet` | Live as Kismet datasource | `GET /v1/state?source=kismet` |
| Kismet nRF 802.15.4 / Zigbee / Thread | Kismet nRF52840 source, then TDS Kismet collector | `kismet` | Configured | `GET /v1/state?source=kismet&kind=iot_device` |
| Kismet datasource health | Kismet collector | `kismet` | Live | `GET /v1/state?source=kismet&kind=datasource` |
| Kismet server health | Kismet collector | `kismet` | Live | `GET /v1/state?source=kismet&kind=server_status` |
| Intercept server health | Intercept collector | `intercept` | Live | `GET /v1/state?source=intercept&kind=server_status` |
| HackRF Pro inventory | Intercept collector | `intercept` | Live | `GET /v1/state?source=intercept&kind=sdr_device` |
| RTL-SDR inventory | Intercept collector | `intercept` | Live | `GET /v1/state?source=intercept&kind=sdr_device` |
| WCH BLE Analyzer Pro PCAP | `tools/ble_analyzer_collect.py` over `wch_capture` + `tshark` | `ble_analyzer` | Live 30-second capture windows | `GET /v1/state?source=ble_analyzer` |
| Rail-band RF activity | `tools/rail_rf_collect.py` over the third RTL-SDR and `rtl_power` | `rail_rf` | Configured | `GET /v1/state?source=rail_rf` |
| YARD Stick One | RFCat tooling | Not ingested yet | Hardware validated | Future sub-GHz adapter |
| GPS receiver | gpsd into Kismet | `kismet` datasource context | Live | `GET /v1/state?source=kismet` |

## Low-Level Collector Paths

### OpenWrt

`tools/openwrt_collect.py` polls authenticated ubus JSON-RPC and submits
normalized observations through `POST /v1/observations`.

Captured surfaces:

- `system board`
- `luci-rpc getDHCPLeases`
- `luci-rpc getHostHints`
- `network.interface dump`
- `iwinfo devices`
- `iwinfo assoclist`

### UniFi

`tools/unifi_collect.py` polls the Network API for clients and devices. Alarm
Manager calls `POST /v1/webhooks/unifi/alarm` or `GET /v1/webhooks/unifi/alarm`
and creates `unifi_alarm` events.

### Kismet

`tools/kismet_collect.py` reads Kismet server status, datasource status, and
device records. It normalizes Wi-Fi, Linux Bluetooth, ADS-B, rtl433 datasource
state, GPS datasource context, and Kismet health into source `kismet`.

Configured Kismet sources:

- `wlan1`: MediaTek monitor-mode Wi-Fi
- `hci1`: MediaTek Bluetooth controller
- `rtl433-<UTILITY_SDR_SERIAL>`: RTL-SDR Blog V3 for 433 MHz sensors
- `rtladsb-<ADSB_SDR_SERIAL>`: RTL-SDR Blog V3 for ADS-B
- `gpsd`: GPS receiver
- `tds_nrf52840`: nRF52840 802.15.4 source on the stable `/dev/serial/by-id`
  path, reporting Kismet `802.15.4` devices that TDS normalizes as
  `zigbee` / `iot_device` observations.

Current upstream Kismet supports WCH BLE Analyzer Pro as `wch-ble-pro`, but many
packaged builds do not include that source helper. TDS uses a dedicated
standalone `wch_capture` path instead: `tools/ble_analyzer_collect.py` captures a
short PCAP, parses BLE advertising metadata and RSSI with `tshark`, and submits
aggregated `ble_analyzer` / `ble_advertiser` observations.

### Intercept

`tools/intercept_collect.py` reads Intercept health and SDR device status. It
normalizes the Intercept service and detected SDR inventory into source
`intercept`.

Current Intercept-backed devices:

- HackRF Pro
- RTL-SDR `<UTILITY_SDR_SERIAL>`
- RTL-SDR `<ADSB_SDR_SERIAL>`

The Intercept collector degrades to unauthenticated health-only collection if
the Intercept login rate limit is hit. The next timer run resumes full inventory
collection after the login window clears.

## Frontend Contract

The dashboard should start from these reads:

```http
GET /v1/dashboard/summary
GET /v1/state?limit=200
GET /v1/events?limit=100
GET /v1/collectors
GET /v1/integrations
```

Source-specific drilldowns should use `GET /v1/state?source=...` first and only
fall back to `GET /v1/observations?source=...` when the user asks for history.
