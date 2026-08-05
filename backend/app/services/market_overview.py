from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any
import math
import time

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

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

CACHE_SECONDS = 600

_cache: dict[str, Any] = {
    "expires": 0.0,
    "data": None,
}

_lock = Lock()


def _num(value: Any) -> float | None:
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except (TypeError, ValueError):
        pass
    return None


def _empty_quote() -> dict[str, float | None]:
    return {
        "price": None,
        "previous_close": None,
        "change_percent": None,
        "market_cap": None,
    }


def _extract_series(
    frame: pd.DataFrame,
    field: str,
    symbol: str,
) -> pd.Series | None:
    if frame is None or frame.empty:
        return None

    try:
        if isinstance(frame.columns, pd.MultiIndex):
            if (field, symbol) in frame.columns:
                return frame[(field, symbol)].dropna()

            if (symbol, field) in frame.columns:
                return frame[(symbol, field)].dropna()

        if field in frame.columns:
            return frame[field].dropna()
    except Exception:
        return None

    return None


def _batch_quotes(
    symbols: list[str],
) -> dict[str, dict[str, float | None]]:
    if not symbols:
        return {}

    try:
        frame = yf.download(
            tickers=symbols,
            period="5d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            group_by="column",
            threads=False,
        )
    except Exception as exc:
        raise RuntimeError(
            f"No fue posible descargar las cotizaciones: {exc}"
        ) from exc

    output: dict[str, dict[str, float | None]] = {}

    for symbol in symbols:
        quote = _empty_quote()

        closes = _extract_series(
            frame=frame,
            field="Close",
            symbol=symbol,
        )

        if closes is not None and not closes.empty:
            quote["price"] = _num(closes.iloc[-1])

            if len(closes) >= 2:
                quote["previous_close"] = _num(closes.iloc[-2])

        price = quote["price"]
        previous_close = quote["previous_close"]

        if (
            price is not None
            and previous_close not in (None, 0)
        ):
            quote["change_percent"] = (
                (price - previous_close)
                / previous_close
                * 100
            )

        output[symbol] = quote

    return output


def _market_caps(
    symbols: list[str],
) -> dict[str, float | None]:
    result: dict[str, float | None] = {}

    for symbol in symbols:
        try:
            fast = yf.Ticker(symbol).fast_info
            result[symbol] = _num(
                getattr(fast, "market_cap", None)
            )
        except Exception:
            result[symbol] = None

    return result


def _build_payload() -> dict[str, Any]:
    stock_symbols = [symbol for symbol, _, _ in MAJOR_STOCKS]
    index_symbols = [symbol for symbol, _ in INDEXES]
    all_symbols = stock_symbols + index_symbols

    quotes = _batch_quotes(all_symbols)
    market_caps = _market_caps(stock_symbols)

    stocks: list[dict[str, Any]] = []

    for symbol, company, sector in MAJOR_STOCKS:
        quote = quotes.get(symbol, _empty_quote())

        stocks.append(
            {
                "ticker": symbol,
                "company": company,
                "sector": sector,
                "price": quote["price"],
                "previous_close": quote["previous_close"],
                "change_percent": quote["change_percent"],
                "market_cap": market_caps.get(symbol),
            }
        )

    indices: list[dict[str, Any]] = []

    for symbol, name in INDEXES:
        quote = quotes.get(symbol, _empty_quote())

        indices.append(
            {
                "ticker": symbol,
                "name": name,
                "price": quote["price"],
                "previous_close": quote["previous_close"],
                "change_percent": quote["change_percent"],
                "market_cap": None,
            }
        )

    valid_changes = [
        stock["change_percent"]
        for stock in stocks
        if stock["change_percent"] is not None
    ]

    advancing = sum(1 for value in valid_changes if value > 0)
    declining = sum(1 for value in valid_changes if value < 0)

    sorted_stocks = sorted(
        [
            stock
            for stock in stocks
            if stock["change_percent"] is not None
        ],
        key=lambda item: item["change_percent"],
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
            "unchanged": max(
                0,
                len(valid_changes) - advancing - declining,
            ),
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "refresh_seconds": CACHE_SECONDS,
        "source": "Yahoo Finance via yfinance",
        "stale": False,
        "warning": None,
        "note": (
            "Las cotizaciones pueden ser en tiempo real o presentar retraso "
            "según la bolsa y el instrumento."
        ),
    }


def market_overview(
    force_refresh: bool = False,
) -> dict[str, Any]:
    now = time.time()

    if (
        not force_refresh
        and _cache["data"] is not None
        and now < _cache["expires"]
    ):
        return _cache["data"]

    with _lock:
        now = time.time()

        if (
            not force_refresh
            and _cache["data"] is not None
            and now < _cache["expires"]
        ):
            return _cache["data"]

        try:
            payload = _build_payload()

            _cache["data"] = payload
            _cache["expires"] = time.time() + CACHE_SECONDS

            return payload

        except Exception as exc:
            print(
                "Error actualizando panorama de mercado:",
                repr(exc),
            )

            if _cache["data"] is not None:
                stale_payload = {
                    **_cache["data"],
                    "stale": True,
                    "warning": (
                        "El proveedor de mercado limitó temporalmente las "
                        "consultas. Se muestra la última información disponible."
                    ),
                }

                _cache["expires"] = time.time() + 60
                return stale_payload

            raise HTTPException(
                status_code=503,
                detail=(
                    "El proveedor de mercado está limitando temporalmente "
                    "las consultas y todavía no existe información en caché. "
                    "Espera unos minutos e inténtalo de nuevo."
                ),
            ) from exc