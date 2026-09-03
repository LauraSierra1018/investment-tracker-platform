from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import ResearchAsset


RESEARCH_DECISION_MAX_AGE = timedelta(hours=24)


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _first_present(stock: dict[str, Any], *keys: str):
    for key in keys:
        if key in stock and stock.get(key) is not None:
            return stock.get(key)
    return None


def upsert_research_asset(db: Session, stock: dict[str, Any]) -> ResearchAsset | None:
    ticker = str(stock.get("ticker") or "").strip().upper()
    if not ticker:
        return None

    asset = db.scalar(
        select(ResearchAsset).where(ResearchAsset.ticker == ticker)
    )

    now = datetime.now(timezone.utc)

    if asset is None:
        asset = ResearchAsset(
            ticker=ticker,
            first_seen_at=now,
        )
        db.add(asset)

    asset.company = stock.get("company") or ticker
    asset.sector = stock.get("sector")
    asset.industry = stock.get("industry")
    asset.exchange = stock.get("exchange")
    asset.asset_type = (
        stock.get("quote_type")
        or stock.get("asset_type")
        or stock.get("type")
        or "EQUITY"
    )
    asset.score = safe_float(stock.get("score"))
    asset.beta = safe_float(stock.get("beta"))
    asset.pe_ratio = safe_float(stock.get("pe_ratio"))
    asset.upside_percent = safe_float(
        _first_present(stock, "upside_percent", "upside_pct")
    )
    asset.revenue_growth_percent = safe_float(
        _first_present(stock, "revenue_growth_pct", "revenue_growth")
    )
    asset.earnings_growth_percent = safe_float(
        _first_present(stock, "earnings_growth_pct", "earnings_growth")
    )
    asset.market_cap = safe_float(stock.get("market_cap"))
    asset.last_price = safe_float(stock.get("price"))

    asset.last_seen_at = now
    asset.updated_at = now

    db.commit()
    db.refresh(asset)
    return asset


def list_research_candidates(
    db: Session,
    *,
    exclude_tickers: set[str] | None = None,
    limit: int = 80,
) -> list[ResearchAsset]:
    exclude_tickers = {x.upper() for x in (exclude_tickers or set())}
    cutoff = datetime.now(timezone.utc) - RESEARCH_DECISION_MAX_AGE

    rows = list(
        db.scalars(
            select(ResearchAsset)
            .where(
                ResearchAsset.is_active.is_(True),
                ResearchAsset.last_seen_at >= cutoff,
            )
            .order_by(
                ResearchAsset.score.desc().nullslast(),
                ResearchAsset.last_seen_at.desc(),
            )
            .limit(max(limit * 2, limit))
        )
    )

    result: list[ResearchAsset] = []

    for row in rows:
        if row.ticker.upper() in exclude_tickers:
            continue

        result.append(row)

        if len(result) >= limit:
            break

    return result
