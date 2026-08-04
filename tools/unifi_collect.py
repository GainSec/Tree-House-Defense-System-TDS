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
VOLATILE_STATE_FIELDS = set()


class UnifiClient:
    def __init__(self, *, base_url: str, api_key: str, timeout: float = 10.0, verify_tls: bool = True):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout
        self.verify_tls = verify_tls

    def __enter__(self) -> "UnifiClient":
        self.http = httpx.Client(
            timeout=self.timeout,
            verify=self.verify_tls,
            headers={"X-API-Key": self.api_key, "Accept": "application/json"},
        )
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.http.close()

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        response = self.http.get(f"{self.base_url}{path}", params=params)
        response.raise_for_status()
        return response.json()

    def list_sites(self) -> list[dict[str, Any]]:
        return extract_items(self.get("/proxy/network/integration/v1/sites", params={"offset": 0, "limit": 200}))

    def list_clients(self, site_id: str) -> list[dict[str, Any]]:
        return self._paginated(f"/proxy/network/integration/v1/sites/{site_id}/clients")

    def list_devices(self, site_id: str) -> list[dict[str, Any]]:
        return self._paginated(f"/proxy/network/integration/v1/sites/{site_id}/devices")

    def _paginated(self, path: str) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        offset = 0
        limit = 200
        while True:
            page = extract_items(self.get(path, params={"offset": offset, "limit": limit}))
            items.extend(page)
            if len(page) < limit:
                return items
            offset += limit


def fetch_unifi_outputs(
    *,
    base_url: str,
    api_key: str,
    site_id: str | None,
    timeout: float,
    verify_tls: bool,
) -> dict[str, Any]:
    with UnifiClient(base_url=base_url, api_key=api_key, timeout=timeout, verify_tls=verify_tls) as client:
        sites = client.list_sites()
        selected_site = select_site(sites, site_id)
        selected_site_id = str(selected_site.get("id") or selected_site.get("_id") or selected_site.get("siteId"))
        return {
            "sites": sites,
            "site": selected_site,
            "site_id": selected_site_id,
            "clients": client.list_clients(selected_site_id),
            "devices": client.list_devices(selected_site_id),
        }


def select_site(sites: list[dict[str, Any]], site_id: str | None) -> dict[str, Any]:
    if not sites:
        raise RuntimeError("UniFi returned no sites")
    if site_id:
        for site in sites:
            if site_id in {str(site.get("id")), str(site.get("_id")), str(site.get("siteId")), str(site.get("name"))}:
                return site
        raise RuntimeError(f"UniFi site not found: {site_id}")
    for site in sites:
        if str(site.get("name", "")).lower() == "default":
            return site
    return sites[0]


def collect_observations(outputs: dict[str, Any], *, zone_id: str | None, observed_at: datetime | None = None) -> list[dict[str, Any]]:
    timestamp = observed_at or datetime.now(UTC)
    site = outputs.get("site", {})
    site_id = str(outputs.get("site_id") or site.get("id") or "default")
    observations: list[dict[str, Any]] = []
    observations.extend(parse_clients(outputs.get("clients", []), site_id=site_id, zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_devices(outputs.get("devices", []), site_id=site_id, zone_id=zone_id, observed_at=timestamp))
    return observations


def parse_clients(clients: list[dict[str, Any]], *, site_id: str, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for client in clients:
        mac = first_present(client, "macAddress", "mac", "clientMac", "id")
        access = client.get("access") if isinstance(client.get("access"), dict) else {}
        wifi = client.get("wifi") if isinstance(client.get("wifi"), dict) else {}
        rssi = first_present(client, "rssi", "signal", "lastConnectedToWiFiRssi") or first_present(access, "rssi", "signal") or first_present(wifi, "rssi", "signal")
        protocol = "wifi" if rssi is not None or str(access.get("type", "")).lower() == "wireless" else "router"
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="unifi",
                sensor_id=str(first_present(client, "connectedToDeviceName", "uplinkDeviceName", "apName") or site_id),
                zone_id=zone_id or str(first_present(client, "networkName", "vlanName") or site_id),
                protocol=protocol,
                identity_hint=normalize_mac(mac),
                rssi=coerce_rssi(rssi),
                known=False,
                metadata={
                    "collector": "tds.unifi.v1",
                    "kind": "client",
                    "site_id": site_id,
                    "name": first_present(client, "name", "displayName", "hostname"),
                    "ip_address": first_present(client, "ipAddress", "ip"),
                    "network": first_present(client, "networkName", "network"),
                    "connection_type": first_present(access, "type") or first_present(client, "type"),
                },
                raw_payload=client,
            )
        )
    return observations


def parse_devices(devices: list[dict[str, Any]], *, site_id: str, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for device in devices:
        mac = first_present(device, "macAddress", "mac", "id")
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="unifi",
                sensor_id=str(first_present(device, "name", "displayName", "model", "id") or "unifi-device"),
                zone_id=zone_id or site_id,
                protocol="infrastructure",
                identity_hint=normalize_mac(mac),
                rssi=UNAVAILABLE_RSSI,
                known=True,
                metadata={
                    "collector": "tds.unifi.v1",
                    "kind": "device",
                    "site_id": site_id,
                    "name": first_present(device, "name", "displayName"),
                    "model": first_present(device, "model", "modelName"),
                    "ip_address": first_present(device, "ipAddress", "ip"),
                    "state": first_present(device, "state", "status"),
                    "type": first_present(device, "type", "deviceType"),
                },
                raw_payload=device,
            )
        )
    return observations


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


def extract_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("items", "data", "results"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
        if isinstance(value, dict):
            nested = extract_items(value)
            if nested:
                return nested
    return []


def first_present(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None and value != "":
            return value
    return None


def coerce_rssi(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return UNAVAILABLE_RSSI


def normalize_mac(value: Any) -> str | None:
    if not value:
        return None
    return str(value).lower()


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
    parser = argparse.ArgumentParser(description="Collect UniFi Network state and submit TDS observations.")
    parser.add_argument("--unifi-url", default=os.getenv("TDS_UNIFI_URL", ""))
    parser.add_argument("--unifi-api-key", default=os.getenv("TDS_UNIFI_API_KEY"))
    parser.add_argument("--unifi-site-id", default=os.getenv("TDS_UNIFI_SITE_ID"))
    parser.add_argument("--unifi-verify-tls", action=argparse.BooleanOptionalAction, default=env_bool("TDS_UNIFI_VERIFY_TLS", True))
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default="unifi-network")
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "unifi",
        {
            "url": "unifi_url",
            "api_key": "unifi_api_key",
            "site_id": "unifi_site_id",
            "verify_tls": ("unifi_verify_tls", bool_value),
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    if not args.unifi_api_key:
        raise SystemExit("TDS_UNIFI_API_KEY or --unifi-api-key is required")

    outputs = fetch_unifi_outputs(
        base_url=args.unifi_url,
        api_key=args.unifi_api_key,
        site_id=args.unifi_site_id,
        timeout=args.http_timeout,
        verify_tls=args.unifi_verify_tls,
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
