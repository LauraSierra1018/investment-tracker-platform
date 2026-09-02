\
from __future__ import annotations

from collections import defaultdict
from typing import Any
import math

import yfinance as yf

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import PortfolioPosition, WatchlistItem
from .market import get_stock


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None

        number = float(value)

        if math.isnan(number) or math.isinf(number):
            return None

        return number
    except (TypeError, ValueError):
        return None


def user_positions(db: Session, user_id: str):
    return list(
        db.scalars(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .order_by(PortfolioPosition.created_at.asc())
        )
    )


def user_watchlist(db: Session, user_id: str):
    return list(
        db.scalars(
            select(WatchlistItem)
            .where(WatchlistItem.user_id == user_id)
            .order_by(WatchlistItem.created_at.desc())
        )
    )


def enrich_positions(positions):
    result = []

    for position in positions:
        try:
            stock = get_stock(position.ticker)
        except Exception:
            stock = {}

        price = safe_float(stock.get("price"))
        invested = float(position.quantity) * float(position.average_cost)
        market_value = (
            float(position.quantity) * price
            if price is not None
            else invested
        )

        result.append(
            {
                "ticker": position.ticker,
                "quantity": float(position.quantity),
                "invested": invested,
                "market_value": market_value,
                "sector": stock.get("sector") or "Sin sector",
                "score": safe_float(stock.get("score")),
                "beta": safe_float(stock.get("beta")),
                "pe_ratio": safe_float(stock.get("pe_ratio")),
                "revenue_growth": safe_float(stock.get("revenue_growth")),
                "earnings_growth": safe_float(stock.get("earnings_growth")),
            }
        )

    return result


def allocations(enriched):
    total = sum(x["market_value"] for x in enriched)

    if total <= 0:
        return [], []

    assets = [
        {
            "ticker": x["ticker"],
            "value": round(x["market_value"], 2),
            "percent": round(x["market_value"] / total * 100, 2),
        }
        for x in enriched
    ]

    assets.sort(key=lambda x: x["percent"], reverse=True)

    sectors = defaultdict(float)

    for x in enriched:
        sectors[x["sector"]] += x["market_value"]

    sector_rows = [
        {
            "sector": sector,
            "value": round(value, 2),
            "percent": round(value / total * 100, 2),
        }
        for sector, value in sectors.items()
    ]

    sector_rows.sort(key=lambda x: x["percent"], reverse=True)

    return assets, sector_rows


def health(enriched, assets, sectors):
    if not enriched:
        return {
            "diversification_score": 0,
            "concentration_score": 0,
            "quality_score": 0,
            "growth_score": 0,
            "risk_label": "Sin datos",
            "largest_position_percent": 0,
            "top3_concentration_percent": 0,
        }, []

    largest = assets[0]["percent"] if assets else 0
    top3 = sum(x["percent"] for x in assets[:3])

    diversification = min(
        100,
        len(assets) * 18
        + min(len(sectors), 4) * 10
        - max(0, largest - 25),
    )

    concentration = max(
        0,
        100
        - max(0, largest - 20) * 1.8
        - max(0, top3 - 60),
    )

    total = sum(x["market_value"] for x in enriched)

    quality_num = 0.0
    quality_den = 0.0
    growth_values = []
    beta_num = 0.0
    beta_den = 0.0

    for x in enriched:
        weight = x["market_value"] / total if total > 0 else 0

        if x["score"] is not None:
            quality_num += x["score"] * weight
            quality_den += weight

        for field in ("revenue_growth", "earnings_growth"):
            value = x[field]

            if value is not None:
                value = value * 100 if abs(value) <= 2 else value
                growth_values.append(value)

        if x["beta"] is not None:
            beta_num += x["beta"] * weight
            beta_den += weight

    quality = quality_num / quality_den if quality_den else 50

    if growth_values:
        avg_growth = sum(growth_values) / len(growth_values)
        growth_score = max(0, min(100, 50 + avg_growth * 1.5))
    else:
        growth_score = 50

    portfolio_beta = beta_num / beta_den if beta_den else None

    if portfolio_beta is None:
        risk_label = "Sin datos"
    elif portfolio_beta <= 0.9:
        risk_label = "Bajo"
    elif portfolio_beta <= 1.25:
        risk_label = "Moderado"
    else:
        risk_label = "Alto"

    alerts = []

    if largest >= 35:
        alerts.append(
            {
                "type": "warning",
                "text": f"La mayor posición representa {largest:.1f}% del portafolio.",
            }
        )
    elif largest > 0:
        alerts.append(
            {
                "type": "positive",
                "text": f"La mayor posición representa {largest:.1f}% del portafolio.",
            }
        )

    if sectors and sectors[0]["percent"] >= 45:
        alerts.append(
            {
                "type": "warning",
                "text": (
                    f"{sectors[0]['sector']} representa "
                    f"{sectors[0]['percent']:.1f}% del portafolio."
                ),
            }
        )

    if len(assets) < 3:
        alerts.append(
            {
                "type": "warning",
                "text": "El portafolio tiene pocas posiciones y una diversificación limitada.",
            }
        )
    elif len(assets) >= 5:
        alerts.append(
            {
                "type": "positive",
                "text": f"Tienes exposición a {len(assets)} activos diferentes.",
            }
        )

    return {
        "diversification_score": round(diversification, 1),
        "concentration_score": round(concentration, 1),
        "quality_score": round(quality, 1),
        "growth_score": round(growth_score, 1),
        "risk_label": risk_label,
        "largest_position_percent": round(largest, 2),
        "top3_concentration_percent": round(top3, 2),
    }, alerts


