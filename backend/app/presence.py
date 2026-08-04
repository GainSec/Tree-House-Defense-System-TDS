from collections import Counter
from datetime import UTC, datetime, timedelta
from itertools import combinations
import re
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.aircraft_db import normalize_icao_hex
from app.models import (
    AircraftMetadata,
    CurrentState,
    CurrentStateSample,
    Event,
    InvestigationNote,
    Observation,
    PresenceEnrichment,
    PresenceIdentityDecision,
    PresenceSighting,
    PresenceWatchlist,
)

SIGHTING_SAMPLE_SECONDS = 30
RAIL_AAR_BASE_CHANNEL = 7
RAIL_AAR_BASE_MHZ = 160.215
RAIL_AAR_SPACING_MHZ = 0.015
INTEREST_REASON_WEIGHTS = {
    "tracked": 30,
    "strong_signal": 20,
    "aircraft": 10,
    "utility": 15,
    "unknown_rf": 25,
    "new_or_rare": 10,
    "repeat_presence": 10,
    "baseline": 0,
}

WATCH_MODES = [
    {
        "id": "home_presence",
        "label": "Home Presence",
        "description": "Prioritize clients, BLE tags, and nearby Wi-Fi identities.",
        "categories": ["client", "wifi", "ble"],
        "severity_floor": "info",
    },
    {
        "id": "airspace",
        "label": "Airspace",
        "description": "Prioritize ADS-B aircraft and learned approach/departure lanes.",
        "categories": ["aircraft"],
        "severity_floor": "info",
    },
    {
        "id": "rail",
        "label": "Rail",
        "description": "Prioritize passive AAR rail-channel activity and local operator/route hints.",
        "categories": ["rail"],
        "severity_floor": "info",
    },
    {
        "id": "iot",
        "label": "IoT Mesh",
        "description": "Prioritize Zigbee, Thread, and 802.15.4 mesh/device activity.",
        "categories": ["iot"],
        "severity_floor": "info",
    },
    {
        "id": "cellular",
        "label": "Cellular Lab",
        "description": "Prioritize private LTE testbed decode status from LibreSDR/LTESniffer.",
        "categories": ["cellular"],
        "severity_floor": "info",
    },
    {
        "id": "rf_anomaly",
        "label": "RF Anomaly",
        "description": "Prioritize unknown RF, utility, rail, IoT, and strong burst evidence.",
        "categories": ["unknown_rf", "utility", "rail", "iot", "cellular"],
        "severity_floor": "watch",
    },
    {
        "id": "quiet",
        "label": "Quiet",
        "description": "Show only selected/tracked entities and important alarms.",
        "categories": [],
        "severity_floor": "warning",
    },
]

PRESENCE_PLAYBOOKS = [
    {
        "id": "watch_entity",
        "label": "Watch entity",
        "description": "Track this identity and keep sampling presence sightings.",
        "trigger": "manual",
        "severity": "info",
        "inputs": ["entity_key", "note"],
    },
    {
        "id": "investigate_rf_burst",
        "label": "Investigate RF burst",
        "description": "Open an investigation trail for a sudden cluster of strong RF signals.",
        "trigger": "manual",
        "severity": "warning",
        "inputs": ["entity_key", "note"],
    },
    {
        "id": "review_blind_spot",
        "label": "Review sensor blind spot",
        "description": "Flag stale sensor coverage for operator follow-up.",
        "trigger": "manual",
        "severity": "warning",
        "inputs": ["sensor_id", "note"],
    },
    {
        "id": "airspace_snapshot",
        "label": "Airspace snapshot",
        "description": "Capture a point-in-time ADS-B context around a selected aircraft or lane.",
        "trigger": "manual",
        "severity": "info",
        "inputs": ["entity_key", "note"],
    },
]

OUI_VENDOR_HINTS = {
    "00:04:20": "Slim Devices / Logitech",
    "00:09:bf": "Nintendo",
    "00:17:88": "Philips Hue / Signify",
    "00:1a:11": "Google / Nest",
    "00:1d:63": "Apple",
    "00:24:e4": "Withings",
    "18:b4:30": "Nest Labs",
    "24:a4:3c": "Ubiquiti",
    "28:cf:e9": "Apple",
    "2c:aa:8e": "Amazon Technologies",
    "38:f9:d3": "Apple",
    "44:65:0d": "Amazon Technologies",
    "50:dc:e7": "Amazon Technologies",
    "68:54:fd": "Amazon Technologies",
    "74:83:c2": "Ubiquiti",
    "78:8a:20": "Ubiquiti",
    "b4:fb:e4": "Ubiquiti",
    "d8:3a:dd": "Raspberry Pi",
    "dc:a6:32": "Raspberry Pi",
    "f0:9f:c2": "Ubiquiti",
}

BLE_UUID_HINTS = {
    "1800": "Generic Access",
    "1801": "Generic Attribute",
    "180a": "Device Information",
    "180d": "Heart Rate",
    "180f": "Battery Service",
    "1812": "Human Interface Device",
    "181a": "Environmental Sensing",
    "181c": "User Data",
    "181d": "Weight Scale",
    "181f": "Continuous Glucose Monitoring",
    "1826": "Fitness Machine",
    "fd6f": "Exposure Notification",
    "feaa": "Eddystone",
}

AIRCRAFT_CALLSIGN_PREFIXES = {
    "AAL": "American Airlines",
    "ACA": "Air Canada",
    "ASA": "Alaska Airlines",
    "BAW": "British Airways",
    "DAL": "Delta Air Lines",
    "FFT": "Frontier Airlines",
    "JBU": "JetBlue",
    "RPA": "Republic Airways",
    "SCX": "Sun Country Airlines",
    "SWA": "Southwest Airlines",
    "UAL": "United Airlines",
    "UPS": "UPS Airlines",
}

AIRCRAFT_MODEL_RE = re.compile(
    r"^(?:"
    r"A\d{2,3}(?:-\d+[A-Z]*)?|"
    r"B\d{3}[A-Z]*|"
    r"\d{3}(?:-\d{1,3}[A-Z]*|-[A-Z0-9]+)?|"
    r"ERJ(?:\s+\d{3}(?:-\d{3})?(?:\s+[A-Z]+)?)?|"
    r"E\d{3}|"
    r"EC[- ]?\d{3}|"
    r"MBB-BK(?:\s+\d{3}(?:\s+[A-Z]-?\d?)?)?|"
    r"BE\d{2}|"
    r"A\d{2}"
    r")$"
)


def string_value(value: Any) -> str:
    return "" if value is None else str(value).strip()


def nested_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def int_value(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def field_value(state: CurrentState, *keys: str) -> Any:
    metadata = state.metadata_json or {}
    raw = state.raw_payload or {}
    raw_signal = nested_dict(raw.get("kismet.device.base.signal"))
    for key in keys:
        if key in metadata and metadata[key] not in (None, ""):
            return metadata[key]
        if key in raw and raw[key] not in (None, ""):
            return raw[key]
        if key in raw_signal and raw_signal[key] not in (None, ""):
            return raw_signal[key]
    return None


def signal_value(state: CurrentState) -> int | None:
    metadata_signal = int_value(field_value(state, "rssi", "signal", "power_dbm", "kismet.common.signal.last_signal"))
    if metadata_signal is not None:
        return metadata_signal
    raw_signal = nested_dict((state.raw_payload or {}).get("kismet.device.base.signal"))
    signal_type = string_value(raw_signal.get("kismet.common.signal.type")).lower()
    last_signal = int_value(raw_signal.get("kismet.common.signal.last_signal"))
    if state.source == "kismet" and signal_type == "none" and last_signal == 0:
        return None
    return last_signal


def label_for_state(state: CurrentState) -> str:
    return (
        string_value(
            field_value(
                state,
                "name",
                "commonname",
                "kismet.device.base.commonname",
                "kismet.device.base.name",
                "callsign",
                "adsb.device.callsign",
            )
        )
        or string_value(state.identity_hint)
        or state.state_key
    )


def entity_type_for_state(state: CurrentState) -> str:
    kind = state.kind.lower()
    protocol = state.protocol.lower()
    if kind == "aircraft" or protocol == "adsb":
        return "aircraft"
    if kind in {"client", "device", "spectrum_peak", "sdr_device", "datasource", "lte_sensor", "lte_decode_status"}:
        return kind
    if protocol in {"wifi", "ble", "bluetooth", "rtl433", "subghz", "utility", "sdr", "rail", "zigbee", "thread", "802154", "lte", "cellular"}:
        return protocol
    return kind or "state"


def category_for_state(state: CurrentState) -> str:
    kind = state.kind.lower()
    protocol = state.protocol.lower()
    state_key = state.state_key.lower()
    if kind == "aircraft" or protocol == "adsb":
        return "aircraft"
    if kind in {"client", "host_hint", "station"}:
        return "client"
    if protocol == "wifi" or "802.11" in state_key:
        return "wifi"
    if protocol in {"ble", "bluetooth"}:
        return "ble"
    if protocol == "rail" or kind == "rail_activity":
        return "rail"
    if protocol in {"zigbee", "thread", "802154"} or kind == "iot_device":
        return "iot"
    if protocol in {"lte", "cellular"} or state.source == "ltesniffer" or kind in {"lte_sensor", "lte_decode_status"}:
        return "cellular"
    if protocol in {"rtl433", "subghz", "utility"} or kind in {"utility", "meter"}:
        return "utility"
    if protocol in {"infrastructure", "router"} and kind not in {"host_hint"}:
        return "infrastructure"
    if kind in {"network_interface", "datasource", "server_status", "subghz_status", "sdr_device"}:
        return "infrastructure"
    if protocol == "sdr" or kind in {"spectrum_peak"}:
        return "unknown_rf"
    return "unknown"


def is_trackable_candidate(state: CurrentState) -> bool:
    return category_for_state(state) in {"aircraft", "client", "wifi", "ble", "utility", "rail", "iot", "cellular"}


def watch_mode_by_id(watch_mode: str | None) -> dict[str, Any] | None:
    if not watch_mode:
        return None
    return next((mode for mode in WATCH_MODES if mode["id"] == watch_mode), None)


def state_matches_watch_mode(state: CurrentState, watch_mode: str | None, *, tracked: bool = False) -> bool:
    mode = watch_mode_by_id(watch_mode)
    if mode is None:
        return True
    if mode["id"] == "quiet":
        return tracked
    return category_for_state(state) in set(mode["categories"])


def event_matches_watch_mode(event: Event, watch_mode: str | None) -> bool:
    mode = watch_mode_by_id(watch_mode)
    if mode is None:
        return True
    return severity_rank(event.severity) >= severity_rank(str(mode["severity_floor"]))


def state_candidate(state: CurrentState, *, tracked: bool = False) -> dict:
    category = category_for_state(state)
    return {
        "entity_key": state.state_key,
        "entity_type": entity_type_for_state(state),
        "category": category,
        "trackable": category in {"aircraft", "client", "wifi", "ble", "utility", "rail", "iot", "cellular"},
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "identity_hint": state.identity_hint,
        "label": label_for_state(state),
        "rssi": signal_value(state),
        "sensor_id": state.sensor_id,
        "zone_id": state.zone_id,
        "seen_count": state.seen_count,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "tracked": tracked,
        "metadata": state.metadata_json or {},
    }


def watchlist_to_dict(item: PresenceWatchlist) -> dict:
    return {
        "id": item.id,
        "entity_key": item.entity_key,
        "entity_type": item.entity_type,
        "source": item.source,
        "protocol": item.protocol,
        "kind": item.kind,
        "identity_hint": item.identity_hint,
        "label": item.label,
        "enabled": item.enabled,
        "created_at": _aware(item.created_at),
        "updated_at": _aware(item.updated_at),
    }


def sighting_to_dict(sighting: PresenceSighting) -> dict:
    return {
        "id": sighting.id,
        "watchlist_id": sighting.watchlist_id,
        "entity_key": sighting.entity_key,
        "timestamp": _aware(sighting.timestamp),
        "source": sighting.source,
        "protocol": sighting.protocol,
        "kind": sighting.kind,
        "identity_hint": sighting.identity_hint,
        "sensor_id": sighting.sensor_id,
        "zone_id": sighting.zone_id,
        "rssi": sighting.rssi,
        "evidence": sighting.evidence_json,
        "raw_payload": sighting.raw_payload,
        "created_at": _aware(sighting.created_at),
    }


def entity_replay_frames(session: Session, entity_key: str, *, limit: int = 200) -> list[dict[str, Any]]:
    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .order_by(PresenceSighting.timestamp.asc())
        .limit(limit)
    ).scalars().all()
    return [
        {
            "frame": index + 1,
            "timestamp": _aware(sighting.timestamp),
            "source": sighting.source,
            "protocol": sighting.protocol,
            "kind": sighting.kind,
            "sensor_id": sighting.sensor_id,
            "zone_id": sighting.zone_id,
            "rssi": sighting.rssi,
            "label": string_value((sighting.evidence_json or {}).get("label")) or string_value(sighting.identity_hint) or sighting.entity_key,
        }
        for index, sighting in enumerate(sightings)
    ]


def co_presence_clusters(session: Session, *, window_minutes: int = 5, limit: int = 20) -> list[dict[str, Any]]:
    watchlist_items = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.enabled.is_(True))
    ).scalars().all()
    labels_by_key = {item.entity_key: item.label for item in watchlist_items}
    if len(labels_by_key) < 2:
        return []

    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key.in_(labels_by_key.keys()))
        .order_by(PresenceSighting.timestamp.desc())
        .limit(1000)
    ).scalars().all()

    bucket_seconds = max(1, window_minutes) * 60
    buckets: dict[int, dict[str, PresenceSighting]] = {}
    for sighting in sightings:
        timestamp = _aware(sighting.timestamp)
        bucket = int(timestamp.timestamp()) // bucket_seconds
        current = buckets.setdefault(bucket, {})
        previous = current.get(sighting.entity_key)
        if previous is None or _aware(previous.timestamp) < timestamp:
            current[sighting.entity_key] = sighting

    pair_windows: dict[tuple[str, str], list[dict[str, Any]]] = {}
    latest_by_pair: dict[tuple[str, str], datetime] = {}
    for bucket, entities in buckets.items():
        if len(entities) < 2:
            continue
        for left, right in combinations(sorted(entities), 2):
            pair = (left, right)
            pair_sightings = [entities[left], entities[right]]
            latest = max(_aware(item.timestamp) for item in pair_sightings)
            pair_windows.setdefault(pair, []).append(
                {
                    "bucket": bucket,
                    "seen_at": _aware(datetime.fromtimestamp(bucket * bucket_seconds, tz=UTC)),
                    "entity_keys": [left, right],
                }
            )
            if pair not in latest_by_pair or latest_by_pair[pair] < latest:
                latest_by_pair[pair] = latest

    clusters = []
    for pair, windows in pair_windows.items():
        labels = sorted(labels_by_key.get(entity_key) or entity_key for entity_key in pair)
        clusters.append(
            {
                "id": f"{pair[0]}::{pair[1]}",
                "entity_keys": list(pair),
                "labels": labels,
                "shared_window_count": len(windows),
                "latest_seen_at": _aware(latest_by_pair[pair]),
                "window_minutes": window_minutes,
                "shared_windows": sorted(windows, key=lambda row: row["bucket"], reverse=True)[:6],
            }
        )

    return sorted(clusters, key=lambda row: (row["shared_window_count"], row["latest_seen_at"]), reverse=True)[:limit]


def airspace_lane_memory(session: Session, *, limit: int = 20) -> list[dict[str, Any]]:
    states = session.execute(
        select(CurrentState)
        .where(CurrentState.protocol == "adsb")
        .order_by(CurrentState.last_seen_at.desc())
        .limit(500)
    ).scalars().all()
    lanes: dict[tuple[int, str], dict[str, Any]] = {}
    for state in states:
        if category_for_state(state) != "aircraft":
            continue
        heading = int_value(field_value(state, "heading", "kismet.common.location.heading"))
        altitude = int_value(field_value(state, "altitude", "alt", "kismet.common.location.alt"))
        if heading is None or altitude is None:
            continue
        heading_bucket = int(round((heading % 360) / 45) * 45) % 360
        altitude_band = altitude_band_label(altitude)
        key = (heading_bucket, altitude_band)
        lane = lanes.setdefault(
            key,
            {
                "id": f"{heading_bucket}:{altitude_band}",
                "label": f"{heading_direction_label(heading_bucket)} lane · {altitude_band}",
                "heading_bucket": heading_bucket,
                "altitude_band": altitude_band,
                "aircraft_count": 0,
                "seen_count": 0,
                "latest_seen_at": _aware(state.last_seen_at),
                "callsigns": [],
            },
        )
        lane["aircraft_count"] += 1
        lane["seen_count"] += state.seen_count
        if _aware(lane["latest_seen_at"]) < _aware(state.last_seen_at):
            lane["latest_seen_at"] = _aware(state.last_seen_at)
        callsign = string_value(field_value(state, "callsign", "adsb.device.callsign")) or string_value(state.identity_hint)
        if callsign and callsign not in lane["callsigns"]:
            lane["callsigns"].append(callsign)

    return sorted(lanes.values(), key=lambda row: (row["aircraft_count"], row["seen_count"]), reverse=True)[:limit]


def altitude_band_label(altitude: int) -> str:
    floor = max(0, (altitude // 1000) * 1000)
    ceiling = floor + 1000
    return f"{floor // 1000}k-{ceiling // 1000}k ft"


def heading_direction_label(heading_bucket: int) -> str:
    labels = {
        0: "N",
        45: "NE",
        90: "E",
        135: "SE",
        180: "S",
        225: "SW",
        270: "W",
        315: "NW",
    }
    return labels.get(heading_bucket % 360, f"{heading_bucket} deg")


def presence_link_graph(session: Session, *, limit: int = 200, mode: str = "all", watch_mode: str | None = None) -> dict[str, Any]:
    tracked = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.enabled.is_(True)).order_by(PresenceWatchlist.updated_at.desc()).limit(limit)
    ).scalars().all()
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[str, dict[str, Any]] = {}
    identity_aliases: dict[str, set[str]] = {}
    entity_labels: dict[str, str] = {}
    for watch in tracked:
        state = session.get(CurrentState, watch.entity_key)
        if state is not None and not state_matches_watch_mode(state, watch_mode, tracked=True):
            continue
        if state is not None and not graph_state_visible(state, mode):
            continue
        entity_id = f"entity:{watch.entity_key}"
        nodes[entity_id] = graph_entity_node(watch, state)
        nodes[entity_id]["operator_decisions"] = identity_decision_summary(session, watch.entity_key)
        nodes[entity_id]["operator_labels"] = nodes[entity_id]["operator_decisions"].get("labels", [])
        if state is not None:
            nodes[entity_id]["resolved_identity"] = graph_resolved_identity_summary(resolved_identity_summary(session, state))
        entity_labels[watch.entity_key] = watch.label
        aliases = {string_value(watch.entity_key), string_value(watch.identity_hint)}
        if state is None:
            identity_aliases[entity_id] = {alias.lower() for alias in aliases if alias}
            continue
        aliases.update({string_value(state.identity_hint), string_value(first_mac_value(state))})
        identity_aliases[entity_id] = {alias.lower() for alias in aliases if alias}
        source_id = f"source:{state.source}"
        sensor_id = f"sensor:{state.sensor_id}"
        nodes[source_id] = graph_source_node(state)
        nodes[sensor_id] = graph_sensor_node(state)
        observed_edge = graph_edge(
            f"{entity_id}->{sensor_id}",
            entity_id,
            sensor_id,
            "observed_by",
            state.seen_count,
            graph_confidence(state.seen_count, state.last_seen_at),
            _aware(state.last_seen_at),
            state.seen_count,
            f"{watch.label} was observed by sensor {state.sensor_id} across {state.seen_count} {pluralize('sighting', state.seen_count)}.",
            [graph_state_evidence(state, watch.label)],
        )
        edges[observed_edge["id"]] = observed_edge
        feed_edge = graph_edge(
            f"{sensor_id}->{source_id}",
            sensor_id,
            source_id,
            "feeds_source",
            1,
            graph_confidence(1, state.last_seen_at),
            _aware(state.last_seen_at),
            1,
            f"Sensor {state.sensor_id} feeds collector source {state.source}.",
            [graph_state_evidence(state, state.sensor_id)],
        )
        edges[feed_edge["id"]] = feed_edge

    if mode in {"all", "presence"}:
        for cluster in co_presence_clusters(session, limit=limit):
            left_key, right_key = cluster["entity_keys"]
            left_id = f"entity:{left_key}"
            right_id = f"entity:{right_key}"
            if left_id not in nodes or right_id not in nodes:
                continue
            latest_seen = _aware(cluster["latest_seen_at"])
            labels = cluster["labels"]
            weight = int(cluster["shared_window_count"])
            edge = graph_edge(
                f"{left_id}->{right_id}",
                left_id,
                right_id,
                "co_present",
                weight,
                graph_confidence(weight, latest_seen),
                latest_seen,
                weight,
                f"{labels[0]} and {labels[1]} were seen together in {weight} recent {pluralize('window', weight)}.",
                [
                    {
                        "label": f"{labels[0]} + {labels[1]}",
                        "timestamp": _aware(window["seen_at"]),
                        "source": None,
                        "sensor_id": None,
                        "rssi": None,
                    }
                    for window in cluster["shared_windows"][:5]
                ],
            )
            edges[edge["id"]] = edge

    if mode in {"all", "alerts"}:
        events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(500)).scalars().all()
        for event in events:
            if not event_matches_watch_mode(event, watch_mode):
                continue
            event_values = {value.lower() for value in event_payload_values(event.payload)}
            matched_entities = [
                entity_id
                for entity_id, aliases in identity_aliases.items()
                if aliases and any(alias in event_values for alias in aliases)
            ]
            if not matched_entities:
                continue
            event_id = f"event:{event.id}"
            nodes[event_id] = graph_event_node(event)
            for entity_id in matched_entities:
                entity_key = entity_id.removeprefix("entity:")
                label = entity_labels.get(entity_key) or nodes[entity_id]["label"]
                edge = graph_edge(
                    f"{event_id}->{entity_id}",
                    event_id,
                    entity_id,
                    "mentions_entity",
                    1,
                    round(float(event.confidence), 2),
                    _aware(event.created_at),
                    1,
                    f"Alert {event.summary} references {label}.",
                    [
                        {
                            "label": event.summary,
                            "timestamp": _aware(event.created_at),
                            "source": event.type,
                            "sensor_id": None,
                            "rssi": None,
                        }
                    ],
                )
                edges[edge["id"]] = edge

    if mode in {"all", "airspace"}:
        aircraft = session.execute(
            select(CurrentState)
            .where(CurrentState.protocol == "adsb")
            .order_by(CurrentState.last_seen_at.desc())
            .limit(limit)
        ).scalars().all()
        aircraft_metadata = aircraft_metadata_for_states(session, aircraft)
        for state in aircraft:
            if category_for_state(state) != "aircraft":
                continue
            if not state_matches_watch_mode(state, watch_mode):
                continue
            aircraft_id = f"aircraft:{state.state_key}"
            metadata = aircraft_metadata_for_state(aircraft_metadata, state)
            nodes[aircraft_id] = graph_aircraft_node(state, metadata)

    if mode in {"all", "rail"}:
        rail_states = session.execute(
            select(CurrentState)
            .where(or_(CurrentState.protocol == "rail", CurrentState.kind == "rail_activity", CurrentState.source == "rail_rf"))
            .order_by(CurrentState.last_seen_at.desc())
            .limit(limit)
        ).scalars().all()
        for state in rail_states:
            if category_for_state(state) != "rail":
                continue
            if not state_matches_watch_mode(state, watch_mode):
                continue
            nodes[f"rail:{state.state_key}"] = graph_rail_node(state, session=session)
    if mode in {"all", "iot"}:
        iot_states = session.execute(
            select(CurrentState)
            .where(or_(CurrentState.protocol.in_(["zigbee", "thread", "802154"]), CurrentState.kind == "iot_device"))
            .order_by(CurrentState.last_seen_at.desc())
            .limit(limit)
        ).scalars().all()
        for state in iot_states:
            if category_for_state(state) != "iot":
                continue
            if not state_matches_watch_mode(state, watch_mode):
                continue
            nodes[f"iot:{state.state_key}"] = graph_iot_node(state)
    if mode in {"all", "cellular"}:
        cellular_states = session.execute(
            select(CurrentState)
            .where(
                or_(
                    CurrentState.protocol.in_(["lte", "cellular"]),
                    CurrentState.kind.in_(["lte_sensor", "lte_decode_status"]),
                    CurrentState.source == "ltesniffer",
                )
            )
            .order_by(CurrentState.last_seen_at.desc())
            .limit(limit)
        ).scalars().all()
        for state in cellular_states:
            if category_for_state(state) != "cellular":
                continue
            if not state_matches_watch_mode(state, watch_mode):
                continue
            nodes[f"cellular:{state.state_key}"] = graph_cellular_node(state)
    response = {"nodes": list(nodes.values()), "edges": list(edges.values())}
    response["insights"] = graph_relationship_insights(response["nodes"], response["edges"])
    if watch_mode_by_id(watch_mode) is not None:
        response["watch_mode"] = watch_mode
    return response


