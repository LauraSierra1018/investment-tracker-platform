from datetime import datetime, timezone
from threading import Lock
import math
import time

import yfinance as yf
from fastapi import HTTPException

# A compact, diversified set of widely-followed US large caps.
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

_cache = {"expires": 0.0, "data": None}
_lock = Lock()


def _num(value):
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _quote(symbol: str):
    ticker = yf.Ticker(symbol)
    fast = ticker.fast_info

    price = _num(getattr(fast, "last_price", None))
    previous_close = _num(getattr(fast, "previous_close", None))
    market_cap = _num(getattr(fast, "market_cap", None))

    if price is None or previous_close is None:
        hist = ticker.history(period="5d", interval="1d", auto_adjust=True)
        if hist is not None and not hist.empty:
            closes = hist["Close"].dropna()
            if price is None and len(closes) >= 1:
                price = _num(closes.iloc[-1])
            if previous_close is None and len(closes) >= 2:
                previous_close = _num(closes.iloc[-2])

    change = None
    if price is not None and previous_close not in (None, 0):
        change = (price - previous_close) / previous_close * 100

    return {
        "price": price,
        "previous_close": previous_close,
        "change_percent": change,
        "market_cap": market_cap,
    }


def market_overview():
    """Return a lightweight market dashboard payload.

    The response is cached briefly to avoid hammering Yahoo Finance when the
    browser refreshes the dashboard every few seconds.
    """
    now = time.time()
    if _cache["data"] is not None and now < _cache["expires"]:
        return _cache["data"]

    with _lock:
        now = time.time()
        if _cache["data"] is not None and now < _cache["expires"]:
            return _cache["data"]

        stocks = []
        indices = []

        try:
            for symbol, company, sector in MAJOR_STOCKS:
                q = _quote(symbol)
                stocks.append({
                    "ticker": symbol,
                    "company": company,
                    "sector": sector,
                    **q,
                })

            for symbol, name in INDEXES:
                q = _quote(symbol)
                indices.append({
                    "ticker": symbol,
                    "name": name,
                    **q,
                })
        except Exception as exc:
            if _cache["data"] is not None:
                return _cache["data"]
            raise HTTPException(502, f"No fue posible actualizar el panorama de mercado: {exc}")

        valid_changes = [x["change_percent"] for x in stocks if x["change_percent"] is not None]
        advancing = sum(1 for x in valid_changes if x > 0)
        declining = sum(1 for x in valid_changes if x < 0)

        sorted_stocks = sorted(
            [x for x in stocks if x["change_percent"] is not None],
            key=lambda x: x["change_percent"],
            reverse=True,
        )

        payload = {
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
            "refresh_seconds": 30,
            "source": "Yahoo Finance via yfinance",
            "note": "Las cotizaciones pueden ser en tiempo real o tener retraso según la bolsa y el instrumento.",
        }

        _cache["data"] = payload
        # Cache slightly less than the browser refresh interval.
        _cache["expires"] = time.time() + 25
        return payload
