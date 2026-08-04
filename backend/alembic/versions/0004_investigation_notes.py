"""add investigation notes"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_investigation_notes"
down_revision: str | None = "0003_presence_tracking"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "investigation_notes",
        sa.Column("id", sa.String(length=96), primary_key=True),
        sa.Column("entity_key", sa.String(length=256), nullable=False),
        sa.Column("note", sa.String(length=2000), nullable=False),
        sa.Column("disposition", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_investigation_notes_entity_time", "investigation_notes", ["entity_key", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_investigation_notes_entity_time", table_name="investigation_notes")
    op.drop_table("investigation_notes")
