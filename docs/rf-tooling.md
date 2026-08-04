# RF Tooling

TDS RF tooling is designed for a local collector host with attached SDR and RF
interfaces. Replace the placeholder hostnames, serials, and paths below with
your own deployment values.

The canonical source ownership map is in `docs/capture-map.md`. In short:

- Kismet owns passive Wi-Fi, Linux Bluetooth, ADS-B, rtl433 datasource state,
  GPS datasource context, datasource health, and Kismet server health.
- Intercept owns Intercept service health and attached SDR inventory, including
  HackRF Pro and RTL-SDR devices.
- WCH BLE Analyzer Pro is ingested through short standalone `wch_capture` PCAP
  windows parsed by `tools/ble_analyzer_collect.py`.

## Intercept

Intercept is installed in `/opt/intercept` and runs as a system service.

```bash
sudo systemctl status intercept.service
sudo systemctl restart intercept.service
sudo journalctl -u intercept.service -n 100 --no-pager
```

Runtime details:

- URL: `http://127.0.0.1:5050`
- Service: `intercept.service`
- Config: `/opt/intercept/.env`
- Source checkout: `/opt/intercept`
- MQTT export: `127.0.0.1:1883`, topic prefix `tds/intercept`

Credentials are stored in `/opt/intercept/.env`; do not copy them into docs or
operator notes.

Installed Intercept profiles:

- Core SIGINT: RTL-SDR, multimon-ng, rtl_433, ADS-B, ACARS, VDL2, GPS, ffmpeg
- RF Security: aircrack-ng, HackRF, BlueZ, hcxtools, SoapySDR

The full Intercept health check may warn about AIS, weather satellite,
radiosonde, Ubertooth, or rtlamr tooling. Those are not required for the first
TDS RF validation pass.

Intercept does not currently use the WCH BLE Analyzer Pro directly. Its
Bluetooth path uses the local BlueZ/bleak/bluetoothctl adapter flow, while the
WCH analyzer is a USB packet sniffer. TDS ingests WCH captures through
`tools/ble_analyzer_collect.py`.

## Kismet

Kismet should run on the collector host.

```bash
kismet --version
systemctl status kismet.service
```

Runtime details:

- URL: `http://127.0.0.1:2501`
- Service: `kismet.service`
- Site config: `/etc/kismet/kismet_site.conf`
- Logs: `/var/log/kismet`
- UI user: `tds`

The Kismet password is stored in `/etc/kismet/kismet_site.conf`; do not copy it
into docs or operator notes.

Installed capture helpers include:

- `kismet_cap_linux_wifi`
- `kismet_cap_linux_bluetooth`
- `kismet_cap_sdr_rtl433`
- `kismet_cap_sdr_rtladsb`

The installed Kismet package does not include a WCH BLE Analyzer capture
helper. Kismet continues to collect Bluetooth through the Linux Bluetooth
adapter source.

Configured capture sources:

- `wlan1`: MediaTek USB Wi-Fi adapter in monitor mode
- `hci1`: MediaTek Bluetooth controller
- `rtl433-<UTILITY_SDR_SERIAL>`: RTL-SDR Blog V3 for 433 MHz sensors
- `rtladsb-<ADSB_SDR_SERIAL>`: RTL-SDR Blog V3 for ADS-B
- `gpsd`: GPS receiver on local gpsd
- `tds_nrf52840`: nRF52840 802.15.4 source on the stable `/dev/serial/by-id`
  path

The systemd service has a local override with `KillMode=control-group` so Kismet
capture helpers are stopped cleanly during restarts.

## Hardware Validation

Use `/settings` or the control-sidecar USB inventory to confirm that the
collector host sees the expected hardware before assigning collectors:

- RTL-SDR Blog V3 dongles should have unique serials before they are assigned to
  Kismet, ADS-B, rail RF, or utility RF collection.
- A monitor-capable Wi-Fi adapter should appear as a Linux wireless interface
  and support monitor mode for Kismet.
