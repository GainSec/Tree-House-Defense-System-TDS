"""add compact current state samples"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_current_state_samples"
down_revision: str | None = "0005_presence_enrichments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "current_state_samples",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("state_key", sa.String(length=256), sa.ForeignKey("current_state.state_key"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("kind", sa.String(length=96), nullable=False),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("identity_hint", sa.String(length=256), nullable=True),
        sa.Column("sensor_id", sa.String(length=96), nullable=True),
        sa.Column("zone_id", sa.String(length=96), nullable=True),
        sa.Column("rssi", sa.Integer(), nullable=True),
        sa.Column("payload_hash", sa.String(length=256), nullable=False),
        sa.Column("observation_id", sa.String(length=96), sa.ForeignKey("observations.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_current_state_samples_state_time", "current_state_samples", ["state_key", "timestamp"])
    op.create_index("ix_current_state_samples_source_time", "current_state_samples", ["source", "timestamp"])


def downgrade() -> None:
    op.drop_index("ix_current_state_samples_source_time", table_name="current_state_samples")
    op.drop_index("ix_current_state_samples_state_time", table_name="current_state_samples")
    op.drop_table("current_state_samples")
