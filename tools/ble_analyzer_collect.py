from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable, Mapping

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.dashboard_settings import apply_dashboard_settings_to_namespace, collector_settings_from_dashboard


TSHARK_FIELDS = [
    "frame.time_epoch",
    "btle.advertising_address",
    "btle_rf.signal_dbm",
    "btle_rf.flags.signal_dbm_valid",
    "btle_rf.channel",
    "btle.advertising_header.pdu_type",
    "btcommon.eir_ad.entry.device_name",
    "btcommon.eir_ad.entry.company_id",
    "btcommon.eir_ad.entry.uuid_16",
    "btcommon.eir_ad.entry.service_data",
]


@dataclass
class BleAdvertiser:
    address: str
    rssi: int
    packet_count: int = 0
    first_seen_epoch: float | None = None
    last_seen_epoch: float | None = None
    channels: list[str] = field(default_factory=list)
    pdu_types: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=list)
    company_ids: list[str] = field(default_factory=list)
    service_uuids: list[str] = field(default_factory=list)
    service_data: list[str] = field(default_factory=list)


def parse_tshark_rows(rows: Iterable[Mapping[str, str]]) -> dict[str, BleAdvertiser]:
    devices: dict[str, BleAdvertiser] = {}
    for row in rows:
        address = normalize_address(row.get("btle.advertising_address"))
        rssi = parse_valid_rssi(row)
        if not address or rssi is None:
            continue

        device = devices.get(address)
        if device is None:
            device = BleAdvertiser(address=address, rssi=rssi)
            devices[address] = device

        device.packet_count += 1
        device.rssi = max(device.rssi, rssi)
        epoch = numeric_value(row.get("frame.time_epoch"))
        if epoch is not None:
            device.first_seen_epoch = epoch if device.first_seen_epoch is None else min(device.first_seen_epoch, epoch)
            device.last_seen_epoch = epoch if device.last_seen_epoch is None else max(device.last_seen_epoch, epoch)
        append_unique(device.channels, split_values(row.get("btle_rf.channel")))
        append_unique(device.pdu_types, split_values(row.get("btle.advertising_header.pdu_type")))
        append_unique(device.names, split_values(row.get("btcommon.eir_ad.entry.device_name")))
        append_unique(device.company_ids, split_values(row.get("btcommon.eir_ad.entry.company_id")))
        append_unique(device.service_uuids, split_values(row.get("btcommon.eir_ad.entry.uuid_16")))
        append_unique(device.service_data, split_values(row.get("btcommon.eir_ad.entry.service_data")))

    for device in devices.values():
        device.channels.sort(key=lambda value: int(value) if value.isdigit() else 999)
    return devices


def collect_observations(
    devices: Mapping[str, BleAdvertiser],
    *,
    zone_id: str | None,
    observed_at: datetime | None = None,
    sensor_id: str = "wch_ble_analyzer",
) -> list[dict[str, Any]]:
    timestamp = observed_at or datetime.now(UTC)
    observations = []
    for device in devices.values():
        name = first_or_none(device.names)
        metadata = {
            "collector": "tds.ble_analyzer.v1",
            "kind": "ble_advertiser",
            "name": name,
            "rssi": device.rssi,
            "packet_count": device.packet_count,
            "channels": device.channels,
            "pdu_types": device.pdu_types,
            "company_ids": device.company_ids,
            "service_uuids": device.service_uuids,
            "service_data": device.service_data[:8],
            "first_seen_epoch": device.first_seen_epoch,
            "last_seen_epoch": device.last_seen_epoch,
        }
        observations.append(
            build_observation(
                observed_at=timestamp,
                source="ble_analyzer",
                sensor_id=sensor_id,
                zone_id=zone_id,
                protocol="ble",
                identity_hint=device.address,
                rssi=device.rssi,
                known=False,
                metadata=metadata,
                raw_payload={"ble_analyzer": metadata},
            )
        )
    return observations


def capture_pcap(*, pcap_dir: Path, capture_seconds: int, wch_capture: str) -> Path:
    pcap_dir.mkdir(parents=True, exist_ok=True)
    pcap_path = pcap_dir / f"ble-{datetime.now(UTC).strftime('%Y%m%d-%H%M%S')}.pcap"
    command = ["timeout", str(capture_seconds), wch_capture, "-w", str(pcap_path)]
    result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode not in {0, 124}:
        raise RuntimeError(f"wch_capture failed with exit {result.returncode}: {result.stderr.strip()}")
    return pcap_path


