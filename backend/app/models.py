from datetime import datetime
from sqlalchemy import String, Float, DateTime, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base

class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), index=True)
    label: Mapped[str] = mapped_column(String(80), default="Principal")
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("ticker", "label", name="uq_watchlist_ticker_label"),)

class PortfolioPosition(Base):
    __tablename__ = "portfolio_positions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticker: Mapped[str] = mapped_column(String(20), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    average_cost: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10), default="USD")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
