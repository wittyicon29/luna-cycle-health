"""add subscriptions

Revision ID: a1b2c3d4e5f6
Revises: a7b8c9d0e1f2
Create Date: 2026-11-01 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a1b2c3d4e5f6'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'subscriptions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('product_id', sa.String(), nullable=False),
        sa.Column('purchase_token', sa.Text(), nullable=False),
        sa.Column('token_hash', sa.String(64), nullable=False),
        sa.Column('state', sa.String(), nullable=False),
        sa.Column('expiry_time', sa.DateTime(), nullable=False),
        sa.Column('auto_renewing', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('acknowledged', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('last_verified_at', sa.DateTime(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
    )
    op.create_index('ix_subscriptions_user_id', 'subscriptions', ['user_id'], unique=True)
    op.create_index('ix_subscriptions_token_hash', 'subscriptions', ['token_hash'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_subscriptions_token_hash', table_name='subscriptions')
    op.drop_index('ix_subscriptions_user_id', table_name='subscriptions')
    op.drop_table('subscriptions')
