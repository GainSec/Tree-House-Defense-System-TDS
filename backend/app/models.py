import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex}"


def utcnow() -> datetime:
    return datetime.now(UTC)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(96), ForeignKey("zones.id"), nullable=True)
    health: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Collector(Base):
    __tablename__ = "collectors"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    health: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Integration(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    kind: Mapped[str] = mapped_column(String(64), nullable=False)
    health: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("dev"))
    label: Mapped[str | None] = mapped_column(String(160), nullable=True)
    known: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Identity(Base):
    __tablename__ = "identities"

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("ident"))
    device_id: Mapped[str | None] = mapped_column(String(96), ForeignKey("devices.id"), nullable=True)
    hint: Mapped[str] = mapped_column(String(256), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Rule(Base):
    __tablename__ = "rules"

    id: Mapped[str] = mapped_column(String(96), primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("obs"))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    sensor_id: Mapped[str] = mapped_column(String(96), nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    identity_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    rssi: Mapped[int] = mapped_column(Integer, nullable=False)
    known: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CurrentState(Base):
    __tablename__ = "current_state"

    state_key: Mapped[str] = mapped_column(String(256), primary_key=True)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    kind: Mapped[str] = mapped_column(String(96), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    identity_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sensor_id: Mapped[str] = mapped_column(String(96), nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    last_observation_id: Mapped[str | None] = mapped_column(String(96), ForeignKey("observations.id"), nullable=True)
    seen_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    metadata_json: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class CurrentStateSample(Base):
    __tablename__ = "current_state_samples"
    __table_args__ = (
        Index("ix_current_state_samples_state_time", "state_key", "timestamp"),
        Index("ix_current_state_samples_source_time", "source", "timestamp"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("sample"))
    state_key: Mapped[str] = mapped_column(String(256), ForeignKey("current_state.state_key"), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    kind: Mapped[str] = mapped_column(String(96), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    identity_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sensor_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    zone_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    observation_id: Mapped[str | None] = mapped_column(String(96), ForeignKey("observations.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PresenceWatchlist(Base):
    __tablename__ = "presence_watchlist"
    __table_args__ = (
        Index("ix_presence_watchlist_enabled", "enabled"),
        Index("ix_presence_watchlist_source_kind", "source", "kind"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("watch"))
    entity_key: Mapped[str] = mapped_column(String(256), unique=True, nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(96), nullable=False)
    identity_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    label: Mapped[str] = mapped_column(String(256), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class PresenceSighting(Base):
    __tablename__ = "presence_sightings"
    __table_args__ = (
        Index("ix_presence_sightings_watchlist_time", "watchlist_id", "timestamp"),
        Index("ix_presence_sightings_entity_time", "entity_key", "timestamp"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("sighting"))
    watchlist_id: Mapped[str] = mapped_column(String(96), ForeignKey("presence_watchlist.id"), nullable=False)
    entity_key: Mapped[str] = mapped_column(String(256), nullable=False)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    source: Mapped[str] = mapped_column(String(96), nullable=False)
    protocol: Mapped[str] = mapped_column(String(32), nullable=False)
    kind: Mapped[str] = mapped_column(String(96), nullable=False)
    identity_hint: Mapped[str | None] = mapped_column(String(256), nullable=True)
    sensor_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    zone_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    rssi: Mapped[int | None] = mapped_column(Integer, nullable=True)
    evidence_json: Mapped[dict] = mapped_column("evidence", JSON, default=dict, nullable=False)
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class InvestigationNote(Base):
    __tablename__ = "investigation_notes"
    __table_args__ = (
        Index("ix_investigation_notes_entity_time", "entity_key", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("note"))
    entity_key: Mapped[str] = mapped_column(String(256), nullable=False)
    note: Mapped[str] = mapped_column(String(2000), nullable=False)
    disposition: Mapped[str] = mapped_column(String(32), default="note", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PresenceIdentityDecision(Base):
    __tablename__ = "presence_identity_decisions"
    __table_args__ = (
        Index("ix_presence_identity_decisions_entity_time", "entity_key", "created_at"),
        Index("ix_presence_identity_decisions_target_time", "target_entity_key", "created_at"),
        Index("ix_presence_identity_decisions_action", "action"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("decision"))
    entity_key: Mapped[str] = mapped_column(String(256), nullable=False)
    target_entity_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    canonical_key: Mapped[str | None] = mapped_column(String(256), nullable=True)
    label: Mapped[str | None] = mapped_column(String(256), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class PresenceEnrichment(Base):
    __tablename__ = "presence_enrichments"
    __table_args__ = (
        Index("ix_presence_enrichments_entity_time", "entity_key", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("enrich"))
    entity_key: Mapped[str] = mapped_column(String(256), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    mode: Mapped[str] = mapped_column(String(64), nullable=False)
    summary: Mapped[str] = mapped_column(String(512), nullable=False)
    targets_json: Mapped[list] = mapped_column("targets", JSON, default=list, nullable=False)
    findings_json: Mapped[list] = mapped_column("findings", JSON, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class AircraftMetadata(Base):
    __tablename__ = "aircraft_metadata"
    __table_args__ = (
        Index("ix_aircraft_metadata_registration", "registration"),
        Index("ix_aircraft_metadata_type", "aircraft_type"),
    )

    icao_hex: Mapped[str] = mapped_column(String(16), primary_key=True)
    registration: Mapped[str | None] = mapped_column(String(64), nullable=True)
    aircraft_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    operator: Mapped[str | None] = mapped_column(String(256), nullable=True)
    source: Mapped[str] = mapped_column(String(96), default="tar1090-db", nullable=False)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(96), primary_key=True, default=lambda: new_id("evt"))
    type: Mapped[str] = mapped_column(String(96), nullable=False)
    severity: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    zone_id: Mapped[str | None] = mapped_column(String(96), nullable=True)
    summary: Mapped[str] = mapped_column(String(512), nullable=False)
    observation_refs: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


@event.listens_for(Observation, "before_update")
@event.listens_for(CurrentStateSample, "before_update")
@event.listens_for(PresenceSighting, "before_update")
@event.listens_for(InvestigationNote, "before_update")
@event.listens_for(PresenceEnrichment, "before_update")
@event.listens_for(PresenceIdentityDecision, "before_update")
@event.listens_for(Event, "before_update")
def prevent_append_only_update(mapper, connection, target):
    raise ValueError(f"{target.__class__.__name__} records are append-only")
