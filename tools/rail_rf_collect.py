from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
import hashlib
import json
import os
import subprocess
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.dashboard_settings import apply_dashboard_settings_to_namespace, collector_settings_from_dashboard


@dataclass(frozen=True)
class RailBand:
    name: str
    label: str
    start_mhz: float
    end_mhz: float


DEFAULT_RAIL_BANDS: tuple[RailBand, ...] = (
    RailBand("aar-vhf", "AAR VHF rail", 160.215, 161.565),
)


AAR_CHANNEL_BASE_MHZ = 160.215
AAR_CHANNEL_SPACING_MHZ = 0.015
AAR_CHANNEL_BASE = 7
AAR_CHANNEL_TOLERANCE_MHZ = 0.008


def aar_channel_for_frequency(frequency_mhz: float) -> str | None:
    channel = round((frequency_mhz - AAR_CHANNEL_BASE_MHZ) / AAR_CHANNEL_SPACING_MHZ) + AAR_CHANNEL_BASE
    if channel < 7 or channel > 96:
        return None
    channel_frequency = AAR_CHANNEL_BASE_MHZ + ((channel - AAR_CHANNEL_BASE) * AAR_CHANNEL_SPACING_MHZ)
    if abs(frequency_mhz - channel_frequency) > AAR_CHANNEL_TOLERANCE_MHZ:
        return None
    return f"{channel:03d}"


