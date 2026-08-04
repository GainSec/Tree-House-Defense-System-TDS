from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import CurrentState, CurrentStateSample
from app.routes.observations import current_state_to_dict

router = APIRouter(prefix="/v1/state", tags=["state"])


@router.get("")
def list_current_state(
    limit: int = 100,
    source: str | None = None,
    kind: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(CurrentState).order_by(CurrentState.last_seen_at.desc()).limit(min(limit, 500))
    if source:
        stmt = stmt.where(CurrentState.source == source)
    if kind:
        stmt = stmt.where(CurrentState.kind == kind)
    states = session.execute(stmt).scalars().all()
    return {"items": [current_state_to_dict(item) for item in states], "count": len(states)}


@router.get("/{state_key:path}/samples")
def list_current_state_samples(
    state_key: str,
    limit: int = 100,
    session: Session = Depends(get_session),
) -> dict:
    stmt = (
        select(CurrentStateSample)
        .where(CurrentStateSample.state_key == state_key)
        .order_by(CurrentStateSample.timestamp.desc())
        .limit(min(limit, 1000))
    )
    samples = session.execute(stmt).scalars().all()
    return {"items": [current_state_sample_to_dict(item) for item in samples], "count": len(samples)}


def current_state_sample_to_dict(sample: CurrentStateSample) -> dict:
    return {
        "id": sample.id,
        "state_key": sample.state_key,
        "timestamp": state_timestamp(sample.timestamp),
        "source": sample.source,
        "kind": sample.kind,
        "protocol": sample.protocol,
        "identity_hint": sample.identity_hint,
        "sensor_id": sample.sensor_id,
        "zone_id": sample.zone_id,
        "rssi": sample.rssi,
        "payload_hash": sample.payload_hash,
        "observation_id": sample.observation_id,
        "created_at": state_timestamp(sample.created_at),
    }


def state_timestamp(value: datetime) -> str:
    normalized = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return normalized.isoformat().replace("+00:00", "Z")
