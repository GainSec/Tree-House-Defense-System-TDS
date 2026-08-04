from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Collector, CurrentState, Event, Integration, Observation, Rule, Sensor, Zone
from app.mqtt import serialize_event

router = APIRouter(prefix="/v1/dashboard", tags=["dashboard"])


def count_model(session: Session, model) -> int:
    return session.execute(select(func.count()).select_from(model)).scalar_one()


@router.get("/summary")
def dashboard_summary(session: Session = Depends(get_session)) -> dict:
    recent_events = session.execute(select(Event).order_by(Event.created_at.desc()).limit(10)).scalars().all()
    unknown_events = session.execute(
        select(func.count()).select_from(Event).where(Event.type == "unknown_device_nearby")
    ).scalar_one()
    return {
        "counts": {
            "observations": count_model(session, Observation),
            "current_state": count_model(session, CurrentState),
            "events": count_model(session, Event),
            "unknown_events": unknown_events,
            "sensors": count_model(session, Sensor),
            "zones": count_model(session, Zone),
            "collectors": count_model(session, Collector),
            "integrations": count_model(session, Integration),
            "rules": count_model(session, Rule),
        },
        "recent_events": [serialize_event(event) for event in recent_events],
    }
