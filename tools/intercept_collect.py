from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
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
VOLATILE_STATE_FIELDS = {
    "data",
    "uptime_seconds",
    "aircraft_count",
    "bt_devices_count",
    "dsc_messages_count",
    "vessel_count",
    "wifi_clients_count",
    "wifi_networks_count",
}


class InterceptClient:
    def __init__(
        self,
        *,
        base_url: str,
        username: str | None = None,
        password: str | None = None,
        timeout: float = 10.0,
        verify_tls: bool = True,
        transport: httpx.BaseTransport | None = None,
    ):
        self.base_url = base_url.rstrip("/")
        self.username = username
        self.password = password
        self.timeout = timeout
        self.verify_tls = verify_tls
        self.transport = transport
        self.authenticated = False

    def __enter__(self) -> "InterceptClient":
        self.http = httpx.Client(timeout=self.timeout, verify=self.verify_tls, transport=self.transport, follow_redirects=False)
        if self.username and self.password:
            self.login()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.http.close()

    def login(self) -> None:
        response = self.http.get(f"{self.base_url}/login")
        if response.status_code == 429:
            self.authenticated = False
            return
        if response.status_code >= 400:
            raise RuntimeError(f"Intercept login page unavailable: HTTP {response.status_code}")
        csrf_token = extract_csrf_token(response.text)
        form = {"username": self.username or "", "password": self.password or ""}
        if csrf_token:
            form["csrf_token"] = csrf_token
        response = self.http.post(f"{self.base_url}/login", data=form)
        if response.status_code == 429:
            self.authenticated = False
            return
        if response.status_code not in {302, 303}:
            raise RuntimeError(f"Intercept login failed: HTTP {response.status_code}")
        self.authenticated = True

    def get_json(self, path: str, *, allow_unauthenticated: bool = False) -> Any:
        response = self.http.get(f"{self.base_url}{path}")
        if response.status_code == 429:
            raise RuntimeError(f"Intercept rate limit hit while reading {path}")
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" not in content_type:
            if allow_unauthenticated:
                return None
            raise RuntimeError(f"Intercept endpoint {path} did not return JSON")
        return response.json()

    def fetch_outputs(self) -> dict[str, Any]:
        health = self.get_json("/health")
        if not self.authenticated and self.username and self.password:
            return {
                "health": health,
                "sdr_devices": [],
                "subghz_status": {},
                "alert_events": {},
            }
        sdr_devices = self.get_json("/devices/status", allow_unauthenticated=True)
        if sdr_devices is None:
            sdr_devices = self.get_json("/system/sdr_devices", allow_unauthenticated=True)
            if isinstance(sdr_devices, dict):
                sdr_devices = sdr_devices.get("devices", [])
        subghz_status = self.optional_json("/subghz/status")
        alert_events = self.optional_json("/alerts/events?limit=100")
        return {
            "health": health,
            "sdr_devices": sdr_devices or [],
            "subghz_status": subghz_status or {},
            "alert_events": alert_events or {},
        }

    def optional_json(self, path: str) -> Any:
        try:
            return self.get_json(path, allow_unauthenticated=True)
        except httpx.HTTPStatusError:
            return None