def graph_relationship_insights(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], *, limit: int = 6) -> dict[str, Any]:
    nodes_by_id = {node.get("id"): node for node in nodes}
    top_relationships = [
        graph_relationship_lead(edge, nodes_by_id)
        for edge in sorted(edges, key=graph_relationship_score, reverse=True)[:limit]
    ]
    clusters = graph_role_clusters(nodes)
    map_read = graph_map_read(nodes, edges, top_relationships, clusters)
    return {"map_read": map_read, "top_relationships": top_relationships, "clusters": clusters}


def graph_relationship_lead(edge: dict[str, Any], nodes_by_id: dict[str, dict[str, Any]]) -> dict[str, Any]:
    source = nodes_by_id.get(edge.get("source"), {})
    target = nodes_by_id.get(edge.get("target"), {})
    confidence = edge.get("confidence")
    evidence_count = edge.get("evidence_count") or edge.get("weight") or 0
    relationship_label = graph_edge_type_label(str(edge.get("type") or "relationship"))
    confidence_text = f"{round(float(confidence) * 100)}% confidence" if isinstance(confidence, int | float) else "confidence learning"
    return {
        "edge_id": edge.get("id"),
        "label": f"{source.get('label') or edge.get('source')} -> {target.get('label') or edge.get('target')}",
        "relationship": relationship_label,
        "tone": graph_edge_tone(str(edge.get("type") or "relationship")),
        "summary": f"{relationship_label} / {evidence_count} evidence / {confidence_text}",
        "evidence_count": evidence_count,
        "confidence": confidence,
    }


def graph_relationship_score(edge: dict[str, Any]) -> float:
    confidence = edge.get("confidence")
    confidence_score = float(confidence) if isinstance(confidence, int | float) else 0.4
    weight = max(1, int(edge.get("evidence_count") or edge.get("weight") or 1))
    type_bonus = {"mentions_entity": 1.4, "co_present": 1.3, "observed_by": 1.1, "feeds_source": 0.8, "airspace_lane": 1.0}.get(str(edge.get("type")), 1.0)
    return (confidence_score * 100) + (min(weight, 25) * 2 * type_bonus)


def graph_role_clusters(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for node in nodes:
        label = graph_node_role_label(node)
        grouped.setdefault(label, []).append(node)
    order = ["Tracked entity", "RF entity", "Sensor", "Source", "Alert/event", "Aircraft", "Rail activity"]
    clusters = []
    for label in order:
        members = grouped.get(label)
        if not members:
            continue
        clusters.append({
            "id": normalized_graph_token(label),
            "label": label,
            "count": len(members),
            "summary": ", ".join(str(member.get("label")) for member in members[:3] if member.get("label")),
        })
    return clusters


def graph_map_read(nodes: list[dict[str, Any]], edges: list[dict[str, Any]], top_relationships: list[dict[str, Any]], clusters: list[dict[str, Any]]) -> str:
    if not nodes:
        return "Graph is empty; track entities or wait for collectors to report observations."
    lead = top_relationships[0]["label"] if top_relationships else "no ranked relationship yet"
    visible = ", ".join(f"{cluster['count']} {cluster['label'].lower()}" for cluster in clusters[:3])
    return f"Graph is showing {len(nodes)} nodes and {len(edges)} links. Strongest lead: {lead}. Visible roles: {visible}."


def graph_node_role_label(node: dict[str, Any]) -> str:
    node_type = str(node.get("type") or "")
    tokens = {str(value).lower() for value in [node.get("type"), node.get("source"), node.get("protocol"), node.get("kind"), *(node.get("badges") or [])] if value}
    if node_type == "aircraft":
        return "Aircraft"
    if node_type == "rail":
        return "Rail activity"
    if node_type == "iot":
        return "IoT mesh"
    if node_type == "event":
        return "Alert/event"
    if node_type == "sensor":
        return "Sensor"
    if node_type == "source":
        return "Source"
    if tokens & {"spectrum_peak", "unknown_rf", "utility", "rtl433", "subghz", "sdr"}:
        return "RF entity"
    return "Tracked entity"


def graph_edge_type_label(edge_type: str) -> str:
    return {
        "observed_by": "Observed by sensor",
        "feeds_source": "Sensor feeds source",
        "mentions_entity": "Alert mentions identity",
        "co_present": "Seen together",
        "airspace_lane": "Airspace lane",
    }.get(edge_type, edge_type.replace("_", " "))


def graph_edge_tone(edge_type: str) -> str:
    return {
        "observed_by": "signal",
        "feeds_source": "source",
        "mentions_entity": "alert",
        "co_present": "copresence",
        "airspace_lane": "airspace",
    }.get(edge_type, "neutral")


def normalized_graph_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def presence_entity_intelligence(session: Session, entity_key: str, *, limit: int = 120) -> dict[str, Any] | None:
    state = session.get(CurrentState, entity_key)
    if state is None:
        return None
    timeline: list[dict[str, Any]] = []
    timeline.append({
        "id": f"current:{state.state_key}",
        "type": "current_state",
        "label": "Current state observed",
        "timestamp": _aware(state.last_seen_at),
        "severity": "info",
        "source": state.source,
        "sensor_id": state.sensor_id,
        "rssi": signal_value(state),
        "summary": f"{label_for_state(state)} last seen by {state.sensor_id}.",
    })
    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .order_by(PresenceSighting.timestamp.desc())
        .limit(limit)
    ).scalars().all()
    for sighting in sightings:
        timeline.append({
            "id": sighting.id,
            "type": "sighting",
            "label": "Presence sighting",
            "timestamp": _aware(sighting.timestamp),
            "severity": "info",
            "source": sighting.source,
            "sensor_id": sighting.sensor_id,
            "rssi": sighting.rssi,
            "summary": f"Seen by {sighting.sensor_id or sighting.source} at {format_signal_summary(sighting.rssi)}.",
        })
    for decision in identity_decisions_for_entity(session, entity_key, limit=limit):
        timeline.append({
            "id": decision.id,
            "type": "operator_decision",
            "label": f"Operator {identity_decision_state(decision.action)}",
            "timestamp": _aware(decision.created_at),
            "severity": "info" if decision.action in {"confirm", "label", "watch"} else "warning",
            "source": "operator",
            "sensor_id": None,
            "rssi": None,
            "summary": decision.reason or decision.label or decision.target_entity_key or decision.action,
        })
    notes = session.execute(
        select(InvestigationNote)
        .where(InvestigationNote.entity_key == entity_key)
        .order_by(InvestigationNote.created_at.desc())
        .limit(limit)
    ).scalars().all()
    for note in notes:
        timeline.append({
            "id": note.id,
            "type": "note",
            "label": f"Operator note: {note.disposition}",
            "timestamp": _aware(note.created_at),
            "severity": "info" if note.disposition == "note" else "warning",
            "source": "operator",
            "sensor_id": None,
            "rssi": None,
            "summary": note.note,
        })
    enrichments = session.execute(
        select(PresenceEnrichment)
        .where(PresenceEnrichment.entity_key == entity_key)
        .order_by(PresenceEnrichment.created_at.desc())
        .limit(limit)
    ).scalars().all()
    for enrichment in enrichments:
        timeline.append({
            "id": enrichment.id,
            "type": "enrichment",
            "label": f"Enrichment {enrichment.status}",
            "timestamp": _aware(enrichment.created_at),
            "severity": "info",
            "source": enrichment.mode,
            "sensor_id": None,
            "rssi": None,
            "summary": enrichment.summary,
        })
    for event in session.execute(select(Event).order_by(Event.created_at.desc()).limit(500)).scalars().all():
        if not event_related_to_entity(event, state):
            continue
        timeline.append({
            "id": event.id,
            "type": "event",
            "label": event.type,
            "timestamp": _aware(event.created_at),
            "severity": event.severity,
            "source": event.type,
            "sensor_id": None,
            "rssi": None,
            "summary": event.summary,
        })
    timeline.sort(key=lambda item: _aware(item.get("timestamp")) or datetime.min.replace(tzinfo=UTC), reverse=True)
    timeline = timeline[:limit]
    return {
        "entity_key": entity_key,
        "summary": state_candidate(state, tracked=True),
        "timeline": {"items": timeline, "count": len(timeline), "order": "newest_first"},
        "confidence_drift": presence_confidence_drift(state, sightings),
        "identity_confidence_radar": identity_confidence_radar(session, state, sightings),
        "presence_habit_calendar": presence_habit_calendar(session, state, sightings),
        "life_story_timeline": entity_life_story_timeline(session, state, timeline, limit=limit),
        "evidence_provenance_ribbon": evidence_provenance_ribbon(session, state, sightings),
    }


def presence_entity_investigation(session: Session, entity_key: str) -> dict[str, Any] | None:
    detail = presence_entity_detail(session, entity_key)
    intelligence = presence_entity_intelligence(session, entity_key)
    if detail is None or intelligence is None:
        return None
    sections = investigation_operator_sections(detail, intelligence)
    return {
        "entity_key": entity_key,
        "summary": detail["summary"],
        "operator_sections": sections,
        "detail": detail,
        "intelligence": intelligence,
    }


def investigation_operator_sections(detail: dict[str, Any], intelligence: dict[str, Any]) -> list[dict[str, Any]]:
    summary = detail.get("summary", {})
    dossier = detail.get("dossier", {})
    drift = intelligence.get("confidence_drift") or {}
    latest_drift = drift.get("latest") or {}
    related_entities = detail.get("related_entities", [])
    timeline = intelligence.get("timeline", {})
    sections = [
        {
            "id": "operator_read",
            "label": "Operator Read",
            "tone": "identity",
            "value": summary.get("label") or dossier.get("identity", {}).get("label") or summary.get("entity_key"),
            "summary": build_operator_read_from_detail(detail),
            "count": summary.get("seen_count") or 0,
        },
        {
            "id": "signal_drift",
            "label": "Signal Drift",
            "tone": "signal",
            "value": f"{latest_drift.get('confidence', 0)}% confidence",
            "summary": latest_drift.get("reason") or "Signal confidence is still being learned.",
            "count": drift.get("count") or 0,
        },
        {
            "id": "identity_timeline",
            "label": "Identity Timeline",
            "tone": "timeline",
            "value": f"{timeline.get('count', 0)} events",
            "summary": "Operator decisions, sightings, notes, enrichments, and alerts in one trail.",
            "count": timeline.get("count") or 0,
        },
        {
            "id": "related_entities",
            "label": "Related Entities",
            "tone": "relationship",
            "value": f"{len(related_entities)} links",
            "summary": "Nearby identities and airspace co-seen with this entity.",
            "count": len(related_entities),
        },
    ]
    return sections


def build_operator_read_from_detail(detail: dict[str, Any]) -> str:
    dossier = detail.get("dossier", {})
    pieces = [
        (dossier.get("identity_resolution") or {}).get("label"),
        (dossier.get("reliability") or {}).get("label"),
        (dossier.get("presence_rules") or {}).get("label"),
    ]
    return " / ".join(str(piece) for piece in pieces if piece) or "TDS is still collecting context for this identity."



def evidence_provenance_ribbon(session: Session, state: CurrentState, sightings: list[PresenceSighting]) -> dict[str, Any]:
    sample_count = session.scalar(select(func.count()).select_from(CurrentStateSample).where(CurrentStateSample.state_key == state.state_key)) or 0
    event_count = sum(1 for event in session.execute(select(Event).order_by(Event.created_at.desc()).limit(500)).scalars().all() if event_related_to_entity(event, state))
    operator_count = len(identity_decisions_for_entity(session, state.state_key, limit=100)) + session.scalar(select(func.count()).select_from(InvestigationNote).where(InvestigationNote.entity_key == state.state_key)) or 0
    enrichment_count = session.scalar(select(func.count()).select_from(PresenceEnrichment).where(PresenceEnrichment.entity_key == state.state_key)) or 0
    source_payload_count = 1 if state.raw_payload or state.metadata_json else 0
    stages = [
        provenance_stage("source_payload", "Source Payload", source_payload_count, "Collector raw or normalized fields reached TDS."),
        provenance_stage("current_state", "Current State", 1, "Canonical current-state row is available."),
        provenance_stage("compact_samples", "Compact Samples", int(sample_count), "Append-only presence samples support history."),
        provenance_stage("presence_sightings", "Presence Sightings", len(sightings), "Watchlist sightings preserve sampled presence."),
        provenance_stage("rules_events", "Rules / Events", event_count, "Rules and alert events reference this identity."),
        provenance_stage("operator_context", "Operator Context", int(operator_count), "Notes, labels, or identity decisions are attached."),
        provenance_stage("enrichment", "Enrichment", int(enrichment_count), "Local enrichment adds vendor or identity hints."),
    ]
    complete_count = sum(1 for stage in stages if stage["status"] == "complete")
    weakest = min(stages, key=lambda stage: (stage["count"], stage["order"]))
    return {
        "stages": stages,
        "complete_count": complete_count,
        "total_count": len(stages),
        "weakest_stage": weakest,
        "operator_read": provenance_operator_read(complete_count, len(stages), weakest),
    }


def provenance_stage(stage_id: str, label: str, count: int, description: str) -> dict[str, Any]:
    status = "complete" if count > 0 else "missing"
    order = ["source_payload", "current_state", "compact_samples", "presence_sightings", "rules_events", "operator_context", "enrichment"].index(stage_id)
    return {
        "id": stage_id,
        "label": label,
        "count": count,
        "status": status,
        "tone": "good" if status == "complete" else "warn",
        "order": order,
        "description": description,
    }


def provenance_operator_read(complete_count: int, total_count: int, weakest: dict[str, Any]) -> str:
    if complete_count == total_count:
        return f"Evidence path complete across {total_count} stages; weakest link is {weakest['label']}."
    return f"Evidence path has {complete_count}/{total_count} stages; missing {weakest['label']}."


def entity_life_story_timeline(session: Session, state: CurrentState, timeline: list[dict[str, Any]], *, limit: int = 120) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for item in timeline:
        lane = life_story_lane_for_type(string_value(item.get("type")))
        story_item = dict(item)
        story_item["lane"] = lane["id"]
        story_item["lane_label"] = lane["label"]
        story_item["tone"] = lane["tone"]
        items.append(story_item)

    samples = session.execute(
        select(CurrentStateSample)
        .where(CurrentStateSample.state_key == state.state_key)
        .order_by(CurrentStateSample.timestamp.desc())
        .limit(limit)
    ).scalars().all()
    for sample in samples:
        lane = LIFE_STORY_LANES["sample"]
        items.append({
            "id": sample.id,
            "type": "state_sample",
            "lane": lane["id"],
            "lane_label": lane["label"],
            "tone": lane["tone"],
            "label": "Compact presence sample",
            "timestamp": _aware(sample.timestamp),
            "severity": "info",
            "source": sample.source,
            "sensor_id": sample.sensor_id,
            "rssi": sample.rssi,
            "summary": f"{sample.source} sample from {sample.sensor_id or 'unknown sensor'} at {format_signal_summary(sample.rssi)}.",
        })

    items.sort(key=lambda item: _aware(item.get("timestamp")) or datetime.min.replace(tzinfo=UTC), reverse=True)
    items = items[:limit]
    lane_counts: Counter[str] = Counter(string_value(item.get("lane")) for item in items)
    lanes = [
        {**lane, "count": lane_counts[lane_id]}
        for lane_id, lane in LIFE_STORY_LANES.items()
        if lane_counts[lane_id] > 0
    ]
    return {
        "items": items,
        "count": len(items),
        "lanes": lanes,
        "order": "newest_first",
        "operator_read": life_story_operator_read(items, lanes),
    }


LIFE_STORY_LANES: dict[str, dict[str, str]] = {
    "sensor": {"id": "sensor", "label": "Sensor Observations", "tone": "signal"},
    "sample": {"id": "sample", "label": "Compact Samples", "tone": "sample"},
    "operator": {"id": "operator", "label": "Operator Context", "tone": "identity"},
    "enrichment": {"id": "enrichment", "label": "Enrichment", "tone": "good"},
    "alert": {"id": "alert", "label": "Alerts", "tone": "warn"},
}


def life_story_lane_for_type(item_type: str) -> dict[str, str]:
    if item_type in {"current_state", "sighting"}:
        return LIFE_STORY_LANES["sensor"]
    if item_type in {"operator_decision", "note"}:
        return LIFE_STORY_LANES["operator"]
    if item_type == "enrichment":
        return LIFE_STORY_LANES["enrichment"]
    if item_type == "event":
        return LIFE_STORY_LANES["alert"]
    if item_type == "state_sample":
        return LIFE_STORY_LANES["sample"]
    return LIFE_STORY_LANES["sensor"]


def life_story_operator_read(items: list[dict[str, Any]], lanes: list[dict[str, Any]]) -> str:
    if not items:
        return "No life story events have been collected yet."
    first = _aware(items[-1].get("timestamp"))
    latest = _aware(items[0].get("timestamp"))
    span = "one moment"
    if first and latest:
        delta = latest - first
        if delta.days >= 1:
            span = plural_word("day", delta.days)
        elif delta.total_seconds() >= 3600:
            span = plural_word("hour", max(1, round(delta.total_seconds() / 3600)))
        elif delta.total_seconds() >= 60:
            span = plural_word("minute", max(1, round(delta.total_seconds() / 60)))
    return f"Story spans {span} across {plural_word('lane', len(lanes))} and {plural_word('event', len(items))}."


def presence_habit_calendar(session: Session, state: CurrentState, sightings: list[PresenceSighting]) -> dict[str, Any]:
    samples = session.execute(
        select(CurrentStateSample)
        .where(CurrentStateSample.state_key == state.state_key)
        .order_by(CurrentStateSample.timestamp.desc())
        .limit(1000)
    ).scalars().all()
    points: list[dict[str, Any]] = []
    for sighting in sightings:
        points.append({
            "timestamp": _aware(sighting.timestamp),
            "source": sighting.source,
            "sensor_id": sighting.sensor_id,
            "rssi": sighting.rssi,
        })
    for sample in samples:
        points.append({
            "timestamp": _aware(sample.timestamp),
            "source": sample.source,
            "sensor_id": sample.sensor_id,
            "rssi": sample.rssi,
        })
    points.sort(key=lambda item: item["timestamp"], reverse=True)

    cell_counts: Counter[tuple[int, int]] = Counter()
    hour_counts: Counter[int] = Counter()
    for point in points:
        timestamp = point["timestamp"]
        cell_counts[(timestamp.weekday(), timestamp.hour)] += 1
        hour_counts[timestamp.hour] += 1

    max_cell_count = max(cell_counts.values(), default=0)
    cells: list[dict[str, Any]] = []
    for weekday in range(7):
        for hour in range(24):
            count = cell_counts[(weekday, hour)]
            cells.append({
                "weekday": weekday,
                "weekday_label": weekday_label(weekday),
                "hour": hour,
                "hour_label": hour_label(hour),
                "count": count,
                "intensity": round((count / max_cell_count) * 100) if max_cell_count else 0,
                "label": f"{weekday_label(weekday)} {hour_label(hour)}",
            })

    peak_windows = [
        {
            "hour": hour,
            "label": hour_label(hour),
            "count": count,
            "share": round((count / len(points)) * 100) if points else 0,
        }
        for hour, count in sorted(hour_counts.items(), key=lambda item: (-item[1], item[0]))[:6]
    ]
    deviations = presence_habit_deviations(points, hour_counts)
    return {
        "sample_count": len(points),
        "cells": cells,
        "peak_windows": peak_windows,
        "deviations": deviations,
        "operator_read": presence_habit_operator_read(points, peak_windows, deviations),
    }


def presence_habit_deviations(points: list[dict[str, Any]], hour_counts: Counter[int]) -> list[dict[str, Any]]:
    if len(points) < 4 or not hour_counts:
        return []
    dominant_count = max(hour_counts.values())
    deviations: list[dict[str, Any]] = []
    seen: set[tuple[int, int]] = set()
    for point in points[:12]:
        timestamp = point["timestamp"]
        key = (timestamp.weekday(), timestamp.hour)
        if key in seen:
            continue
        seen.add(key)
        hour_count = hour_counts[timestamp.hour]
        if hour_count > max(1, dominant_count // 2):
            continue
        deviations.append({
            "timestamp": timestamp,
            "weekday": timestamp.weekday(),
            "hour": timestamp.hour,
            "label": f"Unusual recent sighting at {hour_label(timestamp.hour)}",
            "source": point.get("source"),
            "sensor_id": point.get("sensor_id"),
            "rssi": point.get("rssi"),
        })
        if len(deviations) >= 3:
            break
    return deviations


def presence_habit_operator_read(points: list[dict[str, Any]], peak_windows: list[dict[str, Any]], deviations: list[dict[str, Any]]) -> str:
    if not points:
        return "Learning presence rhythm; no historical samples yet."
    if not peak_windows:
        return f"Learning presence rhythm from {plural_word('sample', len(points))}."
    peak = peak_windows[0]
    read = f"Usually present around {peak['label']} from {plural_word('sample', len(points))}."
    if deviations:
        read += f" Latest off-pattern activity: {deviations[0]['label'].replace('Unusual recent sighting at ', '')}."
    return read


def weekday_label(weekday: int) -> str:
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    return labels[weekday % 7]


def identity_confidence_radar(session: Session, state: CurrentState, sightings: list[PresenceSighting]) -> dict[str, Any]:
    decisions = identity_decision_summary(session, state.state_key)
    enrichment = latest_enrichment(session, state.state_key)
    sample_count = session.scalar(select(func.count()).select_from(CurrentStateSample).where(CurrentStateSample.state_key == state.state_key)) or 0
    source_rows = source_confidence_rows(state, sightings)
    source_count = len({row["source"] for row in source_rows})
    identifier_values = sorted_unique([
        state.identity_hint,
        first_mac_value(state),
        label_for_state(state),
        *values_for_fields(state, "ipAddress", "ip", "hostname", "name", "kismet.device.base.commonname"),
    ])
    rssi_values = [value for value in [signal_value(state), *(sighting.rssi for sighting in sightings[:12])] if isinstance(value, int)]
    rssi_spread = max(rssi_values) - min(rssi_values) if len(rssi_values) >= 2 else None
    axes = [
        radar_axis(
            "source_agreement",
            "Source Agreement",
            min(100, 35 + source_count * 25 + int(sum(row["confidence"] for row in source_rows) * 10)),
            f"{source_count} source {plural_word('row', source_count)} agree on this identity.",
        ),
        radar_axis(
            "identifier_strength",
            "Identifier Strength",
            min(100, 30 + len(identifier_values) * 14 + (15 if first_mac_value(state) else 0)),
            f"{len(identifier_values)} useful identifier {plural_word('value', len(identifier_values))} observed.",
        ),
        radar_axis(
            "signal_stability",
            "Signal Stability",
            signal_stability_score(rssi_values),
            "RSSI spread is unknown." if rssi_spread is None else f"RSSI spread across recent evidence is {rssi_spread} dB.",
        ),
        radar_axis(
            "history_depth",
            "History Depth",
            min(100, 35 + len(sightings) * 12 + int(sample_count) * 8 + min(state.seen_count, 10) * 3),
            f"{len(sightings)} sightings, {int(sample_count)} compact samples, {state.seen_count} current-state observations.",
        ),
        radar_axis(
            "enrichment_coverage",
            "Enrichment Coverage",
            enrichment_coverage_score(enrichment),
            enrichment.summary if enrichment is not None else "No enrichment run has completed for this identity.",
        ),
        radar_axis(
            "operator_confirmation",
            "Operator Confirmation",
            operator_confirmation_score(decisions),
            operator_confirmation_summary(decisions),
        ),
    ]
    overall_score = int(round(sum(axis["score"] for axis in axes) / len(axes))) if axes else 0
    return {
        "overall_score": overall_score,
        "operator_read": radar_operator_read(overall_score, axes),
        "axes": axes,
    }


def radar_axis(axis_id: str, label: str, score: int, evidence: str) -> dict[str, Any]:
    bounded = max(0, min(100, int(score)))
    return {"id": axis_id, "label": label, "score": bounded, "evidence": evidence, "tone": confidence_tone(bounded)}


def signal_stability_score(rssi_values: list[int]) -> int:
    if not rssi_values:
        return 35
    if len(rssi_values) == 1:
        return 55 if rssi_values[0] >= -70 else 45
    spread = max(rssi_values) - min(rssi_values)
    base = 95 - min(spread, 50)
    if max(rssi_values) >= -55:
        base += 8
    return max(30, min(100, base))


def enrichment_coverage_score(enrichment: PresenceEnrichment | None) -> int:
    if enrichment is None:
        return 25
    finding_count = len(enrichment.findings_json or [])
    target_count = len(enrichment.targets_json or [])
    status_bonus = 30 if enrichment.status in {"complete", "completed", "ready"} else 10
    return min(100, 35 + status_bonus + finding_count * 15 + target_count * 8)


def operator_confirmation_score(decisions: dict[str, Any]) -> int:
    if int(decisions.get("confirmed") or 0) > 0:
        return 95
    if int(decisions.get("labeled") or 0) > 0 or int(decisions.get("watching") or 0) > 0:
        return 75
    if int(decisions.get("rejected") or 0) > 0 or int(decisions.get("split") or 0) > 0:
        return 45
    return 35


def operator_confirmation_summary(decisions: dict[str, Any]) -> str:
    if int(decisions.get("confirmed") or 0) > 0:
        return "Operator has confirmed this identity relationship."
    if int(decisions.get("labeled") or 0) > 0:
        labels = decisions.get("labels") or []
        return f"Operator label present: {labels[0]}." if labels else "Operator label present."
    if int(decisions.get("watching") or 0) > 0:
        return "Operator is actively watching this identity."
    if int(decisions.get("rejected") or 0) > 0 or int(decisions.get("split") or 0) > 0:
        return "Operator has rejected or split at least one relationship."
    return "No operator confirmation has been recorded yet."


def radar_operator_read(overall_score: int, axes: list[dict[str, Any]]) -> str:
    weakest = min(axes, key=lambda axis: axis["score"]) if axes else None
    if overall_score >= 70:
        prefix = "Strong identity confidence"
    elif overall_score >= 50:
        prefix = "Moderate identity confidence"
    else:
        prefix = "Low identity confidence"
    if weakest is None:
        return f"{prefix}; TDS is still collecting evidence."
    return f"{prefix}; weakest axis is {weakest['label'].lower()} at {weakest['score']}%."


def confidence_tone(score: int) -> str:
    if score >= 75:
        return "good"
    if score >= 55:
        return "signal"
    if score >= 40:
        return "warn"
    return "low"


def plural_word(word: str, count: int) -> str:
    return word if count == 1 else f"{word}s"

def presence_confidence_drift(state: CurrentState, sightings: list[PresenceSighting], *, limit: int = 24) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    for sighting in sightings[:limit]:
        points.append(confidence_drift_point(_aware(sighting.timestamp), sighting.rssi, sighting.source))
    points.append(confidence_drift_point(_aware(state.last_seen_at), signal_value(state), state.source))
    points = [point for point in points if point["timestamp"] is not None]
    points.sort(key=lambda point: _aware(point["timestamp"]) or datetime.min.replace(tzinfo=UTC), reverse=True)
    deduped: list[dict[str, Any]] = []
    seen_keys: set[tuple[str, str]] = set()
    for point in points:
        key = (str(point["timestamp"]), point["source"] or "")
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(point)
    return {"items": deduped[:limit], "count": len(deduped[:limit]), "latest": deduped[0] if deduped else None}


def confidence_drift_point(timestamp: datetime | None, rssi: int | None, source: str | None) -> dict[str, Any]:
    if rssi is None:
        confidence = 45
        reason = "signal strength unavailable"
    else:
        confidence = max(20, min(95, 130 + int(rssi)))
        if rssi >= -55:
            reason = "strong nearby signal"
        elif rssi <= -75:
            reason = "weak distant signal"
        else:
            reason = "moderate signal confidence"
    return {"timestamp": timestamp, "confidence": confidence, "reason": reason, "rssi": rssi, "source": source}


def format_signal_summary(rssi: int | None) -> str:
    return f"{rssi} dBm" if rssi is not None else "unknown signal"


def event_related_to_entity(event: Event, state: CurrentState) -> bool:
    payload = event.payload or {}
    values = {string_value(payload.get("entity_key")), string_value(payload.get("unificlientmac")), string_value(payload.get("unificlientip"))}
    values.update(string_value(value) for value in payload.values() if isinstance(value, str))
    state_values = {state.state_key, string_value(state.identity_hint), string_value(first_mac_value(state))}
    state_values.update(values_for_fields(state, "ipAddress", "ip", "unificlientip"))
    state_values = {value.lower() for value in state_values if value}
    return any(value.lower() in state_values for value in values if value)


def presence_graph_timeline(session: Session, entity_key: str, *, limit: int = 100) -> list[dict[str, Any]]:
    state = session.get(CurrentState, entity_key)
    aliases = graph_entity_aliases(entity_key, state)
    items: list[dict[str, Any]] = []

    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .order_by(PresenceSighting.timestamp.desc())
        .limit(limit)
    ).scalars().all()
    for sighting in sightings:
        label = string_value((sighting.evidence_json or {}).get("label")) or string_value(sighting.identity_hint) or entity_key
        items.append(
            {
                "id": sighting.id,
                "type": "sighting",
                "label": label,
                "timestamp": _aware(sighting.timestamp),
                "severity": "info",
                "source": sighting.source,
                "sensor_id": sighting.sensor_id,
                "rssi": sighting.rssi,
                "summary": f"{label} seen by {sighting.sensor_id or sighting.source}.",
            }
        )

    notes = session.execute(
        select(InvestigationNote)
        .where(InvestigationNote.entity_key == entity_key)
        .order_by(InvestigationNote.created_at.desc())
        .limit(limit)
    ).scalars().all()
    for note in notes:
        items.append(
            {
                "id": note.id,
                "type": "note",
                "label": note.disposition,
                "timestamp": _aware(note.created_at),
                "severity": "info" if note.disposition == "note" else note.disposition,
                "source": "operator",
                "sensor_id": None,
                "rssi": None,
                "summary": note.note,
            }
        )

    if aliases:
        events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(1000)).scalars().all()
        for event in events:
            payload_values = {value.lower() for value in event_payload_values(event.payload)}
            if not any(alias in payload_values for alias in aliases):
                continue
            timeline_type = "playbook" if event.type == "presence_playbook_run" else "alert"
            items.append(
                {
                    "id": event.id,
                    "type": timeline_type,
                    "label": event.summary,
                    "timestamp": _aware(event.created_at),
                    "severity": event.severity,
                    "source": event.type,
                    "sensor_id": None,
                    "rssi": None,
                    "summary": event.summary,
                }
            )

    return sorted(items, key=lambda item: _aware(item["timestamp"]), reverse=True)[:limit]


def alert_entity_causal_graph(
    session: Session,
    *,
    window_seconds: int = 300,
    limit: int = 50,
) -> list[dict[str, Any]]:
    events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(500)).scalars().all()
    watches = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.enabled.is_(True)).order_by(PresenceWatchlist.updated_at.desc()).limit(500)
    ).scalars().all()
    current_states = {state.state_key: state for state in session.execute(select(CurrentState).limit(1500)).scalars().all()}
    candidates = []
    for watch in watches:
        state = current_states.get(watch.entity_key)
        aliases = graph_entity_aliases(watch.entity_key, state)
        aliases.update({string_value(watch.identity_hint).lower(), string_value(watch.label).lower()})
        candidates.append((watch, state, {alias for alias in aliases if alias}))

    items: list[dict[str, Any]] = []
    for event in events:
        fields = flattened_payload_fields(event.payload)
        for watch, state, aliases in candidates:
            matched = matched_payload_fields(fields, aliases)
            if not matched:
                continue
            before = nearby_sightings(session, watch.entity_key, event.created_at, -abs(window_seconds))
            after = nearby_sightings(session, watch.entity_key, event.created_at, abs(window_seconds))
            entity_label = watch.label or (label_for_state(state) if state else watch.entity_key)
            items.append(
                {
                    "id": f"{event.id}:{watch.entity_key}",
                    "relationship": "alert_to_entity",
                    "confidence": round(float(event.confidence), 2),
                    "explanation": causal_explanation(event.summary, matched, entity_label, before, after),
                    "matched_fields": matched[:5],
                    "event": {
                        "id": event.id,
                        "type": event.type,
                        "severity": event.severity,
                        "summary": event.summary,
                        "created_at": _aware(event.created_at),
                    },
                    "entity": {
                        "entity_key": watch.entity_key,
                        "label": entity_label,
                        "source": watch.source,
                        "protocol": watch.protocol,
                        "kind": watch.kind,
                        "identity_hint": watch.identity_hint,
                        "last_seen_at": _aware(state.last_seen_at) if state else None,
                        "rssi": signal_value(state) if state else None,
                    },
                    "timeline": {
                        "window_seconds": window_seconds,
                        "before_count": len(before),
                        "after_count": len(after),
                        "nearest_before": sighting_brief(before[0]) if before else None,
                        "nearest_after": sighting_brief(after[0]) if after else None,
                    },
                }
            )
            if len(items) >= limit:
                return sorted_causal_items(items)[:limit]
    return sorted_causal_items(items)[:limit]


def flattened_payload_fields(value: Any, prefix: str = "") -> list[dict[str, str]]:
    if isinstance(value, dict):
        fields: list[dict[str, str]] = []
        for key, item in value.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            fields.extend(flattened_payload_fields(item, next_prefix))
        return fields
    if isinstance(value, list):
        fields = []
        for index, item in enumerate(value):
            next_prefix = f"{prefix}[{index}]" if prefix else f"[{index}]"
            fields.extend(flattened_payload_fields(item, next_prefix))
        return fields
    text = string_value(value)
    return [{"field": prefix or "payload", "value": text}] if text else []


def matched_payload_fields(fields: list[dict[str, str]], aliases: set[str]) -> list[dict[str, str]]:
    matches = []
    for field in fields:
        value = field["value"]
        lowered = value.lower()
        if any(alias and alias in lowered for alias in aliases):
            matches.append({"field": field["field"], "value": value})
    return matches


def nearby_sightings(session: Session, entity_key: str, event_time: datetime, window_seconds: int) -> list[PresenceSighting]:
    event_at = _aware(event_time)
    if window_seconds < 0:
        threshold = event_at + timedelta(seconds=window_seconds)
        return session.execute(
            select(PresenceSighting)
            .where(PresenceSighting.entity_key == entity_key)
            .where(PresenceSighting.timestamp >= threshold)
            .where(PresenceSighting.timestamp <= event_at)
            .order_by(PresenceSighting.timestamp.desc())
            .limit(10)
        ).scalars().all()
    threshold = event_at + timedelta(seconds=window_seconds)
    return session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .where(PresenceSighting.timestamp >= event_at)
        .where(PresenceSighting.timestamp <= threshold)
        .order_by(PresenceSighting.timestamp.asc())
        .limit(10)
    ).scalars().all()


def sighting_brief(sighting: PresenceSighting) -> dict[str, Any]:
    return {
        "id": sighting.id,
        "timestamp": _aware(sighting.timestamp),
        "source": sighting.source,
        "sensor_id": sighting.sensor_id,
        "rssi": sighting.rssi,
    }


def causal_explanation(
    event_summary: str,
    matched_fields: list[dict[str, str]],
    entity_label: str,
    before: list[PresenceSighting],
    after: list[PresenceSighting],
) -> str:
    field_label = matched_fields[0]["field"] if matched_fields else "payload"
    context = []
    if before:
        context.append("seen before")
    if after:
        context.append("seen after")
    suffix = f"; {', '.join(context)} nearby" if context else ""
    return f"Alert {event_summary} matched {field_label} for {entity_label}{suffix}."


def sorted_causal_items(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        items,
        key=lambda item: (severity_rank(item["event"]["severity"]), item["confidence"], _aware(item["event"]["created_at"])),
        reverse=True,
    )


def graph_entity_aliases(entity_key: str, state: CurrentState | None) -> set[str]:
    aliases = {string_value(entity_key)}
    if state is not None:
        aliases.update(
            {
                string_value(state.identity_hint),
                string_value(first_mac_value(state)),
                string_value(field_value(state, "macAddress", "mac", "kismet.device.base.macaddr")),
            }
        )
    return {alias.lower() for alias in aliases if alias}


def graph_state_visible(state: CurrentState, mode: str) -> bool:
    category = category_for_state(state)
    if mode == "all":
        return True
    if mode == "presence":
        return category in {"client", "wifi", "ble"}
    if mode == "rf":
        return category in {"unknown_rf", "utility", "rail", "iot", "cellular"}
    if mode == "airspace":
        return False
    if mode == "rail":
        return False
    if mode == "iot":
        return False
    if mode == "cellular":
        return False
    if mode == "alerts":
        return True
    return True


def identity_decision_state(action: str) -> str:
    return {
        "confirm": "confirmed",
        "reject": "rejected",
        "split": "split",
        "label": "labeled",
        "ignore": "ignored",
        "watch": "watching",
    }.get(action, action)


def identity_decisions_for_entity(session: Session, entity_key: str, *, limit: int = 50) -> list[PresenceIdentityDecision]:
    return session.execute(
        select(PresenceIdentityDecision)
        .where(
            or_(
                PresenceIdentityDecision.entity_key == entity_key,
                PresenceIdentityDecision.target_entity_key == entity_key,
            )
        )
        .order_by(PresenceIdentityDecision.created_at.desc())
        .limit(limit)
    ).scalars().all()


def identity_decision_summary(session: Session, entity_key: str) -> dict[str, Any]:
    decisions = identity_decisions_for_entity(session, entity_key, limit=50)
    counts = Counter(identity_decision_state(decision.action) for decision in decisions)
    labels = sorted_unique(decision.label for decision in decisions if decision.label)
    latest = decisions[0] if decisions else None
    summary: dict[str, Any] = {
        "confirmed": counts.get("confirmed", 0),
        "rejected": counts.get("rejected", 0),
        "split": counts.get("split", 0),
        "labeled": counts.get("labeled", 0),
        "ignored": counts.get("ignored", 0),
        "watching": counts.get("watching", 0),
        "total": len(decisions),
        "labels": labels,
        "latest": None,
    }
    if latest is not None:
        summary["latest"] = {
            "id": latest.id,
            "action": latest.action,
            "decision_state": identity_decision_state(latest.action),
            "entity_key": latest.entity_key,
            "target_entity_key": latest.target_entity_key,
            "canonical_key": latest.canonical_key,
            "label": latest.label,
            "reason": latest.reason,
            "created_at": latest.created_at,
        }
    return summary


def graph_entity_node(watch: PresenceWatchlist, state: CurrentState | None) -> dict[str, Any]:
    if state is None:
        return {
            "id": f"entity:{watch.entity_key}",
            "type": "entity",
            "label": watch.label,
            "entity_key": watch.entity_key,
            "source": watch.source,
            "protocol": watch.protocol,
            "kind": watch.kind,
            "severity": None,
            "first_seen_at": None,
            "last_seen_at": None,
            "seen_count": 0,
            "rssi": None,
            "confidence": 0.1,
            "badges": [watch.entity_type, watch.source, watch.protocol],
            "summary": f"{watch.label} is tracked but has no current-state record.",
        }
    rssi = signal_value(state)
    return {
        "id": f"entity:{watch.entity_key}",
        "type": "entity",
        "label": watch.label,
        "entity_key": watch.entity_key,
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": rssi,
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": graph_badges(entity_type_for_state(state), state.source, state.protocol),
        "summary": f"{watch.label} has been seen {state.seen_count} {pluralize('time', state.seen_count)} by {state.sensor_id}.",
    }


def graph_resolved_identity_summary(resolved_identity: dict[str, Any]) -> dict[str, Any]:
    return {
        "canonical_key": resolved_identity.get("canonical_key"),
        "label": resolved_identity.get("label"),
        "tier": resolved_identity.get("tier"),
        "relationship_label": resolved_identity.get("relationship_label"),
        "confidence": resolved_identity.get("confidence"),
        "source_count": resolved_identity.get("source_count"),
        "entity_count": resolved_identity.get("entity_count"),
        "operator_feedback": resolved_identity.get("operator_feedback") or operator_feedback_summary([]),
        "sources": (resolved_identity.get("sources") or [])[:5],
        "evidence": [
            {
                "type": item.get("type"),
                "value": item.get("value"),
                "confidence": item.get("confidence"),
                "explanation": item.get("explanation"),
                "sources": (item.get("sources") or [])[:5],
            }
            for item in (resolved_identity.get("evidence") or [])[:3]
        ],
    }


def graph_sensor_node(state: CurrentState) -> dict[str, Any]:
    return {
        "id": f"sensor:{state.sensor_id}",
        "type": "sensor",
        "label": state.sensor_id,
        "source": state.source,
        "protocol": state.protocol,
        "kind": "sensor",
        "severity": "warning" if freshness_for_time(state.last_seen_at) != "live" else None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": None,
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": graph_badges("sensor", state.source, state.zone_id),
        "summary": f"{state.sensor_id} last reported {label_for_state(state)} from {state.source}.",
    }


def graph_source_node(state: CurrentState) -> dict[str, Any]:
    return {
        "id": f"source:{state.source}",
        "type": "source",
        "label": state.source,
        "source": state.source,
        "protocol": None,
        "kind": "collector",
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": None,
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": graph_badges("source", state.source),
        "summary": f"{state.source} is feeding observations through {state.sensor_id}.",
    }


def graph_event_node(event: Event) -> dict[str, Any]:
    return {
        "id": f"event:{event.id}",
        "type": "event",
        "label": event.summary,
        "entity_key": None,
        "source": event.type,
        "protocol": None,
        "kind": event.type,
        "severity": event.severity,
        "first_seen_at": _aware(event.created_at),
        "last_seen_at": _aware(event.created_at),
        "seen_count": 1,
        "rssi": None,
        "confidence": round(float(event.confidence), 2),
        "badges": graph_badges(event.severity, event.type),
        "summary": f"{event.severity} {event.type}: {event.summary}",
    }


def graph_aircraft_node(state: CurrentState, metadata: AircraftMetadata | None = None) -> dict[str, Any]:
    aircraft_details = aircraft_details_for_state(state, metadata)
    altitude = aircraft_details["altitude_ft"]
    heading = aircraft_details["track_deg"]
    speed = aircraft_details["ground_speed_kt"]
    label = aircraft_details.get("callsign") or aircraft_details["registration"] or label_for_state(state)
    identity_parts = [
        aircraft_details.get("airline") or aircraft_details["operator"],
        aircraft_details.get("aircraft_model") or aircraft_details["aircraft_type"],
    ]
    identity = " ".join(part for part in identity_parts if part)
    motion_details = []
    if altitude is not None:
        motion_details.append(f"{altitude:,} ft")
    if speed is not None:
        motion_details.append(f"{speed:.0f} kt")
    if heading is not None:
        motion_details.append(f"{aircraft_details['track_label']} heading")
    lane_hint = []
    if altitude is not None:
        lane_hint.append(f"{altitude:,} ft")
    if aircraft_details["track_label"]:
        lane_hint.append(aircraft_details["track_label"])
    summary_subject = f"a {identity}" if identity else "an ADS-B aircraft"
    return {
        "id": f"aircraft:{state.state_key}",
        "type": "aircraft",
        "label": label,
        "entity_key": state.state_key,
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": signal_value(state),
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": graph_badges("aircraft", state.source, aircraft_details["flight"], *(motion_details[:1])),
        "position_hint": {"lane": " / ".join(lane_hint) if lane_hint else "airspace", "rank": state.seen_count},
        "summary": f"{label} is {summary_subject}" + (f" at {', '.join(motion_details)}." if motion_details else "."),
        "aircraft_details": aircraft_details,
    }


def graph_rail_node(state: CurrentState, *, session: Session | None = None) -> dict[str, Any]:
    context = rail_context_summary(state) or {}
    label = label_for_state(state)
    lane_parts = [
        context.get("channel_label"),
        context.get("operator_hint"),
    ]
    rail_badges = graph_badges("rail", state.source, context.get("channel_label"), context.get("operator_hint"))
    operator_read = string_value(context.get("operator_read")) or f"{label} has passive rail RF activity."
    return {
        "id": f"rail:{state.state_key}",
        "type": "rail",
        "label": label,
        "entity_key": state.state_key,
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": signal_value(state),
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": rail_badges,
        "position_hint": {"lane": " / ".join(str(part) for part in lane_parts if part) or "rail RF", "rank": state.seen_count},
        "summary": operator_read,
        "rail_context": context or None,
        "rail_visuals": rail_activity_visuals(session, state, context) if session is not None and context else None,
    }


def graph_iot_node(state: CurrentState) -> dict[str, Any]:
    context = iot_context_summary(state) or {}
    label = label_for_state(state)
    lane_parts = [
        context.get("protocol_label"),
        context.get("channel_label"),
    ]
    badges = graph_badges("iot", state.source, context.get("protocol_label"), context.get("channel_label"), context.get("vendor_hint"))
    operator_read = string_value(context.get("operator_read")) or f"{label} has Zigbee/Thread mesh activity."
    return {
        "id": f"iot:{state.state_key}",
        "type": "iot",
        "label": label,
        "entity_key": state.state_key,
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": signal_value(state),
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": badges,
        "position_hint": {"lane": " / ".join(str(part) for part in lane_parts if part) or "IoT mesh", "rank": state.seen_count},
        "summary": operator_read,
        "iot_context": context or None,
    }


def graph_cellular_node(state: CurrentState) -> dict[str, Any]:
    context = cellular_context_summary(state) or {}
    label = label_for_state(state)
    lane_parts = [
        context.get("decode_channel"),
        cellular_frequency_label("DL", context.get("dl_frequency_mhz")),
        cellular_frequency_label("UL", context.get("ul_frequency_mhz")),
    ]
    cell_label = f"Cell {context['cell_id']}" if context.get("cell_id") else None
    badges = graph_badges("cellular", state.source, context.get("decode_channel"), cell_label)
    operator_read = string_value(context.get("operator_read")) or f"{label} has LTE testbed decode status."
    return {
        "id": f"cellular:{state.state_key}",
        "type": "cellular",
        "label": label,
        "entity_key": state.state_key,
        "source": state.source,
        "protocol": state.protocol,
        "kind": state.kind,
        "severity": None,
        "first_seen_at": _aware(state.first_seen_at),
        "last_seen_at": _aware(state.last_seen_at),
        "seen_count": state.seen_count,
        "rssi": signal_value(state),
        "confidence": graph_confidence(state.seen_count, state.last_seen_at),
        "badges": badges,
        "position_hint": {"lane": " / ".join(str(part) for part in lane_parts if part) or "LTE testbed", "rank": state.seen_count},
        "summary": operator_read,
        "cellular_context": context or None,
    }


def aircraft_details_for_state(state: CurrentState, metadata: AircraftMetadata | None = None) -> dict[str, Any]:
    track = float_value(field_value(state, "track", "heading", "true_heading", "kismet.common.location.heading"))
    flight = string_value(field_value(state, "flight", "callsign", "adsb.device.callsign", "name")) or None
    parsed = parsed_aircraft_label(flight or label_for_state(state))
    aircraft_type = string_value(field_value(state, "t", "type", "aircraft_type", "model")) or (metadata.aircraft_type if metadata else None)
    operator = string_value(field_value(state, "operator", "owner", "airline", "company")) or (metadata.operator if metadata else None)
    aircraft_model = aircraft_type or parsed.get("aircraft_model")
    aircraft_photo = aircraft_photo_for_model(aircraft_model or operator or flight)
    confidence = aircraft_metadata_confidence(metadata, parsed, aircraft_type, operator, aircraft_photo["key"])
    altitude_ft = int_value(
        field_value(state, "alt_baro", "alt_geom", "altitude", "alt", "baro_altitude", "kismet.common.location.alt")
    )
    ground_speed_kt = float_value(field_value(state, "gs", "speed", "ground_speed", "groundspeed", "kismet.common.location.speed"))
    vertical_rate_fpm = int_value(field_value(state, "baro_rate", "geom_rate", "vertical_rate", "vertrate"))
    track_label = heading_direction_label(int(round((track % 360) / 45) * 45) % 360) if track is not None else None
    details = {
        "hex": string_value(field_value(state, "hex", "icao", "icao24", "address", "adsb.device.icao"))
        or string_value(state.identity_hint)
        or None,
        "flight": flight,
        "registration": string_value(field_value(state, "registration", "reg", "tail", "tail_number"))
        or (metadata.registration if metadata else None)
        or parsed.get("registration"),
        "aircraft_type": aircraft_type,
        "operator": operator or parsed.get("operator"),
        "callsign": parsed.get("callsign"),
        "callsign_prefix": parsed.get("callsign_prefix"),
        "flight_number": parsed.get("flight_number"),
        "airline": parsed.get("airline"),
        "aircraft_model": aircraft_model,
        "aircraft_visual_class": aircraft_visual_class(aircraft_model or operator or flight),
        "aircraft_photo_key": aircraft_photo["key"],
        "aircraft_photo_label": aircraft_photo["label"],
        "altitude_ft": altitude_ft,
        "ground_speed_kt": ground_speed_kt,
        "track_deg": track,
        "track_label": track_label,
        "vertical_rate_fpm": vertical_rate_fpm,
        "squawk": string_value(field_value(state, "squawk", "adsb.squawk")) or None,
        "emergency": string_value(field_value(state, "emergency")) or None,
        "lat": float_value(field_value(state, "lat", "latitude", "kismet.common.location.lat")),
        "lon": float_value(field_value(state, "lon", "lng", "longitude", "kismet.common.location.lon")),
        "category": string_value(field_value(state, "category", "emitter_category")) or None,
        "messages": int_value(field_value(state, "messages", "msg_count", "packets_total")),
        "seen_pos_seconds": float_value(field_value(state, "seen_pos", "seen_position")),
        "metadata_confidence": confidence["confidence"],
        "metadata_provenance": confidence["provenance"],
        "route_summary": aircraft_route_summary(track, altitude_ft, vertical_rate_fpm),
    }
    if metadata:
        details["metadata_matched"] = True
        details["metadata_source"] = metadata.source
    elif parsed:
        details["metadata_source"] = "parsed-label"
    return details


def aircraft_metadata_confidence(
    metadata: AircraftMetadata | None,
    parsed: dict[str, str],
    aircraft_type: str | None,
    operator: str | None,
    photo_key: str | None,
) -> dict[str, Any]:
    if metadata:
        return {"confidence": 0.95, "provenance": "local aircraft database"}
    if (aircraft_type or parsed.get("aircraft_model")) and (operator or parsed.get("operator") or parsed.get("airline") or parsed.get("callsign")):
        return {"confidence": 0.78, "provenance": "collector payload + callsign prefix"}
    if parsed:
        return {"confidence": 0.65, "provenance": "parsed ADS-B label"}
    if aircraft_type or photo_key:
        return {"confidence": 0.45, "provenance": "model family match"}
    return {"confidence": 0.25, "provenance": "ADS-B current state"}


def parsed_aircraft_label(label: str | None) -> dict[str, str]:
    text = re.sub(r"\s+", " ", string_value(label).upper()).strip()
    if not text or text.startswith("ADSB "):
        return {}
    tokens = text.split()
    if not tokens:
        return {}
    parsed: dict[str, str] = {}
    first = tokens[0]
    callsign_match = re.fullmatch(r"([A-Z]{2,4})(\d{1,5}[A-Z]?)", first)
    if callsign_match:
        parsed["callsign"] = first
        parsed["callsign_prefix"] = callsign_match.group(1)
        parsed["flight_number"] = callsign_match.group(2)
        if airline := AIRCRAFT_CALLSIGN_PREFIXES.get(callsign_match.group(1)):
            parsed["airline"] = airline
        tokens = tokens[1:]
    elif re.fullmatch(r"N[0-9A-Z]{1,5}", first):
        parsed["registration"] = first
        tokens = tokens[1:]

    model_tokens: list[str] = []
    while tokens:
        candidate = " ".join([*model_tokens, tokens[0]]) if model_tokens else tokens[0]
        if AIRCRAFT_MODEL_RE.fullmatch(candidate):
            model_tokens.append(tokens.pop(0))
            continue
        break
    if model_tokens:
        parsed["aircraft_model"] = " ".join(model_tokens)
    if tokens:
        parsed["operator"] = " ".join(tokens)
    return parsed


def aircraft_route_summary(track: float | None, altitude_ft: int | None, vertical_rate_fpm: int | None) -> dict[str, Any] | None:
    if track is None and altitude_ft is None and vertical_rate_fpm is None:
        return None
    heading_bucket = int(round(((track or 0) % 360) / 45) * 45) % 360 if track is not None else None
    heading_label = heading_direction_label(heading_bucket) if heading_bucket is not None else None
    altitude_band = altitude_band_label(altitude_ft) if altitude_ft is not None else None
    lane_parts = []
    if heading_label:
        lane_parts.append(f"{heading_label} lane")
    if altitude_band:
        lane_parts.append(altitude_band)
    known_parts = sum(1 for item in (track, altitude_ft, vertical_rate_fpm) if item is not None)
    return {
        "label": " · ".join(lane_parts) if lane_parts else "airspace route",
        "heading_label": heading_label,
        "altitude_band": altitude_band,
        "pass_direction": pass_direction_label(heading_bucket) if heading_bucket is not None else None,
        "altitude_trend": altitude_trend_label(vertical_rate_fpm),
        "confidence": round(0.35 + (known_parts * 0.15), 2),
    }


def pass_direction_label(heading_bucket: int) -> str:
    labels = {
        0: "northbound",
        45: "northeastbound",
        90: "eastbound",
        135: "southeastbound",
        180: "southbound",
        225: "southwestbound",
        270: "westbound",
        315: "northwestbound",
    }
    return labels.get(heading_bucket % 360, "unknown")


def altitude_trend_label(vertical_rate_fpm: int | None) -> str | None:
    if vertical_rate_fpm is None:
        return None
    if vertical_rate_fpm > 250:
        return "climbing"
    if vertical_rate_fpm < -250:
        return "descending"
    return "level"


def aircraft_visual_class(value: str | None) -> str:
    text = string_value(value).upper()
    if any(token in text for token in ("EC-", "EC1", "EC2", "EC3", "EC4", "MBB-BK", "HELICOPTER")):
        return "helicopter"
    if any(token in text for token in ("777", "787", "767", "747", "A330", "A340", "A350", "A380")):
        return "widebody"
    if any(token in text for token in ("BE20", "BE30", "BE40", "PC12", "C208", "TURBO", "KING AIR")):
        return "turboprop"
    if any(token in text for token in ("A36", "C172", "C182", "PA28", "SR22")):
        return "small-ga"
    if any(
        token in text
        for token in (
            "737",
            "757",
            "B73",
            "B75",
            "A318",
            "A319",
            "A320",
            "A321",
            "A20N",
            "A21N",
            "E170",
            "E175",
            "E190",
            "E195",
            "ERJ",
        )
    ):
        return "jet"
    return "unknown"


def aircraft_photo_for_model(value: str | None) -> dict[str, str | None]:
    text = string_value(value).upper()
    if any(token in text for token in ("787", "B78")):
        return {"key": "boeing-787", "label": "Boeing 787 Dreamliner"}
    if any(token in text for token in ("777", "B77")):
        return {"key": "boeing-777", "label": "Boeing 777 family"}
    if any(token in text for token in ("767", "B76")):
        return {"key": "boeing-767", "label": "Boeing 767 family"}
    if any(token in text for token in ("737", "B73")):
        return {"key": "boeing-737", "label": "Boeing 737 family"}
    if any(token in text for token in ("A318", "A319", "A320", "A321", "A20N", "A21N", "A320NEO", "A321NEO")):
        return {"key": "airbus-a320", "label": "Airbus A320 family"}
    if any(token in text for token in ("E170", "E175", "E190", "E195", "ERJ")):
        return {"key": "embraer-ejet", "label": "Embraer regional jet family"}
    if any(token in text for token in ("EC45", "EC-145", "EC145", "H145", "MBB-BK", "BK 117", "BK117")):
        return {"key": "airbus-h145", "label": "Airbus H145 / EC145 helicopter"}
    if any(token in text for token in ("BE20", "BE30", "KING AIR", "B200")):
        return {"key": "king-air", "label": "Beechcraft King Air family"}
    if any(token in text for token in ("A36", "BONANZA", "C172", "C182", "PA28", "SR22")):
        return {"key": "small-ga", "label": "Small general aviation aircraft"}
    return {"key": None, "label": None}


def aircraft_metadata_lookup_key(state: CurrentState) -> str | None:
    return normalize_icao_hex(
        field_value(state, "hex", "icao", "icao24", "address", "adsb.device.icao") or state.identity_hint
    )


def aircraft_registration_lookup_key(state: CurrentState) -> str | None:
    explicit = clean_registration_value(field_value(state, "registration", "reg", "tail", "tail_number"))
    if explicit:
        return explicit
    label = string_value(field_value(state, "flight", "callsign", "adsb.device.callsign", "name"))
    if not label:
        return None
    return clean_registration_value(label.split()[0])


def clean_registration_value(value: Any) -> str | None:
    text = string_value(value).upper()
    if not text or text in {"ADSB", "MODE", "NULL"}:
        return None
    if re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,11}", text):
        return text
    return None


def aircraft_metadata_for_state(metadata: dict[str, AircraftMetadata], state: CurrentState) -> AircraftMetadata | None:
    icao_hex = aircraft_metadata_lookup_key(state)
    registration = aircraft_registration_lookup_key(state)
    if icao_hex and (match := metadata.get(f"icao:{icao_hex}")):
        return match
    if registration:
        return metadata.get(f"reg:{registration}")
    return None


def aircraft_metadata_for_states(session: Session, states: list[CurrentState]) -> dict[str, AircraftMetadata]:
    icao_hexes = {icao_hex for state in states if (icao_hex := aircraft_metadata_lookup_key(state))}
    registrations = {registration for state in states if (registration := aircraft_registration_lookup_key(state))}
    if not icao_hexes and not registrations:
        return {}
    filters = []
    if icao_hexes:
        filters.append(AircraftMetadata.icao_hex.in_(icao_hexes))
    if registrations:
        filters.append(AircraftMetadata.registration.in_(registrations))
    rows = session.execute(select(AircraftMetadata).where(or_(*filters))).scalars().all()
    metadata: dict[str, AircraftMetadata] = {}
    for row in rows:
        metadata[f"icao:{row.icao_hex}"] = row
        if row.registration:
            metadata[f"reg:{clean_registration_value(row.registration)}"] = row
    return metadata


def graph_edge(
    edge_id: str,
    source: str,
    target: str,
    edge_type: str,
    weight: int,
    confidence: float,
    latest_seen_at: datetime | None,
    evidence_count: int,
    explanation: str,
    evidence: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "id": edge_id,
        "source": source,
        "target": target,
        "type": edge_type,
        "weight": weight,
        "confidence": confidence,
        "latest_seen_at": latest_seen_at,
        "evidence_count": evidence_count,
        "explanation": explanation,
        "evidence": evidence,
    }


def graph_state_evidence(state: CurrentState, label: str) -> dict[str, Any]:
    return {
        "label": label,
        "timestamp": _aware(state.last_seen_at),
        "source": state.source,
        "sensor_id": state.sensor_id,
        "rssi": signal_value(state),
    }


def graph_confidence(weight: int, latest_seen_at: datetime | None) -> float:
    score = 0.25 + min(max(weight, 0), 25) * 0.025
    if latest_seen_at is not None:
        freshness = freshness_for_time(latest_seen_at)
        if freshness == "live":
            score += 0.25
        elif freshness == "stale":
            score += 0.12
    return round(min(1.0, max(0.05, score)), 2)


def graph_badges(*values: str | None) -> list[str]:
    badges = []
    for value in values:
        text = string_value(value)
        if text and text not in badges:
            badges.append(text)
    return badges[:6]


def pluralize(word: str, count: int) -> str:
    return word if count == 1 else f"{word}s"


def spectrum_occupancy(session: Session, *, limit: int = 40) -> list[dict[str, Any]]:
    states = session.execute(
        select(CurrentState)
        .where(CurrentState.kind == "spectrum_peak")
        .order_by(CurrentState.last_seen_at.desc())
        .limit(500)
    ).scalars().all()
    buckets: dict[int, dict[str, Any]] = {}
    for state in states:
        frequency = float_value(field_value(state, "frequency", "freq"))
        if frequency is None:
            continue
        bucket_start = int(frequency // 1)
        bucket = buckets.setdefault(
            bucket_start,
            {
                "id": f"{bucket_start}-{bucket_start + 1}",
                "frequency_band": f"{bucket_start}-{bucket_start + 1} MHz",
                "frequency_start": bucket_start,
                "frequency_end": bucket_start + 1,
                "peak_count": 0,
                "seen_count": 0,
                "strongest_rssi": None,
                "latest_seen_at": _aware(state.last_seen_at),
            },
        )
        rssi = signal_value(state)
        bucket["peak_count"] += 1
        bucket["seen_count"] += state.seen_count
        if rssi is not None and (bucket["strongest_rssi"] is None or rssi > bucket["strongest_rssi"]):
            bucket["strongest_rssi"] = rssi
        if _aware(bucket["latest_seen_at"]) < _aware(state.last_seen_at):
            bucket["latest_seen_at"] = _aware(state.last_seen_at)
    return sorted(buckets.values(), key=lambda row: (row["peak_count"], row["seen_count"]), reverse=True)[:limit]


def rf_burst_swarms(
    session: Session,
    *,
    window_seconds: int = 120,
    minimum_entities: int = 5,
    limit: int = 20,
) -> list[dict[str, Any]]:
    threshold = datetime.now(UTC) - timedelta(seconds=max(1, window_seconds))
    states = session.execute(
        select(CurrentState)
        .where(CurrentState.last_seen_at >= threshold)
        .order_by(CurrentState.last_seen_at.desc())
        .limit(1000)
    ).scalars().all()
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for state in states:
        category = category_for_state(state)
        if category in {"aircraft", "infrastructure", "unknown"}:
            continue
        key = (state.source, state.protocol, category)
        rssi = signal_value(state)
        group = groups.setdefault(
            key,
            {
                "id": f"{state.source}:{state.protocol}:{category}",
                "label": f"{category_label(category)} burst on {state.source}",
                "source": state.source,
                "protocol": state.protocol,
                "category": category,
                "entity_count": 0,
                "seen_count": 0,
                "strongest_rssi": None,
                "latest_seen_at": _aware(state.last_seen_at),
                "sample_labels": [],
            },
        )
        group["entity_count"] += 1
        group["seen_count"] += state.seen_count
        if rssi is not None and (group["strongest_rssi"] is None or rssi > group["strongest_rssi"]):
            group["strongest_rssi"] = rssi
        if _aware(group["latest_seen_at"]) < _aware(state.last_seen_at):
            group["latest_seen_at"] = _aware(state.last_seen_at)
        label = label_for_state(state)
        if label and label not in group["sample_labels"]:
            group["sample_labels"].append(label)

    bursts = []
    for group in groups.values():
        if group["entity_count"] < minimum_entities:
            continue
        strongest = group["strongest_rssi"]
        severity = "info"
        if group["entity_count"] >= minimum_entities * 2 or (isinstance(strongest, int) and strongest >= -55):
            severity = "warning"
        if group["entity_count"] >= minimum_entities * 3 or (isinstance(strongest, int) and strongest >= -40):
            severity = "critical"
        group["severity"] = severity
        group["window_seconds"] = window_seconds
        group["sample_labels"] = group["sample_labels"][:5]
        bursts.append(group)
    return sorted(bursts, key=lambda row: (severity_rank(row["severity"]), row["entity_count"], row["seen_count"]), reverse=True)[:limit]


def change_briefing(session: Session, *, window_seconds: int = 300) -> dict[str, Any]:
    threshold = datetime.now(UTC) - timedelta(seconds=max(1, window_seconds))
    recent_states = session.execute(
        select(CurrentState).where(CurrentState.last_seen_at >= threshold).order_by(CurrentState.last_seen_at.desc()).limit(1000)
    ).scalars().all()
    new_states = [state for state in recent_states if _aware(state.first_seen_at) >= threshold]
    recent_events = session.execute(
        select(Event).where(Event.created_at >= threshold).order_by(Event.created_at.desc()).limit(500)
    ).scalars().all()
    tracked_items = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.enabled.is_(True)).order_by(PresenceWatchlist.updated_at.desc()).limit(500)
    ).scalars().all()

    departed = []
    for watch in tracked_items:
        state = session.get(CurrentState, watch.entity_key)
        if state is not None and _aware(state.last_seen_at) < threshold:
            departed.append(watch)

    source_counts: Counter[str] = Counter(state.source for state in new_states)
    severity = "info"
    if recent_events or departed:
        severity = "warning"
    if any(event.severity in {"critical", "error"} for event in recent_events):
        severity = "critical"

    items = [
        {"type": "new_entity", "label": label_for_state(state), "severity": "info"}
        for state in new_states[:5]
    ]
    items.extend({"type": "event", "label": event.summary, "severity": event.severity} for event in recent_events[:5])
    items.extend({"type": "departed", "label": watch.label, "severity": "warning"} for watch in departed[:5])
    return {
        "window_seconds": window_seconds,
        "severity": severity,
        "summary": f"{len(new_states)} new · {len(recent_events)} events · {len(departed)} departed",
        "new_entities": len(new_states),
        "recent_events": len(recent_events),
        "departed_tracked": len(departed),
        "top_sources": [{"source": source, "count": count} for source, count in source_counts.most_common(5)],
        "items": items[:12],
    }



def presence_pattern_analytics(session: Session, *, limit: int = 50) -> dict[str, Any]:
    watches = session.execute(
        select(PresenceWatchlist)
        .where(PresenceWatchlist.enabled.is_(True))
        .order_by(PresenceWatchlist.updated_at.desc())
        .limit(limit)
    ).scalars().all()
    entities: list[dict[str, Any]] = []
    all_sightings: list[PresenceSighting] = []
    alert_rules: list[dict[str, Any]] = []
    live_count = 0
    learned_count = 0

    for watch in watches:
        state = session.get(CurrentState, watch.entity_key)
        sightings = session.execute(
            select(PresenceSighting)
            .where(PresenceSighting.entity_key == watch.entity_key)
            .order_by(PresenceSighting.timestamp.desc())
            .limit(250)
        ).scalars().all()
        all_sightings.extend(sightings)
        if state is None:
            continue
        candidate = state_candidate(state, tracked=True)
        rhythm = presence_rhythm(sightings)
        commute = commute_clock(rhythm)
        rules = presence_rules(candidate, state, True)
        pattern_status = "learned" if commute.get("status") == "learned" and int(rhythm.get("sample_count") or 0) >= 3 else "learning"
        if pattern_status == "learned":
            learned_count += 1
        if rules.get("freshness") == "live":
            live_count += 1
        entity = {
            "entity_key": watch.entity_key,
            "label": watch.label or label_for_state(state),
            "category": candidate.get("category"),
            "source": state.source,
            "protocol": state.protocol,
            "kind": state.kind,
            "rssi": candidate.get("rssi"),
            "last_seen_at": _aware(state.last_seen_at),
            "sample_count": rhythm.get("sample_count", 0),
            "pattern_status": pattern_status,
            "typical_hour": commute.get("typical_hour"),
            "peak_hours": rhythm.get("peak_hours", []),
            "hotspots": rhythm.get("hotspots", []),
            "rule_state": rules,
            "operator_read": pattern_operator_read(watch.label or label_for_state(state), commute, rules),
        }
        entities.append(entity)
        alert_rules.extend(pattern_alert_rules_for_entity(entity))

    rhythm = presence_rhythm(all_sightings)
    entities.sort(key=lambda item: (item["pattern_status"] == "learned", int(item.get("sample_count") or 0), _aware(item.get("last_seen_at"))), reverse=True)
    alert_rules.sort(key=lambda item: (severity_rank(item["severity"]), _aware(item["timestamp"])), reverse=True)
    return {
        "summary": {
            "tracked_entities": len(watches),
            "visible_tracked": live_count,
            "learned_entities": learned_count,
            "alert_rules": len(alert_rules),
            "sample_count": int(rhythm.get("sample_count") or 0),
        },
        "rhythm": {
            "sample_count": rhythm.get("sample_count", 0),
            "peak_hours": rhythm.get("peak_hours", []),
            "hotspots": rhythm.get("hotspots", []),
            "hour_bins": rhythm_hour_bins(all_sightings),
        },
        "entities": entities[:limit],
        "alert_rules": alert_rules[:limit],
    }


def pattern_operator_read(label: str, commute: dict[str, Any], rules: dict[str, Any]) -> str:
    rule_label = string_value(rules.get("label")) or "Presence rule state unknown"
    commute_label = string_value(commute.get("label")) or "Learning normal presence time"
    return f"{label}: {commute_label}; {rule_label}."


def pattern_alert_rules_for_entity(entity: dict[str, Any]) -> list[dict[str, Any]]:
    rules = entity.get("rule_state") or {}
    status = string_value(rules.get("status"))
    timestamp = _aware(entity.get("last_seen_at"))
    alerts: list[dict[str, Any]] = []
    if status == "left_behind_candidate":
        alerts.append({
            "id": f"left_behind:{entity['entity_key']}",
            "type": "left_behind_candidate",
            "severity": "warning",
            "entity_key": entity["entity_key"],
            "label": entity["label"],
            "timestamp": timestamp,
            "summary": "Tracked identity is live with a strong nearby signal.",
            "operator_action": "Confirm whether this device should be nearby or left behind.",
        })
    if status == "departed":
        alerts.append({
            "id": f"departed:{entity['entity_key']}",
            "type": "departed_tracked",
            "severity": "warning",
            "entity_key": entity["entity_key"],
            "label": entity["label"],
            "timestamp": timestamp,
            "summary": "Tracked identity is stale or out of range.",
            "operator_action": "Review whether this is expected departure behavior.",
        })
    if entity.get("pattern_status") == "learning":
        alerts.append({
            "id": f"learning:{entity['entity_key']}",
            "type": "pattern_learning",
            "severity": "info",
            "entity_key": entity["entity_key"],
            "label": entity["label"],
            "timestamp": timestamp,
            "summary": "Not enough sightings yet to establish a normal rhythm.",
            "operator_action": "Keep collecting sightings before relying on schedule alerts.",
        })
    return alerts


def rhythm_hour_bins(sightings: list[PresenceSighting]) -> list[dict[str, int]]:
    counts: Counter[int] = Counter(_aware(sighting.timestamp).hour for sighting in sightings)
    return [{"hour": hour, "count": counts.get(hour, 0)} for hour in range(24)]

def presence_history_audit(session: Session) -> dict[str, Any]:
    stores = {
        "observations": history_store_audit(session, Observation, Observation.created_at, append_only=True),
        "current_state": history_store_audit(session, CurrentState, CurrentState.last_seen_at, append_only=False),
        "current_state_samples": history_store_audit(session, CurrentStateSample, CurrentStateSample.timestamp, append_only=True),
        "presence_sightings": history_store_audit(session, PresenceSighting, PresenceSighting.timestamp, append_only=True),
        "events": history_store_audit(session, Event, Event.created_at, append_only=True),
        "investigation_notes": history_store_audit(session, InvestigationNote, InvestigationNote.created_at, append_only=True),
        "identity_decisions": history_store_audit(session, PresenceIdentityDecision, PresenceIdentityDecision.created_at, append_only=True),
        "enrichments": history_store_audit(session, PresenceEnrichment, PresenceEnrichment.created_at, append_only=True),
    }
    state_count = stores["current_state"]["count"]
    sampled_state_keys = session.scalar(select(func.count(func.distinct(CurrentStateSample.state_key)))) or 0
    coverage_percent = int(round((sampled_state_keys / state_count) * 100)) if state_count else 100
    gaps = []
    if state_count and stores["current_state_samples"]["count"] == 0:
        gaps.append("Current-state rows exist but no compact history samples have been retained.")
    elif state_count and coverage_percent < 80:
        gaps.append(f"Only {coverage_percent}% of current-state identities have compact history samples.")
    status = "healthy" if not gaps else "needs_attention"
    return {
        "status": status,
        "stores": stores,
        "sample_coverage": {
            "state_count": state_count,
            "sampled_state_keys": int(sampled_state_keys),
            "coverage_percent": coverage_percent,
        },
        "gaps": gaps,
    }


def history_store_audit(session: Session, model: Any, timestamp_column: Any, *, append_only: bool) -> dict[str, Any]:
    count = session.scalar(select(func.count()).select_from(model)) or 0
    latest = session.scalar(select(func.max(timestamp_column)))
    return {"count": int(count), "latest_at": _aware(latest) if latest else None, "append_only": append_only}


def presence_change_feed(session: Session, *, window_seconds: int = 300, limit: int = 50) -> dict[str, Any]:
    threshold = datetime.now(UTC) - timedelta(seconds=window_seconds)
    items: list[dict[str, Any]] = []
    for state in session.execute(
        select(CurrentState).where(CurrentState.last_seen_at >= threshold).order_by(CurrentState.last_seen_at.desc()).limit(limit)
    ).scalars().all():
        items.append({
            "id": f"current_state:{state.state_key}:{_aware(state.last_seen_at).isoformat() if _aware(state.last_seen_at) else ''}",
            "type": "current_state",
            "severity": "info",
            "timestamp": _aware(state.last_seen_at),
            "entity_key": state.state_key,
            "label": label_for_state(state),
            "summary": f"{label_for_state(state)} seen by {state.sensor_id} at {format_signal_summary(signal_value(state))}.",
            "source": state.source,
            "sensor_id": state.sensor_id,
            "rssi": signal_value(state),
        })
    for event in session.execute(
        select(Event).where(Event.created_at >= threshold).order_by(Event.created_at.desc()).limit(limit)
    ).scalars().all():
        items.append({
            "id": f"event:{event.id}",
            "type": "event",
            "severity": event.severity,
            "timestamp": _aware(event.created_at),
            "entity_key": string_value(event.payload.get("entity_key")) or None,
            "label": event.summary,
            "summary": event.summary,
            "source": event.type,
            "sensor_id": None,
            "rssi": None,
        })
    for note in session.execute(
        select(InvestigationNote).where(InvestigationNote.created_at >= threshold).order_by(InvestigationNote.created_at.desc()).limit(limit)
    ).scalars().all():
        items.append({
            "id": f"note:{note.id}",
            "type": "note",
            "severity": "info" if note.disposition == "note" else "warning",
            "timestamp": _aware(note.created_at),
            "entity_key": note.entity_key,
            "label": f"Operator note: {note.disposition}",
            "summary": note.note,
            "source": "operator",
            "sensor_id": None,
            "rssi": None,
        })
    for decision in session.execute(
        select(PresenceIdentityDecision).where(PresenceIdentityDecision.created_at >= threshold).order_by(PresenceIdentityDecision.created_at.desc()).limit(limit)
    ).scalars().all():
        decision_value = decision.label or decision.target_entity_key or decision.reason or decision.action
        items.append({
            "id": f"identity_decision:{decision.id}",
            "type": "identity_decision",
            "severity": "info",
            "timestamp": _aware(decision.created_at),
            "entity_key": decision.entity_key,
            "label": f"Operator {decision.action}",
            "summary": f"Operator {decision.action}: {decision_value}",
            "source": "operator",
            "sensor_id": None,
            "rssi": None,
        })
    items.sort(key=lambda item: _aware(item.get("timestamp")) or datetime.min.replace(tzinfo=UTC), reverse=True)
    items = items[:limit]
    return {"items": items, "count": len(items), "window_seconds": window_seconds, "poll_after_seconds": 3}


def sensor_trust_heatmap(session: Session, *, limit: int = 100) -> dict[str, Any]:
    states = session.execute(select(CurrentState).order_by(CurrentState.last_seen_at.desc()).limit(3000)).scalars().all()
    groups: dict[tuple[str, str | None, str], dict[str, Any]] = {}
    for state in states:
        key = (state.sensor_id, state.zone_id, state.source)
        group = groups.setdefault(
            key,
            {
                "id": f"{state.source}:{state.zone_id}:{state.sensor_id}",
                "label": f"{state.sensor_id} · {state.source}",
                "sensor_id": state.sensor_id,
                "zone_id": state.zone_id,
                "source": state.source,
                "entity_count": 0,
                "observation_count": 0,
                "sample_count": 0,
                "alert_count": 0,
                "latest_seen_at": _aware(state.last_seen_at),
                "freshness": freshness_for_time(state.last_seen_at),
                "trust_score": 0,
                "status": "weak",
                "signals": [],
            },
        )
        group["entity_count"] += 1
        group["observation_count"] += int(state.seen_count or 0)
        if _aware(group["latest_seen_at"]) < _aware(state.last_seen_at):
            group["latest_seen_at"] = _aware(state.last_seen_at)
            group["freshness"] = freshness_for_time(state.last_seen_at)

    samples = session.execute(select(CurrentStateSample).order_by(CurrentStateSample.timestamp.desc()).limit(5000)).scalars().all()
    for sample in samples:
        sensor_id = sample.sensor_id or "unknown"
        key = (sensor_id, sample.zone_id, sample.source)
        group = groups.setdefault(
            key,
            {
                "id": f"{sample.source}:{sample.zone_id}:{sensor_id}",
                "label": f"{sensor_id} · {sample.source}",
                "sensor_id": sensor_id,
                "zone_id": sample.zone_id,
                "source": sample.source,
                "entity_count": 0,
                "observation_count": 0,
                "sample_count": 0,
                "alert_count": 0,
                "latest_seen_at": _aware(sample.timestamp),
                "freshness": freshness_for_time(sample.timestamp),
                "trust_score": 0,
                "status": "weak",
                "signals": [],
            },
        )
        group["sample_count"] += 1
        if _aware(group["latest_seen_at"]) < _aware(sample.timestamp):
            group["latest_seen_at"] = _aware(sample.timestamp)
            group["freshness"] = freshness_for_time(sample.timestamp)

    events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(1000)).scalars().all()
    for event in events:
        payload = event.payload or {}
        sensor_id = string_value(payload.get("sensor_id") or payload.get("sensorId") or payload.get("unificonnectedtodevicename"))
        source = string_value(payload.get("source") or event.type.split("_", 1)[0])
        if not sensor_id:
            continue
        candidate_keys = [key for key in groups if key[0] == sensor_id and key[2] == source]
        if not candidate_keys:
            candidate_keys = [(sensor_id, event.zone_id, source)]
        for key in candidate_keys[:1]:
            group = groups.setdefault(
                key,
                {
                    "id": f"{source}:{event.zone_id}:{sensor_id}",
                    "label": f"{sensor_id} · {source}",
                    "sensor_id": sensor_id,
                    "zone_id": event.zone_id,
                    "source": source,
                    "entity_count": 0,
                    "observation_count": 0,
                    "sample_count": 0,
                    "alert_count": 0,
                    "latest_seen_at": _aware(event.created_at),
                    "freshness": freshness_for_time(event.created_at),
                    "trust_score": 0,
                    "status": "weak",
                    "signals": [],
                },
            )
            group["alert_count"] += 1

    for group in groups.values():
        freshness = string_value(group.get("freshness"))
        score = {"live": 65, "stale": 45, "historical": 20}.get(freshness, 10)
        score += min(15, int(group["entity_count"]) * 5)
        score += min(20, int(group["sample_count"]) * 10)
        score += min(10, int(group["observation_count"]) // 2)
        score -= min(20, int(group["alert_count"]) * 8)
        group["trust_score"] = max(0, min(100, score))
        group["status"] = sensor_trust_status(group["trust_score"])
        group["signals"] = sensor_trust_signals(group)

    items = sorted(groups.values(), key=lambda item: (item["trust_score"], item["latest_seen_at"]), reverse=True)[:limit]
    trusted = sum(1 for item in items if item["status"] == "trusted")
    weak = sum(1 for item in items if item["status"] == "weak")
    return {
        "items": items,
        "count": len(items),
        "trusted_sensors": trusted,
        "weak_sensors": weak,
        "operator_read": f"{trusted} trusted sensors · {weak} weak sensors need attention.",
    }


def sensor_trust_status(score: int) -> str:
    if score >= 75:
        return "trusted"
    if score >= 50:
        return "degraded"
    return "weak"


def sensor_trust_signals(group: dict[str, Any]) -> list[str]:
    signals: list[str] = []
    freshness = string_value(group.get("freshness"))
    if freshness == "live":
        signals.append("live current-state feed")
    elif freshness == "stale":
        signals.append("stale current-state feed")
    else:
        signals.append("historical only")
    if int(group.get("sample_count") or 0) > 0:
        signals.append("compact samples present")
    if int(group.get("alert_count") or 0) > 0:
        signals.append("recent alerts")
    return signals


def sensor_coverage(session: Session, *, limit: int = 100) -> dict[str, Any]:
    states = session.execute(
        select(CurrentState).order_by(CurrentState.last_seen_at.desc()).limit(2000)
    ).scalars().all()
    groups: dict[tuple[str, str, str], dict[str, Any]] = {}
    for state in states:
        key = (state.sensor_id, state.zone_id, state.source)
        status = freshness_for_time(state.last_seen_at)
        category = coverage_category_for_state(state)
        group = groups.setdefault(
            key,
            {
                "id": f"{state.source}:{state.zone_id}:{state.sensor_id}",
                "label": f"{state.sensor_id} · {state.zone_id}",
                "sensor_id": state.sensor_id,
                "zone_id": state.zone_id,
                "source": state.source,
                "status": status,
                "entity_count": 0,
                "live_entities": 0,
                "latest_seen_at": _aware(state.last_seen_at),
                "category_counts": {},
                "coverage_score": 0,
            },
        )
        group["entity_count"] += 1
        if status == "live":
            group["live_entities"] += 1
        if _aware(group["latest_seen_at"]) < _aware(state.last_seen_at):
            group["latest_seen_at"] = _aware(state.last_seen_at)
            group["status"] = status
        category_counts = group["category_counts"]
        category_counts[category] = int(category_counts.get(category, 0)) + 1

    for group in groups.values():
        freshness_score = {"live": 100, "stale": 60, "historical": 20}.get(group["status"], 0)
        density_bonus = min(15, int(group["entity_count"]) * 2) if group["status"] == "stale" else 0
        group["coverage_score"] = min(100, freshness_score + density_bonus)

    items = sorted(groups.values(), key=lambda row: (row["coverage_score"], row["entity_count"]), reverse=True)[:limit]
    blind_spots = [
        {
            "sensor_id": item["sensor_id"],
            "zone_id": item["zone_id"],
            "source": item["source"],
            "status": item["status"],
        }
        for item in items
        if item["status"] != "live"
    ]
    return {
        "items": items,
        "count": len(items),
        "live_sensors": sum(1 for item in items if item["status"] == "live"),
        "blind_spots": blind_spots,
    }


def category_label(category: str) -> str:
    labels = {
        "wifi": "Wi-Fi",
        "client": "Client",
        "ble": "BLE",
        "utility": "Utility",
        "rail": "Rail RF",
        "iot": "Zigbee/Thread",
        "cellular": "Cellular Lab",
        "unknown_rf": "Unknown RF",
    }
    return labels.get(category, category.replace("_", " ").title())


def coverage_category_for_state(state: CurrentState) -> str:
    if state.protocol.lower() == "wifi":
        return "wifi"
    if state.protocol.lower() in {"ble", "bluetooth"}:
        return "ble"
    return category_for_state(state)


def severity_rank(severity: str) -> int:
    return {"critical": 3, "warning": 2, "info": 1}.get(severity, 0)


def investigation_search(session: Session, query: str, *, limit: int = 25) -> list[dict[str, Any]]:
    terms = [term for term in query.lower().split() if term]
    if not terms:
        return []

    items: list[dict[str, Any]] = []
    states = session.execute(select(CurrentState).order_by(CurrentState.last_seen_at.desc()).limit(500)).scalars().all()
    for state in states:
        label = label_for_state(state)
        fields = [
            {"field": "label", "value": label},
            {"field": "entity_key", "value": state.state_key},
            {"field": "identity_hint", "value": state.identity_hint},
            {"field": "source", "value": state.source},
            {"field": "protocol", "value": state.protocol},
            {"field": "kind", "value": state.kind},
        ]
        field_matches = search_field_matches(fields, terms)
        if field_matches:
            items.append(
                {
                    "type": "entity",
                    "label": label,
                    "entity_key": state.state_key,
                    "subtitle": " / ".join([state.source, state.protocol, state.kind]),
                    "source": state.source,
                    "severity": None,
                    "timestamp": _aware(state.last_seen_at),
                    "score": search_result_score(field_matches, state.last_seen_at, 55),
                    "matches": field_matches,
                }
            )
    notes = session.execute(select(InvestigationNote).order_by(InvestigationNote.created_at.desc()).limit(500)).scalars().all()
    for note in notes:
        fields = [
            {"field": "note", "value": note.note},
            {"field": "disposition", "value": note.disposition},
            {"field": "entity_key", "value": note.entity_key},
        ]
        field_matches = search_field_matches(fields, terms)
        if field_matches:
            items.append(
                {
                    "type": "note",
                    "label": note.note,
                    "entity_key": note.entity_key,
                    "subtitle": f"{note.disposition} note",
                    "source": "operator",
                    "severity": note.disposition,
                    "timestamp": _aware(note.created_at),
                    "score": search_result_score(field_matches, note.created_at, 45),
                    "matches": field_matches,
                }
            )
    events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(500)).scalars().all()
    for event in events:
        fields = [
            {"field": "summary", "value": event.summary},
            {"field": "type", "value": event.type},
            {"field": "severity", "value": event.severity},
            *flattened_payload_fields(event.payload),
        ]
        field_matches = search_field_matches(fields, terms)
        if field_matches:
            items.append(
                {
                    "type": "event",
                    "label": event.summary,
                    "event_id": event.id,
                    "subtitle": f"{event.severity} {event.type}",
                    "source": event.type,
                    "severity": event.severity,
                    "timestamp": _aware(event.created_at),
                    "score": search_result_score(field_matches, event.created_at, 50 + severity_rank(event.severity) * 5),
                    "matches": field_matches,
                }
            )
    return sorted(items, key=lambda item: (item["score"], _aware(item.get("timestamp"))), reverse=True)[:limit]


def search_field_matches(fields: list[dict[str, Any]], terms: list[str]) -> list[dict[str, str]]:
    normalized = [
        {"field": string_value(field.get("field")), "value": string_value(field.get("value"))}
        for field in fields
        if string_value(field.get("value"))
    ]
    haystack = " ".join(field["value"].lower() for field in normalized)
    if not all(term in haystack for term in terms):
        return []
    matches = []
    for field in normalized:
        value = field["value"]
        lowered = value.lower()
        if any(term in lowered for term in terms):
            matches.append({"field": field["field"], "value": value})
    return matches[:6]


def search_result_score(matches: list[dict[str, str]], timestamp: datetime | None, base: int) -> int:
    score = base + len(matches) * 8
    if any(match["field"] in {"label", "summary", "entity_key"} for match in matches):
        score += 14
    if timestamp is not None and freshness_for_time(timestamp) == "live":
        score += 10
    return min(100, score)


def float_value(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def event_payload_values(value: Any) -> set[str]:
    values: set[str] = set()
    if isinstance(value, dict):
        for item in value.values():
            values.update(event_payload_values(item))
    elif isinstance(value, list):
        for item in value:
            values.update(event_payload_values(item))
    else:
        text = string_value(value)
        if text:
            values.add(text)
    return values


def entity_dossier(session: Session, entity_key: str) -> dict | None:
    state = session.get(CurrentState, entity_key)
    if state is None:
        return None

    watch = session.execute(
        select(PresenceWatchlist).where(
            PresenceWatchlist.entity_key == entity_key,
            PresenceWatchlist.enabled.is_(True),
        )
    ).scalar_one_or_none()
    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .order_by(PresenceSighting.timestamp.desc())
        .limit(250)
    ).scalars().all()
    observation = session.get(Observation, state.last_observation_id) if state.last_observation_id else None

    candidate = state_candidate(state, tracked=watch is not None)
    reasons = interest_reasons(candidate, watch is not None, sightings)
    evidence = evidence_rows(state, observation, sightings)
    source_confidence = source_confidence_rows(state, sightings)
    reliability = reliability_score(state, sightings)
    rhythm = presence_rhythm(sightings)
    commute = commute_clock(rhythm)
    rules = presence_rules(candidate, state, watch is not None)
    enrichment = enrichment_plan(session, state, candidate)
    resolved_identity = resolved_identity_summary(session, state)
    return {
        "entity": candidate,
        "watchlist": watchlist_to_dict(watch) if watch else None,
        "identity": identity_summary(state, sightings),
        "resolved_identity": resolved_identity,
        "identity_resolution": identity_resolution_summary(state, candidate, resolved_identity),
        "rf_fingerprint": rf_fingerprint_summary(state, sightings),
        "ble_profile": ble_profile_summary(state),
        "wifi_roaming": wifi_roaming_summary(state, sightings),
        "rail_context": rail_context_summary(state),
        "iot_context": iot_context_summary(state),
        "cellular_context": cellular_context_summary(state),
        "sample_summary": state_sample_summary(session, state),
        "enrichment": enrichment,
        "scores": {
            "interest": interest_score(candidate, reasons),
            "reliability": reliability,
        },
        "reliability": reliability_report(state, sightings, source_confidence, reliability),
        "reasons": reasons,
        "reason_chips": interest_reason_chips(reasons),
        "anomalies": behavior_anomalies(candidate, state, sightings, source_confidence),
        "rhythm": rhythm,
        "commute_clock": commute,
        "next_seen": next_seen_timer(commute),
        "presence_rules": rules,
        "source_confidence": source_confidence,
        "evidence": evidence,
        "timeline": {
            "first_seen_at": _aware(sightings[-1].timestamp if sightings else state.first_seen_at),
            "last_seen_at": _aware(sightings[0].timestamp if sightings else state.last_seen_at),
            "sighting_count": len(sightings),
            "current_seen_count": state.seen_count,
        },
    }


def presence_entity_detail(session: Session, entity_key: str) -> dict[str, Any] | None:
    dossier = entity_dossier(session, entity_key)
    if dossier is None:
        return None
    state = session.get(CurrentState, entity_key)
    if state is None:
        return None
    sightings = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.entity_key == entity_key)
        .order_by(PresenceSighting.timestamp.desc())
        .limit(100)
    ).scalars().all()
    notes = session.execute(
        select(InvestigationNote)
        .where(InvestigationNote.entity_key == entity_key)
        .order_by(InvestigationNote.created_at.desc())
        .limit(50)
    ).scalars().all()
    timeline = presence_graph_timeline(session, entity_key, limit=100)
    return {
        "summary": {
            "entity_key": entity_key,
            "label": label_for_state(state),
            "category": category_for_state(state),
            "source": state.source,
            "protocol": state.protocol,
            "kind": state.kind,
            "identity_hint": state.identity_hint,
            "seen_count": state.seen_count,
            "first_seen_at": _aware(state.first_seen_at),
            "last_seen_at": _aware(state.last_seen_at),
            "rssi": signal_value(state),
        },
        "dossier": dossier,
        "sightings": {"items": [sighting_to_dict(sighting) for sighting in sightings], "count": len(sightings)},
        "notes": {"items": [presence_note_to_dict(note) for note in notes], "count": len(notes)},
        "timeline": {"items": timeline, "count": len(timeline), "order": "newest_first"},
        "related_entities": related_entities_for_detail(session, entity_key),
        "raw_payload_preview": raw_payload_preview(state.raw_payload),
    }


def presence_note_to_dict(note: InvestigationNote) -> dict[str, Any]:
    return {
        "id": note.id,
        "entity_key": note.entity_key,
        "note": note.note,
        "disposition": note.disposition,
        "created_at": _aware(note.created_at),
    }


def related_entities_for_detail(session: Session, entity_key: str) -> list[dict[str, Any]]:
    related: list[dict[str, Any]] = []
    for cluster in co_presence_clusters(session, limit=50):
        if entity_key not in cluster["entity_keys"]:
            continue
        for key, label in zip(cluster["entity_keys"], cluster["labels"], strict=False):
            if key == entity_key:
                continue
            related.append(
                {
                    "entity_key": key,
                    "label": label,
                    "relationship": "co_presence",
                    "shared_window_count": cluster["shared_window_count"],
                    "latest_seen_at": cluster["latest_seen_at"],
                }
            )
    return sorted(related, key=lambda item: (item["shared_window_count"], _aware(item["latest_seen_at"])), reverse=True)[:12]


def raw_payload_preview(payload: Any, *, limit: int = 24) -> list[dict[str, str]]:
    fields = flattened_payload_fields(payload, "raw_payload")[:limit]
    return [{"field": field["field"], "value": field["value"]} for field in fields]


def state_sample_summary(session: Session, state: CurrentState, *, limit: int = 24) -> dict[str, Any]:
    total = session.scalar(select(func.count()).select_from(CurrentStateSample).where(CurrentStateSample.state_key == state.state_key)) or 0
    latest_samples = session.execute(
        select(CurrentStateSample)
        .where(CurrentStateSample.state_key == state.state_key)
        .order_by(CurrentStateSample.timestamp.desc())
        .limit(limit)
    ).scalars().all()
    samples = list(reversed(latest_samples))
    timestamps = [_aware(sample.timestamp) for sample in samples]
    intervals = [
        (timestamps[index] - timestamps[index - 1]).total_seconds()
        for index in range(1, len(timestamps))
        if (timestamps[index] - timestamps[index - 1]).total_seconds() >= 0
    ]
    average_interval = round(sum(intervals) / len(intervals), 1) if intervals else None
    rssi_values = [sample.rssi for sample in samples if sample.rssi is not None]
    return {
        "sample_count": int(total),
        "recent_sample_count": len(samples),
        "first_sample_at": _aware(samples[0].timestamp) if samples else None,
        "last_sample_at": _aware(samples[-1].timestamp) if samples else None,
        "average_interval_seconds": average_interval,
        "cadence_label": sample_cadence_label(average_interval, len(samples)),
        "latest_rssi": samples[-1].rssi if samples else None,
        "strongest_rssi": max(rssi_values) if rssi_values else None,
        "weakest_rssi": min(rssi_values) if rssi_values else None,
        "samples": [
            {
                "timestamp": _aware(sample.timestamp),
                "source": sample.source,
                "sensor_id": sample.sensor_id,
                "rssi": sample.rssi,
            }
            for sample in samples[-12:]
        ],
    }


def sample_cadence_label(average_interval_seconds: float | None, sample_count: int) -> str:
    if sample_count <= 0:
        return "No compact samples yet"
    if average_interval_seconds is None:
        return "One compact sample captured"
    seconds = int(round(average_interval_seconds))
    if seconds < 60:
        return f"Seen every {seconds}s recently"
    minutes = max(1, int(round(seconds / 60)))
    return f"Seen every {minutes}m recently"


def resolved_identity_summary(session: Session, state: CurrentState) -> dict[str, Any]:
    target = state_identity_fingerprint(state)
    decisions = identity_decisions_for_entity(session, state.state_key, limit=100)
    confirmed_decisions = [decision for decision in decisions if decision.action == "confirm"]
    suppressed_keys = {
        counterpart
        for decision in decisions
        if decision.action in {"reject", "split"}
        for counterpart in [decision_counterpart_key(decision, state.state_key)]
        if counterpart
    }
    confirmed_by_key = {
        counterpart: decision
        for decision in confirmed_decisions
        for counterpart in [decision_counterpart_key(decision, state.state_key)]
        if counterpart
    }
    candidates = session.execute(
        select(CurrentState).order_by(CurrentState.last_seen_at.desc()).limit(2500)
    ).scalars().all()
    needed_keys = {state.state_key, *confirmed_by_key.keys()}
    loaded_keys = {candidate.state_key for candidate in candidates}
    for needed_key in needed_keys - loaded_keys:
        needed_state = session.get(CurrentState, needed_key)
        if needed_state is not None:
            candidates.append(needed_state)
    if all(candidate.state_key != state.state_key for candidate in candidates):
        candidates.append(state)
    matches: list[tuple[CurrentState, dict[str, Any], list[dict[str, Any]], float]] = []
    for candidate in candidates:
        if candidate.state_key != state.state_key and candidate.state_key in suppressed_keys:
            continue
        fingerprint = state_identity_fingerprint(candidate)
        evidence, score = identity_match_evidence(target, fingerprint, same_entity=candidate.state_key == state.state_key)
        confirmed_decision = confirmed_by_key.get(candidate.state_key)
        if confirmed_decision is not None:
            evidence.append(
                {
                    "type": "operator_confirm",
                    "value": confirmed_decision.canonical_key or confirmed_decision.label or candidate.state_key,
                    "confidence": 0.99,
                }
            )
            score = max(score, 1.0)
        if candidate.state_key == state.state_key or score >= 0.18:
            matches.append((candidate, fingerprint, evidence, score))

    identifiers = {
        "macs": sorted_unique(value for _, fp, _, _ in matches for value in fp["macs"]),
        "ip_addresses": sorted_unique(value for _, fp, _, _ in matches for value in fp["ip_addresses"]),
        "hostnames": sorted_unique(value for _, fp, _, _ in matches for value in fp["hostnames"]),
        "aliases": sorted_unique(value for _, fp, _, _ in matches for value in fp["aliases"]),
        "networks": sorted_unique(value for _, fp, _, _ in matches for value in fp["networks"]),
    }
    sources = sorted_unique(candidate.source for candidate, _, _, _ in matches)
    entity_keys = [candidate.state_key for candidate, _, _, _ in matches]
    evidence_rows = resolved_identity_evidence(matches)
    tier = resolved_identity_tier(evidence_rows, len(matches), len(sources))
    operator_canonical = next((decision.canonical_key for decision in confirmed_decisions if decision.canonical_key), None)
    operator_label = next((decision.label for decision in decisions if decision.label), None)
    return {
        "canonical_key": operator_canonical or canonical_identity_key(state, identifiers, len(matches), tier),
        "label": operator_label or resolved_identity_label(state, identifiers),
        "tier": tier,
        "relationship_label": resolved_identity_relationship_label(tier),
        "confidence": resolved_identity_confidence(evidence_rows, len(matches), len(sources), tier),
        "sources": sources,
        "entity_keys": entity_keys,
        "source_count": len(sources),
        "entity_count": len(matches),
        "identifiers": identifiers,
        "operator_feedback": operator_feedback_summary(decisions),
        "evidence": evidence_rows,
    }


def decision_counterpart_key(decision: PresenceIdentityDecision, entity_key: str) -> str | None:
    if decision.entity_key == entity_key:
        return decision.target_entity_key
    if decision.target_entity_key == entity_key:
        return decision.entity_key
    return None


def operator_feedback_summary(decisions: list[PresenceIdentityDecision]) -> dict[str, Any]:
    counts = Counter(identity_decision_state(decision.action) for decision in decisions)
    return {
        "confirmed": counts.get("confirmed", 0),
        "rejected": counts.get("rejected", 0),
        "split": counts.get("split", 0),
        "labeled": counts.get("labeled", 0),
        "ignored": counts.get("ignored", 0),
        "watching": counts.get("watching", 0),
        "total": len(decisions),
        "labels": sorted_unique(decision.label for decision in decisions if decision.label),
    }


def state_identity_fingerprint(state: CurrentState) -> dict[str, Any]:
    mac = first_mac_value(state)
    ip_values = values_for_fields(
        state,
        "ipAddress",
        "ip",
        "last_ip",
        "unificlientip",
        "client_ip",
        "host.ip",
    )
    hostname_values = values_for_fields(
        state,
        "hostname",
        "hostName",
        "host_name",
        "dns_name",
        "kismet.device.base.name",
    )
    alias_values = values_for_fields(
        state,
        "name",
        "commonname",
        "alias",
        "client_name",
        "kismet.device.base.commonname",
    )
    network_values = values_for_fields(
        state,
        "NetworkName",
        "network",
        "ssid",
        "unifinetworkname",
        "unifiwifiname",
    )
    label = label_for_state(state)
    if label:
        alias_values.append(label)
    if state.identity_hint and not normalize_mac_text(state.identity_hint):
        alias_values.append(state.identity_hint)
    aliases = sorted_unique(alias_values)
    hostnames = sorted_unique(hostname_values)
    return {
        "state_key": state.state_key,
        "source": state.source,
        "macs": [mac] if mac else [],
        "ip_addresses": sorted_unique(ip_values),
        "hostnames": hostnames,
        "aliases": aliases,
        "alias_keys": sorted_unique(normalized_identity_phrase(value) for value in [*aliases, *hostnames]),
        "networks": sorted_unique(network_values),
    }


def values_for_fields(state: CurrentState, *keys: str) -> list[str]:
    values: list[str] = []
    metadata = state.metadata_json or {}
    raw = state.raw_payload or {}
    for key in keys:
        for container in (metadata, raw):
            value = container.get(key)
            if isinstance(value, list):
                values.extend(string_value(item) for item in value)
            else:
                text = string_value(value)
                if text:
                    values.append(text)
    return [value for value in values if value]


def identity_match_evidence(
    target: dict[str, Any],
    candidate: dict[str, Any],
    *,
    same_entity: bool,
) -> tuple[list[dict[str, Any]], float]:
    if same_entity:
        return ([{"type": "local_identity", "value": target["state_key"], "confidence": 0.42}], 1.0)
    evidence: list[dict[str, Any]] = []
    score = 0.0
    shared_macs = set(target["macs"]) & set(candidate["macs"])
    if shared_macs:
        value = sorted(shared_macs)[0]
        evidence.append({"type": "mac_match", "value": value, "confidence": 0.98})
        score += 0.58
    shared_ips = set(target["ip_addresses"]) & set(candidate["ip_addresses"])
    if shared_ips:
        value = sorted(shared_ips)[0]
        evidence.append({"type": "ip_match", "value": value, "confidence": 0.74})
        score += 0.22
    shared_aliases = set(target["alias_keys"]) & set(candidate["alias_keys"])
    if shared_aliases:
        value = sorted(shared_aliases)[0]
        evidence.append({"type": "alias_match", "value": value, "confidence": 0.68})
        score += 0.18
    return evidence, score


def resolved_identity_evidence(matches: list[tuple[CurrentState, dict[str, Any], list[dict[str, Any]], float]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], dict[str, Any]] = {}
    for state, _fingerprint, evidence_items, _score in matches:
        for item in evidence_items:
            key = (item["type"], item["value"])
            row = grouped.setdefault(
                key,
                {
                    "type": item["type"],
                    "value": item["value"],
                    "sources": [],
                    "entity_keys": [],
                    "confidence": item["confidence"],
                    "explanation": identity_evidence_explanation(item["type"], item["value"]),
                },
            )
            if state.source not in row["sources"]:
                row["sources"].append(state.source)
            if state.state_key not in row["entity_keys"]:
                row["entity_keys"].append(state.state_key)
            row["confidence"] = max(row["confidence"], item["confidence"])
    for row in grouped.values():
        if row["type"] not in {"mac_match", "ip_match", "alias_match"}:
            continue
        for state, fingerprint, _evidence_items, _score in matches:
            if identity_row_matches_fingerprint(row, fingerprint):
                if state.source not in row["sources"]:
                    row["sources"].append(state.source)
                if state.state_key not in row["entity_keys"]:
                    row["entity_keys"].append(state.state_key)
    rows = list(grouped.values())
    rows.sort(key=lambda row: (identity_evidence_rank(row["type"]), -len(row["sources"]), row["value"]))
    return rows[:8]


def identity_row_matches_fingerprint(row: dict[str, Any], fingerprint: dict[str, Any]) -> bool:
    value = string_value(row.get("value"))
    if row.get("type") == "mac_match":
        return value in fingerprint["macs"]
    if row.get("type") == "ip_match":
        return value in fingerprint["ip_addresses"]
    if row.get("type") == "alias_match":
        return value in fingerprint["alias_keys"]
    return False


def identity_evidence_rank(evidence_type: str) -> int:
    return {"local_identity": 0, "operator_confirm": 1, "mac_match": 2, "ip_match": 3, "alias_match": 4}.get(evidence_type, 9)


def identity_evidence_explanation(evidence_type: str, value: str) -> str:
    if evidence_type == "operator_confirm":
        return "Operator confirmed these source rows describe the same identity"
    if evidence_type == "mac_match":
        return "Exact MAC match across source rows"
    if evidence_type == "ip_match":
        return "Same local IP reported by infrastructure collectors"
    if evidence_type == "alias_match":
        return "Human-readable names normalize to the same identity"
    if evidence_type == "local_identity":
        return "Current selected source row"
    return f"Matched identity value {value}"


def canonical_identity_key(state: CurrentState, identifiers: dict[str, list[str]], entity_count: int, tier: str = "single_source") -> str:
    if tier == "resolved" and entity_count > 1 and identifiers["macs"]:
        mac = identifiers["macs"][0]
        return f"mac:{mac}"
    return f"entity:{state.state_key}"


def resolved_identity_label(state: CurrentState, identifiers: dict[str, list[str]]) -> str:
    label = label_for_state(state)
    if label and label != state.state_key:
        return label
    for key in ("aliases", "hostnames", "macs", "ip_addresses"):
        if identifiers[key]:
            return identifiers[key][0]
    return state.state_key


def resolved_identity_tier(evidence_rows: list[dict[str, Any]], entity_count: int, source_count: int) -> str:
    if entity_count <= 1:
        return "single_source"
    evidence_types = {row["type"] for row in evidence_rows}
    if "operator_confirm" in evidence_types:
        return "resolved"
    if "mac_match" in evidence_types:
        return "resolved"
    if {"ip_match", "alias_match"}.issubset(evidence_types) and source_count >= 2:
        return "probable"
    if "alias_match" in evidence_types:
        return "possible"
    if "ip_match" in evidence_types:
        return "related"
    return "single_source"


def resolved_identity_relationship_label(tier: str) -> str:
    return {
        "resolved": "Confirmed identity",
        "probable": "Probable same identity",
        "possible": "Possible relationship",
        "related": "Related signal",
        "single_source": "Single source identity",
    }.get(tier, "Investigation lead")


def resolved_identity_confidence(evidence_rows: list[dict[str, Any]], entity_count: int, source_count: int, tier: str = "single_source") -> int:
    base_by_tier = {
        "resolved": 78,
        "probable": 66,
        "possible": 50,
        "related": 44,
        "single_source": 42,
    }
    score = base_by_tier.get(tier, 42)
    evidence_types = {row["type"] for row in evidence_rows}
    if entity_count > 1:
        score += 6
    if source_count > 1:
        score += min(10, source_count * 4)
    if "operator_confirm" in evidence_types:
        score += 15
    if "mac_match" in evidence_types:
        score += 12
    if "ip_match" in evidence_types:
        score += 5
    if "alias_match" in evidence_types:
        score += 4
    return min(99, score)


def sorted_unique(values) -> list[str]:
    return sorted({string_value(value) for value in values if string_value(value)})


def normalized_identity_phrase(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", " ", string_value(value).lower()).strip()
    if len(text) < 3 or text in {"unknown", "none", "null", "client", "device"}:
        return ""
    return re.sub(r"\s+", "-", text)

def identity_summary(state: CurrentState, sightings: list[PresenceSighting]) -> dict:
    aliases = {
        value
        for value in [
            string_value(state.identity_hint),
            string_value(label_for_state(state)),
            string_value(field_value(state, "name", "hostname", "NetworkName", "ssid", "kismet.device.base.commonname")),
            string_value(field_value(state, "ipAddress", "ip", "last_ip")),
            string_value(field_value(state, "macAddress", "mac", "kismet.device.base.macaddr")),
        ]
        if value
    }
    for sighting in sightings[:20]:
        if sighting.identity_hint:
            aliases.add(sighting.identity_hint)
        label = string_value((sighting.evidence_json or {}).get("label"))
        if label:
            aliases.add(label)
    primary = string_value(state.identity_hint) or label_for_state(state)
    return {
        "primary": primary,
        "label": label_for_state(state),
        "aliases": sorted(aliases),
        "confidence": min(1.0, 0.45 + (0.1 * min(len(aliases), 4)) + (0.15 if state.seen_count >= 3 else 0)),
    }


def identity_resolution_summary(
    state: CurrentState, candidate: dict[str, Any], resolved_identity: dict[str, Any] | None = None
) -> dict[str, Any]:
    mac = first_mac_value(state)
    signals: list[str] = []
    confidence = 35
    status = "stable"
    label = "Stable identifier"

    if mac and is_locally_administered_mac(mac):
        status = "likely_randomized"
        label = "Likely randomized MAC"
        confidence += 40
        signals.append("Locally administered MAC bit is set")
    if string_value(candidate.get("category")) in {"client", "wifi", "ble"}:
        confidence += 10
        signals.append("Client-class RF identity")
    if string_value(field_value(state, "name", "hostname", "kismet.device.base.commonname")):
        confidence += 10
        signals.append("Human-readable alias observed")
    if signal_value(state) is not None:
        confidence += 5
        signals.append("RSSI available for fingerprint comparison")
    resolved_source_count = int_value(resolved_identity.get("source_count")) if resolved_identity else None
    resolved_tier = string_value(resolved_identity.get("tier")) if resolved_identity else ""
    if resolved_identity and resolved_tier == "resolved" and resolved_source_count and resolved_source_count >= 2:
        source_count = resolved_source_count
        entity_count = int_value(resolved_identity.get("entity_count")) or source_count
        status = "resolved"
        label = f"Resolved across {source_count} sources"
        confidence = max(confidence, int_value(resolved_identity.get("confidence")) or confidence)
        signals.insert(0, f"Merged {entity_count} source rows into one identity")
    elif resolved_identity and resolved_tier in {"probable", "possible", "related"}:
        status = resolved_tier
        label = string_value(resolved_identity.get("relationship_label")) or label
        confidence = max(confidence, int_value(resolved_identity.get("confidence")) or confidence)
        signals.insert(0, "Needs operator review before treating linked rows as one identity")

    return {
        "status": status,
        "label": label,
        "confidence": min(100, confidence),
        "mac": mac,
        "signals": signals or ["No resolver signals yet"],
    }



def confidence_percent(value: Any, default: int = 45) -> int:
    parsed = float_value(value)
    if parsed is None:
        return default
    if parsed <= 1:
        parsed *= 100
    return max(0, min(100, int(round(parsed))))


def rail_context_summary(state: CurrentState) -> dict[str, Any] | None:
    if category_for_state(state) != "rail":
        return None
    channel_label = string_value(field_value(state, "channel_label"))
    frequency = float_value(field_value(state, "frequency_mhz", "frequency"))
    operator = string_value(field_value(state, "rail_operator_hint")) or None
    route = string_value(field_value(state, "rail_route_hint")) or None
    usage = string_value(field_value(state, "rail_usage_hint")) or None
    operator_read = string_value(field_value(state, "operator_read"))
    if not operator_read:
        operator_read = f"{channel_label or 'Rail-band'} activity" + (f" near {frequency:.3f} MHz" if frequency is not None else "") + "."
    return {
        "status": "inferred",
        "channel_label": channel_label or None,
        "frequency_mhz": frequency,
        "operator_hint": operator,
        "route_hint": route,
        "usage_hint": usage,
        "activity_type": string_value(field_value(state, "activity_type")) or "rail_voice_or_data_activity",
        "confidence": confidence_percent(field_value(state, "inference_confidence"), 52),
        "operator_read": operator_read,
        "limits": "Passive RF indicates channel activity; exact train identity requires decoded audio or an external rail feed.",
    }


def rail_activity_visuals(session: Session, state: CurrentState, context: dict[str, Any]) -> dict[str, Any]:
    sample_summary = state_sample_summary(session, state, limit=18)
    channel = rail_channel_number(state, context)
    frequency = float_value(context.get("frequency_mhz")) or float_value(field_value(state, "frequency_mhz", "frequency"))
    channel_label = string_value(context.get("channel_label")) or (f"AAR {channel:03d}" if channel is not None else "Rail channel")
    recent_activity = [
        {
            "timestamp": sample["timestamp"],
            "rssi": sample["rssi"],
            "label": channel_label,
            "frequency_mhz": frequency,
            "sensor_id": sample["sensor_id"],
        }
        for sample in sample_summary["samples"][-12:]
    ]
    rhythm = rail_activity_rhythm(sample_summary)
    return {
        "frequency_ladder": rail_frequency_ladder(channel, frequency),
        "confidence_strip": rail_confidence_strip(context),
        "recent_activity": recent_activity,
        "rhythm": rhythm,
    }


def rail_channel_number(state: CurrentState, context: dict[str, Any]) -> int | None:
    channel_value = string_value(field_value(state, "aar_channel")) or string_value(context.get("channel_label"))
    if channel_value:
        match = re.search(r"(\d{1,3})", channel_value)
        if match:
            return int(match.group(1))
    frequency = float_value(context.get("frequency_mhz")) or float_value(field_value(state, "frequency_mhz", "frequency"))
    if frequency is None:
        return None
    return round((frequency - RAIL_AAR_BASE_MHZ) / RAIL_AAR_SPACING_MHZ) + RAIL_AAR_BASE_CHANNEL


def rail_frequency_for_channel(channel: int) -> float:
    return round(RAIL_AAR_BASE_MHZ + ((channel - RAIL_AAR_BASE_CHANNEL) * RAIL_AAR_SPACING_MHZ), 3)


def rail_frequency_ladder(channel: int | None, frequency: float | None) -> list[dict[str, Any]]:
    if channel is None:
        if frequency is None:
            return []
        return [{"channel": "Rail RF", "frequency_mhz": round(frequency, 3), "role": "selected"}]
    ladder = []
    for nearby in range(max(1, channel - 2), channel + 3):
        ladder.append(
            {
                "channel": f"AAR {nearby:03d}",
                "frequency_mhz": round(frequency, 3) if nearby == channel and frequency is not None else rail_frequency_for_channel(nearby),
                "role": "selected" if nearby == channel else "nearby",
            }
        )
    return ladder


def rail_confidence_strip(context: dict[str, Any]) -> list[dict[str, Any]]:
    base_confidence = int(context.get("confidence") or 52)
    rows = [
        ("Channel", context.get("channel_label"), base_confidence, "rail"),
        ("Operator", context.get("operator_hint"), max(35, base_confidence - 8), "operator"),
        ("Route", context.get("route_hint"), max(30, base_confidence - 12), "route"),
    ]
    return [
        {"label": label, "value": value, "confidence": confidence, "tone": tone}
        for label, value, confidence, tone in rows
        if value
    ]


def rail_activity_rhythm(sample_summary: dict[str, Any]) -> dict[str, Any]:
    samples = sample_summary["samples"]
    peak_hour: int | None = None
    if samples:
        hours = Counter(_aware(sample["timestamp"]).hour for sample in samples)
        peak_hour = hours.most_common(1)[0][0]
    sample_count = int(sample_summary["sample_count"])
    peak_hour_label = rail_hour_label(peak_hour)
    cadence = sample_summary["cadence_label"]
    operator_read = cadence
    if peak_hour_label:
        operator_read = f"{cadence}; strongest recent cluster around {peak_hour_label}."
    return {
        "sample_count": sample_count,
        "recent_sample_count": int(sample_summary["recent_sample_count"]),
        "cadence_label": cadence,
        "peak_hour": peak_hour,
        "peak_hour_label": peak_hour_label,
        "operator_read": operator_read,
    }


def rail_hour_label(hour: int | None) -> str | None:
    if hour is None:
        return None
    suffix = "AM" if hour < 12 else "PM"
    display = hour % 12 or 12
    return f"{display} {suffix}"


def iot_context_summary(state: CurrentState) -> dict[str, Any] | None:
    if category_for_state(state) != "iot":
        return None
    channel = string_value(field_value(state, "channel"))
    channel_mhz = float_value(field_value(state, "iot_channel_mhz"))
    protocol_label = string_value(field_value(state, "iot_protocol_label")) or "Zigbee / Thread / 802.15.4"
    channel_label = None
    if channel and channel_mhz is not None:
        channel_label = f"Channel {channel} / {channel_mhz:.1f} MHz"
    elif channel:
        channel_label = f"Channel {channel}"
    return {
        "status": "observed",
        "protocol_label": protocol_label,
        "stack_hint": string_value(field_value(state, "iot_stack_hint")) or None,
        "channel_label": channel_label,
        "channel_mhz": channel_mhz,
        "packet_direction": string_value(field_value(state, "packet_direction")) or None,
        "network_pan_id": string_value(field_value(state, "network_pan_id")) or None,
        "short_address": string_value(field_value(state, "short_address")) or None,
        "device_role_hint": string_value(field_value(state, "device_role_hint")) or None,
        "vendor_hint": string_value(field_value(state, "vendor_hint", "manufacturer")) or None,
        "confidence": iot_context_confidence(state),
        "operator_read": string_value(field_value(state, "operator_read")) or f"{protocol_label} activity observed by {state.sensor_id}.",
        "limits": "802.15.4 capture can show mesh/channel/device hints; encrypted payloads may hide exact product type.",
    }


def iot_context_confidence(state: CurrentState) -> int:
    score = 40
    if field_value(state, "iot_stack_hint"):
        score += 8
    if field_value(state, "channel", "iot_channel_mhz"):
        score += 8
    if field_value(state, "network_pan_id"):
        score += 8
    if field_value(state, "packet_direction"):
        score += 6
    if field_value(state, "short_address"):
        score += 4
    if field_value(state, "device_role_hint"):
        score += 4
    if field_value(state, "vendor_hint", "manufacturer"):
        score += 6
    return min(86, score)


def cellular_context_summary(state: CurrentState) -> dict[str, Any] | None:
    if category_for_state(state) != "cellular":
        return None
    dl_freq_hz = int_value(field_value(state, "dl_freq_hz", "downlink_frequency_hz"))
    ul_freq_hz = int_value(field_value(state, "ul_freq_hz", "uplink_frequency_hz"))
    processed_subframes = int_value(field_value(state, "processed_subframes", "subframes"))
    rnti_count = int_value(field_value(state, "rnti_count", "active_rntis"))
    prb = int_value(field_value(state, "prb", "nof_prb"))
    api_mode = int_value(field_value(state, "api_mode"))
    snr = float_value(field_value(state, "snr_db", "snr"))
    decode_channel = string_value(field_value(state, "decode_channel", "channel")) or cellular_decode_channel(state)
    return {
        "status": "observed",
        "decode_channel": decode_channel,
        "dl_freq_hz": dl_freq_hz,
        "ul_freq_hz": ul_freq_hz,
        "dl_frequency_mhz": cellular_hz_to_mhz(dl_freq_hz),
        "ul_frequency_mhz": cellular_hz_to_mhz(ul_freq_hz),
        "cell_id": string_value(field_value(state, "cell_id", "pci")) or None,
        "prb": prb,
        "api_mode": api_mode,
        "api_output": string_value(field_value(state, "api_output")) or None,
        "processed_subframes": processed_subframes,
        "rnti_count": rnti_count,
        "snr_db": snr,
        "confidence": cellular_context_confidence(state),
        "operator_read": string_value(field_value(state, "operator_read"))
        or cellular_operator_read(state, decode_channel, dl_freq_hz, ul_freq_hz),
        "limits": "Use only on owned or authorized LTE testbeds; identity-like values stay masked unless explicitly unmasked for lab use.",
    }


def cellular_decode_channel(state: CurrentState) -> str:
    kind = state.kind.lower()
    mode = string_value(field_value(state, "mode")).lower()
    if "uplink" in mode or "pusch" in kind:
        return "PUSCH"
    if "api" in mode:
        return "PUSCH"
    if "decode" in kind:
        return "PDSCH/PUSCH"
    return "PDSCH"


def cellular_context_confidence(state: CurrentState) -> int:
    score = 42
    for key, amount in [
        ("decode_channel", 8),
        ("dl_freq_hz", 8),
        ("ul_freq_hz", 8),
        ("cell_id", 6),
        ("prb", 5),
        ("api_mode", 3),
        ("processed_subframes", 5),
        ("rnti_count", 4),
        ("snr_db", 4),
    ]:
        if field_value(state, key):
            score += amount
    return min(88, score)


def cellular_hz_to_mhz(value: int | None) -> float | None:
    if value is None:
        return None
    return round(value / 1_000_000, 3)


def cellular_frequency_label(prefix: str, value_mhz: Any) -> str | None:
    value = float_value(value_mhz)
    if value is None:
        return None
    return f"{prefix} {value:.3f} MHz"


def cellular_operator_read(state: CurrentState, decode_channel: str, dl_freq_hz: int | None, ul_freq_hz: int | None) -> str:
    frequency_parts = [
        cellular_frequency_label("DL", cellular_hz_to_mhz(dl_freq_hz)),
        cellular_frequency_label("UL", cellular_hz_to_mhz(ul_freq_hz)),
    ]
    suffix = " / ".join(part for part in frequency_parts if part)
    if suffix:
        return f"{decode_channel} decode status from {state.sensor_id} on {suffix}."
    return f"{decode_channel} decode status from {state.sensor_id}."


def cellular_context_findings(state: CurrentState) -> list[dict[str, Any]]:
    context = cellular_context_summary(state)
    if not context:
        return []
    findings = [
        {
            "target_id": "lte_testbed_context",
            "type": "lte_decode_channel",
            "label": "LTE decode channel",
            "value": context["decode_channel"],
            "confidence": context["confidence"] / 100,
            "source": "ltesniffer_decode_status",
            "summary": context["operator_read"],
        }
    ]
    if context.get("cell_id"):
        findings.append(
            {
                "target_id": "lte_testbed_context",
                "type": "lte_cell_id",
                "label": "LTE cell ID",
                "value": context["cell_id"],
                "confidence": context["confidence"] / 100,
                "source": "ltesniffer_decode_status",
                "summary": context["operator_read"],
            }
        )
    if context.get("rnti_count") is not None:
        findings.append(
            {
                "target_id": "lte_testbed_context",
                "type": "lte_rnti_activity",
                "label": "RNTI activity",
                "value": str(context["rnti_count"]),
                "confidence": 0.72,
                "source": "ltesniffer_decode_status",
                "summary": f"{context['rnti_count']} active RNTI rows in the latest decode status.",
            }
        )
    return findings


def rail_context_findings(state: CurrentState) -> list[dict[str, Any]]:
    context = rail_context_summary(state)
    if not context:
        return []
    findings = []
    if context.get("channel_label"):
        findings.append(
            {
                "target_id": "rail_channel_context",
                "type": "aar_channel",
                "label": "AAR channel",
                "value": context["channel_label"],
                "confidence": context["confidence"] / 100,
                "source": "local_rail_channel_table",
                "summary": context["operator_read"],
            }
        )
    if context.get("operator_hint"):
        findings.append(
            {
                "target_id": "rail_channel_context",
                "type": "rail_operator_hint",
                "label": "Rail operator hint",
                "value": context["operator_hint"],
                "confidence": context["confidence"] / 100,
                "source": "local_rail_catalog",
                "summary": context["operator_read"],
            }
        )
    return findings


def iot_context_findings(state: CurrentState) -> list[dict[str, Any]]:
    context = iot_context_summary(state)
    if not context:
        return []
    findings = [
        {
            "target_id": "iot_mesh_context",
            "type": "iot_protocol_hint",
            "label": "IoT protocol hint",
            "value": context["protocol_label"],
            "confidence": context["confidence"] / 100,
            "source": "kismet_802154_fields",
            "summary": context["operator_read"],
        }
    ]
    if context.get("network_pan_id"):
        findings.append(
            {
                "target_id": "iot_mesh_context",
                "type": "iot_network_hint",
                "label": "802.15.4 PAN",
                "value": context["network_pan_id"],
                "confidence": context["confidence"] / 100,
                "source": "kismet_802154_fields",
                "summary": context["operator_read"],
            }
        )
    if context.get("vendor_hint"):
        findings.append(
            {
                "target_id": "iot_mesh_context",
                "type": "iot_vendor_hint",
                "label": "IoT vendor hint",
                "value": context["vendor_hint"],
                "confidence": 0.72,
                "source": "local_iot_oui_catalog",
                "summary": f"Address prefix suggests {context['vendor_hint']} hardware.",
            }
        )
    return findings


def enrichment_plan(session: Session, state: CurrentState, candidate: dict[str, Any]) -> dict[str, Any]:
    latest_run = latest_enrichment(session, state.state_key)
    targets = enrichment_targets(state, candidate)
    if latest_run is not None:
        return {
            "status": latest_run.status,
            "mode": latest_run.mode,
            "targets": latest_run.targets_json or targets,
            "findings": latest_run.findings_json or [],
            "latest_run": enrichment_to_dict(latest_run),
        }
    return {
        "status": "ready" if targets else "empty",
        "mode": "manual_review",
        "targets": targets,
        "findings": [],
        "latest_run": None,
    }


def latest_enrichment(session: Session, entity_key: str) -> PresenceEnrichment | None:
    return session.execute(
        select(PresenceEnrichment)
        .where(PresenceEnrichment.entity_key == entity_key)
        .order_by(PresenceEnrichment.created_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def enrichment_to_dict(enrichment: PresenceEnrichment) -> dict[str, Any]:
    return {
        "id": enrichment.id,
        "entity_key": enrichment.entity_key,
        "status": enrichment.status,
        "mode": enrichment.mode,
        "summary": enrichment.summary,
        "targets": enrichment.targets_json or [],
        "findings": enrichment.findings_json or [],
        "created_at": _aware(enrichment.created_at),
    }


def run_entity_enrichment(session: Session, entity_key: str) -> tuple[PresenceEnrichment, Event] | None:
    state = session.get(CurrentState, entity_key)
    if state is None:
        return None
    candidate = state_candidate(state, tracked=False)
    planned = enrichment_targets(state, candidate)
    findings = enrichment_findings(state, candidate, planned)
    targets = [
        {
            **target,
            "status": "completed" if any(finding.get("target_id") == target["id"] for finding in findings) else "no_match",
        }
        for target in planned
    ]
    status = "completed" if findings else ("empty" if not targets else "no_match")
    summary = enrichment_summary(status, findings, targets)
    enrichment = PresenceEnrichment(
        entity_key=entity_key,
        status=status,
        mode="local_lookup",
        summary=summary,
        targets_json=targets,
        findings_json=findings,
    )
    session.add(enrichment)
    session.flush()
    event = Event(
        type="presence_enrichment_run",
        severity="info" if status == "completed" else "watch",
        confidence=0.72 if status == "completed" else 0.45,
        zone_id=state.zone_id,
        summary=summary,
        observation_refs=[state.last_observation_id] if state.last_observation_id else [],
        payload={
            "entity_key": entity_key,
            "enrichment_id": enrichment.id,
            "status": status,
            "mode": "local_lookup",
            "targets": [target["id"] for target in targets],
            "finding_count": len(findings),
        },
    )
    session.add(event)
    session.commit()
    return enrichment, event


def enrichment_targets(state: CurrentState, candidate: dict[str, Any]) -> list[dict[str, str]]:
    targets: list[dict[str, str]] = []
    category = string_value(candidate.get("category"))
    if first_mac_value(state):
        targets.append({"id": "mac_oui", "label": "MAC/OUI vendor lookup", "status": "queued"})
    if category == "aircraft" or state.protocol == "adsb":
        targets.append({"id": "aircraft_registry", "label": "Aircraft registry lookup", "status": "queued"})
    if category == "ble":
        targets.append({"id": "ble_uuid_catalog", "label": "BLE UUID catalog lookup", "status": "queued"})
    if category in {"unknown_rf", "utility", "cellular"}:
        targets.append({"id": "fcc_frequency_hint", "label": "Frequency allocation hint", "status": "queued"})
    if category == "rail":
        targets.append({"id": "rail_channel_context", "label": "Rail channel/operator context", "status": "queued"})
    if category == "iot":
        targets.append({"id": "iot_mesh_context", "label": "IoT mesh protocol context", "status": "queued"})
    if category == "cellular":
        targets.append({"id": "lte_testbed_context", "label": "LTE testbed decode context", "status": "queued"})
    return targets


def enrichment_findings(state: CurrentState, candidate: dict[str, Any], targets: list[dict[str, str]]) -> list[dict[str, Any]]:
    target_ids = {target["id"] for target in targets}
    findings: list[dict[str, Any]] = []
    if "mac_oui" in target_ids:
        findings.extend(mac_enrichment_findings(state))
    if "ble_uuid_catalog" in target_ids:
        findings.extend(ble_uuid_findings(state))
    if "aircraft_registry" in target_ids:
        findings.extend(aircraft_registry_findings(state))
    if "fcc_frequency_hint" in target_ids:
        findings.extend(frequency_allocation_findings(state, candidate))
    if "rail_channel_context" in target_ids:
        findings.extend(rail_context_findings(state))
    if "iot_mesh_context" in target_ids:
        findings.extend(iot_context_findings(state))
    if "lte_testbed_context" in target_ids:
        findings.extend(cellular_context_findings(state))
    return findings


def mac_enrichment_findings(state: CurrentState) -> list[dict[str, Any]]:
    mac = first_mac_value(state)
    if not mac:
        return []
    findings: list[dict[str, Any]] = []
    oui = ":".join(mac.split(":")[:3])
    vendor = OUI_VENDOR_HINTS.get(oui)
    if vendor:
        findings.append(
            {
                "target_id": "mac_oui",
                "type": "vendor",
                "label": "OUI vendor",
                "value": vendor,
                "confidence": 0.82,
                "source": "local_oui_catalog",
                "summary": f"{oui.upper()} resolves locally to {vendor}.",
            }
        )
    else:
        findings.append(
            {
                "target_id": "mac_oui",
                "type": "oui_prefix",
                "label": "OUI prefix",
                "value": oui.upper(),
                "confidence": 0.38,
                "source": "local_oui_catalog",
                "summary": f"No local vendor match yet for prefix {oui.upper()}.",
            }
        )
    if is_locally_administered_mac(mac):
        findings.append(
            {
                "target_id": "mac_oui",
                "type": "mac_privacy",
                "label": "MAC privacy",
                "value": "Locally administered address",
                "confidence": 0.74,
                "source": "mac_address_bits",
                "summary": "The local-admin bit is set, so this may be randomized or device-private.",
            }
        )
    return findings


def ble_uuid_findings(state: CurrentState) -> list[dict[str, Any]]:
    metadata = state.metadata_json or {}
    raw = state.raw_payload or {}
    services = list_values(
        metadata.get("service_uuids")
        or metadata.get("services")
        or raw.get("service_uuids")
        or raw.get("services")
        or raw.get("ble.services")
    )
    findings = []
    for service in services:
        normalized = service.lower().replace("0x", "")
        name = BLE_UUID_HINTS.get(normalized)
        if not name:
            continue
        findings.append(
            {
                "target_id": "ble_uuid_catalog",
                "type": "ble_uuid",
                "label": f"BLE {normalized}",
                "value": name,
                "confidence": 0.78,
                "source": "local_ble_uuid_catalog",
                "summary": f"{normalized.upper()} maps to {name}.",
            }
        )
    return findings


def aircraft_registry_findings(state: CurrentState) -> list[dict[str, Any]]:
    callsign = string_value(field_value(state, "callsign", "registration", "flight", "adsb.device.callsign"))
    altitude = int_value(field_value(state, "altitude", "alt_baro", "baro_altitude"))
    heading = int_value(field_value(state, "heading", "track", "true_heading"))
    findings = []
    if callsign:
        label = "FAA registration hint" if callsign.upper().startswith("N") else "Aircraft callsign"
        findings.append(
            {
                "target_id": "aircraft_registry",
                "type": "aircraft_identity",
                "label": label,
                "value": callsign.upper(),
                "confidence": 0.64 if callsign.upper().startswith("N") else 0.52,
                "source": "adsb_identity_fields",
                "summary": f"ADS-B payload reports {callsign.upper()}.",
            }
        )
    if altitude is not None or heading is not None:
        findings.append(
            {
                "target_id": "aircraft_registry",
                "type": "aircraft_motion",
                "label": "Aircraft motion",
                "value": " · ".join(
                    part
                    for part in [
                        f"{altitude:,} ft" if altitude is not None else "",
                        f"{heading} deg" if heading is not None else "",
                    ]
                    if part
                ),
                "confidence": 0.56,
                "source": "adsb_motion_fields",
                "summary": "Recent motion fields are available for airspace context.",
            }
        )
    return findings


def frequency_allocation_findings(state: CurrentState, candidate: dict[str, Any]) -> list[dict[str, Any]]:
    frequency = float_value(field_value(state, "frequency", "freq", "center_frequency") or candidate.get("frequency"))
    if frequency is None:
        hint = string_value(state.identity_hint)
        frequency = float_value(hint)
    if frequency is None:
        return []
    if 433.05 <= frequency <= 434.79:
        value = "433 MHz ISM / low-power device band"
    elif 902 <= frequency <= 928:
        value = "902-928 MHz ISM band"
    elif 2400 <= frequency <= 2483.5:
        value = "2.4 GHz ISM band"
    elif 5725 <= frequency <= 5850:
        value = "5.8 GHz ISM / U-NII band"
    else:
        value = "No local allocation hint"
    return [
        {
            "target_id": "fcc_frequency_hint",
            "type": "frequency_allocation",
            "label": "Frequency hint",
            "value": value,
            "confidence": 0.6 if value != "No local allocation hint" else 0.3,
            "source": "local_frequency_table",
            "summary": f"{frequency:g} MHz maps to {value}.",
        }
    ]


def float_value(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def enrichment_summary(status: str, findings: list[dict[str, Any]], targets: list[dict[str, str]]) -> str:
    if status == "completed":
        labels = [string_value(finding.get("label")) for finding in findings[:3]]
        return f"Enrichment completed with {len(findings)} {pluralize('finding', len(findings))}: {', '.join(labels)}"
    if not targets:
        return "No enrichment targets are available for this entity."
    return f"Enrichment checked {len(targets)} {pluralize('target', len(targets))} with no matches."


def first_mac_value(state: CurrentState) -> str | None:
    value = field_value(state, "macAddress", "mac", "kismet.device.base.macaddr", "unificlientmac")
    if value is None:
        value = state.identity_hint
    return normalize_mac_text(value)


def normalize_mac_text(value: Any) -> str | None:
    text = string_value(value).lower().replace("-", ":")
    parts = text.split(":")
    if len(parts) != 6:
        return None
    if any(len(part) != 2 for part in parts):
        return None
    try:
        bytes.fromhex("".join(parts))
    except ValueError:
        return None
    return ":".join(parts)


def is_locally_administered_mac(mac: str) -> bool:
    first_octet = int(mac.split(":")[0], 16)
    return bool(first_octet & 0b00000010) and not bool(first_octet & 0b00000001)


def rf_fingerprint_summary(state: CurrentState, sightings: list[PresenceSighting]) -> dict[str, Any]:
    anchors: list[str] = []
    score = 20
    if state.protocol:
        anchors.append(f"Protocol {state.protocol}")
        score += 10
    rssi = signal_value(state)
    if rssi is not None:
        anchors.append(f"RSSI {rssi} dBm")
        score += 20
    channel = field_value(state, "channel", "Channel", "wifi_channel")
    if channel not in (None, ""):
        anchors.append(f"Channel {channel}")
        score += 12
    frequency = field_value(state, "frequency", "freq", "center_frequency")
    if frequency not in (None, ""):
        anchors.append(f"Frequency {frequency}")
        score += 12
    manufacturer = field_value(state, "manufacturer", "oui", "vendor")
    if manufacturer not in (None, ""):
        anchors.append(f"Manufacturer {manufacturer}")
        score += 10
    if state.sensor_id:
        anchors.append(f"Sensor {state.sensor_id}")
        score += 15
    if state.seen_count >= 5 or len(sightings) >= 3:
        anchors.append("Repeated observations")
        score += 12

    confidence = min(100, score)
    return {
        "confidence": confidence,
        "label": rf_fingerprint_label(confidence),
        "anchors": anchors or ["No RF anchors available"],
        "sample_count": max(state.seen_count, len(sightings)),
    }


def rf_fingerprint_label(confidence: int) -> str:
    if confidence >= 82:
        return "Strong RF fingerprint"
    if confidence >= 60:
        return "Useful RF fingerprint"
    if confidence >= 40:
        return "Partial RF fingerprint"
    return "Weak RF fingerprint"


def ble_profile_summary(state: CurrentState) -> dict[str, Any] | None:
    if category_for_state(state) != "ble":
        return None
    metadata = state.metadata_json or {}
    raw = state.raw_payload or {}
    services = list_values(
        metadata.get("service_uuids")
        or metadata.get("services")
        or raw.get("service_uuids")
        or raw.get("services")
        or raw.get("ble.services")
    )
    manufacturer = string_value(field_value(state, "manufacturer", "company", "vendor")) or None
    model = string_value(field_value(state, "model", "device_model")) or None
    name = string_value(field_value(state, "name", "bluetooth_name", "kismet.device.base.commonname")) or None
    manufacturer_data = string_value(metadata.get("manufacturer_data") or raw.get("manufacturer_data") or raw.get("ble.manufacturer_data"))
    signals = []
    if services:
        signals.append(f"{len(services)} BLE services")
    if manufacturer_data:
        signals.append("Manufacturer data present")
    if name:
        signals.append("Advertised name observed")
    if manufacturer:
        signals.append(f"Manufacturer {manufacturer}")
    return {
        "status": "available" if services or manufacturer or model or manufacturer_data or name else "empty",
        "label": "BLE profile observed" if services or manufacturer or model or manufacturer_data or name else "No BLE profile fields",
        "name": name,
        "services": services,
        "manufacturer": manufacturer,
        "model": model,
        "manufacturer_data": manufacturer_data or None,
        "signals": signals or ["No BLE service/profile fields decoded yet"],
    }


def list_values(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [string_value(item) for item in value if string_value(item)]
    if isinstance(value, tuple | set):
        return [string_value(item) for item in value if string_value(item)]
    text = string_value(value)
    if not text:
        return []
    if "," in text:
        return [part.strip() for part in text.split(",") if part.strip()]
    return [text]


def wifi_roaming_summary(state: CurrentState, sightings: list[PresenceSighting]) -> dict[str, Any] | None:
    if category_for_state(state) not in {"wifi", "client"} and state.protocol.lower() != "wifi":
        return None
    hops: list[dict[str, Any]] = []

    def add_hop(timestamp: datetime, payload: dict[str, Any], raw: dict[str, Any], rssi: int | None) -> None:
        network = first_payload_value(payload, raw, "NetworkName", "network", "ssid", "unifinetworkname", "unifiwifiname")
        access_point = first_payload_value(payload, raw, "access_point", "ap", "unificonnectedtodevicename", "connected_to")
        if not network and not access_point:
            return
        hop = {
            "timestamp": _aware(timestamp),
            "network": network,
            "access_point": access_point,
            "rssi": rssi,
        }
        if hop not in hops:
            hops.append(hop)

    add_hop(state.last_seen_at, state.metadata_json or {}, state.raw_payload or {}, signal_value(state))
    for sighting in sightings:
        add_hop(sighting.timestamp, sighting.evidence_json or {}, sighting.raw_payload or {}, sighting.rssi)

    network_names = unique_non_empty(hop.get("network") for hop in hops)
    access_points = unique_non_empty(hop.get("access_point") for hop in hops)
    return {
        "status": "observed" if hops else "empty",
        "label": "Wi-Fi roaming path observed" if hops else "No Wi-Fi roaming path",
        "network_names": network_names,
        "access_points": access_points,
        "hop_count": len(hops),
        "hops": sorted(hops, key=lambda hop: hop["timestamp"], reverse=True)[:8],
    }


def first_payload_value(metadata: dict[str, Any], raw: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = metadata.get(key)
        if value in (None, ""):
            value = raw.get(key)
        text = string_value(value)
        if text:
            return text
    return None


def unique_non_empty(values: Any) -> list[str]:
    result: list[str] = []
    for value in values:
        text = string_value(value)
        if text and text not in result:
            result.append(text)
    return result


def evidence_rows(state: CurrentState, observation: Observation | None, sightings: list[PresenceSighting]) -> list[dict]:
    rows: list[dict] = []
    rows.append(
        {
            "source": state.source,
            "sensor_id": state.sensor_id,
            "timestamp": _aware(state.last_seen_at),
            "type": "current_state",
            "freshness": freshness_for_time(state.last_seen_at),
            "fields": operator_fields(state.metadata_json or {}, state.raw_payload or {}),
            "highlights": operator_highlights(state.metadata_json or {}, state.raw_payload or {}),
            "provenance": evidence_provenance(state.source, state.sensor_id, "current_state", state.last_seen_at),
            "raw_payload": state.raw_payload or {},
        }
    )
    if observation is not None:
        rows.append(
            {
                "source": observation.source,
                "sensor_id": observation.sensor_id,
                "timestamp": _aware(observation.timestamp),
                "type": "observation",
                "freshness": freshness_for_time(observation.timestamp),
                "fields": operator_fields(observation.metadata_json or {}, observation.raw_payload or {}),
                "highlights": operator_highlights(observation.metadata_json or {}, observation.raw_payload or {}),
                "provenance": evidence_provenance(observation.source, observation.sensor_id, "observation", observation.timestamp),
                "raw_payload": observation.raw_payload or {},
            }
        )
    for sighting in sightings[:5]:
        rows.append(
            {
                "source": sighting.source,
                "sensor_id": sighting.sensor_id,
                "timestamp": _aware(sighting.timestamp),
                "type": "presence_sighting",
                "freshness": freshness_for_time(sighting.timestamp),
                "fields": operator_fields(sighting.evidence_json or {}, sighting.raw_payload or {}),
                "highlights": operator_highlights(sighting.evidence_json or {}, sighting.raw_payload or {}),
                "provenance": evidence_provenance(sighting.source, sighting.sensor_id, "presence_sighting", sighting.timestamp),
                "raw_payload": sighting.raw_payload or {},
            }
        )
    return rows


def evidence_provenance(source: str, sensor_id: str | None, evidence_type: str, timestamp: datetime) -> dict[str, str | None]:
    return {
        "source": source,
        "sensor_id": sensor_id,
        "type": evidence_type,
        "freshness": freshness_for_time(timestamp),
    }


def operator_fields(metadata: dict[str, Any], raw: dict[str, Any]) -> dict[str, Any]:
    keys = [
        "macAddress",
        "name",
        "ipAddress",
        "NetworkName",
        "type",
        "sensor_id",
        "kind",
        "rssi",
        "message",
        "unificlientmac",
        "unificlientip",
        "unificonnectedtodevicename",
        "unifiwifirssi",
        "unifiwifiname",
        "unifinetworkname",
        "severity",
        "kismet.device.base.phyname",
        "kismet.device.base.macaddr",
        "kismet.device.base.commonname",
        "kismet.common.signal.last_signal",
        "event_type",
        "model",
        "id",
        "frequency",
        "protocol",
        "identity_hint",
        "known",
        "callsign",
        "altitude",
        "speed",
        "heading",
        "squawk",
        "aar_channel",
        "channel_label",
        "rail_operator_hint",
        "rail_route_hint",
        "rail_usage_hint",
        "activity_type",
        "inference_confidence",
        "iot_protocol_label",
        "iot_stack_hint",
        "iot_channel_mhz",
        "packet_direction",
        "network_pan_id",
        "short_address",
        "device_role_hint",
        "vendor_hint",
        "decode_channel",
        "dl_freq_hz",
        "ul_freq_hz",
        "cell_id",
        "prb",
        "api_mode",
        "api_output",
        "processed_subframes",
        "rnti_count",
        "snr_db",
        "operator_read",
    ]
    fields: dict[str, Any] = {}
    for key in keys:
        value = metadata.get(key)
        if value in (None, ""):
            value = raw.get(key)
        if value not in (None, ""):
            fields[key] = value
    return fields


def operator_highlights(metadata: dict[str, Any], raw: dict[str, Any]) -> list[dict[str, str]]:
    field_labels = [
        ("macAddress", "Client MAC", "identity"),
        ("unificlientmac", "Client MAC", "identity"),
        ("kismet.device.base.macaddr", "Client MAC", "identity"),
        ("identity_hint", "Identity", "identity"),
        ("name", "Name", "identity"),
        ("kismet.device.base.commonname", "Name", "identity"),
        ("ipAddress", "Client IP", "network"),
        ("unificlientip", "Client IP", "network"),
        ("NetworkName", "Network", "network"),
        ("unifinetworkname", "Network", "network"),
        ("unifiwifiname", "Wi-Fi", "network"),
        ("unificonnectedtodevicename", "Connected To", "network"),
        ("access", "Access", "network"),
        ("type", "Type", "classification"),
        ("kind", "Kind", "classification"),
        ("protocol", "Protocol", "classification"),
        ("model", "Model", "classification"),
        ("sensor_id", "Sensor", "source"),
        ("rssi", "RSSI", "signal"),
        ("unifiwifirssi", "Wi-Fi RSSI", "signal"),
        ("kismet.common.signal.last_signal", "RSSI", "signal"),
        ("frequency", "Frequency", "signal"),
        ("message", "Message", "alert"),
        ("severity", "Severity", "alert"),
        ("event_type", "Event Type", "alert"),
        ("callsign", "Callsign", "aircraft"),
        ("altitude", "Altitude", "aircraft"),
        ("speed", "Speed", "aircraft"),
        ("heading", "Heading", "aircraft"),
        ("squawk", "Squawk", "aircraft"),
        ("known", "Known", "classification"),
        ("channel_label", "AAR Channel", "rail"),
        ("rail_operator_hint", "Rail Operator", "rail"),
        ("rail_route_hint", "Rail Route", "rail"),
        ("rail_usage_hint", "Rail Usage", "rail"),
        ("activity_type", "Rail Activity", "rail"),
        ("iot_protocol_label", "IoT Protocol", "iot"),
        ("iot_stack_hint", "IoT Stack", "iot"),
        ("network_pan_id", "PAN", "iot"),
        ("short_address", "Short Address", "iot"),
        ("packet_direction", "Packet Direction", "iot"),
        ("device_role_hint", "IoT Role", "iot"),
        ("vendor_hint", "Vendor Hint", "identity"),
        ("decode_channel", "LTE Decode", "cellular"),
        ("dl_freq_hz", "LTE Downlink", "cellular"),
        ("ul_freq_hz", "LTE Uplink", "cellular"),
        ("cell_id", "LTE Cell", "cellular"),
        ("prb", "LTE PRB", "cellular"),
        ("api_mode", "LTE API Mode", "cellular"),
        ("api_output", "LTE API Output", "cellular"),
        ("processed_subframes", "Subframes", "cellular"),
        ("rnti_count", "RNTIs", "cellular"),
        ("snr_db", "SNR", "signal"),
        ("operator_read", "Operator Read", "classification"),
    ]
    highlights: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for key, label, tone in field_labels:
        value = metadata.get(key)
        if value in (None, ""):
            value = raw.get(key)
        if value in (None, ""):
            continue
        text = str(value)
        dedupe_key = (label, text)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        highlights.append({"key": key, "label": label, "value": text, "tone": tone})
    return highlights


def source_confidence_rows(state: CurrentState, sightings: list[PresenceSighting]) -> list[dict]:
    grouped: dict[str, list[PresenceSighting]] = {}
    for sighting in sightings:
        grouped.setdefault(sighting.source, []).append(sighting)
    if state.source not in grouped:
        grouped[state.source] = []
    rows = []
    for source, source_sightings in grouped.items():
        latest_seen_at = source_sightings[0].timestamp if source_sightings else state.last_seen_at
        observations = len(source_sightings) or state.seen_count
        freshness = freshness_for_time(latest_seen_at)
        confidence = min(1.0, 0.35 + min(observations, 8) * 0.07 + (0.2 if freshness == "live" else 0))
        rows.append(
            {
                "source": source,
                "observations": observations,
                "latest_seen_at": _aware(latest_seen_at),
                "freshness": freshness,
                "confidence": round(confidence, 2),
            }
        )
    return sorted(rows, key=lambda row: (row["confidence"], row["observations"]), reverse=True)


def interest_reasons(candidate: dict, tracked: bool, sightings: list[PresenceSighting]) -> list[str]:
    reasons: list[str] = []
    if tracked:
        reasons.append("tracked")
    rssi = candidate.get("rssi")
    if isinstance(rssi, int) and rssi >= -60:
        reasons.append("strong_signal")
    if candidate["category"] in {"aircraft", "utility", "unknown_rf", "cellular"}:
        reasons.append(candidate["category"])
    if candidate["seen_count"] <= 2:
        reasons.append("new_or_rare")
    if len(sightings) >= 5:
        reasons.append("repeat_presence")
    return reasons or ["baseline"]


def interest_score(candidate: dict, reasons: list[str]) -> int:
    score = 25
    for reason in reasons:
        score += INTEREST_REASON_WEIGHTS.get(reason, 0)
    return min(100, score)


def interest_reason_chips(reasons: list[str]) -> list[dict[str, str | int]]:
    return [
        {
            "id": reason,
            "label": reason.replace("_", " ").capitalize(),
            "tone": interest_reason_tone(reason),
            "weight": INTEREST_REASON_WEIGHTS.get(reason, 0),
        }
        for reason in reasons
    ]


def interest_reason_tone(reason: str) -> str:
    if reason in {"tracked", "repeat_presence"}:
        return "good"
    if reason == "strong_signal":
        return "signal"
    if reason in {"unknown_rf", "new_or_rare"}:
        return "hot"
    if reason in {"aircraft", "utility"}:
        return "warn"
    return "neutral"


def reliability_score(state: CurrentState, sightings: list[PresenceSighting]) -> int:
    score = 35
    score += min(state.seen_count, 10) * 4
    score += min(len(sightings), 10) * 3
    if signal_value(state) is not None:
        score += 10
    if freshness_for_time(state.last_seen_at) == "live":
        score += 15
    return min(100, score)


def reliability_report(
    state: CurrentState,
    sightings: list[PresenceSighting],
    source_confidence: list[dict],
    score: int,
) -> dict[str, Any]:
    strengths: list[str] = []
    gaps: list[str] = []
    if signal_value(state) is not None:
        strengths.append("RSSI is available")
    else:
        gaps.append("RSSI is missing")
    if state.seen_count >= 5:
        strengths.append("Repeated current-state observations")
    else:
        gaps.append("Low current-state observation count")
    if len(source_confidence) > 1:
        strengths.append("Multiple sources have reported this entity")
    else:
        gaps.append("Only one source has reported this entity")
    if len(sightings) > 0:
        strengths.append("Presence sightings are being sampled")
    else:
        gaps.append("No sampled presence sightings yet")

    return {
        "score": score,
        "label": reliability_label(score),
        "freshness": freshness_for_time(state.last_seen_at),
        "sighting_count": len(sightings),
        "current_seen_count": state.seen_count,
        "source_count": len(source_confidence),
        "strengths": strengths,
        "gaps": gaps,
    }


def reliability_label(score: int) -> str:
    if score >= 80:
        return "Strong"
    if score >= 60:
        return "Good"
    if score >= 40:
        return "Limited"
    return "Weak"


def behavior_anomalies(
    candidate: dict,
    state: CurrentState,
    sightings: list[PresenceSighting],
    source_confidence: list[dict],
) -> list[dict[str, str]]:
    anomalies: list[dict[str, str]] = []
    rssi = candidate.get("rssi")
    if isinstance(rssi, int) and rssi >= -55:
        anomalies.append(
            {
                "id": "strong_nearby_signal",
                "label": "Strong nearby signal",
                "severity": "info",
                "tone": "signal",
            }
        )
    if state.seen_count <= 2:
        anomalies.append({"id": "new_or_rare", "label": "New or rare", "severity": "watch", "tone": "hot"})
    if freshness_for_time(state.last_seen_at) != "live":
        anomalies.append({"id": "not_live", "label": "Not live", "severity": "watch", "tone": "warn"})
    if rssi is None:
        anomalies.append({"id": "missing_rssi", "label": "Missing RSSI", "severity": "watch", "tone": "warn"})
    if len(source_confidence) <= 1 and len(sightings) <= 1:
        anomalies.append({"id": "thin_evidence", "label": "Thin evidence", "severity": "watch", "tone": "neutral"})
    return anomalies


def presence_rhythm(sightings: list[PresenceSighting]) -> dict[str, Any]:
    hour_counts: Counter[int] = Counter()
    hotspot_counts: Counter[tuple[int, int]] = Counter()
    for sighting in sightings:
        timestamp = _aware(sighting.timestamp)
        hour_counts[timestamp.hour] += 1
        hotspot_counts[(timestamp.weekday(), timestamp.hour)] += 1

    peak_hours = [
        {"hour": hour, "count": count}
        for hour, count in sorted(hour_counts.items(), key=lambda item: (-item[1], item[0]))[:6]
    ]
    hotspots = [
        {"weekday": weekday, "hour": hour, "count": count}
        for (weekday, hour), count in sorted(hotspot_counts.items(), key=lambda item: (-item[1], item[0][0], item[0][1]))[:12]
    ]
    return {
        "sample_count": len(sightings),
        "peak_hours": peak_hours,
        "hotspots": hotspots,
    }


def commute_clock(rhythm: dict[str, Any]) -> dict[str, Any]:
    sample_count = int(rhythm.get("sample_count") or 0)
    peak_hours = rhythm.get("peak_hours") or []
    if sample_count <= 0 or not peak_hours:
        return {
            "status": "learning",
            "typical_hour": None,
            "sample_count": sample_count,
            "label": "Learning normal presence time",
        }
    typical_hour = int(peak_hours[0]["hour"])
    return {
        "status": "learned",
        "typical_hour": typical_hour,
        "sample_count": sample_count,
        "label": f"Usually seen around {hour_label(typical_hour)}",
    }


def next_seen_timer(commute: dict[str, Any]) -> dict[str, Any]:
    typical_hour = commute.get("typical_hour")
    if commute.get("status") != "learned" or typical_hour is None:
        return {
            "status": "learning",
            "expected_hour": None,
            "label": "Next expected time is still learning",
        }
    return {
        "status": "expected",
        "expected_hour": int(typical_hour),
        "label": f"Next expected around {hour_label(int(typical_hour))}",
    }


def presence_rules(candidate: dict[str, Any], state: CurrentState, tracked: bool) -> dict[str, Any]:
    freshness = freshness_for_time(state.last_seen_at)
    category = string_value(candidate.get("category"))
    rssi = candidate.get("rssi")
    chips: list[dict[str, str]] = []

    if freshness == "live":
        status = "present"
        label = "Currently visible"
        tone = "good"
        chips.append({"id": "present", "label": "Currently visible", "tone": "good"})
    else:
        status = "departed"
        label = "Departed or out of range"
        tone = "warn"
        chips.append({"id": "departed", "label": "Departed or out of range", "tone": "warn"})

    if tracked and category in {"client", "wifi", "ble"}:
        chips.append({"id": "left_behind_ready", "label": "Left-behind watch armed", "tone": "signal"})
        if freshness == "live" and isinstance(rssi, int) and rssi >= -60:
            status = "left_behind_candidate"
            label = "Nearby tracked device"
            tone = "signal"
            chips.append({"id": "nearby_tracked", "label": "Strong tracked signal", "tone": "signal"})
    elif not tracked:
        chips.append({"id": "not_tracked", "label": "Not on watchlist", "tone": "neutral"})

    return {
        "status": status,
        "label": label,
        "tone": tone,
        "freshness": freshness,
        "last_seen_at": _aware(state.last_seen_at),
        "chips": chips,
    }


def hour_label(hour: int) -> str:
    normalized = hour % 24
    suffix = "PM" if normalized >= 12 else "AM"
    display = normalized % 12 or 12
    return f"{display} {suffix}"


def freshness_for_time(value: datetime) -> str:
    age_seconds = (datetime.now(UTC) - _aware(value)).total_seconds()
    if age_seconds <= 120:
        return "live"
    if age_seconds <= 900:
        return "stale"
    return "historical"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def should_sample_sighting(session: Session, watchlist_id: str, timestamp: datetime) -> bool:
    latest = session.execute(
        select(PresenceSighting)
        .where(PresenceSighting.watchlist_id == watchlist_id)
        .order_by(PresenceSighting.timestamp.desc())
        .limit(1)
    ).scalar_one_or_none()
    if latest is None:
        return True
    return (_aware(timestamp) - _aware(latest.timestamp)).total_seconds() >= SIGHTING_SAMPLE_SECONDS


def append_presence_sightings(
    session: Session,
    state: CurrentState,
    timestamp: datetime,
    *,
    rssi: int | None = None,
) -> list[PresenceSighting]:
    watchlist_items = session.execute(
        select(PresenceWatchlist).where(
            PresenceWatchlist.enabled.is_(True),
            PresenceWatchlist.entity_key == state.state_key,
        )
    ).scalars()
    created: list[PresenceSighting] = []
    for watchlist_item in watchlist_items:
        if not should_sample_sighting(session, watchlist_item.id, timestamp):
            continue
        sighting = PresenceSighting(
            watchlist_id=watchlist_item.id,
            entity_key=watchlist_item.entity_key,
            timestamp=timestamp,
            source=state.source,
            protocol=state.protocol,
            kind=state.kind,
            identity_hint=state.identity_hint,
            sensor_id=state.sensor_id,
            zone_id=state.zone_id,
            rssi=rssi if rssi is not None else signal_value(state),
            evidence_json={
                "label": label_for_state(state),
                "entity_type": entity_type_for_state(state),
                "seen_count": state.seen_count,
                "first_seen_at": state.first_seen_at.isoformat(),
                "last_seen_at": state.last_seen_at.isoformat(),
                "metadata": state.metadata_json or {},
            },
            raw_payload=state.raw_payload or {},
        )
        session.add(sighting)
        created.append(sighting)
    return created
