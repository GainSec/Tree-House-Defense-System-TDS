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


ANONYMOUS_SESSION = "00000000000000000000000000000000"
UNAVAILABLE_RSSI = -127
VOLATILE_STATE_FIELDS = {
    "lease_expires_in_seconds",
    "noise",
    "signal_avg",
    "inactive_ms",
    "connected_time_seconds",
}


class UbusClient:
    def __init__(self, *, url: str, username: str, password: str, timeout: float = 5.0, verify_tls: bool = True):
        self.url = url
        self.username = username
        self.password = password
        self.timeout = timeout
        self.verify_tls = verify_tls
        self.session_id = ANONYMOUS_SESSION

    def __enter__(self) -> "UbusClient":
        self.http = httpx.Client(timeout=self.timeout, verify=self.verify_tls)
        self.login()
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.http.close()

    def login(self) -> None:
        result = self.call(
            "session",
            "login",
            {"username": self.username, "password": self.password},
            session_id=ANONYMOUS_SESSION,
        )
        self.session_id = result["ubus_rpc_session"]

    def call(self, object_name: str, method: str, params: dict[str, Any] | None = None, *, session_id: str | None = None) -> dict:
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "call",
            "params": [session_id or self.session_id, object_name, method, params or {}],
        }
        response = self.http.post(self.url, json=payload)
        response.raise_for_status()
        body = response.json()
        if "error" in body:
            raise RuntimeError(body["error"])
        result = body.get("result")
        if not isinstance(result, list) or not result or result[0] != 0:
            raise RuntimeError(f"ubus call failed: {body}")
        return result[1] if len(result) > 1 else {}


def fetch_openwrt_outputs(
    *,
    url: str,
    username: str,
    password: str,
    wifi_interfaces: list[str] | None,
    timeout: float,
    verify_tls: bool,
) -> dict[str, Any]:
    with UbusClient(url=url, username=username, password=password, timeout=timeout, verify_tls=verify_tls) as client:
        devices = client.call("iwinfo", "devices")
        interfaces = wifi_interfaces or devices.get("devices", [])
        outputs: dict[str, Any] = {
            "board": client.call("system", "board"),
            "dhcp_leases": client.call("luci-rpc", "getDHCPLeases", {"family": 4}),
            "host_hints": client.call("luci-rpc", "getHostHints"),
            "network_interfaces": client.call("network.interface", "dump"),
            "wifi_interfaces": interfaces,
            "wifi_assoc": {},
        }
        for interface in interfaces:
            outputs["wifi_assoc"][interface] = client.call("iwinfo", "assoclist", {"device": interface})
        return outputs


def collect_observations(
    outputs: dict[str, Any],
    *,
    router_id: str,
    zone_id: str | None,
    observed_at: datetime | None = None,
) -> list[dict[str, Any]]:
    timestamp = observed_at or datetime.now(UTC)
    observations: list[dict[str, Any]] = []
    observations.extend(parse_board_info(outputs.get("board", {}), router_id=router_id, zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_dhcp_leases(outputs.get("dhcp_leases", {}), router_id=router_id, zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_host_hints(outputs.get("host_hints", {}), zone_id=zone_id, observed_at=timestamp))
    observations.extend(parse_network_interfaces(outputs.get("network_interfaces", {}), router_id=router_id, zone_id=zone_id, observed_at=timestamp))
    for interface, assoclist in outputs.get("wifi_assoc", {}).items():
        observations.extend(parse_iwinfo_assoclist(assoclist, interface=interface, zone_id=zone_id, observed_at=timestamp))
    return observations


def parse_board_info(data: dict[str, Any], *, router_id: str, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    if not data:
        return []
    return [
        build_observation(
            observed_at=observed_at,
            source="openwrt",
            sensor_id=router_id,
            zone_id=zone_id,
            protocol="infrastructure",
            identity_hint=data.get("hostname") or router_id,
            rssi=UNAVAILABLE_RSSI,
            known=True,
            metadata={
                "collector": "tds.openwrt.v1",
                "kind": "router_board",
                "hostname": data.get("hostname"),
                "model": data.get("model"),
                "release": data.get("release", {}).get("description"),
            },
            raw_payload=data,
        )
    ]


def parse_dhcp_leases(data: dict[str, Any], *, router_id: str, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for lease in data.get("dhcp_leases", []):
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="openwrt",
                sensor_id=router_id,
                zone_id=zone_id,
                protocol="router",
                identity_hint=normalize_mac(lease.get("macaddr")),
                rssi=UNAVAILABLE_RSSI,
                known=False,
                metadata={
                    "collector": "tds.openwrt.v1",
                    "kind": "dhcp_lease",
                    "ip_address": lease.get("ipaddr"),
                    "hostname": lease.get("hostname"),
                    "lease_expires_in_seconds": lease.get("expires") or None,
                },
                raw_payload=lease,
            )
        )
    return observations


def parse_host_hints(data: dict[str, Any], *, zone_id: str | None, observed_at: datetime) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for mac, hint in data.items():
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="openwrt",
                sensor_id="openwrt-host-hints",
                zone_id=zone_id,
                protocol="router",
                identity_hint=normalize_mac(mac),
                rssi=UNAVAILABLE_RSSI,
                known=False,
                metadata={
                    "collector": "tds.openwrt.v1",
                    "kind": "host_hint",
                    "name": hint.get("name"),
                    "ip_addresses": hint.get("ipaddrs", []),
                    "ipv6_addresses": hint.get("ip6addrs", []),
                },
                raw_payload={"macaddr": mac, **hint},
            )
        )
    return observations


