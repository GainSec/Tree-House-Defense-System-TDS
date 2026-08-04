"""add aircraft metadata table"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_aircraft_metadata"
down_revision: str | None = "0006_current_state_samples"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "aircraft_metadata",
        sa.Column("icao_hex", sa.String(length=16), primary_key=True),
        sa.Column("registration", sa.String(length=64), nullable=True),
        sa.Column("aircraft_type", sa.String(length=64), nullable=True),
        sa.Column("operator", sa.String(length=256), nullable=True),
        sa.Column("source", sa.String(length=96), nullable=False),
        sa.Column("raw_json", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_aircraft_metadata_registration", "aircraft_metadata", ["registration"])
    op.create_index("ix_aircraft_metadata_type", "aircraft_metadata", ["aircraft_type"])


def downgrade() -> None:
    op.drop_index("ix_aircraft_metadata_type", table_name="aircraft_metadata")
    op.drop_index("ix_aircraft_metadata_registration", table_name="aircraft_metadata")
    op.drop_table("aircraft_metadata")
