from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from .market_provider import get_quote
from .market_snapshot import load_snapshot, save_snapshot


MAJOR_STOCKS = [
    ("AAPL", "Apple", "Tecnología"),
    ("MSFT", "Microsoft", "Tecnología"),
    ("NVDA", "NVIDIA", "Tecnología"),
    ("AMZN", "Amazon", "Consumo"),
    ("GOOGL", "Alphabet", "Comunicación"),
    ("META", "Meta", "Comunicación"),
    ("BRK-B", "Berkshire", "Finanzas"),
    ("AVGO", "Broadcom", "Tecnología"),
    ("TSLA", "Tesla", "Consumo"),
    ("JPM", "JPMorgan", "Finanzas"),
    ("WMT", "Walmart", "Consumo"),
    ("LLY", "Eli Lilly", "Salud"),
]

INDEXES = [
    ("^GSPC", "S&P 500"),
    ("^IXIC", "Nasdaq"),
    ("^DJI", "Dow Jones"),
    ("^VIX", "VIX"),
]

CACHE_SECONDS = 10 * 60


def _quote_row(symbol: str) -> tuple[dict[str, Any], str | None, str | None]:
    quote = get_quote(symbol)
    if not quote:
        return {
            "price": None,
            "previous_close": None,
            "change_percent": None,
        }, None, None
    return {
        "price": quote.get("price"),
        "previous_close": quote.get("previous_close"),
        "change_percent": quote.get("change_percent"),
    }, quote.get("source"), quote.get("fetched_at")


def _cached_market_cap(symbol: str) -> tuple[float | None, str | None, str | None]:
    fundamentals = load_snapshot("fundamentals", symbol, 24 * 60 * 60)
    if not isinstance(fundamentals, dict):
        return None, None, None
    return (
        fundamentals.get("market_cap"),
        fundamentals.get("source"),
        fundamentals.get("fetched_at"),
    )


def _build_payload() -> dict[str, Any]:
    stocks: list[dict[str, Any]] = []
    indices: list[dict[str, Any]] = []
    provenance: dict[str, Any] = {}

    for symbol, company, sector in MAJOR_STOCKS:
        quote, quote_source, quote_fetched_at = _quote_row(symbol)
        market_cap, fundamentals_source, fundamentals_fetched_at = _cached_market_cap(symbol)
        stocks.append({
            "ticker": symbol,
            "company": company,
            "sector": sector,
            "price": quote["price"],
            "previous_close": quote["previous_close"],
            "change_percent": quote["change_percent"],
            "market_cap": market_cap,
        })
        provenance[symbol] = {
            "quote_source": quote_source,
            "quote_fetched_at": quote_fetched_at,
            "fundamentals_source": fundamentals_source,
            "fundamentals_fetched_at": fundamentals_fetched_at,
        }

    for symbol, name in INDEXES:
        quote, quote_source, quote_fetched_at = _quote_row(symbol)
        indices.append({
            "ticker": symbol,
            "name": name,
            "price": quote["price"],
            "previous_close": quote["previous_close"],
            "change_percent": quote["change_percent"],
            "market_cap": None,
        })
        provenance[symbol] = {
            "quote_source": quote_source,
            "quote_fetched_at": quote_fetched_at,
        }

    if not any(row.get("price") is not None for row in stocks + indices):
        raise HTTPException(
            status_code=503,
            detail=(
                "No fue posible obtener cotizaciones vigentes del panorama de mercado "
                "desde Yahoo Finance ni desde Alpha Vantage."
            ),
        )

    valid_changes = [
        row["change_percent"]
        for row in stocks
        if row.get("change_percent") is not None
    ]
    advancing = sum(1 for value in valid_changes if value > 0)
    declining = sum(1 for value in valid_changes if value < 0)
    sorted_stocks = sorted(
        [row for row in stocks if row.get("change_percent") is not None],
        key=lambda row: row["change_percent"],
        reverse=True,
    )

    return {
        "stocks": stocks,
        "indices": indices,
        "leaders": sorted_stocks[:3],
        "laggards": list(reversed(sorted_stocks[-3:])),
        "breadth": {
            "advancing": advancing,
            "declining": declining,
            "unchanged": max(0, len(valid_changes) - advancing - declining),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_seconds": CACHE_SECONDS,
        "source": "Yahoo Finance primary; Alpha Vantage fallback",
        "stale": False,
        "warning": None,
        "provenance": provenance,
        "note": (
            "Cada valor conserva su fuente y momento de consulta. Los campos no "
            "verificados dentro de su ventana de vigencia se muestran como no disponibles."
        ),
    }


def market_overview(force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        cached = load_snapshot("market_overview", "default", CACHE_SECONDS)
        if isinstance(cached, dict):
            return cached

    payload = _build_payload()
    save_snapshot("market_overview", "default", payload)
    return payload