- A Bluetooth controller can be used by Kismet's Linux Bluetooth source.
- A GPS dongle is optional; site coordinates can also be set directly in the
  dashboard.
- nRF52840, HackRF, YARD Stick One, LibreSDR/B210-compatible hardware, and WCH
  BLE Analyzer devices should be validated with their vendor tools before TDS
  collectors are enabled.

YARD Stick One non-root access is handled by `/etc/udev/rules.d/60-yardstick-one.rules`.
WCH BLE Analyzer non-root access is handled by `/etc/udev/rules.d/99-wch-ble-analyzer.rules`;
capture files are written under `/var/log/tds/ble-analyzer` with group
`plugdev`.

## Current RF Role Split

The preferred live split is:

- `<ADSB_SDR_SERIAL>`: ADS-B aircraft through Kismet
  `rtladsb-<ADSB_SDR_SERIAL>`.
- `<UTILITY_SDR_SERIAL>`: utility/ISM decodes through Kismet
  `rtl433-<UTILITY_SDR_SERIAL>`, initially at 433.92 MHz. `rtl_433` supports
  many TPMS, weather, utility meter, door/window contact, keyfob, thermometer,
  and other low-power ISM decoders.
- `<RAIL_SDR_SERIAL>`: passive rail-band energy detection through
  `tools/rail_rf_collect.py` and `rtl_power`. TDS records frequency, band,
  RSSI-like peak power, and timestamp as `rail_rf` / `rail` /
  `rail_activity`; it does not decode train-control traffic.
- HackRF Pro: receive-only rotating SubGHz profile collector through Intercept
  `/subghz/sweep/start`. `tools/intercept_mqtt_collect.py --hackrf-rotation`
  cycles TPMS, utility meter, leak sensor, smart thermostat, and door/window
  sensor windows long enough to capture useful bursts, while tagging MQTT sweep
  peaks with the active profile. Targeted profile peaks are ingested as
  `intercept` / `subghz` / `spectrum_peak` records with
  `decode_status=candidate`; they remain in the Unknown RF discovery layer until
  a decoder promotes them to a real device/protocol class.
- YARD Stick One: CC1111/RfCat packet work for compatible sub-GHz OOK/ASK/FSK
  devices around common ISM bands such as 315, 433, 868, and 902-928 MHz. It is
  hardware-validated, but not auto-started by TDS because it is a
  protocol-specific transceiver, not a general wideband scanner. Use it once
  modulation, sync word, rate, and packet format are known; it is not the right
  path for ADS-B, Wi-Fi, or BLE.

As of this validation, `/v1/map/rf` is populated with Wi-Fi, BLE, ADS-B,
HackRF discovery peaks, and any decoded rtl433/Kismet utility records. HackRF
sweep/profile peaks remain Unknown RF until Yardstick One, rtl_433, rtlamr, or
another decoder identifies them.

## nRF52840 802.15.4

Kismet supports nRF52840 Zigbee/802.15.4 sources with an explicit serial
device path. The TDS drop-in source definition is in
`deploy/kismet/kismet_site_nrf52840.conf`:

```conf
source=nrf52840:device=/dev/serial/by-id/usb-Nordic_Semiconductor_nRF52_USB_Product_<SERIAL>-if00,name=tds_nrf52840,channels="11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26"
```

After adding that line to `/etc/kismet/kismet_site.conf`, restart Kismet:

```bash
sudo systemctl restart kismet.service
systemctl --user start tds-kismet-collect.service
curl -fsS 'http://127.0.0.1:8080/v1/state?source=kismet&kind=iot_device'
```

Kismet reports these devices as phy `802.15.4`; TDS stores them as `zigbee`
protocol with `kind=iot_device` and `rf_family=802.15.4` metadata so Thread or
Zigbee evidence can be reviewed without flattening it into unknown RF.

## Rail RF

The rail collector watches AAR VHF rail channels around 160.215-161.565 MHz
with the third RTL-SDR. It is passive energy-only collection:

