from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)

from sqlalchemy.orm import (
    Mapped,
    mapped_column,
)

from .db import Base


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "ticker", name="watchlist_user_ticker_unique"),
    )


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False, index=True)
    ticker: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    average_cost: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class ResearchAsset(Base):
    __tablename__ = "research_assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(30), nullable=False, unique=True, index=True)
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    sector: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    industry: Mapped[str | None] = mapped_column(String(180), nullable=True)
    exchange: Mapped[str | None] = mapped_column(String(60), nullable=True)
    asset_type: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True, index=True)
    beta: Mapped[float | None] = mapped_column(Float, nullable=True)
    pe_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    upside_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    revenue_growth_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    earnings_growth_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    market_cap: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(default=True, nullable=False)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class MarketDataSnapshot(Base):
    """Persistent market cache shared by all backend instances.

    This prevents Render restarts and multiple workers from losing the latest
    usable market response. Payload is stored as JSON text so schema changes in
    provider responses do not require database migrations.
    """

    __tablename__ = "market_data_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    cache_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    payload: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, index=True)

    __table_args__ = (
        UniqueConstraint("kind", "cache_key", name="market_snapshot_kind_key_unique"),
    )


class SnapTradeUser(Base):
    __tablename__ = "snaptrade_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False, unique=True, index=True)
    snaptrade_user_id: Mapped[str] = mapped_column(String(180), nullable=False, unique=True, index=True)
    user_secret_encrypted: Mapped[str] = mapped_column(String(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class BrokerPosition(Base):
    __tablename__ = "broker_positions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False, index=True)
    account_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    authorization_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    ticker: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    average_cost: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="USD")
    company: Mapped[str | None] = mapped_column(String(255), nullable=True)
    asset_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "account_id", "ticker", name="broker_position_user_account_ticker_unique"),
    )
