from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any

import pandas as pd
import yfinance as yf

from .market_fallback import alpha_request, alpha_stock_raw
from .market_snapshot import load_snapshot, save_snapshot


QUOTE_TTL_SECONDS = 15 * 60
FUNDAMENTALS_TTL_SECONDS = 24 * 60 * 60
SEARCH_TTL_SECONDS = 60 * 60

HISTORY_TTL_SECONDS = {
    ("1d", "5m"): 5 * 60,
    ("5d", "15m"): 15 * 60,
    ("1mo", "1d"): 2 * 60 * 60,
    ("3mo", "1d"): 4 * 60 * 60,
    ("6mo", "1d"): 6 * 60 * 60,
    ("ytd", "1d"): 6 * 60 * 60,
    ("1y", "1d"): 12 * 60 * 60,
    ("2y", "1d"): 12 * 60 * 60,
    ("5y", "1wk"): 24 * 60 * 60,
}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def safe_num(value: Any) -> float | None:
    try:
        number = float(value)
        if math.isfinite(number):
            return number
    except (TypeError, ValueError):
        pass
    return None


def pct(value: Any) -> float | None:
    number = safe_num(value)
    return number * 100 if number is not None else None


def _normalize(symbol: str) -> str:
    return str(symbol or "").strip().upper()


def _extract_close_series(frame: pd.DataFrame, symbol: str) -> pd.Series | None:
    if frame is None or frame.empty:
        return None
    try:
        if isinstance(frame.columns, pd.MultiIndex):
            if ("Close", symbol) in frame.columns:
                return frame[("Close", symbol)].dropna()
            if (symbol, "Close") in frame.columns:
                return frame[(symbol, "Close")].dropna()
            if "Close" in frame.columns.get_level_values(0):
                return frame.xs("Close", axis=1, level=0).iloc[:, 0].dropna()
        if "Close" in frame.columns:
            return frame["Close"].dropna()
    except Exception:
        return None
    return None


def _yahoo_quote(symbol: str) -> dict[str, Any] | None:
    try:
        frame = yf.download(
            symbol,
            period="5d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False,
        )
        closes = _extract_close_series(frame, symbol)
        if closes is None or closes.empty:
            return None
        price = safe_num(closes.iloc[-1])
        previous_close = safe_num(closes.iloc[-2]) if len(closes) >= 2 else None
        if price is None:
            return None
        change_percent = (
            ((price - previous_close) / previous_close) * 100
            if previous_close not in (None, 0)
            else None
        )
        return {
            "price": price,
            "previous_close": previous_close,
            "change_percent": change_percent,
            "provider": "yahoo",
            "source": "Yahoo Finance via yfinance",
            "fetched_at": utc_now_iso(),
        }
    except Exception:
        return None


def _alpha_quote(symbol: str) -> dict[str, Any] | None:
    payload = alpha_request({"function": "GLOBAL_QUOTE", "symbol": symbol}) or {}
    quote = payload.get("Global Quote") or {}
    price = safe_num(quote.get("05. price"))
    if price is None:
        return None
    previous_close = safe_num(quote.get("08. previous close"))
    change_percent = (
        ((price - previous_close) / previous_close) * 100
        if previous_close not in (None, 0)
        else None
    )
    return {
        "price": price,
        "previous_close": previous_close,
        "change_percent": change_percent,
        "volume": safe_num(quote.get("06. volume")),
        "provider": "alpha_vantage",
        "source": "Alpha Vantage",
        "fetched_at": utc_now_iso(),
    }


def get_quote(symbol: str) -> dict[str, Any] | None:
    symbol = _normalize(symbol)
    if not symbol:
        return None

    cached = load_snapshot("quote", symbol, QUOTE_TTL_SECONDS)
    if isinstance(cached, dict):
        return cached

    result = _yahoo_quote(symbol)
    if result is None:
        result = _alpha_quote(symbol)
    if result is not None:
        save_snapshot("quote", symbol, result)
    return result


