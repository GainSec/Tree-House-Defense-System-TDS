"""add presence tracking tables"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_presence_tracking"
down_revision: str | None = "0002_current_state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "presence_watchlist",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("entity_key", sa.String(length=256), nullable=False, unique=True),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=96), nullable=False),
        sa.Column("identity_hint", sa.String(length=256), nullable=True),
        sa.Column("label", sa.String(length=256), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presence_watchlist_enabled", "presence_watchlist", ["enabled"])
    op.create_index("ix_presence_watchlist_source_kind", "presence_watchlist", ["source", "kind"])

    op.create_table(
        "presence_sightings",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("watchlist_id", sa.String(length=96), sa.ForeignKey("presence_watchlist.id"), nullable=False),
        sa.Column("entity_key", sa.String(length=256), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=96), nullable=False),
        sa.Column("identity_hint", sa.String(length=256), nullable=True),
        sa.Column("sensor_id", sa.String(length=96), nullable=True),
        sa.Column("zone_id", sa.String(length=96), nullable=True),
        sa.Column("rssi", sa.Integer(), nullable=True),
        sa.Column("evidence", sa.JSON(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presence_sightings_watchlist_time", "presence_sightings", ["watchlist_id", "timestamp"])
    op.create_index("ix_presence_sightings_entity_time", "presence_sightings", ["entity_key", "timestamp"])


def downgrade() -> None:
    op.drop_index("ix_presence_sightings_entity_time", table_name="presence_sightings")
    op.drop_index("ix_presence_sightings_watchlist_time", table_name="presence_sightings")
    op.drop_table("presence_sightings")
    op.drop_index("ix_presence_watchlist_source_kind", table_name="presence_watchlist")
    op.drop_index("ix_presence_watchlist_enabled", table_name="presence_watchlist")
    op.drop_table("presence_watchlist")