def read_tshark_rows(*, pcap_path: Path, tshark: str) -> list[dict[str, str]]:
    command = [
        tshark,
        "-r",
        str(pcap_path),
        "-T",
        "fields",
        "-E",
        "header=y",
        "-E",
        "separator=\t",
        "-E",
        "occurrence=a",
    ]
    for field_name in TSHARK_FIELDS:
        command.extend(["-e", field_name])
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"tshark failed with exit {result.returncode}: {result.stderr.strip()}")
    return list(csv.DictReader(result.stdout.splitlines(), delimiter="\t"))


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


def build_observation(
    *,
    observed_at: datetime,
    source: str,
    sensor_id: str,
    zone_id: str | None,
    protocol: str,
    identity_hint: str,
    rssi: int,
    known: bool,
    metadata: dict[str, Any],
    raw_payload: dict[str, Any],
) -> dict[str, Any]:
    kind = metadata.get("kind", protocol)
    stable_metadata = {
        key: value
        for key, value in metadata.items()
        if key not in {"packet_count", "first_seen_epoch", "last_seen_epoch"}
    }
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
        "state_key": f"{source}:{kind}:{identity_hint}",
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


def parse_valid_rssi(row: Mapping[str, str]) -> int | None:
    if string_value(row.get("btle_rf.flags.signal_dbm_valid")).lower() not in {"true", "1"}:
        return None
    rssi = int_value(row.get("btle_rf.signal_dbm"))
    if rssi is None or rssi >= 0:
        return None
    return rssi


def split_values(value: Any) -> list[str]:
    return [part.strip() for part in string_value(value).split(",") if part.strip()]


def append_unique(target: list[str], values: Iterable[str]) -> None:
    seen = set(target)
    for value in values:
        if value not in seen:
            target.append(value)
            seen.add(value)


def first_or_none(values: list[str]) -> str | None:
    return values[0] if values else None


def normalize_address(value: Any) -> str | None:
    address = string_value(value).lower()
    return address if address and address != "00:00:00:00:00:00" else None


def string_value(value: Any) -> str:
    return "" if value is None else str(value).strip()


def numeric_value(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


def int_value(value: Any) -> int | None:
    parsed = numeric_value(value)
    return int(parsed) if parsed is not None else None


def stable_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def load_env_file(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def parse_args() -> argparse.Namespace:
    load_env_file()
    parser = argparse.ArgumentParser(description="Capture WCH BLE Analyzer packets and submit TDS BLE observations.")
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default=os.getenv("TDS_BLE_ANALYZER_ZONE", "rf-passive"))
    parser.add_argument("--sensor-id", default=os.getenv("TDS_BLE_ANALYZER_SENSOR_ID", "wch_ble_analyzer"))
    parser.add_argument("--capture-seconds", type=int, default=int(os.getenv("TDS_BLE_ANALYZER_CAPTURE_SECONDS", "8")))
    parser.add_argument("--pcap-dir", type=Path, default=Path(os.getenv("TDS_BLE_ANALYZER_PCAP_DIR", "/var/log/tds/ble-analyzer")))
    parser.add_argument("--pcap", type=Path, default=None, help="Parse an existing PCAP instead of starting wch_capture.")
    parser.add_argument("--wch-capture", default=os.getenv("TDS_WCH_CAPTURE_BIN", "wch_capture"))
    parser.add_argument("--tshark", default=os.getenv("TDS_TSHARK_BIN", "tshark"))
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--retain-pcap", action="store_true", default=os.getenv("TDS_BLE_ANALYZER_RETAIN_PCAP", "").lower() in {"1", "true", "yes", "on"})
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "ble_analyzer",
        {
            "capture_seconds": ("capture_seconds", int),
            "pcap_dir": ("pcap_dir", Path),
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    pcap_path = args.pcap or capture_pcap(
        pcap_dir=args.pcap_dir,
        capture_seconds=args.capture_seconds,
        wch_capture=args.wch_capture,
    )
    try:
        rows = read_tshark_rows(pcap_path=pcap_path, tshark=args.tshark)
        devices = parse_tshark_rows(rows)
        observations = collect_observations(devices, zone_id=args.zone_id, sensor_id=args.sensor_id)

        if args.dry_run:
            print(json.dumps({"observations": observations, "count": len(observations), "pcap": str(pcap_path)}, indent=2))
            return

        results = submit_observations(
            observations,
            base_url=args.base_url,
            api_key=args.api_key,
            timeout=args.http_timeout,
        )
        print(json.dumps({"submitted": len(results), "results": results, "pcap": str(pcap_path)}))
    finally:
        if args.pcap is None and not args.retain_pcap:
            pcap_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise
