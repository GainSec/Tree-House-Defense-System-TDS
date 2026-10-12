import hashlib
import math
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import CurrentState
from app.schemas import AircraftMapFeature, RfMapFeature
from app.site_settings import get_site_settings

router = APIRouter(prefix="/v1/map", tags=["map"])

DEFAULT_MAP_CENTER = (0, 0)
LIVE_SECONDS = 5 * 60
STALE_SECONDS = 60 * 60
SPECTRUM_PEAK_LIVE_SECONDS = 10 * 60
SPECTRUM_PEAK_STALE_SECONDS = 15 * 60
NAUTICAL_MILES_PER_DEGREE = 60


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


def nested_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def first_present(candidate: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in candidate and candidate[key] is not None and candidate[key] != "":
            return candidate[key]
    return None


def candidates(state: CurrentState) -> list[dict[str, Any]]:
    raw = state.raw_payload or {}
    metadata = state.metadata_json or {}
    base_location = nested_dict(raw.get("kismet.device.base.location"))
    location_candidates = [metadata, raw, base_location]
    location_candidates.extend(
        nested_dict(base_location.get(key))
        for key in [
            "kismet.common.location.last",
            "kismet.common.location.avg_loc",
            "kismet.common.location.max_loc",
        ]
    )
    return [candidate for candidate in location_candidates if candidate]


def valid_coordinate(longitude: float | None, latitude: float | None, *, allow_zero: bool = True) -> tuple[float, float] | None:
    if (
        latitude is not None
        and longitude is not None
        and abs(latitude) <= 90
        and abs(longitude) <= 180
        and (allow_zero or latitude != 0 or longitude != 0)
    ):
        return latitude, longitude
    return None


def coordinate_from_candidate(candidate: dict[str, Any], *, allow_zero: bool = True) -> tuple[float, float] | None:
    geopoint = candidate.get("kismet.common.location.geopoint")
    if isinstance(geopoint, list | tuple) and len(geopoint) >= 2:
        coordinate = valid_coordinate(numeric_value(geopoint[0]), numeric_value(geopoint[1]), allow_zero=allow_zero)
        if coordinate:
            return coordinate

    latitude = numeric_value(
        first_present(
            candidate,
            [
                "lat",
                "latitude",
                "gps_lat",
                "gpsLatitude",
                "kismet.common.location.lat",
                "kismet.common.location.avg_lat",
            ],
        )
    )
    longitude = numeric_value(
        first_present(
            candidate,
            [
                "lon",
                "lng",
                "long",
                "longitude",
                "gps_lon",
                "gpsLongitude",
                "kismet.common.location.lon",
                "kismet.common.location.avg_lon",
            ],
        )
    )
    return valid_coordinate(longitude, latitude, allow_zero=allow_zero)


def real_coordinate(state: CurrentState, *, allow_zero: bool = True) -> tuple[float, float] | None:
    for candidate in candidates(state):
        coordinate = coordinate_from_candidate(candidate, allow_zero=allow_zero)
        if coordinate:
            return coordinate
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


def rf_signal_value(state: CurrentState) -> int | None:
    metadata_signal = int_value(field_value(state, "rssi", "signal", "power_dbm"))
    if metadata_signal is not None:
        return metadata_signal

    raw_signal = nested_dict((state.raw_payload or {}).get("kismet.device.base.signal"))
    signal_type = string_value(raw_signal.get("kismet.common.signal.type")).lower()
    last_signal = int_value(raw_signal.get("kismet.common.signal.last_signal"))
    if state.source == "kismet" and signal_type == "none" and last_signal == 0:
        return None
    return last_signal


def raw_adsb(state: CurrentState) -> dict[str, Any]:
    return nested_dict((state.raw_payload or {}).get("adsb.device"))


def last_location(state: CurrentState) -> dict[str, Any]:
    return nested_dict(nested_dict((state.raw_payload or {}).get("kismet.device.base.location")).get("kismet.common.location.last"))


def classify(state: CurrentState) -> str:
    protocol = state.protocol.lower()
    kind = state.kind.lower()
    phyname = string_value(field_value(state, "phyname", "kismet.device.base.phyname")).lower()
    name = string_value(field_value(state, "name", "kismet.device.base.name")).lower()
    state_key = state.state_key.lower()

    if state.source == "intercept" and kind == "spectrum_peak":
        return "unknown_rf"
    if kind in {"datasource", "server_status", "sdr_device"} or protocol == "infrastructure":
        return "infrastructure"
    if protocol == "adsb" or kind == "aircraft" or "adsb" in phyname:
        return "aircraft"
    if protocol == "rail" or kind == "rail_activity" or state.source == "rail_rf":
        return "rail"
    if protocol in {"lte", "cellular"} or kind in {"lte_sensor", "lte_decode_status"} or state.source == "ltesniffer":
        return "cellular"
    if protocol in {"zigbee", "thread", "802154"} or kind == "iot_device" or "802.15.4" in phyname:
        return "iot"
    if protocol in {"ble", "bluetooth"} or "bluetooth" in phyname:
        return "ble"
    if protocol == "wifi" or "802.11" in phyname:
        return "wifi"
    if (
        protocol in {"rtl433", "subghz", "utility"}
        or "rtl433" in phyname
        or "rtl433" in name
        or "rtl433" in state_key
        or "weather" in name
        or "meter" in name
    ):
        return "utility"
    return "unknown_rf"


def is_rf_state(state: CurrentState) -> bool:
    if state.source in {"kismet", "intercept", "ltesniffer"}:
        return True
    protocol = state.protocol.lower()
    kind = state.kind.lower()
    return protocol in {"wifi", "ble", "bluetooth", "adsb", "rtl433", "subghz", "utility", "sdr", "rail", "lte", "cellular", "zigbee", "thread", "802154"} or kind in {
        "aircraft",
        "sdr_device",
        "rail_activity",
        "lte_sensor",
        "lte_decode_status",
        "iot_device",
    }


def rf_state_filter():
    return or_(
        CurrentState.source.in_(["kismet", "intercept"]),
        CurrentState.source.in_(["rail_rf", "ltesniffer"]),
        CurrentState.protocol.in_(["wifi", "ble", "bluetooth", "adsb", "rtl433", "subghz", "utility", "sdr", "rail", "lte", "cellular", "zigbee", "thread", "802154"]),
        CurrentState.kind.in_(["aircraft", "sdr_device", "rail_activity", "lte_sensor", "lte_decode_status", "iot_device"]),
    )


def freshness(
    last_seen_at: datetime | None,
    now: datetime,
    *,
    live_seconds: int = LIVE_SECONDS,
    stale_seconds: int = STALE_SECONDS,
) -> str:
    if last_seen_at is None:
        return "stale"
    seen = last_seen_at if last_seen_at.tzinfo else last_seen_at.replace(tzinfo=UTC)
    age = max(0, (now - seen).total_seconds())
    if age <= live_seconds:
        return "live"
    if age <= stale_seconds:
        return "stale"
    return "expired"


def stable_estimate(state: CurrentState, category: str, rssi: int | None, freshness_value: str, site: dict[str, Any] | None = None) -> tuple[float, float]:
    digest = hashlib.sha256(f"{category}:{state.identity_hint or state.state_key}".encode()).digest()
    bearing = (int.from_bytes(digest[:4], "big") / 2**32) * math.tau
    if category == "infrastructure":
        distance_nm = 0.015
    elif rssi is None:
        distance_nm = 0.18
    else:
        strength = max(0, min(80, rssi + 100))
        distance_nm = 0.04 + (1 - strength / 80) * 0.28
    if freshness_value == "stale":
        distance_nm *= 1.25

    longitude, latitude = site_longitude_latitude(site)
    delta_lat = (math.cos(bearing) * distance_nm) / NAUTICAL_MILES_PER_DEGREE
    lon_scale = max(math.cos(math.radians(latitude)), 0.01)
    delta_lon = (math.sin(bearing) * distance_nm) / (NAUTICAL_MILES_PER_DEGREE * lon_scale)
    return latitude + delta_lat, longitude + delta_lon


def site_longitude_latitude(site: dict[str, Any] | None = None) -> tuple[float, float]:
    if site:
        return float(site["longitude"]), float(site["latitude"])
    return DEFAULT_MAP_CENTER


def rf_map_feature(state: CurrentState, now: datetime, site: dict[str, Any] | None = None) -> RfMapFeature | None:
    category = classify(state)
    if state.source == "intercept" and state.kind == "spectrum_peak":
        last_seen_freshness = freshness(
            state.last_seen_at,
            now,
            live_seconds=SPECTRUM_PEAK_LIVE_SECONDS,
            stale_seconds=SPECTRUM_PEAK_STALE_SECONDS,
        )
    else:
        last_seen_freshness = freshness(state.last_seen_at, now)
    if last_seen_freshness == "expired":
        return None

    rssi = rf_signal_value(state)
    coordinate = real_coordinate(state, allow_zero=category != "aircraft")
    if coordinate:
        latitude, longitude = coordinate
        location_accuracy = "real"
    elif category == "infrastructure":
        longitude, latitude = site_longitude_latitude(site)
        location_accuracy = "receiver"
    elif category == "aircraft":
        longitude, latitude = site_longitude_latitude(site)
        location_accuracy = "receiver"
    else:
        latitude, longitude = stable_estimate(state, category, rssi, last_seen_freshness, site)
        location_accuracy = "estimated"

    identity = string_value(state.identity_hint) or state.state_key
    label = (
        string_value(field_value(state, "name", "commonname", "kismet.device.base.commonname", "kismet.device.base.name"))
        or identity
    )

    return RfMapFeature(
        identity=identity,
        label=label,
        protocol=state.protocol,
        kind=state.kind,
        source=state.source,
        category=category,
        latitude=latitude,
        longitude=longitude,
        location_accuracy=location_accuracy,
        estimated=location_accuracy == "estimated",
        rssi=rssi,
        channel=string_value(field_value(state, "channel")) or None,
        frequency=string_value(field_value(state, "frequency", "frequency_mhz")) or None,
        manufacturer=string_value(field_value(state, "manufacturer")) or None,
        first_seen_at=state.first_seen_at,
        last_seen_at=state.last_seen_at,
        count=state.seen_count,
        freshness=last_seen_freshness,
        operator_context=operator_context_for_state(state, category),
        state_key=state.state_key,
    )



def operator_context_for_state(state: CurrentState, category: str) -> dict[str, Any] | None:
    metadata = state.metadata_json or {}
    headline = string_value(metadata.get("operator_read"))
    chips: list[dict[str, str]] = []
    if category == "rail":
        chips.extend(
            context_chip(value, tone)
            for value, tone in [
                (metadata.get("channel_label"), "rail"),
                (metadata.get("rail_operator_hint"), "rail"),
                (metadata.get("rail_route_hint"), "route"),
                (metadata.get("rail_usage_hint"), "usage"),
            ]
            if value not in (None, "")
        )
    elif category == "iot":
        pan = string_value(metadata.get("network_pan_id"))
        chips.extend(
            context_chip(value, tone)
            for value, tone in [
                (metadata.get("iot_protocol_label"), "iot"),
                (f"PAN {pan}" if pan else None, "iot"),
                (metadata.get("packet_direction"), "traffic"),
                (metadata.get("vendor_hint"), "identity"),
            ]
            if value not in (None, "")
        )
    elif category == "cellular":
        cell_id = string_value(metadata.get("cell_id"))
        prb = string_value(metadata.get("prb"))
        dl_freq = frequency_mhz_label("DL", metadata.get("dl_freq_hz"))
        ul_freq = frequency_mhz_label("UL", metadata.get("ul_freq_hz"))
        chips.extend(
            context_chip(value, tone)
            for value, tone in [
                (metadata.get("decode_channel") or metadata.get("channel"), "cellular"),
                (f"Cell {cell_id}" if cell_id else None, "cellular"),
                (f"{prb} PRB" if prb else None, "cellular"),
                (dl_freq, "frequency"),
                (ul_freq, "frequency"),
            ]
            if value not in (None, "")
        )
    else:
        return None
    if not headline and chips:
        headline = " · ".join(chip["label"] for chip in chips[:3])
    if not headline and not chips:
        return None
    return {"headline": headline, "chips": chips[:6]}


def context_chip(value: Any, tone: str) -> dict[str, str]:
    return {"label": string_value(value), "tone": tone}


def frequency_mhz_label(prefix: str, value: Any) -> str | None:
    hz = int_value(value)
    if hz is None or hz <= 0:
        return None
    return f"{prefix} {hz / 1_000_000:.3f} MHz"


def aircraft_state_filter():
    return or_(CurrentState.protocol == "adsb", CurrentState.kind == "aircraft")


def aircraft_map_feature(state: CurrentState, now: datetime) -> AircraftMapFeature | None:
    if freshness(state.last_seen_at, now) == "expired":
        return None
    coordinate = real_coordinate(state, allow_zero=False)
    if not coordinate:
        return None

    latitude, longitude = coordinate
    adsb = raw_adsb(state)
    icao = nested_dict(adsb.get("kismet.adsb.icao_record"))
    location = last_location(state)
    identity = string_value(state.identity_hint) or state.state_key
    callsign = string_value(adsb.get("adsb.device.callsign"))
    label = string_value(field_value(state, "name", "commonname", "kismet.device.base.commonname", "kismet.device.base.name"))

    return AircraftMapFeature(
        identity=identity,
        callsign=callsign or label or identity,
        model=string_value(icao.get("adsb.icao.model") or icao.get("adsb.icao.type")),
        owner=string_value(icao.get("adsb.icao.owner")),
        icao_type=string_value(icao.get("adsb.icao.type") or icao.get("adsb.icao.icao_type")),
        registration=string_value(icao.get("adsb.icao.registration") or icao.get("adsb.icao.reg")),
        country=string_value(icao.get("adsb.icao.country")),
        squawk=string_value(adsb.get("adsb.device.squawk") or field_value(state, "squawk", "adsb.device.squawk")),
        latitude=latitude,
        longitude=longitude,
        altitude=numeric_value(location.get("kismet.common.location.alt")),
        speed=numeric_value(location.get("kismet.common.location.speed")),
        heading=numeric_value(location.get("kismet.common.location.heading")) or 0,
        source=state.source,
        protocol=state.protocol,
        first_seen_at=state.first_seen_at,
        last_seen_at=state.last_seen_at,
        count=state.seen_count,
    )


@router.get("/rf")
def list_rf_map_features(limit: int = Query(default=500, ge=1, le=1000), session: Session = Depends(get_session)) -> dict:
    now = datetime.now(UTC)
    site = get_site_settings(session)
    expired_cutoff = now - timedelta(seconds=STALE_SECONDS)
    stmt = (
        select(CurrentState)
        .where(rf_state_filter(), CurrentState.last_seen_at >= expired_cutoff)
        .order_by(CurrentState.last_seen_at.desc())
    )
    states = session.execute(stmt).scalars().all()
    features = [feature for state in states if is_rf_state(state) and (feature := rf_map_feature(state, now, site)) is not None]
    category_counts = Counter(feature.category for feature in features)
    category_live_counts = Counter(feature.category for feature in features if feature.freshness == "live")
    source_counts = Counter(feature.source for feature in features)
    limited_features = features[:limit]
    return {
        "items": [feature.model_dump(mode="json") for feature in limited_features],
        "count": len(limited_features),
        "total_count": len(features),
        "category_counts": dict(category_counts),
        "category_live_counts": dict(category_live_counts),
        "source_counts": dict(source_counts),
        "site": site,
    }


@router.get("/aircraft")
def list_aircraft_map_features(limit: int = Query(default=100, ge=1, le=500), session: Session = Depends(get_session)) -> dict:
    stmt = select(CurrentState).where(aircraft_state_filter()).order_by(CurrentState.last_seen_at.desc()).limit(limit)
    states = session.execute(stmt).scalars().all()
    now = datetime.now(UTC)
    features = [feature for state in states if (feature := aircraft_map_feature(state, now)) is not None]
    return {"items": [feature.model_dump(mode="json") for feature in features], "count": len(features), "site": get_site_settings(session)}
