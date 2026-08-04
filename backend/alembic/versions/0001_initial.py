"""initial canonical TDS schema"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "zones",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "sensors",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("zone_id", sa.String(length=96), sa.ForeignKey("zones.id"), nullable=True),
        sa.Column("health", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "collectors",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("health", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "integrations",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("health", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "devices",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("label", sa.String(length=160), nullable=True),
        sa.Column("known", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "identities",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("device_id", sa.String(length=96), sa.ForeignKey("devices.id"), nullable=True),
        sa.Column("hint", sa.String(length=256), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "rules",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("config", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "observations",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), nullable=False),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("sensor_id", sa.String(length=96), nullable=False),
        sa.Column("zone_id", sa.String(length=96), nullable=True),
        sa.Column("protocol", sa.String(length=32), nullable=False),
        sa.Column("identity_hint", sa.String(length=256), nullable=True),
        sa.Column("rssi", sa.Integer(), nullable=False),
        sa.Column("known", sa.Boolean(), nullable=False),
        sa.Column("metadata", sa.JSON(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "events",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("type", sa.String(length=96), nullable=False),
        sa.Column("severity", sa.String(length=32), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("zone_id", sa.String(length=96), nullable=True),
        sa.Column("summary", sa.String(length=512), nullable=False),
        sa.Column("observation_refs", sa.JSON(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    for table in [
        "events",
        "observations",
        "rules",
        "identities",
        "devices",
        "integrations",
        "collectors",
        "sensors",
        "zones",
    ]:
        op.drop_table(table)
