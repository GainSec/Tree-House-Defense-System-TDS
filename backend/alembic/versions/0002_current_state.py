"""add current state table"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_current_state"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "current_state",
        sa.Column("state_key", sa.String(length=256), primary_key=True),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("kind", sa.String(length=96), nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("identity_hint", sa.String(length=256), nullable=True),
        sa.Column("sensor_id", sa.String(length=96), nullable=False),
        sa.Column("zone_id", sa.String(length=96), nullable=True),
        sa.Column("payload_hash", sa.String(length=256), nullable=False),
        sa.Column("last_observation_id", sa.String(length=96), sa.ForeignKey("observations.id"), nullable=True),
        sa.Column("seen_count", sa.Integer(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_current_state_source_kind", "current_state", ["source", "kind"])
    op.create_index("ix_current_state_last_seen_at", "current_state", ["last_seen_at"])


def downgrade() -> None:
    op.drop_index("ix_current_state_last_seen_at", table_name="current_state")
    op.drop_index("ix_current_state_source_kind", table_name="current_state")
    op.drop_table("current_state")
