from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from .market_provider import (
    get_fundamentals,
    get_history as provider_history,
    get_quote,
    search_yahoo,
)
from .market_snapshot import load_snapshot
from .scoring import evaluate


LEGACY_FUNDAMENTALS_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


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


def _legacy_stock(symbol: str) -> dict[str, Any]:
    """Read rich snapshots created by the previous market layer.

    They remain useful for slowly-changing fundamentals while the new provider
    cache is warming up. Quotes are never taken from this 7-day compatibility
    snapshot; current prices still come from the quote provider/cache.
    """
    cached = load_snapshot("stock", symbol, LEGACY_FUNDAMENTALS_MAX_AGE_SECONDS)
    return cached if isinstance(cached, dict) else {}


def _first(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def get_stock(ticker: str) -> dict[str, Any]:
    symbol = _normalize_symbol(ticker)

    fundamentals = get_fundamentals(symbol) or {}
    quote = get_quote(symbol) or {}
    legacy = _legacy_stock(symbol)

    if not fundamentals and not quote and not legacy:
        raise HTTPException(
            status_code=503,
            detail=(
                "No fue posible obtener información vigente del activo desde "
                "Yahoo Finance ni desde Alpha Vantage."
            ),
        )

    price = safe_num(quote.get("price"))
    previous_close = safe_num(quote.get("previous_close"))
    change_percent = safe_num(quote.get("change_percent"))

    target = safe_num(_first(fundamentals.get("target_price"), legacy.get("target_price")))
    shares = safe_num(fundamentals.get("shares_outstanding"))
    float_shares = safe_num(fundamentals.get("float_shares"))

    calculated_free_float = (
        float_shares / shares * 100
        if shares not in (None, 0) and float_shares is not None
        else None
    )
    free_float = _first(calculated_free_float, safe_num(legacy.get("free_float_percent")))
    upside = (
        (target - price) / price * 100
        if target is not None and price not in (None, 0)
        else safe_num(_first(legacy.get("upside_percent"), legacy.get("upside_pct")))
    )

    market_cap = safe_num(_first(fundamentals.get("market_cap"), legacy.get("market_cap")))
    revenue = safe_num(_first(fundamentals.get("revenue"), legacy.get("revenue")))
    legacy_fcf_m = safe_num(legacy.get("free_cash_flow_m"))
    free_cash_flow = safe_num(fundamentals.get("free_cash_flow"))

    metrics = {
        "market_cap_b": market_cap / 1e9 if market_cap is not None else None,
        "pe_ratio": safe_num(_first(fundamentals.get("pe_ratio"), legacy.get("pe_ratio"))),
        "revenue_m": revenue / 1e6 if revenue is not None else safe_num(legacy.get("revenue_millions")),
        "free_float_pct": free_float,
        "upside_pct": upside,
        "revenue_growth_pct": safe_num(_first(fundamentals.get("revenue_growth_pct"), legacy.get("revenue_growth_pct"))),
        "earnings_growth_pct": safe_num(_first(fundamentals.get("earnings_growth_pct"), legacy.get("earnings_growth_pct"))),
        "roe_pct": safe_num(_first(fundamentals.get("roe_pct"), legacy.get("roe_pct"))),
        "roa_pct": safe_num(_first(fundamentals.get("roa_pct"), legacy.get("roa_pct"))),
        "operating_margin_pct": safe_num(_first(fundamentals.get("operating_margin_pct"), legacy.get("operating_margin_pct"))),
        "debt_to_equity": safe_num(_first(fundamentals.get("debt_to_equity"), legacy.get("debt_to_equity"))),
        "current_ratio": safe_num(_first(fundamentals.get("current_ratio"), legacy.get("current_ratio"))),
        "free_cash_flow_m": free_cash_flow / 1e6 if free_cash_flow is not None else legacy_fcf_m,
        "beta": safe_num(_first(fundamentals.get("beta"), legacy.get("beta"))),
    }

    score, classification, criteria, strengths, risks, missing = evaluate(metrics)

    quote_source = quote.get("source")
    fundamentals_source = fundamentals.get("source")
    used_legacy = bool(legacy) and any(
        fundamentals.get(key) is None and legacy.get(legacy_key) is not None
        for key, legacy_key in (
            ("market_cap", "market_cap"),
            ("pe_ratio", "pe_ratio"),
            ("revenue", "revenue"),
            ("beta", "beta"),
        )
    )
    sources = [source for source in (quote_source, fundamentals_source) if source]
    if used_legacy:
        sources.append("Snapshot fundamental persistente")
    source = " + ".join(dict.fromkeys(sources)) if sources else "Snapshot fundamental persistente"

    fetched_candidates = [
        value
        for value in (
            quote.get("fetched_at"),
            fundamentals.get("fetched_at"),
            legacy.get("updated_at"),
        )
        if value
    ]
    updated_at = max(fetched_candidates) if fetched_candidates else legacy.get("updated_at")

    return {
        "ticker": symbol,
        "company": _first(fundamentals.get("company"), legacy.get("company"), symbol),
        "description": _first(fundamentals.get("description"), legacy.get("description")),
        "exchange": _first(fundamentals.get("exchange"), legacy.get("exchange")),
        "currency": _first(fundamentals.get("currency"), legacy.get("currency"), "USD"),
        "quote_type": _first(fundamentals.get("quote_type"), legacy.get("quote_type")),
        "sector": _first(fundamentals.get("sector"), legacy.get("sector")),
        "industry": _first(fundamentals.get("industry"), legacy.get("industry")),
        "price": price,
        "previous_close": previous_close,
        "change_percent": change_percent,
        "daily_change_percent": change_percent,
        "target_price": target,
        "upside_percent": upside,
        "upside_pct": upside,
        "market_cap": market_cap,
        "pe_ratio": metrics["pe_ratio"],
        "revenue": revenue,
        "revenue_millions": metrics["revenue_m"],
        "free_float_percent": free_float,
        "volume": safe_num(_first(quote.get("volume"), fundamentals.get("volume"), legacy.get("volume"))),
        "average_volume": safe_num(_first(fundamentals.get("average_volume"), legacy.get("average_volume"))),
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
                "provider": fundamentals.get("provider") or ("persistent_snapshot" if used_legacy else None),
                "source": fundamentals_source or ("Snapshot fundamental persistente" if used_legacy else None),
                "fetched_at": fundamentals.get("fetched_at") or legacy.get("updated_at"),
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
    return None
