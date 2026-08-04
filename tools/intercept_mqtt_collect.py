from __future__ import annotations

import argparse
import dataclasses
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from tools.dashboard_settings import apply_dashboard_settings_to_namespace, collector_settings_from_dashboard


UNAVAILABLE_RSSI = -127


@dataclasses.dataclass(frozen=True)
class HackRfRotationProfile:
    name: str
    label: str
    target_class: str
    freq_start_mhz: float
    freq_end_mhz: float
    dwell_seconds: int
    bin_width: int = 250000
    decoders: tuple[str, ...] = ()


DEFAULT_HACKRF_ROTATION_PROFILES: tuple[HackRfRotationProfile, ...] = (
    HackRfRotationProfile(
        name="tpms",
        label="TPMS",
        target_class="tpms",
        freq_start_mhz=314.8,
        freq_end_mhz=315.2,
        dwell_seconds=90,
        decoders=("rtl_433:tpms",),
    ),
    HackRfRotationProfile(
        name="utility",
        label="Utility meters",
        target_class="utility",
        freq_start_mhz=902.0,
        freq_end_mhz=928.0,
        dwell_seconds=120,
        decoders=("rtlamr", "rtl_433:scm"),
    ),
    HackRfRotationProfile(
        name="leak_sensors",
        label="Leak sensors",
        target_class="leak_sensor",
        freq_start_mhz=433.05,
        freq_end_mhz=434.79,
        dwell_seconds=90,
        decoders=("rtl_433:ook",),
    ),
    HackRfRotationProfile(
        name="smart_thermostat",
        label="Smart thermostat",
        target_class="thermostat",
        freq_start_mhz=344.5,
        freq_end_mhz=345.5,
        dwell_seconds=90,
        decoders=("rtl_433:ook",),
    ),
    HackRfRotationProfile(
        name="door_window",
        label="Door/window sensors",
        target_class="door_window_sensor",
        freq_start_mhz=318.5,
        freq_end_mhz=319.8,
        dwell_seconds=90,
        decoders=("rtl_433:ook",),
    ),
)


def parse_sweep_payload(
    payload: dict[str, Any],
    *,
    zone_id: str | None,
    observed_at: datetime,
    limit: int = 8,
    power_floor: float = -70.0,
    profile: HackRfRotationProfile | None = None,
) -> list[dict[str, Any]]:
    points = payload.get("points") if isinstance(payload, dict) else []
    if not isinstance(points, list):
        return []

    parsed: list[tuple[float, float]] = []
    for point in points:
        if not isinstance(point, dict):
            continue
        try:
            frequency_mhz = float(point.get("freq"))
            power_dbm = float(point.get("power"))
        except (TypeError, ValueError):
            continue
        if not (frequency_mhz > 0) or power_dbm < power_floor:
            continue
        if profile and not (profile.freq_start_mhz <= frequency_mhz <= profile.freq_end_mhz):
            continue
        parsed.append((frequency_mhz, power_dbm))

    observations = []
    for frequency_mhz, power_dbm in sorted(parsed, key=lambda item: item[1], reverse=True)[:limit]:
        profile_name = profile.name if profile else "sweep"
        target_class = profile.target_class if profile else "unknown_rf"
        identity = f"hackrf-{profile_name}:{frequency_mhz:.3f}mhz"
        metadata = {
            "collector": "tds.intercept.mqtt.v1",
            "kind": "spectrum_peak",
            "frequency_mhz": round(frequency_mhz, 6),
            "power_dbm": round(power_dbm, 1),
            "scan_profile": profile_name,
            "target_class": target_class,
            "decode_status": "candidate",
            "decoded": False,
            "decoders": list(profile.decoders) if profile else [],
            "state_key": f"intercept:spectrum_peak:{identity}",
            "state_fingerprint": stable_hash(
                {"kind": "spectrum_peak", "scan_profile": profile_name, "frequency_mhz": round(frequency_mhz, 3)}
            ),
        }
        observations.append(
            {
                "timestamp": observed_at.isoformat(),
                "source": "intercept",
                "sensor_id": f"hackrf_{profile_name}",
                "zone_id": zone_id,
                "protocol": "sdr" if profile is None else "subghz",
                "identity_hint": identity,
                "rssi": max(-127, min(20, int(round(power_dbm)))),
                "known": False,
                "metadata": metadata,
                "raw_payload": payload,
            }
        )
    return observations


def rotation_profile_payload(profile: HackRfRotationProfile) -> dict[str, Any]:
    return {
        "profile": profile.name,
        "target_class": profile.target_class,
        "freq_start_mhz": profile.freq_start_mhz,
        "freq_end_mhz": profile.freq_end_mhz,
        "bin_width": profile.bin_width,
        "dwell_seconds": profile.dwell_seconds,
        "decoders": list(profile.decoders),
        "record_capture": True,
    }