def load_rail_catalog(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    data = json.loads(path.read_text())
    if isinstance(data, dict):
        data = data.get("items", [])
    return [item for item in data if isinstance(item, dict)]


def rail_catalog_match(frequency_mhz: float, catalog: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    if not catalog:
        return None
    best: tuple[float, dict[str, Any]] | None = None
    for item in catalog:
        try:
            catalog_frequency = float(item.get("frequency_mhz"))
        except (TypeError, ValueError):
            continue
        distance = abs(frequency_mhz - catalog_frequency)
        if distance <= AAR_CHANNEL_TOLERANCE_MHZ and (best is None or distance < best[0]):
            best = (distance, item)
    return best[1] if best else None


def rail_peak_context(peak: dict[str, Any], rail_catalog: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    frequency_mhz = float(peak["frequency_mhz"])
    aar_channel = aar_channel_for_frequency(frequency_mhz)
    catalog = rail_catalog_match(frequency_mhz, rail_catalog)
    channel_label = f"AAR {aar_channel}" if aar_channel else None
    operator = string_or_none(catalog.get("operator") if catalog else None)
    route = string_or_none(catalog.get("route") if catalog else None)
    usage = string_or_none(catalog.get("usage") if catalog else None)
    confidence = 0.52 if aar_channel else 0.38
    if catalog:
        confidence += 0.22
    context = {
        "aar_channel": aar_channel,
        "channel_label": channel_label,
        "activity_type": "rail_voice_or_data_activity",
        "rail_operator_hint": operator,
        "rail_route_hint": route,
        "rail_usage_hint": usage,
        "inference_confidence": round(min(confidence, 0.88), 2),
    }
    context["operator_read"] = rail_operator_read(frequency_mhz, context)
    return {key: value for key, value in context.items() if value not in (None, "")}


def rail_operator_read(frequency_mhz: float, context: dict[str, Any]) -> str:
    channel = string_or_none(context.get("channel_label")) or "Rail-band"
    operator = string_or_none(context.get("rail_operator_hint"))
    route = string_or_none(context.get("rail_route_hint"))
    if operator and route:
        return f"{channel} activity near {frequency_mhz:.3f} MHz, likely {operator} on {route}."
    if operator:
        return f"{channel} activity near {frequency_mhz:.3f} MHz, likely {operator}."
    return f"{channel} activity near {frequency_mhz:.3f} MHz."


def string_or_none(value: Any) -> str | None:
    text = "" if value is None else str(value).strip()
    return text or None


def parse_rtl_power_csv(csv_text: str, *, bands: tuple[RailBand, ...] = DEFAULT_RAIL_BANDS, power_floor: float = -80.0) -> list[dict[str, Any]]:
    peaks: dict[tuple[str, float], dict[str, Any]] = {}
    for row in csv.reader(csv_text.splitlines()):
        if len(row) < 7:
            continue
        try:
            start_hz = float(row[2].strip())
            end_hz = float(row[3].strip())
            step_hz = float(row[4].strip())
        except (TypeError, ValueError):
            continue
        if step_hz <= 0 or end_hz <= start_hz:
            continue
        for index, raw_power in enumerate(row[6:]):
            try:
                power_dbm = float(raw_power.strip())
            except (TypeError, ValueError):
                continue
            if power_dbm < power_floor:
                continue
            frequency_mhz = (start_hz + (index * step_hz) + (step_hz / 2)) / 1_000_000
            band = band_for_frequency(frequency_mhz, bands)
            if band is None:
                continue
            rounded_frequency = round(frequency_mhz, 3)
            key = (band.name, rounded_frequency)
            candidate = {
                "band": band.name,
                "band_label": band.label,
                "frequency_mhz": rounded_frequency,
                "power_dbm": round(power_dbm, 1),
            }
            if key not in peaks or candidate["power_dbm"] > peaks[key]["power_dbm"]:
                peaks[key] = candidate
    return sorted(peaks.values(), key=lambda item: item["power_dbm"], reverse=True)


def band_for_frequency(frequency_mhz: float, bands: tuple[RailBand, ...]) -> RailBand | None:
    for band in bands:
        if band.start_mhz <= frequency_mhz <= band.end_mhz:
            return band
    return None


def collect_observations(
    csv_text: str,
    *,
    zone_id: str | None,
    observed_at: datetime,
    power_floor: float = -80.0,
    rail_catalog: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    observations = []
    for peak in strongest_peak_per_band(parse_rtl_power_csv(csv_text, power_floor=power_floor)):
        context = rail_peak_context(peak, rail_catalog)
        enriched_peak = {**peak, **context}
        identity = f"{peak['band']}:{peak['frequency_mhz']:.3f}mhz"
        metadata = {
            "collector": "tds.rail_rf.v1",
            "kind": "rail_activity",
            "band": peak["band"],
            "band_label": peak["band_label"],
            "frequency_mhz": peak["frequency_mhz"],
            "power_dbm": peak["power_dbm"],
            "decode_status": "energy_only",
            **context,
            "state_key": f"rail_rf:rail_activity:{identity}",
            "state_fingerprint": stable_hash(
                {
                    "kind": "rail_activity",
                    "band": peak["band"],
                    "frequency_mhz": peak["frequency_mhz"],
                    "zone_id": zone_id,
                }
            ),
        }
        observations.append(
            {
                "timestamp": observed_at.isoformat(timespec="seconds"),
                "source": "rail_rf",
                "sensor_id": "rtl_sdr_rail",
                "zone_id": zone_id,
                "protocol": "rail",
                "identity_hint": identity,
                "rssi": max(-127, min(20, int(round(peak["power_dbm"])))),
                "known": False,
                "metadata": metadata,
                "raw_payload": enriched_peak,
            }
        )
    return observations


def strongest_peak_per_band(peaks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    strongest: dict[str, dict[str, Any]] = {}
    for peak in peaks:
        band = str(peak["band"])
        if band not in strongest or peak["power_dbm"] > strongest[band]["power_dbm"]:
            strongest[band] = peak
    return sorted(strongest.values(), key=lambda item: item["power_dbm"], reverse=True)


def rtl_power_command(
    *,
    device: str,
    bands: tuple[RailBand, ...] = DEFAULT_RAIL_BANDS,
    scan_seconds: int = 8,
    bin_width_hz: int = 10000,
) -> list[str]:
    ranges = ",".join(f"{band.start_mhz:.3f}M:{band.end_mhz:.3f}M:{format_bin_width(bin_width_hz)}" for band in bands)
    return ["rtl_power", "-d", device, "-f", ranges, "-i", str(scan_seconds), "-e", f"{scan_seconds}s"]


def rtl_device_candidates(device: str, *, auto_limit: int = 4) -> list[str]:
    parts = [raw_part.strip() for raw_part in device.split(",") if raw_part.strip()]
    has_explicit_serial = any(part.lower() != "auto" and not part.isdigit() for part in parts)
    candidates: list[str] = []
    for part in parts:
        if has_explicit_serial and part.lower() == "auto":
            continue
        expanded = [str(index) for index in range(auto_limit)] if part.lower() == "auto" else [part]
        for candidate in expanded:
            if candidate not in candidates:
                candidates.append(candidate)
    return candidates or [str(index) for index in range(auto_limit)]


def format_bin_width(bin_width_hz: int) -> str:
    if bin_width_hz % 1_000_000 == 0:
        return f"{bin_width_hz // 1_000_000}M"
    if bin_width_hz % 1_000 == 0:
        return f"{bin_width_hz // 1_000}k"
    return str(bin_width_hz)


def run_rtl_power(command: list[str], *, timeout: float) -> str:
    result = subprocess.run(command, check=True, capture_output=True, text=True, timeout=timeout)
    return result.stdout


def retryable_rtl_device_error(error: BaseException) -> bool:
    if isinstance(error, subprocess.TimeoutExpired):
        return True
    if isinstance(error, subprocess.CalledProcessError):
        text = "\n".join(part for part in [error.stdout, error.stderr, str(error)] if part)
    else:
        text = str(error)
    return "usb_claim_interface error" in text or "Failed to open rtlsdr device" in text


def run_rtl_power_with_fallback(
    devices: list[str],
    *,
    scan_seconds: int,
    bin_width_hz: int,
    timeout: float,
    runner=run_rtl_power,
) -> str:
    last_device_error: BaseException | None = None
    for device in devices:
        command = rtl_power_command(device=device, scan_seconds=scan_seconds, bin_width_hz=bin_width_hz)
        try:
            return runner(command, timeout=timeout)
        except Exception as error:
            if not retryable_rtl_device_error(error):
                raise
            last_device_error = error
    if last_device_error is not None:
        raise RuntimeError(f"No usable RTL-SDR rail device found after trying {', '.join(devices)}") from last_device_error
    raise RuntimeError("No RTL-SDR rail device candidates configured")


def submit_observations(observations: list[dict[str, Any]], *, base_url: str, api_key: str, timeout: float) -> list[dict[str, Any]]:
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
    parser = argparse.ArgumentParser(description="Collect passive rail-band RF activity and submit TDS observations.")
    parser.add_argument("--device", default=os.getenv("TDS_RAIL_RTL_DEVICE", "auto"))
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default=os.getenv("TDS_RAIL_RF_ZONE", "rf-passive"))
    parser.add_argument("--scan-seconds", type=int, default=int(os.getenv("TDS_RAIL_RF_SCAN_SECONDS", "8")))
    parser.add_argument("--bin-width-hz", type=int, default=int(os.getenv("TDS_RAIL_RF_BIN_WIDTH_HZ", "10000")))
    parser.add_argument("--power-floor", type=float, default=float(os.getenv("TDS_RAIL_RF_POWER_FLOOR", "-80")))
    parser.add_argument("--catalog", default=os.getenv("TDS_RAIL_RF_CATALOG"))
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "rail_rf",
        {
            "rtl_device": "device",
            "scan_seconds": ("scan_seconds", int),
            "catalog": "catalog",
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    csv_text = run_rtl_power_with_fallback(
        rtl_device_candidates(args.device),
        scan_seconds=args.scan_seconds,
        bin_width_hz=args.bin_width_hz,
        timeout=max(args.http_timeout, args.scan_seconds + 5),
    )
    rail_catalog = load_rail_catalog(Path(args.catalog)) if args.catalog else []
    observations = collect_observations(csv_text, zone_id=args.zone_id, observed_at=datetime.now(UTC), power_floor=args.power_floor, rail_catalog=rail_catalog)
    if args.dry_run:
        print(json.dumps({"observations": observations, "count": len(observations)}, indent=2))
        return
    results = submit_observations(observations, base_url=args.base_url, api_key=args.api_key, timeout=args.http_timeout)
    print(json.dumps({"submitted": len(results), "results": results}))


if __name__ == "__main__":
    main()
