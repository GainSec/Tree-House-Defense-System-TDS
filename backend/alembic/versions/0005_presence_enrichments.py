"""add presence enrichments"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_presence_enrichments"
down_revision: str | None = "0004_investigation_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "presence_enrichments",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("entity_key", sa.String(length=256), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("mode", sa.String(length=64), nullable=False),
        sa.Column("summary", sa.String(length=512), nullable=False),
        sa.Column("targets", sa.JSON(), nullable=False),
        sa.Column("findings", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presence_enrichments_entity_time", "presence_enrichments", ["entity_key", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_presence_enrichments_entity_time", table_name="presence_enrichments")
    op.drop_table("presence_enrichments")