def _yahoo_fundamentals(symbol: str) -> dict[str, Any] | None:
    try:
        info = yf.Ticker(symbol).info or {}
    except Exception:
        return None
    if not info:
        return None
    return {
        "company": info.get("longName") or info.get("shortName") or symbol,
        "description": info.get("longBusinessSummary"),
        "exchange": info.get("exchange"),
        "currency": info.get("currency") or "USD",
        "quote_type": info.get("quoteType") or info.get("type"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "target_price": safe_num(info.get("targetMeanPrice")),
        "market_cap": safe_num(info.get("marketCap")),
        "pe_ratio": safe_num(info.get("trailingPE") or info.get("forwardPE")),
        "revenue": safe_num(info.get("totalRevenue")),
        "shares_outstanding": safe_num(info.get("sharesOutstanding")),
        "float_shares": safe_num(info.get("floatShares")),
        "volume": safe_num(info.get("volume")),
        "average_volume": safe_num(info.get("averageVolume")),
        "beta": safe_num(info.get("beta")),
        "revenue_growth_pct": pct(info.get("revenueGrowth")),
        "earnings_growth_pct": pct(info.get("earningsGrowth")),
        "roe_pct": pct(info.get("returnOnEquity")),
        "roa_pct": pct(info.get("returnOnAssets")),
        "operating_margin_pct": pct(info.get("operatingMargins")),
        "debt_to_equity": safe_num(info.get("debtToEquity")),
        "current_ratio": safe_num(info.get("currentRatio")),
        "free_cash_flow": safe_num(info.get("freeCashflow")),
        "provider": "yahoo",
        "source": "Yahoo Finance via yfinance",
        "fetched_at": utc_now_iso(),
    }


def _alpha_fundamentals(symbol: str) -> dict[str, Any] | None:
    raw = alpha_stock_raw(symbol)
    if not raw:
        return None
    return {
        **raw,
        "shares_outstanding": None,
        "float_shares": None,
        "average_volume": None,
        "debt_to_equity": None,
        "current_ratio": None,
        "free_cash_flow": None,
        "provider": "alpha_vantage",
        "source": "Alpha Vantage",
        "fetched_at": utc_now_iso(),
    }


def get_fundamentals(symbol: str) -> dict[str, Any] | None:
    symbol = _normalize(symbol)
    if not symbol:
        return None

    cached = load_snapshot("fundamentals", symbol, FUNDAMENTALS_TTL_SECONDS)
    if isinstance(cached, dict):
        return cached

    result = _yahoo_fundamentals(symbol)
    if result is None:
        result = _alpha_fundamentals(symbol)
    if result is not None:
        save_snapshot("fundamentals", symbol, result)
    return result


def _yahoo_history(symbol: str, period: str, interval: str) -> list[dict[str, Any]] | None:
    try:
        frame = yf.Ticker(symbol).history(
            period=period,
            interval=interval,
            auto_adjust=False,
            actions=False,
            prepost=False,
        )
    except Exception:
        return None
    if frame is None or frame.empty:
        return None

    points: list[dict[str, Any]] = []
    for index, row in frame.iterrows():
        close = safe_num(row.get("Close"))
        if close is None:
            continue
        dt = index.to_pydatetime() if hasattr(index, "to_pydatetime") else index
        points.append({
            "date": dt.isoformat() if isinstance(dt, datetime) else str(dt),
            "open": safe_num(row.get("Open")),
            "high": safe_num(row.get("High")),
            "low": safe_num(row.get("Low")),
            "close": close,
            "volume": int(row.get("Volume")) if safe_num(row.get("Volume")) is not None else None,
        })
    return points or None


def _alpha_daily_history(symbol: str) -> list[dict[str, Any]] | None:
    payload = alpha_request({
        "function": "TIME_SERIES_DAILY",
        "symbol": symbol,
        "outputsize": "full",
    }) or {}
    series = payload.get("Time Series (Daily)") or {}
    if not isinstance(series, dict) or not series:
        return None
    points: list[dict[str, Any]] = []
    for date_key, row in sorted(series.items()):
        close = safe_num(row.get("4. close"))
        if close is None:
            continue
        points.append({
            "date": f"{date_key}T00:00:00",
            "open": safe_num(row.get("1. open")),
            "high": safe_num(row.get("2. high")),
            "low": safe_num(row.get("3. low")),
            "close": close,
            "volume": int(row.get("5. volume")) if safe_num(row.get("5. volume")) is not None else None,
        })
    return points or None


def get_history(symbol: str, period: str, interval: str) -> dict[str, Any] | None:
    symbol = _normalize(symbol)
    if not symbol:
        return None
    ttl = HISTORY_TTL_SECONDS.get((period, interval), 6 * 60 * 60)
    key = f"{symbol}:{period}:{interval}"
    cached = load_snapshot("provider_history", key, ttl)
    if isinstance(cached, dict):
        return cached

    points = _yahoo_history(symbol, period, interval)
    provider = "yahoo"
    source = "Yahoo Finance via yfinance"

    if points is None and interval in {"1d", "1wk"}:
        alpha_points = _alpha_daily_history(symbol)
        if alpha_points:
            points = alpha_points
            provider = "alpha_vantage"
            source = "Alpha Vantage"

    if not points:
        return None

    result = {
        "ticker": symbol,
        "period": period,
        "interval": interval,
        "points": points,
        "provider": provider,
        "source": source,
        "fetched_at": utc_now_iso(),
    }
    save_snapshot("provider_history", key, result)
    return result


def search_yahoo(query: str) -> list[dict[str, Any]]:
    q = str(query or "").strip()
    if not q:
        return []
    key = q.lower()
    cached = load_snapshot("search", key, SEARCH_TTL_SECONDS)
    if isinstance(cached, list):
        return cached
    try:
        search = yf.Search(q, max_results=10, news_count=0)
        quotes = getattr(search, "quotes", []) or []
    except Exception:
        quotes = []
    results: list[dict[str, Any]] = []
    for item in quotes:
        symbol = item.get("symbol")
        quote_type = str(item.get("quoteType") or "").upper()
        if not symbol or quote_type not in {"EQUITY", "ETF"}:
            continue
        results.append({
            "ticker": symbol,
            "name": item.get("longname") or item.get("shortname") or symbol,
            "exchange": item.get("exchDisp") or item.get("exchange"),
            "type": "ETF" if quote_type == "ETF" else "Stock",
        })
    if results:
        save_snapshot("search", key, results)
    return results
