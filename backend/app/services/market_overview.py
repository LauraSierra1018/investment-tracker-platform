from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from .market_requests import market_budget

from fastapi import HTTPException

from .market_provider import get_quotes
from .market_data.common import provenance as data_provenance
from .market_snapshot import load_snapshot, save_snapshot, load_snapshots


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

CACHE_SECONDS = 60


def _cached_market_cap(symbol: str, snapshots: dict) -> tuple[float | None, str | None, str | None]:
    fundamentals = snapshots.get(symbol)
    if not isinstance(fundamentals, dict):
        return None, None, None
    return (
        fundamentals.get("market_cap"),
        fundamentals.get("source"),
        fundamentals.get("fetched_at"),
    )


def _build_payload() -> dict[str, Any]:
    all_symbols = [symbol for symbol, _, _ in MAJOR_STOCKS] + [
        symbol for symbol, _ in INDEXES
    ]
    quotes = get_quotes(all_symbols)
    fundamentals = load_snapshots("md_fundamentals", [s for s, _, _ in MAJOR_STOCKS], 24 * 60 * 60)

    stocks: list[dict[str, Any]] = []
    indices: list[dict[str, Any]] = []
    provenance: dict[str, Any] = {}

    for symbol, company, sector in MAJOR_STOCKS:
        quote = quotes.get(symbol) or {}
        market_cap, fundamentals_source, fundamentals_fetched_at = _cached_market_cap(symbol, fundamentals)
        stocks.append({
            "ticker": symbol,
            "company": company,
            "sector": sector,
            "price": quote.get("price"),
            "previous_close": quote.get("previous_close"),
            "change_percent": quote.get("change_percent"),
            "market_cap": market_cap,
            "stale": quote.get("stale", False),
            "data_timestamp": quote.get("data_timestamp"),
        })
        provenance[symbol] = {
            "quote_source": quote.get("source"),
            "quote": data_provenance(quote),
            "quote_fetched_at": quote.get("fetched_at"),
            "fundamentals_source": fundamentals_source,
            "fundamentals_fetched_at": fundamentals_fetched_at,
        }

    for symbol, name in INDEXES:
        quote = quotes.get(symbol) or {}
        indices.append({
            "ticker": symbol,
            "name": name,
            "price": quote.get("price"),
            "previous_close": quote.get("previous_close"),
            "change_percent": quote.get("change_percent"),
            "market_cap": None,
            "stale": quote.get("stale", False),
            "data_timestamp": quote.get("data_timestamp"),
        })
        provenance[symbol] = {
            "quote_source": quote.get("source"),
            "quote": data_provenance(quote),
            "quote_fetched_at": quote.get("fetched_at"),
        }

    if not any(row.get("price") is not None for row in stocks + indices):
        raise HTTPException(
            status_code=503,
            detail=(
                "No fue posible obtener cotizaciones vigentes del panorama de mercado "
                "desde los proveedores configurados."
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
        "updated_at": max((q.get("retrieved_at") or q.get("fetched_at") or "" for q in quotes.values()), default=None),
        "refresh_seconds": 10 if any(q.get("stale") for q in quotes.values()) or len(quotes) < len(all_symbols) else CACHE_SECONDS,
        "source": " + ".join(sorted({q["source"] for q in quotes.values() if q.get("source")})),
        "stale": any(q.get("stale") for q in quotes.values()),
        "warning": "Algunas cotizaciones son el último dato guardado." if any(q.get("stale") for q in quotes.values()) else None,
        "provenance": provenance,
        "note": (
            "Cada valor conserva su fuente y momento de consulta. Los campos no "
            "verificados dentro de su ventana de vigencia se muestran como no disponibles."
        ),
    }


@market_budget
def market_overview(force_refresh: bool = False) -> dict[str, Any]:
    if not force_refresh:
        cached = load_snapshot("market_overview", "multi_provider_v1", CACHE_SECONDS)
        if isinstance(cached, dict) and (cached.get("stale") or cached.get("refresh_seconds") == 10):
            # Do not hide completed background quotes behind a minute-old partial composite.
            cached = load_snapshot("market_overview", "multi_provider_v1", 10)
        if isinstance(cached, dict):
            return cached

    payload = _build_payload()
    save_snapshot("market_overview", "multi_provider_v1", payload)
    return payload
