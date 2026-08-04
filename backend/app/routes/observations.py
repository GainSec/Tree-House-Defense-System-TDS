from fastapi import APIRouter, Depends, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import require_ingest_api_key
from app.db import get_session
from app.models import CurrentState, CurrentStateSample, Observation
from app.mqtt import publish_event
from app.presence import append_presence_sightings
from app.rules import evaluate_observation
from app.schemas import ObservationCreate, ObservationRead

router = APIRouter(prefix="/v1/observations", tags=["observations"])


def observation_to_dict(observation: Observation) -> dict:
    return {
        "id": observation.id,
        "timestamp": observation.timestamp,
        "source": observation.source,
        "sensor_id": observation.sensor_id,
        "zone_id": observation.zone_id,
        "protocol": observation.protocol,
        "identity_hint": observation.identity_hint,
        "rssi": observation.rssi,
        "known": observation.known,
        "metadata": observation.metadata_json,
        "raw_payload": observation.raw_payload,
    }


def current_state_to_dict(state: CurrentState) -> dict:
    return {
        "state_key": state.state_key,
        "source": state.source,
        "kind": state.kind,
        "protocol": state.protocol,
        "identity_hint": state.identity_hint,
        "sensor_id": state.sensor_id,
        "zone_id": state.zone_id,
        "payload_hash": state.payload_hash,
        "last_observation_id": state.last_observation_id,
        "seen_count": state.seen_count,
        "metadata": state.metadata_json,
        "raw_payload": state.raw_payload,
        "first_seen_at": state.first_seen_at,
        "last_seen_at": state.last_seen_at,
    }


def compact_observation_to_dict(observation: Observation | None) -> dict | None:
    if observation is None:
        return None
    return {
        "id": observation.id,
        "timestamp": observation.timestamp,
        "source": observation.source,
        "sensor_id": observation.sensor_id,
        "zone_id": observation.zone_id,
        "protocol": observation.protocol,
        "identity_hint": observation.identity_hint,
        "metadata": observation.metadata_json,
    }