def submit_observations(observations: list[dict[str, Any]], *, base_url: str, api_key: str, timeout: float) -> int:
    submitted = 0
    with httpx.Client(timeout=timeout) as client:
        for observation in observations:
            try:
                response = client.post(
                    f"{base_url.rstrip('/')}/v1/observations",
                    json=observation,
                    headers={"x-tds-api-key": api_key},
                )
                response.raise_for_status()
                submitted += 1
            except httpx.HTTPError:
                continue
    return submitted


def ensure_subghz_sweep(args: argparse.Namespace) -> None:
    if not args.ensure_sweep:
        return
    health = public_intercept_json(args.intercept_url, "/health", timeout=args.http_timeout)
    processes = health.get("processes") if isinstance(health.get("processes"), dict) else {}
    if processes.get("subghz") is True:
        return
    try:
        opener = authenticated_intercept_opener(args)
        status = intercept_json(opener, args.intercept_url, "/subghz/status")
    except urllib.error.HTTPError as error:
        if error.code == 429:
            return
        raise
    if status.get("mode") == "sweep":
        return
    body = json.dumps(
        {
            "freq_start_mhz": args.sweep_start_mhz,
            "freq_end_mhz": args.sweep_end_mhz,
            "bin_width": args.sweep_bin_width,
        }
    ).encode()
    request = urllib.request.Request(
        f"{args.intercept_url.rstrip('/')}/subghz/sweep/start",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with opener.open(request, timeout=args.http_timeout) as response:
            response.read()
    except urllib.error.HTTPError as error:
        if error.code != 429:
            raise


def start_rotation_profile(
    opener: urllib.request.OpenerDirector,
    base_url: str,
    profile: HackRfRotationProfile,
    *,
    timeout: float,
) -> bool:
    body = json.dumps(rotation_profile_payload(profile)).encode()
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/subghz/sweep/start",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            response.read()
        return True
    except urllib.error.HTTPError as error:
        if error.code in {409, 429}:
            return False
        raise
    except OSError:
        return False


def rotation_profiles_from_args(args: argparse.Namespace) -> list[HackRfRotationProfile]:
    names = {name.strip().lower() for name in args.hackrf_rotation_profiles.split(",") if name.strip()}
    profiles = list(DEFAULT_HACKRF_ROTATION_PROFILES)
    return [profile for profile in profiles if not names or profile.name in names]


def run_hackrf_rotation(args: argparse.Namespace, active_profile: dict[str, HackRfRotationProfile | None]) -> None:
    profiles = rotation_profiles_from_args(args)
    if not profiles:
        return

    opener = authenticated_intercept_opener(args)
    while True:
        for profile in profiles:
            active_profile["current"] = profile
            start_rotation_profile(opener, args.intercept_url, profile, timeout=args.http_timeout)
            time.sleep(max(1, profile.dwell_seconds))


def start_hackrf_rotation_thread(args: argparse.Namespace, active_profile: dict[str, HackRfRotationProfile | None]) -> threading.Thread | None:
    if not args.hackrf_rotation:
        return None
    thread = threading.Thread(target=run_hackrf_rotation, args=(args, active_profile), daemon=True)
    thread.start()
    return thread


def authenticated_intercept_opener(args: argparse.Namespace) -> urllib.request.OpenerDirector:
    jar = urllib.request.HTTPCookieProcessor()
    opener = urllib.request.build_opener(jar)
    login = opener.open(f"{args.intercept_url.rstrip('/')}/login", timeout=args.http_timeout).read().decode()
    csrf = extract_csrf_token(login)
    form = {"username": args.intercept_username or "", "password": args.intercept_password or ""}
    if csrf:
        form["csrf_token"] = csrf
    try:
        opener.open(
            urllib.request.Request(
                f"{args.intercept_url.rstrip('/')}/login",
                data=urllib.parse.urlencode(form).encode(),
                method="POST",
            ),
            timeout=args.http_timeout,
        )
    except urllib.error.HTTPError as error:
        if error.code not in {302, 303}:
            raise
    return opener


def intercept_json(opener: urllib.request.OpenerDirector, base_url: str, path: str) -> dict[str, Any]:
    request = urllib.request.Request(f"{base_url.rstrip('/')}{path}", headers={"Accept": "application/json"})
    with opener.open(request, timeout=10) as response:
        data = json.loads(response.read().decode())
    return data if isinstance(data, dict) else {}


def public_intercept_json(base_url: str, path: str, *, timeout: float) -> dict[str, Any]:
    try:
        request = urllib.request.Request(f"{base_url.rstrip('/')}{path}", headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode())
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def extract_csrf_token(html: str) -> str | None:
    match = re.search(r'name=["\']csrf_token["\']\s+value=["\']([^"\']+)["\']', html)
    if match:
        return match.group(1)
    match = re.search(r'value=["\']([^"\']+)["\']\s+name=["\']csrf_token["\']', html)
    return match.group(1) if match else None


def run_mqtt_collector(args: argparse.Namespace) -> None:
    import paho.mqtt.client as mqtt

    last_publish: dict[str, float] = {}
    active_profile: dict[str, HackRfRotationProfile | None] = {"current": None}
    start_hackrf_rotation_thread(args, active_profile)

    def on_message(client: mqtt.Client, userdata: object, message: mqtt.MQTTMessage) -> None:
        if not message.topic.endswith("/subghz/sweep"):
            return
        try:
            payload = json.loads(message.payload.decode())
        except json.JSONDecodeError:
            return
        now = datetime.now(UTC)
        observations = parse_sweep_payload(
            payload,
            zone_id=args.zone_id,
            observed_at=now,
            limit=args.max_points_per_message,
            power_floor=args.power_floor,
            profile=active_profile["current"],
        )
        if not observations:
            return
        fresh = []
        monotonic_now = time.monotonic()
        for observation in observations:
            identity = observation["identity_hint"]
            if monotonic_now - last_publish.get(identity, 0) < args.per_frequency_cooldown:
                continue
            last_publish[identity] = monotonic_now
            fresh.append(observation)
        if fresh:
            submit_observations(fresh, base_url=args.base_url, api_key=args.api_key, timeout=args.http_timeout)

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=args.client_id)
    client.on_message = on_message
    client.connect(args.mqtt_host, args.mqtt_port, keepalive=30)
    client.subscribe(args.topic)
    client.loop_forever()


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
    parser = argparse.ArgumentParser(description="Collect Intercept MQTT RF sweep points and submit TDS observations.")
    parser.add_argument("--mqtt-host", default=os.getenv("TDS_MQTT_HOST", "127.0.0.1"))
    parser.add_argument("--mqtt-port", type=int, default=int(os.getenv("TDS_MQTT_PORT", "1883")))
    parser.add_argument("--topic", default=os.getenv("TDS_INTERCEPT_MQTT_TOPIC", "tds/intercept/#"))
    parser.add_argument("--client-id", default=os.getenv("TDS_INTERCEPT_MQTT_CLIENT_ID", "tds-intercept-mqtt-collector"))
    parser.add_argument("--base-url", default=os.getenv("TDS_BASE_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--api-key", default=os.getenv("TDS_INGEST_API_KEY", "change-me"))
    parser.add_argument("--zone", dest="zone_id", default=os.getenv("TDS_INTERCEPT_ZONE", "rf-active"))
    parser.add_argument("--http-timeout", type=float, default=10.0)
    parser.add_argument("--max-points-per-message", type=int, default=8)
    parser.add_argument("--power-floor", type=float, default=-70.0)
    parser.add_argument("--per-frequency-cooldown", type=float, default=30.0)
    parser.add_argument("--ensure-sweep", action="store_true", default=os.getenv("TDS_INTERCEPT_ENSURE_SWEEP", "true").lower() in {"1", "true", "yes", "on"})
    parser.add_argument(
        "--hackrf-rotation",
        action=argparse.BooleanOptionalAction,
        default=os.getenv("TDS_HACKRF_ROTATION", "true").lower() in {"1", "true", "yes", "on"},
    )
    parser.add_argument("--hackrf-rotation-profiles", default=os.getenv("TDS_HACKRF_ROTATION_PROFILES", ""))
    parser.add_argument("--intercept-url", default=os.getenv("TDS_INTERCEPT_URL", "http://127.0.0.1:5050"))
    parser.add_argument("--intercept-username", default=os.getenv("TDS_INTERCEPT_USERNAME"))
    parser.add_argument("--intercept-password", default=os.getenv("TDS_INTERCEPT_PASSWORD"))
    parser.add_argument("--sweep-start-mhz", type=float, default=float(os.getenv("TDS_INTERCEPT_SWEEP_START_MHZ", "300")))
    parser.add_argument("--sweep-end-mhz", type=float, default=float(os.getenv("TDS_INTERCEPT_SWEEP_END_MHZ", "928")))
    parser.add_argument("--sweep-bin-width", type=int, default=int(os.getenv("TDS_INTERCEPT_SWEEP_BIN_WIDTH", "1000000")))
    args = parser.parse_args()
    apply_dashboard_settings_to_namespace(
        args,
        "intercept_mqtt",
        {
            "mqtt_url": ("mqtt_url", str),
            "topic": "topic",
        },
        settings_loader=collector_settings_from_dashboard,
    )
    if hasattr(args, "mqtt_url"):
        apply_mqtt_url(args, args.mqtt_url)
    return args


def apply_mqtt_url(args: argparse.Namespace, value: str) -> None:
    parsed = urllib.parse.urlparse(value if "://" in value else f"mqtt://{value}")
    if parsed.hostname:
        args.mqtt_host = parsed.hostname
    if parsed.port:
        args.mqtt_port = parsed.port


def main() -> None:
    args = parse_args()
    if not args.hackrf_rotation:
        ensure_subghz_sweep(args)
    run_mqtt_collector(args)


if __name__ == "__main__":
    main()
