from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.dashboard_settings import apply_dashboard_settings_to_namespace, bool_value, collector_settings_from_dashboard


UNAVAILABLE_RSSI = -127
IOT_VENDOR_HINTS = {
    "00:12:4b": "Texas Instruments",
    "00:0d:6f": "Ember / Silicon Labs",
    "00:17:88": "Philips Hue / Signify",
    "00:21:2e": "Texas Instruments",
    "00:24:46": "Texas Instruments",
}

VOLATILE_STATE_FIELDS = {
    "first_time",
    "last_time",
    "mod_time",
    "packets_total",
    "packets_rx_total",
    "packets_tx_total",
    "datasize",
    "num_packets",
    "num_error_packets",
    "devices_count",
}


class KismetClient:
    def __init__(
        self,
        *,
        base_url: str,
        username: str,
        password: str,
        timeout: float = 10.0,
        verify_tls: bool = True,
        recent_seconds: int = 60,
    ):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        self.verify_tls = verify_tls
        self.recent_seconds = recent_seconds

    def __enter__(self) -> "KismetClient":
        self.http = httpx.Client(
            timeout=self.timeout,
            verify=self.verify_tls,
            auth=(self.username, self.password),
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.http.close()

    def get(self, path: str) -> Any:
        response = self.http.get(f"{self.base_url}{path}")
        response.raise_for_status()
        return response.json()

    def fetch_outputs(self) -> dict[str, Any]:
        return {
            "status": self.get("/system/status.json"),
            "datasources": self.get("/datasource/all_sources.json"),
            "devices": self.get(f"/devices/last-time/-{self.recent_seconds}/devices.json"),
        }


def fetch_kismet_outputs(
    *,
    base_url: str,
    username: str,
    password: str,
    timeout: float,
    verify_tls: bool,
    recent_seconds: int = 60,
) -> dict[str, Any]:
    with KismetClient(
        base_url=base_url,
        username=username,
        password=password,
        timeout=timeout,
        verify_tls=verify_tls,
        recent_seconds=recent_seconds,
    ) as client:
        return client.fetch_outputs()


def collect_observations(
    outputs: dict[str, Any],
    *,
    zone_id: str | None,
    observed_at: datetime | None = None,
) -> list[dict[str, Any]]:
    timestamp = observed_at or datetime.now(UTC)
    observations: list[dict[str, Any]] = []
    observations.extend(parse_status(outputs.get("status", {}), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_datasources(outputs.get("datasources", []), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_devices(outputs.get("devices", []), zone_id=zone_id, observed_at=timestamp))
    return observations


def parse_status(data: dict[str, Any], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    if not data:
        return []
    server_uuid = str(data.get("kismet.server.uuid") or "kismet")
    return [
        build_observation(
            observed_at=observed_at,
            source="kismet",
            sensor_id="kismet",
            zone_id=zone_id,
            protocol="infrastructure",
            identity_hint=server_uuid.lower(),
            rssi=UNAVAILABLE_RSSI,
            known=True,
            metadata={
                "collector": "tds.kismet.v1",
                "kind": "server_status",
                "server_name": data.get("kismet.system.server_name"),
                "server_description": data.get("kismet.system.server_description"),
                "server_location": data.get("kismet.system.server_location"),
                "version": data.get("kismet.system.version"),
                "devices_count": data.get("kismet.system.devices.count"),
            },
            raw_payload=data,
        )
    ]


def parse_datasources(data: list[dict[str, Any]], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations = []
    for source in data:
        source_uuid = source.get("kismet.datasource.uuid")
        name = source.get("kismet.datasource.name") or source.get("kismet.datasource.interface")
        identity = str(source_uuid or name or "unknown").lower()
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="kismet",
                sensor_id=str(name or "kismet-datasource"),
                zone_id=zone_id,
                protocol="infrastructure",
                identity_hint=str(name or identity),
                rssi=UNAVAILABLE_RSSI,
                known=True,
                metadata={
                    "collector": "tds.kismet.v1",
                    "kind": "datasource",
                    "source_uuid": source_uuid,
                    "name": name,
                    "interface": source.get("kismet.datasource.interface"),
                    "type_driver": source.get("kismet.datasource.type_driver"),
                    "running": source.get("kismet.datasource.running"),
                    "paused": source.get("kismet.datasource.paused"),
                    "error": source.get("kismet.datasource.error"),
                    "warning": source.get("kismet.datasource.warning"),
                    "num_packets": source.get("kismet.datasource.num_packets"),
                    "num_error_packets": source.get("kismet.datasource.num_error_packets"),
                },
                raw_payload=source,
            )
        )
    return observations


def parse_devices(data: list[dict[str, Any]], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations = []
    for device in data:
        phy = device.get("kismet.device.base.phyname")
        protocol, kind = protocol_and_kind(phy)
        if protocol is None:
            continue
        key = device.get("kismet.device.base.key")
        identity_hint = normalize_identity(device.get("kismet.device.base.macaddr"))
        state_identity = str(key or identity_hint or device.get("kismet.device.base.commonname") or "unknown").lower()
        metadata = {
            "collector": "tds.kismet.v1",
            "kind": kind,
            "kismet_key": key,
            "phyname": phy,
            "name": device.get("kismet.device.base.commonname") or device.get("kismet.device.base.name"),
            "manufacturer": device.get("kismet.device.base.manuf"),
            "channel": device.get("kismet.device.base.channel"),
            "frequency": device.get("kismet.device.base.frequency"),
            "first_time": device.get("kismet.device.base.first_time"),
            "last_time": device.get("kismet.device.base.last_time"),
            "mod_time": device.get("kismet.device.base.mod_time"),
            "packets_total": device.get("kismet.device.base.packets.total"),
            "packets_rx_total": device.get("kismet.device.base.packets.rx_total"),
            "packets_tx_total": device.get("kismet.device.base.packets.tx_total"),
            "datasize": device.get("kismet.device.base.datasize"),
        }
        if phy == "802.15.4":
            metadata.update(iot_context_metadata(device, rssi=extract_signal(device)))
            if metadata.get("iot_stack_hint") == "thread":
                protocol = "thread"
        observations.append(
            build_observation(
                observed_at=kismet_device_timestamp(device, fallback=observed_at),
                source="kismet",
                sensor_id=first_seenby_name(device) or "kismet",
                zone_id=zone_id,
                protocol=protocol,
                identity_hint=identity_hint or state_identity,
                rssi=extract_signal(device),
                known=False,
                metadata=metadata,
                raw_payload=device,
            )
        )
    return observations



def iot_context_metadata(device: dict[str, Any], *, rssi: int) -> dict[str, Any]:
    channel = string_or_none(device.get("kismet.device.base.channel"))
    frequency = numeric_or_none(device.get("kismet.device.base.frequency"))
    channel_mhz = None
    if frequency is not None:
        channel_mhz = round(frequency / 1000, 3) if frequency > 100000 else round(frequency, 3)
    iot_payload = nested_dict(device.get("802154.device"))
    stack_hint = iot_stack_hint(device, iot_payload)
    rx_packets = int_or_zero(device.get("kismet.device.base.packets.rx_total"))
    tx_packets = int_or_zero(device.get("kismet.device.base.packets.tx_total"))
    metadata = {
        "rf_family": "802.15.4",
        "iot_stack_hint": stack_hint,
        "iot_protocol_label": "Zigbee / Thread / 802.15.4",
        "iot_channel_mhz": channel_mhz,
        "packet_direction": packet_direction(rx_packets, tx_packets),
        "network_pan_id": first_present_value(
            iot_payload,
            [
                "802154.device.pan",
                "802154.device.panid",
                "802154.device.pan_id",
                "pan",
                "panid",
            ],
        ),
        "short_address": first_present_value(
            iot_payload,
            [
                "802154.device.short_addr",
                "802154.device.shortaddr",
                "short_addr",
                "short_address",
            ],
        ),
        "device_role_hint": iot_role_hint(device, iot_payload),
        "vendor_hint": iot_vendor_hint(device.get("kismet.device.base.macaddr")),
    }
    metadata = {key: value for key, value in metadata.items() if value not in (None, "")}
    metadata["operator_read"] = iot_operator_read(stack_hint, channel, metadata.get("packet_direction"), rssi)
    return metadata


def iot_stack_hint(device: dict[str, Any], iot_payload: dict[str, Any]) -> str:
    haystack = " ".join(str(value).lower() for value in [*device.values(), *iot_payload.values()] if value is not None)
    if "thread" in haystack:
        return "thread"
    if "zigbee" in haystack:
        return "zigbee"
    return "zigbee_or_thread"


def iot_role_hint(device: dict[str, Any], iot_payload: dict[str, Any]) -> str:
    role = string_or_none(first_present_value(iot_payload, ["802154.device.role", "role", "device_role"]))
    if role:
        return role
    mac = string_or_none(device.get("kismet.device.base.macaddr")) or ""
    if mac.lower() in {"ff:ff", "ff:ff:ff:ff:ff:ff"}:
        return "broadcast endpoint"
    return "mesh endpoint or router"


def packet_direction(rx_packets: int, tx_packets: int) -> str:
    if rx_packets > 0 and tx_packets > 0:
        return "bidirectional"
    if rx_packets > 0:
        return "receive only"
    if tx_packets > 0:
        return "transmit only"
    return "unknown"


def iot_vendor_hint(mac: Any) -> str | None:
    normalized = normalize_identity(mac)
    if not normalized:
        return None
    return IOT_VENDOR_HINTS.get(":".join(normalized.split(":")[:3]))


def iot_operator_read(stack_hint: str, channel: str | None, direction: str | None, rssi: int) -> str:
    stack = "Zigbee" if stack_hint == "zigbee" else "Thread" if stack_hint == "thread" else "802.15.4"
    channel_part = f" on channel {channel}" if channel else ""
    direction_part = f", {direction} packets" if direction and direction != "unknown" else ""
    signal_part = f", RSSI {rssi} dBm" if rssi != UNAVAILABLE_RSSI else ""
    return f"{stack} 802.15.4 device{channel_part}{direction_part}{signal_part}."


def nested_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def first_present_value(candidate: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        value = candidate.get(key)
        if value not in (None, ""):
            return value
    return None


def numeric_or_none(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def int_or_zero(value: Any) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0


def string_or_none(value: Any) -> str | None:
    text = "" if value is None else str(value).strip()
    return text or None


def kismet_device_timestamp(device: dict[str, Any], *, fallback: datetime) -> datetime:
    try:
        last_time = float(device.get("kismet.device.base.last_time"))
    except (TypeError, ValueError):
        return fallback
    if last_time <= 0:
        return fallback
    return datetime.fromtimestamp(last_time, tz=UTC)


def protocol_and_kind(phy: Any) -> tuple[str | None, str]:
    if phy == "IEEE802.11":
        return "wifi", "device"
    if phy == "Bluetooth":
        return "ble", "device"
    if phy == "ADSB":
        return "adsb", "aircraft"
    if phy == "802.15.4":
        return "zigbee", "iot_device"
    return None, "device"


def extract_signal(device: dict[str, Any]) -> int:
    signal = device.get("kismet.device.base.signal")
    if isinstance(signal, dict):
        for key in (
            "kismet.common.signal.last_signal",
            "kismet.common.signal.max_signal",
            "kismet.common.signal.min_signal",
        ):
            if signal.get(key) is not None:
                rssi = coerce_rssi(signal.get(key))
                return rssi if rssi < 0 else UNAVAILABLE_RSSI
    return UNAVAILABLE_RSSI


def first_seenby_name(device: dict[str, Any]) -> str | None:
    seenby = device.get("kismet.device.base.seenby")
    if isinstance(seenby, list) and seenby:
        first = seenby[0]
        if isinstance(first, dict):
            return first.get("kismet.common.seenby.uuid") or first.get("kismet.common.seenby.name")
    return None


def normalize_identity(value: Any) -> str | None:
    if not value:
        return None
    return str(value).lower()


def coerce_rssi(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return UNAVAILABLE_RSSI


def build_observation(
    *,
    observed_at: datetime,
    source: str,
    sensor_id: str,
    zone_id: str | None,
    protocol: str,
    identity_hint: str | None,
    rssi: int,
    known: bool,
    metadata: dict[str, Any],
    raw_payload: dict[str, Any],
) -> dict[str, Any]:
    kind = metadata.get("kind", protocol)
    state_identity = metadata.get("kismet_key") or metadata.get("source_uuid") or identity_hint or f"{sensor_id}:{kind}"
    stable_metadata = {key: value for key, value in metadata.items() if key not in VOLATILE_STATE_FIELDS}
    state_fields = {
        "source": source,
        "kind": kind,
        "protocol": protocol,
        "identity_hint": identity_hint,
        "sensor_id": sensor_id,
        "zone_id": zone_id,
        "known": known,
        "metadata": stable_metadata,
    }
    metadata = {
        **metadata,
        "state_key": f"{source}:{kind}:{state_identity}",
        "state_fingerprint": stable_hash(state_fields),
    }
    return {
        "timestamp": observed_at.isoformat(),
        "source": source,
        "sensor_id": sensor_id,
        "zone_id": zone_id,
        "protocol": protocol,
        "identity_hint": identity_hint,
        "rssi": rssi,
        "known": known,
        "metadata": metadata,
        "raw_payload": raw_payload,
    }


def submit_observations(
    observations: list[dict[str, Any]],
    *,
    base_url: str,
    api_key: str,
    timeout: float,
) -> list[dict[str, Any]]:
    results = []
    with httpx.Client(timeout=timeout) as client:
        for observation in observations:
            response = client.post(
                f"{base_url.rstrip('/')}/v1/observations",
                json=observation,
                headers={"x-tds-api-key": api_key},
            )
            response.raise_for_status()
            results.append(response.json())
    return results


def load_env_file(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def stable_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    load_env_file()
    parser = argparse.ArgumentParser(description="Collect Kismet passive RF state and submit TDS observations.")
    parser.add_argument("--kismet-url", default=os.getenv("TDS_KISMET_URL", "http://127.0.0.1:2501"))
    parser.add_argument("--kismet-username", default=os.getenv("TDS_KISMET_USERNAME"))
    parser.add_argument("--kismet-password", default=os.getenv("TDS_KISMET_PASSWORD"))
    parser.add_argument(
        "--kismet-verify-tls",
        action=argparse.BooleanOptionalAction,
        default=env_bool("TDS_KISMET_VERIFY_TLS", True),
    )
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default="rf-passive")
    parser.add_argument("--recent-seconds", type=int, default=int(os.getenv("TDS_KISMET_RECENT_SECONDS", "60")))
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "kismet",
        {
            "url": "kismet_url",
            "username": "kismet_username",
            "password": "kismet_password",
            "verify_tls": ("kismet_verify_tls", bool_value),
            "recent_seconds": ("recent_seconds", int),
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    if not args.kismet_username or not args.kismet_password:
        raise SystemExit("TDS_KISMET_USERNAME and TDS_KISMET_PASSWORD are required")

    outputs = fetch_kismet_outputs(
        base_url=args.kismet_url,
        username=args.kismet_username,
        password=args.kismet_password,
        timeout=args.http_timeout,
        verify_tls=args.kismet_verify_tls,
        recent_seconds=args.recent_seconds,
    )
    observations = collect_observations(outputs, zone_id=args.zone_id)

    if args.dry_run:
        print(json.dumps({"observations": observations, "count": len(observations)}, indent=2))
        return

    results = submit_observations(
        observations,
        base_url=args.base_url,
        api_key=args.api_key,
        timeout=args.http_timeout,
    )
    print(json.dumps({"submitted": len(results), "results": results}))


if __name__ == "__main__":
    main()
