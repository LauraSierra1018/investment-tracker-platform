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