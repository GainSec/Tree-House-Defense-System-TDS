from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Event, Observation, utcnow


def evaluate_observation(
    session: Session,
    observation: Observation,
    *,
    rssi_threshold: int = -55,
    cooldown_seconds: int = 300,
) -> list[Event]:
    if observation.known:
        return []
    if observation.protocol not in {"ble", "wifi"}:
        return []
    if observation.rssi < rssi_threshold:
        return []
    if _has_recent_unknown_event(session, observation.zone_id, cooldown_seconds):
        return []

    event = Event(
        type="unknown_device_nearby",
        severity="medium",
        confidence=0.8,
        zone_id=observation.zone_id,
        summary=_summary_for(observation),
        observation_refs=[observation.id],
        payload={
            "source": observation.source,
            "sensor_id": observation.sensor_id,
            "zone_id": observation.zone_id,
            "protocol": observation.protocol,
            "identity_hint": observation.identity_hint,
            "rssi": observation.rssi,
        },
    )
    session.add(event)
    return [event]


def _has_recent_unknown_event(session: Session, zone_id: str | None, cooldown_seconds: int) -> bool:
    cutoff = utcnow() - timedelta(seconds=cooldown_seconds)
    stmt = (
        select(Event)
        .where(Event.type == "unknown_device_nearby")
        .where(Event.created_at >= cutoff)
        .limit(1)
    )
    if zone_id is None:
        stmt = stmt.where(Event.zone_id.is_(None))
    else:
        stmt = stmt.where(Event.zone_id == zone_id)
    return session.execute(stmt).scalar_one_or_none() is not None


def _summary_for(observation: Observation) -> str:
    zone = observation.zone_id or "unknown zone"
    return f"Unknown {observation.protocol.upper()} device near {zone}"