def fetch_intercept_outputs(
    *,
    base_url: str,
    username: str | None,
    password: str | None,
    timeout: float,
    verify_tls: bool,
) -> dict[str, Any]:
    with InterceptClient(
        base_url=base_url,
        username=username,
        password=password,
        timeout=timeout,
        verify_tls=verify_tls,
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
    observations.extend(parse_health(outputs.get("health", {}), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_sdr_devices(outputs.get("sdr_devices", []), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_subghz_status(outputs.get("subghz_status", {}), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_intercept_alert_events(outputs.get("alert_events", {}), zone_id=zone_id, observed_at=timestamp))
    return observations


def parse_health(data: dict[str, Any], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    if not data:
        return []
    counts = data.get("data") if isinstance(data.get("data"), dict) else {}
    metadata = {
        "collector": "tds.intercept.v1",
        "kind": "server_status",
        "database": data.get("database"),
        "processes": data.get("processes") if isinstance(data.get("processes"), dict) else {},
        "data": counts,
        "uptime_seconds": data.get("uptime_seconds"),
    }
    if isinstance(counts, dict):
        metadata.update({key: counts.get(key) for key in counts})
    return [
        build_observation(
            observed_at=observed_at,
            source="intercept",
            sensor_id="intercept",
            zone_id=zone_id,
            protocol="infrastructure",
            identity_hint="intercept",
            rssi=UNAVAILABLE_RSSI,
            known=True,
            metadata=metadata,
            raw_payload=data,
        )
    ]


def parse_sdr_devices(data: list[dict[str, Any]], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations = []
    for device in data:
        device_type = str(device.get("type") or device.get("sdr_type") or "sdr").lower()
        index = device.get("index", 0)
        serial = str(device.get("serial") or "").strip()
        identity = f"{device_type}:{index}:{serial}" if serial else f"{device_type}:{index}"
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="intercept",
                sensor_id=str(device.get("name") or identity),
                zone_id=zone_id,
                protocol="sdr",
                identity_hint=identity,
                rssi=UNAVAILABLE_RSSI,
                known=True,
                metadata={
                    "collector": "tds.intercept.v1",
                    "kind": "sdr_device",
                    "device_type": device_type,
                    "index": index,
                    "name": device.get("name"),
                    "serial": serial,
                    "driver": device.get("driver"),
                    "in_use": device.get("in_use"),
                    "used_by": device.get("used_by"),
                },
                raw_payload=device,
            )
        )
    return observations


def parse_subghz_status(data: dict[str, Any], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    if not data:
        return []
    metadata = {
        "collector": "tds.intercept.v1",
        "kind": "subghz_status",
        "mode": data.get("mode"),
        "hackrf_available": data.get("hackrf_available"),
        "hackrf_connected": data.get("hackrf_connected"),
        "hackrf_info_available": data.get("hackrf_info_available"),
        "hackrf_detection_paused": data.get("hackrf_detection_paused"),
        "rtl433_available": data.get("rtl433_available"),
        "sweep_available": data.get("sweep_available"),
    }
    return [
        build_observation(
            observed_at=observed_at,
            source="intercept",
            sensor_id="intercept-subghz",
            zone_id=zone_id,
            protocol="infrastructure",
            identity_hint="intercept-subghz",
            rssi=UNAVAILABLE_RSSI,
            known=True,
            metadata=metadata,
            raw_payload=data,
        )
    ]


def parse_intercept_alert_events(data: dict[str, Any], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    events = data.get("events") if isinstance(data, dict) else []
    if not isinstance(events, list):
        return []
    observations = []
    for event in events:
        if not isinstance(event, dict):
            continue
        mode = str(event.get("mode") or "intercept").lower()
        event_payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        decoded = event_payload.get("event") if isinstance(event_payload.get("event"), dict) else event_payload
        identity = first_string(
            decoded.get("id"),
            decoded.get("device_id"),
            decoded.get("hash"),
            decoded.get("address"),
            decoded.get("mac"),
            event.get("id"),
        )
        rssi = int_or_default(decoded.get("rssi") or decoded.get("power") or decoded.get("signal"), UNAVAILABLE_RSSI)
        metadata = {
            "collector": "tds.intercept.v1",
            "kind": "intercept_event",
            "mode": mode,
            "event_id": event.get("id"),
            "event_type": event.get("event_type"),
            "severity": event.get("severity"),
            "message": event.get("message"),
            "frequency": decoded.get("frequency") or decoded.get("frequency_mhz") or decoded.get("freq"),
        }
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="intercept",
                sensor_id=f"intercept-{mode}",
                zone_id=zone_id,
                protocol="subghz" if mode in {"subghz", "ook", "rtlamr"} else "sdr",
                identity_hint=identity or f"{mode}:{event.get('id')}",
                rssi=max(-127, min(20, rssi)),
                known=False,
                metadata=metadata,
                raw_payload=event,
            )
        )
    return observations


def first_string(*values: Any) -> str:
    for value in values:
        text = str(value).strip() if value is not None else ""
        if text:
            return text
    return ""


def int_or_default(value: Any, default: int) -> int:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return default


def extract_csrf_token(html: str) -> str | None:
    match = re.search(r'name=["\']csrf_token["\']\s+value=["\']([^"\']+)["\']', html)
    if match:
        return match.group(1)
    match = re.search(r'value=["\']([^"\']+)["\']\s+name=["\']csrf_token["\']', html)
    return match.group(1) if match else None


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
    state_identity = identity_hint or f"{sensor_id}:{kind}"
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
    parser = argparse.ArgumentParser(description="Collect Intercept RF platform state and submit TDS observations.")
    parser.add_argument("--intercept-url", default=os.getenv("TDS_INTERCEPT_URL", "http://127.0.0.1:5050"))
    parser.add_argument("--intercept-username", default=os.getenv("TDS_INTERCEPT_USERNAME"))
    parser.add_argument("--intercept-password", default=os.getenv("TDS_INTERCEPT_PASSWORD"))
    parser.add_argument(
        "--intercept-verify-tls",
        action=argparse.BooleanOptionalAction,
        default=env_bool("TDS_INTERCEPT_VERIFY_TLS", True),
    )
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default="rf-active")
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "intercept",
        {
            "url": "intercept_url",
            "username": "intercept_username",
            "password": "intercept_password",
            "verify_tls": ("intercept_verify_tls", bool_value),
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    outputs = fetch_intercept_outputs(
        base_url=args.intercept_url,
        username=args.intercept_username,
        password=args.intercept_password,
        timeout=args.http_timeout,
        verify_tls=args.intercept_verify_tls,
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
