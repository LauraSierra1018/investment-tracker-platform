from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from .market_provider import get_history as provider_history
from .market_data.common import provenance


RANGE_CONFIG: dict[str, tuple[str, str]] = {
    "1D": ("1d", "5m"),
    "5D": ("5d", "15m"),
    "1M": ("1mo", "1d"),
    "6M": ("6mo", "1d"),
    "YTD": ("ytd", "1d"),
    "1Y": ("1y", "1d"),
    "5Y": ("5y", "1wk"),
}


def get_price_history(ticker: str, range_key: str = "1M") -> dict[str, Any]:
    symbol = str(ticker or "").strip().upper()
    requested = str(range_key or "").strip().upper()

    if not symbol:
        raise HTTPException(status_code=400, detail="Ticker requerido.")
    if requested not in RANGE_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=f"Rango inválido. Usa uno de: {', '.join(RANGE_CONFIG)}",
        )

    period, interval = RANGE_CONFIG[requested]
    data = provider_history(symbol, period, interval)

    if data is None:
        detail = (
            f"No hay un histórico verificado disponible para {symbol}."
        )
        raise HTTPException(status_code=503, detail=detail)

    points = data.get("points") or []
    if not points:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron precios utilizables para {symbol}.",
        )

    first_close = points[0].get("close")
    last_close = points[-1].get("close")
    change_percent = (
        ((last_close - first_close) / first_close) * 100
        if first_close not in (None, 0) and last_close is not None
        else None
    )

    return {
        "ticker": symbol,
        "range": requested,
        "period": period,
        "interval": interval,
        "currency": data.get("currency"),
        "first_close": first_close,
        "last_close": last_close,
        "change_percent": change_percent,
        "points": points,
        "provider": data.get("provider"),
        "source": data.get("source"),
        "fetched_at": data.get("fetched_at"),
        "retrieved_at": data.get("retrieved_at"),
        "data_timestamp": data.get("data_timestamp"),
        "price_basis": data.get("price_basis"),
        "coverage": data.get("coverage"),
        "provenance": provenance(data),
        "stale": data.get("stale", False),
        "warning": data.get("warning"),
    }
