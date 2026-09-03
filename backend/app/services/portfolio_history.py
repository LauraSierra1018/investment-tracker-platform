from __future__ import annotations

from collections import defaultdict
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BrokerPosition, PortfolioPosition
from .market_provider import get_history as provider_history


PERIODS = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
}


def _positions(db: Session, user_id: str):
    broker_rows = list(
        db.scalars(
            select(BrokerPosition)
            .where(BrokerPosition.user_id == user_id)
            .order_by(BrokerPosition.ticker.asc())
        )
    )
    if broker_rows:
        return broker_rows

    return list(
        db.scalars(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .order_by(PortfolioPosition.created_at.asc())
        )
    )


def _number(value: Any) -> float | None:
    try:
        number = float(value)
        if number == number:
            return number
    except (TypeError, ValueError):
        pass
    return None


def build_history(db: Session, user_id: str, range_name: str):
    positions = _positions(db, user_id)
    if not positions:
        return {
            "range": range_name,
            "points": [],
            "provenance": {},
        }

    period = PERIODS.get(range_name, "3mo")
    quantities: dict[str, float] = defaultdict(float)
    for position in positions:
        ticker = str(position.ticker or "").strip().upper()
        if ticker:
            quantities[ticker] += float(position.quantity)

    series: dict[str, tuple[dict[str, float], float]] = {}
    provenance: dict[str, Any] = {}
    unavailable: list[str] = []

    for ticker, quantity in sorted(quantities.items()):
        data = provider_history(ticker, period, "1d")
        if not data or not data.get("points"):
            unavailable.append(ticker)
            continue

        closes: dict[str, float] = {}
        for point in data["points"]:
            close = _number(point.get("close"))
            date = str(point.get("date") or "")[:10]
            if close is not None and date:
                closes[date] = close

        if not closes:
            unavailable.append(ticker)
            continue

        series[ticker] = (closes, quantity)
        provenance[ticker] = {
            "provider": data.get("provider"),
            "source": data.get("source"),
            "fetched_at": data.get("fetched_at"),
        }

    if unavailable:
        raise HTTPException(
            status_code=503,
            detail=(
                "No se puede reconstruir un histórico confiable del portafolio porque "
                "faltan datos vigentes para: " + ", ".join(unavailable)
            ),
        )

    all_dates = sorted(
        set().union(*(set(closes.keys()) for closes, _ in series.values()))
    )
    last_prices: dict[str, float] = {}
    points: list[dict[str, Any]] = []

    for date in all_dates:
        total = 0.0
        complete = True

        for ticker, (closes, quantity) in series.items():
            if date in closes:
                last_prices[ticker] = closes[date]
            price = last_prices.get(ticker)
            if price is None:
                complete = False
                break
            total += price * quantity

        if complete:
            points.append({
                "date": f"{date}T00:00:00",
                "value": round(total, 2),
            })

    return {
        "range": range_name,
        "points": points,
        "provenance": provenance,
        "source": "Yahoo Finance primary; Alpha Vantage fallback",
    }