def parse_network_interfaces(
    data: dict[str, Any],
    *,
    router_id: str,
    zone_id: str | None,
    observed_at: datetime,
) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for item in data.get("interface", []):
        interface = item.get("interface")
        if not interface:
            continue
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="openwrt",
                sensor_id=router_id,
                zone_id=zone_id,
                protocol="infrastructure",
                identity_hint=interface,
                rssi=UNAVAILABLE_RSSI,
                known=True,
                metadata={
                    "collector": "tds.openwrt.v1",
                    "kind": "network_interface",
                    "interface": interface,
                    "up": item.get("up"),
                    "device": item.get("device"),
                    "l3_device": item.get("l3_device"),
                    "proto": item.get("proto"),
                    "ipv4_addresses": item.get("ipv4-address", []),
                },
                raw_payload=item,
            )
        )
    return observations


def parse_iwinfo_assoclist(
    data: dict[str, Any],
    *,
    interface: str,
    zone_id: str | None,
    observed_at: datetime,
) -> list[dict[str, Any]]:
    observations: list[dict[str, Any]] = []
    for station in data.get("results", []):
        observations.append(
            build_observation(
                observed_at=observed_at,
                source="openwrt",
                sensor_id=interface,
                zone_id=zone_id,
                protocol="wifi",
                identity_hint=normalize_mac(station.get("mac")),
                rssi=int(station.get("signal", UNAVAILABLE_RSSI)),
                known=False,
                metadata={
                    "collector": "tds.openwrt.v1",
                    "kind": "wifi_station",
                    "interface": interface,
                    "noise": station.get("noise"),
                    "signal_avg": station.get("signal_avg"),
                    "inactive_ms": station.get("inactive"),
                    "connected_time_seconds": station.get("connected_time"),
                    "authorized": station.get("authorized"),
                    "authenticated": station.get("authenticated"),
                },
                raw_payload=station,
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


def normalize_mac(value: str | None) -> str | None:
    return value.lower() if value else None


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


def env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def parse_args() -> argparse.Namespace:
    load_env_file()
    parser = argparse.ArgumentParser(description="Collect OpenWrt ubus state and submit TDS observations.")
    parser.add_argument("--openwrt-url", default=os.getenv("TDS_OPENWRT_URL", "https://192.0.2.1/ubus"))
    parser.add_argument("--openwrt-username", default=os.getenv("TDS_OPENWRT_USERNAME", "tds"))
    parser.add_argument("--openwrt-password", default=os.getenv("TDS_OPENWRT_PASSWORD"))
    parser.add_argument("--openwrt-verify-tls", action=argparse.BooleanOptionalAction, default=env_bool("TDS_OPENWRT_VERIFY_TLS", False))
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--router-id", default="openwrt-router")
    parser.add_argument("--zone", dest="zone_id", default="network-core")
    parser.add_argument("--wifi-interface", action="append", dest="wifi_interfaces")
    parser.add_argument("--http-timeout", type=float, default=5.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "openwrt",
        {
            "url": "openwrt_url",
            "username": "openwrt_username",
            "password": "openwrt_password",
            "verify_tls": ("openwrt_verify_tls", bool_value),
        },
        settings_loader=collector_settings_from_dashboard,
    )
    return args


def main() -> None:
    args = parse_args()
    if not args.openwrt_password:
        raise SystemExit("TDS_OPENWRT_PASSWORD or --openwrt-password is required")

    outputs = fetch_openwrt_outputs(
        url=args.openwrt_url,
        username=args.openwrt_username,
        password=args.openwrt_password,
        wifi_interfaces=args.wifi_interfaces,
        timeout=args.http_timeout,
        verify_tls=args.openwrt_verify_tls,
    )
    observations = collect_observations(outputs, router_id=args.router_id, zone_id=args.zone_id)

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
