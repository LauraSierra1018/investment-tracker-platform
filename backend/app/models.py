from datetime import datetime

from sqlalchemy import (
    DateTime,
    Float,
    Integer,
    String,
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

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    user_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        nullable=False,
        index=True,
    )

    ticker: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "ticker",
            name="watchlist_user_ticker_unique",
        ),
    )


class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    user_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        nullable=False,
        index=True,
    )

    ticker: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        index=True,
    )

    quantity: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    average_cost: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    currency: Mapped[str] = mapped_column(
        String(10),
        default="USD",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )



class ResearchAsset(Base):
    __tablename__ = "research_assets"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    ticker: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        unique=True,
        index=True,
    )

    company: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    sector: Mapped[str | None] = mapped_column(
        String(120),
        nullable=True,
        index=True,
    )

    industry: Mapped[str | None] = mapped_column(
        String(180),
        nullable=True,
    )

    exchange: Mapped[str | None] = mapped_column(
        String(60),
        nullable=True,
    )

    asset_type: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
        index=True,
    )

    score: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
        index=True,
    )

    beta: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    pe_ratio: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    upside_percent: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    revenue_growth_percent: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    earnings_growth_percent: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    market_cap: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    last_price: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    is_active: Mapped[bool] = mapped_column(
        default=True,
        nullable=False,
    )

    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        index=True,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )


class SnapTradeUser(Base):
    """
    Mapea un usuario autenticado de la app con su identidad Commercial en SnapTrade.

    El user_secret se almacena cifrado a nivel de aplicación; nunca debe enviarse
    al frontend.
    """
    __tablename__ = "snaptrade_users"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    user_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        nullable=False,
        unique=True,
        index=True,
    )

    snaptrade_user_id: Mapped[str] = mapped_column(
        String(180),
        nullable=False,
        unique=True,
        index=True,
    )

    user_secret_encrypted: Mapped[str] = mapped_column(
        String(1024),
        nullable=False,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )


class BrokerPosition(Base):
    """
    Copia normalizada y de solo lectura de las posiciones recibidas desde SnapTrade.

    La app usa estas filas para Portfolio Health y Research Opportunities.
    No representan órdenes y nunca se editan desde el frontend.
    """
    __tablename__ = "broker_positions"

    id: Mapped[int] = mapped_column(
        Integer,
        primary_key=True,
    )

    user_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        nullable=False,
        index=True,
    )

    account_id: Mapped[str] = mapped_column(
        String(80),
        nullable=False,
        index=True,
    )

    authorization_id: Mapped[str | None] = mapped_column(
        String(80),
        nullable=True,
        index=True,
    )

    ticker: Mapped[str] = mapped_column(
        String(60),
        nullable=False,
        index=True,
    )

    quantity: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )

    average_cost: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    currency: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        default="USD",
    )

    company: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    asset_type: Mapped[str | None] = mapped_column(
        String(40),
        nullable=True,
    )

    last_price: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "account_id",
            "ticker",
            name="broker_position_user_account_ticker_unique",
        ),
    )