```bash
cd /opt/tds/TDS
.venv/bin/python tools/rail_rf_collect.py --dry-run
systemctl --user status tds-rail-rf-collect.timer
curl -fsS 'http://127.0.0.1:8080/v1/state?source=rail_rf'
```

Use `TDS_RAIL_RTL_DEVICE=<RAIL_SDR_SERIAL>` to pin the collector to the train SDR.
Avoid `auto` in production; rail must fail closed instead of falling back to a
Kismet-owned RTL-SDR.

The collector also calculates the nearest AAR channel and can add local
operator/route hints from `TDS_RAIL_RF_CATALOG`. Start by copying
`config/rail_channels.example.json` to `config/rail_channels.local.json`, then
replace the example rows with local channel assignments. These fields are
shown as inferred context in `/v1/map/rf` and the presence dossier; they do not
prove exact train identity without decoded audio or another rail data source.

802.15.4 devices from Kismet are enriched with protocol-family, PAN, channel,
packet-direction, vendor, and role hints before being shown as IoT mesh context.
This keeps Zigbee/Thread traffic visible to operators while making clear that
encrypted payloads may hide exact product type.

## WCH BLE Analyzer Pro

The WCH BLE Analyzer Pro is ingested as a standalone BLE packet capture source.
It is not wired into Intercept directly.

Short capture:

```bash
mkdir -p /var/log/tds/ble-analyzer
timeout 30 wch_capture -w /var/log/tds/ble-analyzer/ble-$(date +%Y%m%d-%H%M%S).pcap
```

Verbose validation:

```bash
timeout 12 wch_capture -v -w /var/log/tds/ble-analyzer/test-$(date +%Y%m%d-%H%M%S).pcap
```

Expected startup:

- Three MCU devices open successfully.
- MCU 0 maps to BLE channel 37.
- MCU 1 maps to BLE channel 38.
- MCU 2 maps to BLE channel 39.
- PCAP output is written under `/var/log/tds/ble-analyzer`.

Do not run a long unattended `wch_capture` session without a rotation policy;
PCAP files can grow quickly in a busy BLE environment.

TDS runtime collection uses 8-second capture windows every 30 seconds:

```bash
systemctl --user status tds-ble-analyzer-collect.timer
systemctl --user start tds-ble-analyzer-collect.service
```

The collector parses advertising address, RSSI, RF channel, PDU type, device
name, manufacturer company IDs, service UUIDs, and service data from `tshark`.
It aggregates packets by advertiser and submits `ble_analyzer` /
`ble_advertiser` observations to `POST /v1/observations`.

## RTL-SDR Driver Prep

RTL-SDR userspace access is prepared for dongle validation:

- RTL-SDR udev rules are installed in `/etc/udev/rules.d/20-rtlsdr.rules`
- Conflicting DVB kernel drivers are blacklisted in `/etc/modprobe.d/blacklist-rtlsdr.conf`
- initramfs was regenerated after the blacklist was added

After plugging in RTL-SDR hardware, unplug/replug once if `rtl_test` cannot
claim the device immediately.

## Hardware Validation

Baseline checks before plugging in RF dongles:

```bash
lsusb
rtl_test -t
hackrf_info
SoapySDRUtil --find
systemctl is-active intercept.service
```

Expected pre-hardware result:

- Intercept service is active.
- Kismet is installed and inactive.
- `rtl_test`, `hackrf_info`, and `SoapySDRUtil --find` report no external SDR
  devices until dongles are attached.

First hardware pass:

1. Plug in the RTL-SDR dongle and run `lsusb`, `rtl_test -t`, and `rtl_433 -A`.
2. Plug in the monitor-mode Wi-Fi adapter and confirm it appears with `iw dev`
   and Kismet can see it as a source.
3. Plug in HackRF or LimeSDR hardware, if available, and run `hackrf_info` or
   `SoapySDRUtil --find`.
4. Confirm Intercept still serves `http://127.0.0.1:5050`.
5. Start only the specific Intercept or Kismet capture mode being tested.
