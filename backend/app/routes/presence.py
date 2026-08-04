from collections import Counter
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import CurrentState, Event, InvestigationNote, PresenceIdentityDecision, PresenceSighting, PresenceWatchlist
from app.mqtt import publish_event, serialize_event
from app.presence import (
    PRESENCE_PLAYBOOKS,
    WATCH_MODES,
    airspace_lane_memory,
    alert_entity_causal_graph,
    change_briefing,
    co_presence_clusters,
    entity_dossier,
    entity_replay_frames,
    presence_graph_timeline,
    investigation_search,
    identity_decision_summary,
    label_for_state,
    is_trackable_candidate,
    presence_entity_detail,
    presence_entity_intelligence,
    presence_entity_investigation,
    presence_change_feed,
    presence_history_audit,
    presence_pattern_analytics,
    presence_link_graph,
    rf_burst_swarms,
    run_entity_enrichment,
    sensor_coverage,
    sensor_trust_heatmap,
    sighting_to_dict,
    spectrum_occupancy,
    state_candidate,
    state_matches_watch_mode,
    watch_mode_by_id,
    watchlist_to_dict,
)

router = APIRouter(prefix="/v1/presence", tags=["presence"])


class PresenceWatchCreate(BaseModel):
    entity_key: str = Field(min_length=1, max_length=256)
    entity_type: str | None = Field(default=None, max_length=32)
    source: str | None = Field(default=None, max_length=96)
    protocol: str | None = Field(default=None, max_length=32)
    kind: str | None = Field(default=None, max_length=96)
    identity_hint: str | None = Field(default=None, max_length=256)
    label: str | None = Field(default=None, max_length=256)


class PresenceWatchPatch(BaseModel):
    label: str | None = Field(default=None, max_length=256)
    enabled: bool | None = None


class IdentityDecisionCreate(BaseModel):
    entity_key: str = Field(min_length=1, max_length=256)
    target_entity_key: str | None = Field(default=None, max_length=256)
    action: Literal["confirm", "reject", "split", "label", "ignore", "watch"]
    canonical_key: str | None = Field(default=None, max_length=256)
    label: str | None = Field(default=None, max_length=256)
    reason: str | None = Field(default=None, max_length=1000)


class InvestigationNoteCreate(BaseModel):
    entity_key: str = Field(min_length=1, max_length=256)
    note: str = Field(min_length=1, max_length=2000)
    disposition: Literal["note", "watch", "important", "resolved"] = "note"


class PresenceEntityAnnotationCreate(BaseModel):
    note: str | None = Field(default=None, min_length=1, max_length=2000)
    disposition: Literal["note", "watch", "important", "resolved"] = "note"
    label: str | None = Field(default=None, min_length=1, max_length=256)


class PlaybookRunCreate(BaseModel):
    entity_key: str | None = Field(default=None, min_length=1, max_length=256)
    sensor_id: str | None = Field(default=None, min_length=1, max_length=96)
    note: str | None = Field(default=None, max_length=1000)


def decision_state_for_action(action: str) -> str:
    return {
        "confirm": "confirmed",
        "reject": "rejected",
        "split": "split",
        "label": "labeled",
        "ignore": "ignored",
        "watch": "watching",
    }.get(action, action)


def identity_decision_to_dict(decision: PresenceIdentityDecision) -> dict:
    return {
        "id": decision.id,
        "entity_key": decision.entity_key,
        "target_entity_key": decision.target_entity_key,
        "action": decision.action,
        "decision_state": decision_state_for_action(decision.action),
        "canonical_key": decision.canonical_key,
        "label": decision.label,
        "reason": decision.reason,
        "created_at": decision.created_at,
    }


def active_watch_keys(session: Session) -> set[str]:
    return set(
        session.execute(select(PresenceWatchlist.entity_key).where(PresenceWatchlist.enabled.is_(True))).scalars().all()
    )


@router.get("/identity-decisions")
def list_presence_identity_decisions(
    entity_key: str | None = Query(default=None, max_length=256),
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(PresenceIdentityDecision).order_by(PresenceIdentityDecision.created_at.desc()).limit(limit)
    if entity_key:
        stmt = stmt.where(
            or_(
                PresenceIdentityDecision.entity_key == entity_key,
                PresenceIdentityDecision.target_entity_key == entity_key,
            )
        )
    items = session.execute(stmt).scalars().all()
    return {"items": [identity_decision_to_dict(item) for item in items], "count": len(items)}


@router.post("/identity-decisions", status_code=status.HTTP_201_CREATED)
def create_presence_identity_decision(payload: IdentityDecisionCreate, session: Session = Depends(get_session)) -> dict:
    if session.get(CurrentState, payload.entity_key) is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    decision = PresenceIdentityDecision(
        entity_key=payload.entity_key,
        target_entity_key=payload.target_entity_key,
        action=payload.action,
        canonical_key=payload.canonical_key,
        label=payload.label,
        reason=payload.reason,
    )
    session.add(decision)
    session.commit()
    return identity_decision_to_dict(decision)


@router.get("/candidates")
def list_presence_candidates(
    limit: int = Query(default=500, ge=1, le=1000),
    scope: Literal["trackable", "all"] = "trackable",
    watch_mode: str | None = Query(default=None, max_length=64),
    source: str | None = None,
    kind: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    if watch_mode and watch_mode_by_id(watch_mode) is None:
        raise HTTPException(status_code=400, detail="unknown presence watch mode")
    row_limit = 1000 if scope == "trackable" else limit
    stmt = select(CurrentState).order_by(CurrentState.last_seen_at.desc())
    if watch_mode == "airspace":
        stmt = stmt.where(or_(CurrentState.protocol == "adsb", CurrentState.kind == "aircraft"))
    if watch_mode == "rail":
        stmt = stmt.where(or_(CurrentState.protocol == "rail", CurrentState.kind == "rail_activity", CurrentState.source == "rail_rf"))
    if source:
        stmt = stmt.where(CurrentState.source == source)
    if kind:
        stmt = stmt.where(CurrentState.kind == kind)
    stmt = stmt.limit(row_limit)
    tracked = active_watch_keys(session)
    states = session.execute(stmt).scalars().all()
    if scope == "trackable":
        states = [state for state in states if is_trackable_candidate(state)]
    states = [state for state in states if state_matches_watch_mode(state, watch_mode, tracked=state.state_key in tracked)]
    candidates = [state_candidate(state, tracked=state.state_key in tracked) for state in states]
    limited_candidates = candidates[:limit]
    return {
        "items": limited_candidates,
        "count": len(limited_candidates),
        "total_count": len(candidates),
        "category_counts": dict(Counter(candidate["category"] for candidate in candidates)),
        "watch_mode": watch_mode,
    }


@router.get("/watch-modes")
def list_presence_watch_modes() -> dict:
    return {"items": WATCH_MODES, "count": len(WATCH_MODES)}


@router.get("/playbooks")
def list_presence_playbooks() -> dict:
    return {"items": PRESENCE_PLAYBOOKS, "count": len(PRESENCE_PLAYBOOKS)}


@router.post("/playbooks/{playbook_id}/runs", status_code=status.HTTP_202_ACCEPTED)
def run_presence_playbook(
    playbook_id: str,
    payload: PlaybookRunCreate,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    playbook = next((item for item in PRESENCE_PLAYBOOKS if item["id"] == playbook_id), None)
    if playbook is None:
        raise HTTPException(status_code=404, detail="presence playbook not found")
    state = session.get(CurrentState, payload.entity_key) if payload.entity_key else None
    if payload.entity_key and state is None:
        raise HTTPException(status_code=404, detail="presence entity not found")

    event = Event(
        type="presence_playbook_run",
        severity=str(playbook["severity"]),
        confidence=0.8,
        zone_id=state.zone_id if state is not None else None,
        summary=f"Playbook queued: {playbook['label']}",
        observation_refs=[],
        payload={
            "playbook_id": playbook["id"],
            "playbook_label": playbook["label"],
            "entity_key": payload.entity_key,
            "sensor_id": payload.sensor_id,
            "note": payload.note,
        },
    )
    session.add(event)
    session.commit()
    publish_event(event, request.app.state.settings)
    return serialize_event(event)


@router.get("/watchlist")
def list_presence_watchlist(session: Session = Depends(get_session)) -> dict:
    items = session.execute(select(PresenceWatchlist).order_by(PresenceWatchlist.updated_at.desc())).scalars().all()
    return {"items": [watchlist_to_dict(item) for item in items], "count": len(items)}


@router.post("/watchlist", status_code=status.HTTP_201_CREATED)
def create_presence_watch(payload: PresenceWatchCreate, session: Session = Depends(get_session)) -> dict:
    existing = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.entity_key == payload.entity_key)
    ).scalar_one_or_none()
    if existing is not None:
        existing.enabled = True
        if payload.label:
            existing.label = payload.label
        existing.updated_at = datetime.now(UTC)
        session.commit()
        return watchlist_to_dict(existing)

    state = session.get(CurrentState, payload.entity_key)
    if state is None and not all([payload.source, payload.protocol, payload.kind]):
        raise HTTPException(
            status_code=404,
            detail="entity_key is not in current state; include source, protocol, and kind to track it manually",
        )

    item = PresenceWatchlist(
        entity_key=payload.entity_key,
        entity_type=payload.entity_type or (state_candidate(state)["entity_type"] if state else "state"),
        source=payload.source or state.source,  # type: ignore[union-attr]
        protocol=payload.protocol or state.protocol,  # type: ignore[union-attr]
        kind=payload.kind or state.kind,  # type: ignore[union-attr]
        identity_hint=payload.identity_hint if payload.identity_hint is not None else (state.identity_hint if state else None),
        label=payload.label or (label_for_state(state) if state else payload.entity_key),
        enabled=True,
    )
    session.add(item)
    session.commit()
    return watchlist_to_dict(item)


@router.patch("/watchlist/{watchlist_id}")
def update_presence_watch(watchlist_id: str, payload: PresenceWatchPatch, session: Session = Depends(get_session)) -> dict:
    item = session.get(PresenceWatchlist, watchlist_id)
    if item is None:
        raise HTTPException(status_code=404, detail="watchlist item not found")
    if payload.label is not None:
        item.label = payload.label
    if payload.enabled is not None:
        item.enabled = payload.enabled
    item.updated_at = datetime.now(UTC)
    session.commit()
    return watchlist_to_dict(item)


@router.delete("/watchlist/{watchlist_id}", status_code=204)
def delete_presence_watch(watchlist_id: str, session: Session = Depends(get_session)) -> None:
    item = session.get(PresenceWatchlist, watchlist_id)
    if item is None:
        raise HTTPException(status_code=404, detail="watchlist item not found")
    item.enabled = False
    item.updated_at = datetime.now(UTC)
    session.commit()


@router.get("/sightings")
def list_presence_sightings(
    limit: int = Query(default=200, ge=1, le=1000),
    watchlist_id: str | None = None,
    entity_key: str | None = None,
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(PresenceSighting).order_by(PresenceSighting.timestamp.desc()).limit(limit)
    if watchlist_id:
        stmt = stmt.where(PresenceSighting.watchlist_id == watchlist_id)
    if entity_key:
        stmt = stmt.where(PresenceSighting.entity_key == entity_key)
    items = session.execute(stmt).scalars().all()
    return {"items": [sighting_to_dict(item) for item in items], "count": len(items)}


@router.get("/summary")
def list_presence_summary(session: Session = Depends(get_session)) -> dict:
    watchlist_items = session.execute(
        select(PresenceWatchlist).where(PresenceWatchlist.enabled.is_(True)).order_by(PresenceWatchlist.updated_at.desc())
    ).scalars()
    items = []
    for item in watchlist_items:
        sightings = session.execute(
            select(PresenceSighting)
            .where(PresenceSighting.watchlist_id == item.id)
            .order_by(PresenceSighting.timestamp.desc())
            .limit(250)
        ).scalars().all()
        current_state = session.get(CurrentState, item.entity_key)
        latest = sightings[0] if sightings else None
        items.append(
            {
                **watchlist_to_dict(item),
                "sighting_count": len(sightings),
                "last_seen_at": latest.timestamp if latest else (current_state.last_seen_at if current_state else None),
                "first_seen_at": sightings[-1].timestamp if sightings else (current_state.first_seen_at if current_state else None),
                "last_rssi": latest.rssi if latest else None,
                "current_state": state_candidate(current_state, tracked=True) if current_state else None,
            }
        )
    return {"items": items, "count": len(items)}


@router.get("/co-presence")
def list_presence_co_presence(
    window_minutes: int = Query(default=5, ge=1, le=60),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> dict:
    items = co_presence_clusters(session, window_minutes=window_minutes, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/airspace/lanes")
def list_airspace_lanes(
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> dict:
    items = airspace_lane_memory(session, limit=limit)
    return {"items": items, "count": len(items)}


def investigation_note_to_dict(note: InvestigationNote) -> dict:
    return {
        "id": note.id,
        "entity_key": note.entity_key,
        "note": note.note,
        "disposition": note.disposition,
        "created_at": note.created_at,
    }


@router.get("/cases/notes")
def list_investigation_notes(
    entity_key: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    stmt = select(InvestigationNote).order_by(InvestigationNote.created_at.desc()).limit(limit)
    if entity_key:
        stmt = stmt.where(InvestigationNote.entity_key == entity_key)
    items = session.execute(stmt).scalars().all()
    return {"items": [investigation_note_to_dict(item) for item in items], "count": len(items)}


@router.post("/cases/notes", status_code=status.HTTP_201_CREATED)
def create_investigation_note(payload: InvestigationNoteCreate, session: Session = Depends(get_session)) -> dict:
    if session.get(CurrentState, payload.entity_key) is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    note = InvestigationNote(entity_key=payload.entity_key, note=payload.note, disposition=payload.disposition)
    session.add(note)
    session.commit()
    return investigation_note_to_dict(note)


@router.get("/graph")
def get_presence_link_graph(
    limit: int = Query(default=200, ge=1, le=500),
    mode: Literal["presence", "rf", "airspace", "rail", "iot", "cellular", "alerts", "all"] = "all",
    watch_mode: str | None = Query(default=None, max_length=64),
    session: Session = Depends(get_session),
) -> dict:
    if watch_mode and watch_mode_by_id(watch_mode) is None:
        raise HTTPException(status_code=400, detail="unknown presence watch mode")
    return presence_link_graph(session, limit=limit, mode=mode, watch_mode=watch_mode)


@router.get("/graph/timeline")
def get_presence_graph_timeline(
    entity_key: str = Query(min_length=1, max_length=256),
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    items = presence_graph_timeline(session, entity_key, limit=limit)
    return {"items": items, "count": len(items), "order": "newest_first"}


@router.get("/graph/causal-alerts")
def get_presence_alert_causal_graph(
    window_seconds: int = Query(default=300, ge=30, le=3600),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
) -> dict:
    items = alert_entity_causal_graph(session, window_seconds=window_seconds, limit=limit)
    return {"items": items, "count": len(items), "window_seconds": window_seconds}


@router.get("/spectrum/occupancy")
def get_spectrum_occupancy(
    limit: int = Query(default=40, ge=1, le=200),
    session: Session = Depends(get_session),
) -> dict:
    items = spectrum_occupancy(session, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/rf-bursts")
def get_rf_burst_swarms(
    window_seconds: int = Query(default=120, ge=10, le=3600),
    minimum_entities: int = Query(default=5, ge=2, le=100),
    limit: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
) -> dict:
    items = rf_burst_swarms(session, window_seconds=window_seconds, minimum_entities=minimum_entities, limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/briefing/changes")
def get_change_briefing(
    window_seconds: int = Query(default=300, ge=30, le=86400),
    session: Session = Depends(get_session),
) -> dict:
    return change_briefing(session, window_seconds=window_seconds)



@router.get("/patterns/analytics")
def get_presence_pattern_analytics(
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
) -> dict:
    return presence_pattern_analytics(session, limit=limit)

@router.get("/history/audit")
def get_presence_history_audit(session: Session = Depends(get_session)) -> dict:
    return presence_history_audit(session)


@router.get("/changes/feed")
def get_presence_change_feed(
    window_seconds: int = Query(default=300, ge=3, le=86400),
    limit: int = Query(default=50, ge=1, le=200),
    session: Session = Depends(get_session),
) -> dict:
    return presence_change_feed(session, window_seconds=window_seconds, limit=limit)


@router.get("/sensor-coverage")
def get_sensor_coverage(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    return sensor_coverage(session, limit=limit)


@router.get("/sensor-trust")
def get_sensor_trust_heatmap(
    limit: int = Query(default=100, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    return sensor_trust_heatmap(session, limit=limit)


@router.get("/search")
def search_presence_investigation(
    q: str = Query(min_length=1, max_length=256),
    limit: int = Query(default=25, ge=1, le=100),
    session: Session = Depends(get_session),
) -> dict:
    items = investigation_search(session, q, limit=limit)
    return {"items": items, "count": len(items)}


@router.post("/entities/{entity_key}/annotations", status_code=status.HTTP_201_CREATED)
def create_presence_entity_annotation(
    entity_key: str,
    payload: PresenceEntityAnnotationCreate,
    session: Session = Depends(get_session),
) -> dict:
    if session.get(CurrentState, entity_key) is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    if not payload.note and not payload.label:
        raise HTTPException(status_code=400, detail="note or label is required")
    note = InvestigationNote(entity_key=entity_key, note=payload.note, disposition=payload.disposition) if payload.note else None
    label_decision = PresenceIdentityDecision(entity_key=entity_key, action="label", label=payload.label, reason="operator annotation") if payload.label else None
    if note is not None:
        session.add(note)
    if label_decision is not None:
        session.add(label_decision)
    session.commit()
    notes = session.execute(select(InvestigationNote).where(InvestigationNote.entity_key == entity_key).order_by(InvestigationNote.created_at.desc()).limit(100)).scalars().all()
    return {
        "entity_key": entity_key,
        "note": investigation_note_to_dict(note) if note is not None else None,
        "label_decision": identity_decision_to_dict(label_decision) if label_decision is not None else None,
        "notes": {"items": [investigation_note_to_dict(item) for item in notes], "count": len(notes)},
        "decision_state": identity_decision_summary(session, entity_key),
    }


@router.get("/entities/{entity_key}/intelligence")
def get_presence_entity_intelligence(
    entity_key: str,
    limit: int = Query(default=120, ge=1, le=500),
    session: Session = Depends(get_session),
) -> dict:
    intelligence = presence_entity_intelligence(session, entity_key, limit=limit)
    if intelligence is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    return intelligence


@router.get("/entities/{entity_key}/investigation")
def get_presence_entity_investigation(entity_key: str, session: Session = Depends(get_session)) -> dict:
    investigation = presence_entity_investigation(session, entity_key)
    if investigation is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    return investigation


@router.get("/entities/{entity_key}/dossier")
def get_presence_entity_dossier(entity_key: str, session: Session = Depends(get_session)) -> dict:
    dossier = entity_dossier(session, entity_key)
    if dossier is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    return dossier


@router.get("/entities/{entity_key}")
def get_presence_entity_detail(entity_key: str, session: Session = Depends(get_session)) -> dict:
    detail = presence_entity_detail(session, entity_key)
    if detail is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    return detail


@router.post("/entities/{entity_key}/enrichment", status_code=status.HTTP_201_CREATED)
def run_presence_entity_enrichment(entity_key: str, request: Request, session: Session = Depends(get_session)) -> dict:
    result = run_entity_enrichment(session, entity_key)
    if result is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    enrichment, event = result
    publish_event(event, request.app.state.settings)
    return {
        "id": enrichment.id,
        "entity_key": enrichment.entity_key,
        "status": enrichment.status,
        "mode": enrichment.mode,
        "summary": enrichment.summary,
        "targets": enrichment.targets_json or [],
        "findings": enrichment.findings_json or [],
        "created_at": enrichment.created_at,
    }


@router.get("/entities/{entity_key}/replay")
def get_presence_entity_replay(
    entity_key: str,
    limit: int = Query(default=200, ge=1, le=1000),
    session: Session = Depends(get_session),
) -> dict:
    if session.get(CurrentState, entity_key) is None:
        raise HTTPException(status_code=404, detail="presence entity not found")
    items = entity_replay_frames(session, entity_key, limit=limit)
    return {"items": items, "count": len(items)}
