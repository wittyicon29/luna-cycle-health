"""encrypt health text columns

Revision ID: d4e5f6a7b8c9
Revises: 9569df628839
Create Date: 2026-10-24 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'd4e5f6a7b8c9'
down_revision = '9569df628839'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # JSON -> TEXT so the columns can hold "enc:v1:<token>" values. Existing rows keep
    # their plaintext JSON and are re-encrypted the next time they are written.
    op.alter_column(
        'questionnaires', 'responses',
        existing_type=postgresql.JSON(astext_type=sa.Text()),
        type_=sa.Text(),
        existing_nullable=False,
        postgresql_using='responses::text',
    )
    op.alter_column(
        'analyses', 'input_data',
        existing_type=postgresql.JSON(astext_type=sa.Text()),
        type_=sa.Text(),
        existing_nullable=True,
        postgresql_using='input_data::text',
    )


def downgrade() -> None:
    raise NotImplementedError(
        "Encrypted rows cannot be converted back to JSON; restore from a backup instead."
    )
