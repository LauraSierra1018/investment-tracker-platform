from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from .market_provider import (
    get_fundamentals,
    get_history as provider_history,
    get_quote,
    search_yahoo,
)
from .scoring import evaluate


def safe_num(value: Any, scale: float = 1.0) -> float | None:
    try:
        if value is None:
            return None
        return float(value) / scale
    except (TypeError, ValueError):
        return None


def _normalize_symbol(ticker: str) -> str:
    symbol = str(ticker or "").strip().upper()
    if not symbol or len(symbol) > 20:
        raise HTTPException(status_code=400, detail="Ticker inválido")
    return symbol


def get_stock(ticker: str) -> dict[str, Any]:
    symbol = _normalize_symbol(ticker)

    fundamentals = get_fundamentals(symbol)
    quote = get_quote(symbol)

    if fundamentals is None and quote is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "No fue posible obtener información vigente del activo desde "
                "Yahoo Finance ni desde Alpha Vantage."
            ),
        )

    fundamentals = fundamentals or {}
    quote = quote or {}

    price = safe_num(quote.get("price"))
    previous_close = safe_num(quote.get("previous_close"))
    change_percent = safe_num(quote.get("change_percent"))

    target = safe_num(fundamentals.get("target_price"))
    shares = safe_num(fundamentals.get("shares_outstanding"))
    float_shares = safe_num(fundamentals.get("float_shares"))

    free_float = (
        float_shares / shares * 100
        if shares not in (None, 0) and float_shares is not None
        else None
    )
    upside = (
        (target - price) / price * 100
        if target is not None and price not in (None, 0)
        else None
    )

    metrics = {
        "market_cap_b": safe_num(fundamentals.get("market_cap"), 1e9),
        "pe_ratio": safe_num(fundamentals.get("pe_ratio")),
        "revenue_m": safe_num(fundamentals.get("revenue"), 1e6),
        "free_float_pct": free_float,
        "upside_pct": upside,
        "revenue_growth_pct": safe_num(fundamentals.get("revenue_growth_pct")),
        "earnings_growth_pct": safe_num(fundamentals.get("earnings_growth_pct")),
        "roe_pct": safe_num(fundamentals.get("roe_pct")),
        "roa_pct": safe_num(fundamentals.get("roa_pct")),
        "operating_margin_pct": safe_num(fundamentals.get("operating_margin_pct")),
        "debt_to_equity": safe_num(fundamentals.get("debt_to_equity")),
        "current_ratio": safe_num(fundamentals.get("current_ratio")),
        "free_cash_flow_m": safe_num(fundamentals.get("free_cash_flow"), 1e6),
        "beta": safe_num(fundamentals.get("beta")),
    }

    score, classification, criteria, strengths, risks, missing = evaluate(metrics)

    quote_source = quote.get("source")
    fundamentals_source = fundamentals.get("source")
    sources = [source for source in (quote_source, fundamentals_source) if source]
    source = " + ".join(dict.fromkeys(sources)) if sources else "Proveedor de mercado"

    fetched_candidates = [
        value
        for value in (
            quote.get("fetched_at"),
            fundamentals.get("fetched_at"),
        )
        if value
    ]
    updated_at = max(fetched_candidates) if fetched_candidates else None

    return {
        "ticker": symbol,
        "company": fundamentals.get("company") or symbol,
        "description": fundamentals.get("description"),
        "exchange": fundamentals.get("exchange"),
        "currency": fundamentals.get("currency") or "USD",
        "quote_type": fundamentals.get("quote_type"),
        "sector": fundamentals.get("sector"),
        "industry": fundamentals.get("industry"),
        "price": price,
        "previous_close": previous_close,
        "change_percent": change_percent,
        "daily_change_percent": change_percent,
        "target_price": target,
        "upside_percent": upside,
        "upside_pct": upside,
        "market_cap": safe_num(fundamentals.get("market_cap")),
        "pe_ratio": metrics["pe_ratio"],
        "revenue": safe_num(fundamentals.get("revenue")),
        "revenue_millions": metrics["revenue_m"],
        "free_float_percent": free_float,
        "volume": safe_num(quote.get("volume") or fundamentals.get("volume")),
        "average_volume": safe_num(fundamentals.get("average_volume")),
        "beta": metrics["beta"],
        "revenue_growth_pct": metrics["revenue_growth_pct"],
        "earnings_growth_pct": metrics["earnings_growth_pct"],
        "roe_pct": metrics["roe_pct"],
        "roa_pct": metrics["roa_pct"],
        "operating_margin_pct": metrics["operating_margin_pct"],
        "debt_to_equity": metrics["debt_to_equity"],
        "current_ratio": metrics["current_ratio"],
        "free_cash_flow_m": metrics["free_cash_flow_m"],
        "score": score,
        "classification": classification,
        "criteria": criteria,
        "strengths": strengths,
        "risks": risks,
        "missing_data": missing,
        "updated_at": updated_at,
        "source": source,
        "stale": False,
        "warning": None,
        "provenance": {
            "quote": {
                "provider": quote.get("provider"),
                "source": quote_source,
                "fetched_at": quote.get("fetched_at"),
            },
            "fundamentals": {
                "provider": fundamentals.get("provider"),
                "source": fundamentals_source,
                "fetched_at": fundamentals.get("fetched_at"),
            },
        },
    }


def search(query: str):
    q = str(query or "").strip()
    if not q:
        return []
    results = search_yahoo(q)
    if results:
        return results
    return [{"ticker": q.upper(), "name": q.upper(), "exchange": None, "type": "Stock"}]


def history(ticker: str, period: str = "1y"):
    symbol = _normalize_symbol(ticker)
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y"}
    if period not in allowed:
        period = "1y"

    interval = "1wk" if period == "5y" else "1d"
    data = provider_history(symbol, period, interval)
    if data is None:
        raise HTTPException(
            status_code=503,
            detail=(
                "No fue posible obtener un histórico vigente desde Yahoo Finance "
                "ni desde Alpha Vantage."
            ),
        )
    return [
        {
            "date": point.get("date", "").split("T")[0],
            "close": point.get("close"),
            "volume": point.get("volume"),
        }
        for point in data["points"]
    ]


def clear_market_cache(ticker: str | None = None):
    # El caché canónico es persistente y expira por política de vigencia.
    # No se elimina aquí para evitar forzar llamadas externas innecesarias.
    return None