def candidate_score(stock, profile, current_sectors):
    score = safe_float(stock.get("score")) or 50
    beta = safe_float(stock.get("beta"))
    pe = safe_float(stock.get("pe_ratio"))
    revenue_growth = safe_float(stock.get("revenue_growth"))
    earnings_growth = safe_float(stock.get("earnings_growth"))
    sector = stock.get("sector")

    growth_values = []

    for value in (revenue_growth, earnings_growth):
        if value is not None:
            value = value * 100 if abs(value) <= 2 else value
            growth_values.append(value)

    growth = sum(growth_values) / len(growth_values) if growth_values else 0

    match = score * 0.55

    if sector and sector not in current_sectors:
        match += 15

    if profile == "conservative":
        if beta is not None and beta <= 1:
            match += 15
        if pe is not None and 0 < pe <= 30:
            match += 10

    elif profile == "moderate":
        if beta is not None and beta <= 1.35:
            match += 10
        if growth >= 10:
            match += 10
        if pe is not None and 0 < pe <= 35:
            match += 5

    else:
        if growth >= 20:
            match += 20
        elif growth >= 10:
            match += 12
        if beta is not None and beta >= 1:
            match += 5

    reasons = []
    cautions = []

    if score >= 70:
        reasons.append("Buen score fundamental.")
    if sector and sector not in current_sectors:
        reasons.append("Añade exposición a un sector distinto.")
    if growth >= 10:
        reasons.append("Crecimiento financiero atractivo.")
    if beta is not None and beta > 1.6:
        cautions.append("Volatilidad elevada.")
    if pe is not None and pe > 40:
        cautions.append("Valoración P/E elevada.")

    return int(max(0, min(100, round(match)))), reasons, cautions


def recommendations(db, user_id, profile, enriched):
    tickers_in_portfolio = {x["ticker"] for x in enriched}
    current_sectors = {x["sector"] for x in enriched}

    output = []

    for item in user_watchlist(db, user_id):
        if item.ticker in tickers_in_portfolio:
            continue

        try:
            stock = get_stock(item.ticker)
        except Exception:
            continue

        match, reasons, cautions = candidate_score(
            stock,
            profile,
            current_sectors,
        )

        output.append(
            {
                "ticker": stock.get("ticker") or item.ticker,
                "company": stock.get("company") or item.ticker,
                "match": match,
                "score": safe_float(stock.get("score")),
                "beta": safe_float(stock.get("beta")),
                "sector": stock.get("sector"),
                "reasons": reasons,
                "cautions": cautions,
            }
        )

    output.sort(key=lambda x: x["match"], reverse=True)

    return output[:10]


def build_analysis(db, user_id, profile):
    positions = user_positions(db, user_id)
    enriched = enrich_positions(positions)

    invested = sum(x["invested"] for x in enriched)
    market_value = sum(x["market_value"] for x in enriched)
    pnl = market_value - invested
    pnl_percent = pnl / invested * 100 if invested else 0

    assets, sectors = allocations(enriched)
    health_data, alerts = health(enriched, assets, sectors)

    return {
        "summary": {
            "market_value": round(market_value, 2),
            "invested": round(invested, 2),
            "pnl": round(pnl, 2),
            "pnl_percent": round(pnl_percent, 2),
            "positions": len(enriched),
            "sectors": len(sectors),
        },
        "health": health_data,
        "allocation_by_asset": assets,
        "allocation_by_sector": sectors,
        "alerts": alerts,
        "recommendations": recommendations(
            db,
            user_id,
            profile,
            enriched,
        ),
    }


PERIODS = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
}


def build_history(db, user_id, range_name):
    positions = user_positions(db, user_id)

    if not positions:
        return {"range": range_name, "points": []}

    period = PERIODS.get(range_name, "3mo")
    series = {}
    all_dates = set()

    for position in positions:
        try:
            frame = yf.Ticker(position.ticker).history(
                period=period,
                interval="1d",
                auto_adjust=False,
            )

            if frame.empty:
                continue

            closes = frame["Close"].dropna()

            if closes.empty:
                continue

            series[position.ticker] = (
                closes,
                float(position.quantity),
            )

            all_dates.update(closes.index)
        except Exception:
            continue

    last_prices = {}
    points = []

    for date in sorted(all_dates):
        total = 0.0
        has_value = False

        for ticker, (closes, quantity) in series.items():
            if date in closes.index:
                price = safe_float(closes.loc[date])

                if price is not None:
                    last_prices[ticker] = price

            price = last_prices.get(ticker)

            if price is not None:
                total += price * quantity
                has_value = True

        if has_value:
            dt = (
                date.to_pydatetime()
                if hasattr(date, "to_pydatetime")
                else date
            )

            points.append(
                {
                    "date": dt.isoformat(),
                    "value": round(total, 2),
                }
            )

    return {
        "range": range_name,
        "points": points,
    }
