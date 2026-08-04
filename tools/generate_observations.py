from __future__ import annotations

import argparse
import json
import random
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx


def build_observation(
    *,
    protocol: str = "ble",
    zone_id: str = "entrance",
    sensor_id: str = "front-door",
    source: str = "synthetic",
    rssi: int | None = None,
    known: bool = False,
) -> dict[str, Any]:
    identity_hint = _identity_hint(protocol)
    signal = rssi if rssi is not None else random.randint(-70, -42)
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "source": source,
        "sensor_id": sensor_id,
        "zone_id": zone_id,
        "protocol": protocol,
        "identity_hint": identity_hint,
        "rssi": signal,
        "known": known,
        "metadata": {"generator": "tds.synthetic.v1"},
        "raw_payload": {
            "synthetic_id": uuid.uuid4().hex,
            "identity_hint": identity_hint,
            "protocol": protocol,
        },
    }


def build_observations(
    *,
    count: int,
    protocol: str = "ble",
    zone_id: str = "entrance",
    sensor_id: str = "front-door",
    source: str = "synthetic",
    rssi: int | None = None,
    known: bool = False,
) -> list[dict[str, Any]]:
    return [
        build_observation(
            protocol=protocol,
            zone_id=zone_id,
            sensor_id=sensor_id,
            source=source,
            rssi=rssi,
            known=known,
        )
        for _ in range(count)
    ]


def submit_observation(
    payload: dict[str, Any],
    *,
    base_url: str,
    api_key: str,
    client: Any | None = None,
    timeout: float = 5.0,
) -> dict[str, Any]:
    http_client = client or httpx
    response = http_client.post(
        f"{base_url.rstrip('/')}/v1/observations",
        json=payload,
        headers={"x-tds-api-key": api_key},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def _identity_hint(protocol: str) -> str:
    octets = [random.randint(0, 255) for _ in range(6)]
    if protocol == "wifi":
        octets[0] &= 0b11111110
    return ":".join(f"{octet:02x}" for octet in octets)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate synthetic TDS observations.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8080")
    parser.add_argument("--api-key", default="change-me")
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--protocol", choices=["ble", "wifi", "manual"], default="ble")
    parser.add_argument("--zone", dest="zone_id", default="entrance")
    parser.add_argument("--sensor", dest="sensor_id", default="front-door")
    parser.add_argument("--source", default="synthetic")
    parser.add_argument("--rssi", type=int)
    parser.add_argument("--known", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    for payload in build_observations(
        count=args.count,
        protocol=args.protocol,
        zone_id=args.zone_id,
        sensor_id=args.sensor_id,
        source=args.source,
        rssi=args.rssi,
        known=args.known,
    ):
        result = submit_observation(payload, base_url=args.base_url, api_key=args.api_key)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
