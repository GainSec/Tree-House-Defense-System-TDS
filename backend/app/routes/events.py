from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Event
from app.mqtt import serialize_event

router = APIRouter(prefix="/v1/events", tags=["events"])


@router.get("")
def list_events(limit: int = 100, zone_id: str | None = None, type: str | None = None, session: Session = Depends(get_session)) -> dict:
    stmt = select(Event).order_by(Event.created_at.desc()).limit(min(limit, 500))
    if zone_id:
        stmt = stmt.where(Event.zone_id == zone_id)
    if type:
        stmt = stmt.where(Event.type == type)
    events = session.execute(stmt).scalars().all()
    return {"items": [serialize_event(event) for event in events], "count": len(events)}
