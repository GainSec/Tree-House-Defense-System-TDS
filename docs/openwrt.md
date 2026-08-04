# TDS OpenWrt Integration

TDS should collect OpenWrt state through ubus JSON-RPC, not ongoing SSH.
SSH is only needed for one-time setup if `/ubus` is not already exposed.

## Current Target

- Router: `192.0.2.1`
- Platform: OpenWrt 24.10.1 on GL.iNet GL-MT6000
- TDS collector host: local TDS host
- TDS API: `http://127.0.0.1:8080`

## One-Time OpenWrt Setup

The router already has the required packages installed:

- `rpcd`
- `rpcd-mod-iwinfo`
- `rpcd-mod-luci`
- `uhttpd`
- `uhttpd-mod-ubus`

Expose ubus through uhttpd:

```sh
uci set uhttpd.main.ubus_prefix='/ubus'
uci commit uhttpd
/etc/init.d/uhttpd restart
```

Create a restricted ACL at `/usr/share/rpcd/acl.d/tds-openwrt.json`:

```json
{
  "tds-openwrt-read": {
    "description": "Read-only TDS OpenWrt telemetry",
    "read": {
      "ubus": {
        "system": ["board"],
        "network.interface": ["dump"],
        "iwinfo": ["devices", "assoclist", "info"],
        "luci-rpc": ["getDHCPLeases", "getHostHints"]
      }
    }
  }
}
```

Create a password hash and add a read-only rpcd login:

```sh
TDS_OPENWRT_PASSWORD='replace-with-long-random-password'
TDS_OPENWRT_HASH="$(uhttpd -m "$TDS_OPENWRT_PASSWORD")"
uci add rpcd login
uci set rpcd.@login[-1].username='tds'
uci set rpcd.@login[-1].password="$TDS_OPENWRT_HASH"
uci add_list rpcd.@login[-1].read='tds-openwrt-read'
uci commit rpcd
/etc/init.d/rpcd restart
```

Do not enable `no_ubusauth`; it would expose ubus methods without
authentication.

## Collector

Store the password on the collector host in `.env`:

```env
TDS_OPENWRT_URL=https://192.0.2.1/ubus
TDS_OPENWRT_USERNAME=tds
TDS_OPENWRT_PASSWORD=replace-with-long-random-password
TDS_OPENWRT_VERIFY_TLS=false
```

Preview without ingesting:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/openwrt_collect.py --dry-run
```

Submit observations:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/openwrt_collect.py
```

## Collected Surfaces

- Router board identity from `system board`
- IPv4 DHCP leases from `luci-rpc getDHCPLeases`
- Host hints from `luci-rpc getHostHints`
- Interface state from `network.interface dump`
- Wi-Fi station RSSI and association state from `iwinfo assoclist`

The collector intentionally avoids `uci show wireless` and
`luci-rpc getWirelessDevices` because those responses can include wireless
credentials.
