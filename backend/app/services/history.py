from __future__ import annotations

from datetime import datetime
from typing import Any

import yfinance as yf
from fastapi import HTTPException


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
    """Return chart-ready OHLCV history for a Yahoo Finance ticker."""
    symbol = ticker.strip().upper()
    requested = range_key.strip().upper()

    if not symbol:
        raise HTTPException(status_code=400, detail="Ticker requerido.")

    if requested not in RANGE_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=f"Rango inválido. Usa uno de: {', '.join(RANGE_CONFIG)}",
        )

    period, interval = RANGE_CONFIG[requested]

    try:
        frame = yf.Ticker(symbol).history(
            period=period,
            interval=interval,
            auto_adjust=False,
            actions=False,
            prepost=False,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible consultar el histórico de {symbol}: {exc}",
        ) from exc

    if frame is None or frame.empty:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron precios históricos para {symbol}.",
        )

    points: list[dict[str, Any]] = []

    for index, row in frame.iterrows():
        try:
            dt = index.to_pydatetime() if hasattr(index, "to_pydatetime") else index
        except Exception:
            dt = index

        if isinstance(dt, datetime):
            timestamp = dt.isoformat()
        else:
            timestamp = str(dt)

        close = _number(row.get("Close"))
        if close is None:
            continue

        points.append(
            {
                "date": timestamp,
                "open": _number(row.get("Open")),
                "high": _number(row.get("High")),
                "low": _number(row.get("Low")),
                "close": close,
                "volume": _integer(row.get("Volume")),
            }
        )

    if not points:
        raise HTTPException(
            status_code=404,
            detail=f"No se encontraron precios utilizables para {symbol}.",
        )

    first_close = points[0]["close"]
    last_close = points[-1]["close"]
    change_percent = None

    if first_close not in (None, 0) and last_close is not None:
        change_percent = ((last_close - first_close) / first_close) * 100

    return {
        "ticker": symbol,
        "range": requested,
        "period": period,
        "interval": interval,
        "currency": getattr(yf.Ticker(symbol), "fast_info", {}).get("currency"),
        "first_close": first_close,
        "last_close": last_close,
        "change_percent": change_percent,
        "points": points,
        "source": "Yahoo Finance via yfinance",
    }


def _number(value: Any) -> float | None:
    try:
        if value is None:
            return None
        number = float(value)
        if number != number:  # NaN
            return None
        return number
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    number = _number(value)
    return int(number) if number is not None else None
