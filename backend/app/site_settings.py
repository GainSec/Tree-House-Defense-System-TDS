from typing import Any

from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.models import Rule

SITE_SETTINGS_RULE_ID = "control_site_settings"
DEFAULT_SITE_SETTINGS = {
    "latitude": 0.0,
    "longitude": 0.0,
    "label": "TDS Lab",
    "floor_heading_degrees": 0.0,
}


class SiteSettingsPayload(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    label: str | None = None
    floor_heading_degrees: float = Field(default=0.0, ge=-360, le=360)

    @field_validator("label")
    @classmethod
    def clean_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


def site_settings_response(config: dict[str, Any] | None = None, *, source: str = "defaults") -> dict[str, Any]:
    merged = {**DEFAULT_SITE_SETTINGS, **(config or {})}
    return {
        "latitude": float(merged["latitude"]),
        "longitude": float(merged["longitude"]),
        "label": str(merged.get("label") or DEFAULT_SITE_SETTINGS["label"]),
        "floor_heading_degrees": float(merged.get("floor_heading_degrees") or 0.0),
        "source": source,
    }


def get_site_settings(session: Session) -> dict[str, Any]:
    rule = session.get(Rule, SITE_SETTINGS_RULE_ID)
    if rule is None or not rule.config:
        return site_settings_response()
    return site_settings_response(rule.config, source="saved")