def compact_current_state_to_dict(state: CurrentState | None) -> dict | None:
    if state is None:
        return None
    return {
        "state_key": state.state_key,
        "source": state.source,
        "kind": state.kind,
        "protocol": state.protocol,
        "identity_hint": state.identity_hint,
        "sensor_id": state.sensor_id,
        "zone_id": state.zone_id,
        "payload_hash": state.payload_hash,
        "last_observation_id": state.last_observation_id,
        "seen_count": state.seen_count,
        "metadata": state.metadata_json,
        "first_seen_at": state.first_seen_at,
        "last_seen_at": state.last_seen_at,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_observation(
    payload: ObservationCreate,
    request: Request,
    response: Response,
    _: None = Depends(require_ingest_api_key),
    session: Session = Depends(get_session),
) -> dict:
    state_key = payload.metadata.get("state_key")
    payload_hash = payload.metadata.get("state_fingerprint") or state_key
    state_only = payload.metadata.get("state_only") is True
    state_metadata = state_metadata_for_payload(payload)
    existing_state = session.get(CurrentState, state_key) if state_key else None
    if existing_state and existing_state.payload_hash == payload_hash:
        existing_state.seen_count += 1
        existing_state.last_seen_at = payload.timestamp
        existing_state.sensor_id = payload.sensor_id
        existing_state.zone_id = payload.zone_id
        existing_state.metadata_json = state_metadata
        existing_state.raw_payload = payload.raw_payload
        append_current_state_sample(session, existing_state, payload.timestamp, rssi=payload.rssi, observation_id=existing_state.last_observation_id)
        if not state_only:
            append_presence_sightings(session, existing_state, payload.timestamp, rssi=payload.rssi)
        session.commit()

        response.status_code = status.HTTP_200_OK
        observation = session.get(Observation, existing_state.last_observation_id) if existing_state.last_observation_id else None
        if state_only:
            return {
                "observation": compact_observation_to_dict(observation),
                "generated_events": [],
                "deduplicated": True,
                "state": compact_current_state_to_dict(existing_state),
            }
        return {
            "observation": observation_to_dict(observation) if observation else None,
            "generated_events": [],
            "deduplicated": True,
            "state": current_state_to_dict(existing_state),
        }

    observation = Observation(
        timestamp=payload.timestamp,
        source=payload.source,
        sensor_id=payload.sensor_id,
        zone_id=payload.zone_id,
        protocol=payload.protocol,
        identity_hint=payload.identity_hint,
        rssi=payload.rssi,
        known=payload.known,
        metadata_json=payload.metadata,
        raw_payload=payload.raw_payload,
    )
    session.add(observation)
    session.flush()
    state = upsert_current_state(session, payload, observation.id, state_key=state_key, payload_hash=payload_hash)
    if state is not None:
        append_current_state_sample(session, state, payload.timestamp, rssi=payload.rssi, observation_id=observation.id)
        if not state_only:
            append_presence_sightings(session, state, payload.timestamp, rssi=payload.rssi)

    events = (
        []
        if state_only
        else evaluate_observation(
            session,
            observation,
            rssi_threshold=request.app.state.settings.unknown_rssi_threshold,
            cooldown_seconds=request.app.state.settings.event_cooldown_seconds,
        )
    )
    session.commit()

    for event in events:
        publish_event(event, request.app.state.settings)

    if state_only:
        return {
            "observation": compact_observation_to_dict(observation),
            "generated_events": [],
            "deduplicated": False,
            "state": compact_current_state_to_dict(state),
        }

    return {
        "observation": observation_to_dict(observation),
        "generated_events": [event.id for event in events],
        "deduplicated": False,
        "state": current_state_to_dict(state) if state else None,
    }


@router.get("")
def list_observations(
    limit: int = 100,
    source: str | None = None,
    zone_id: str | None = None,
    protocol: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(Observation).order_by(Observation.created_at.desc()).limit(min(limit, 500))
    if source:
        stmt = stmt.where(Observation.source == source)
    if zone_id:
        stmt = stmt.where(Observation.zone_id == zone_id)
    if protocol:
        stmt = stmt.where(Observation.protocol == protocol)
    observations = session.execute(stmt).scalars().all()
    return {"items": [observation_to_dict(item) for item in observations], "count": len(observations)}


def upsert_current_state(
    session: Session,
    payload: ObservationCreate,
    observation_id: str,
    *,
    state_key: str | None,
    payload_hash: str | None,
) -> CurrentState | None:
    if not state_key:
        return None
    state_metadata = state_metadata_for_payload(payload)
    state = session.get(CurrentState, state_key)
    kind = str(payload.metadata.get("kind") or payload.protocol)
    if state is None:
        state = CurrentState(
            state_key=state_key,
            source=payload.source,
            kind=kind,
            protocol=payload.protocol,
            identity_hint=payload.identity_hint,
            sensor_id=payload.sensor_id,
            zone_id=payload.zone_id,
            payload_hash=payload_hash or state_key,
            last_observation_id=observation_id,
            seen_count=1,
            metadata_json=state_metadata,
            raw_payload=payload.raw_payload,
            first_seen_at=payload.timestamp,
            last_seen_at=payload.timestamp,
        )
        session.add(state)
        return state

    state.source = payload.source
    state.kind = kind
    state.protocol = payload.protocol
    state.identity_hint = payload.identity_hint
    state.sensor_id = payload.sensor_id
    state.zone_id = payload.zone_id
    state.payload_hash = payload_hash or state_key
    state.last_observation_id = observation_id
    state.seen_count += 1
    state.metadata_json = state_metadata
    state.raw_payload = payload.raw_payload
    state.last_seen_at = payload.timestamp
    return state


def append_current_state_sample(
    session: Session,
    state: CurrentState,
    timestamp,
    *,
    rssi: int | None,
    observation_id: str | None,
) -> CurrentStateSample:
    sample = CurrentStateSample(
        state_key=state.state_key,
        timestamp=timestamp,
        source=state.source,
        kind=state.kind,
        protocol=state.protocol,
        identity_hint=state.identity_hint,
        sensor_id=state.sensor_id,
        zone_id=state.zone_id,
        rssi=rssi,
        payload_hash=state.payload_hash,
        observation_id=observation_id,
    )
    session.add(sample)
    return sample


def state_metadata_for_payload(payload: ObservationCreate) -> dict:
    return {**payload.metadata, "rssi": payload.rssi}
