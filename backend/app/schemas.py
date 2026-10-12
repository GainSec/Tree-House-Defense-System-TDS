from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


Protocol = Literal[
    "wifi",
    "ble",
    "bluetooth",
    "infrastructure",
    "router",
    "camera",
    "manual",
    "sdr",
    "adsb",
    "rtl433",
    "subghz",
    "utility",
    "rail",
    "lte",
    "cellular",
    "zigbee",
    "thread",
    "802154",
]


class ObservationCreate(BaseModel):
    timestamp: datetime
    source: str = Field(min_length=1, max_length=96)
    sensor_id: str = Field(min_length=1, max_length=96)
    zone_id: str | None = Field(default=None, max_length=96)
    protocol: Protocol
    identity_hint: str | None = Field(default=None, max_length=256)
    rssi: int = Field(ge=-127, le=20)
    known: bool = False
    metadata: dict = Field(default_factory=dict)
    raw_payload: dict


class ObservationRead(BaseModel):
    id: str
    timestamp: datetime
    source: str
    sensor_id: str
    zone_id: str | None
    protocol: str
    identity_hint: str | None
    rssi: int
    known: bool
    metadata: dict
    raw_payload: dict

    model_config = ConfigDict(from_attributes=True)


class EventRead(BaseModel):
    id: str
    type: str
    severity: str
    confidence: float
    zone_id: str | None
    summary: str
    observation_refs: list[str]
    payload: dict
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


RfMapCategory = Literal["wifi", "ble", "utility", "unknown_rf", "infrastructure", "aircraft", "rail", "iot", "cellular"]
LocationAccuracy = Literal["real", "estimated", "receiver"]
RfFreshness = Literal["live", "stale", "expired"]


class RfMapFeature(BaseModel):
    identity: str
    label: str
    protocol: str
    kind: str
    source: str
    category: RfMapCategory
    latitude: float
    longitude: float
    location_accuracy: LocationAccuracy
    estimated: bool
    rssi: int | None = None
    channel: str | None = None
    frequency: str | None = None
    manufacturer: str | None = None
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    count: int = 1
    freshness: RfFreshness
    operator_context: dict | None = None
    # Current-state key: presence dossier/enrichment routes are keyed by this, not by identity.
    state_key: str | None = None


class AircraftMapFeature(BaseModel):
    identity: str
    callsign: str
    model: str
    owner: str
    icao_type: str = ""
    registration: str = ""
    country: str = ""
    squawk: str = ""
    latitude: float
    longitude: float
    altitude: float | None = None
    speed: float | None = None
    heading: float
    source: str
    protocol: str
    first_seen_at: datetime | None = None
    last_seen_at: datetime | None = None
    count: int = 1
