"""add daily logs

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-25 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'a7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'daily_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('log_date', sa.Date(), nullable=False),
        sa.Column('data', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.UniqueConstraint('user_id', 'log_date', name='uq_daily_logs_user_date'),
    )
    op.create_index('ix_daily_logs_user_id', 'daily_logs', ['user_id'])
    op.create_index('ix_daily_logs_log_date', 'daily_logs', ['log_date'])


def downgrade() -> None:
    op.drop_index('ix_daily_logs_log_date', table_name='daily_logs')
    op.drop_index('ix_daily_logs_user_id', table_name='daily_logs')
    op.drop_table('daily_logs')
