from __future__ import annotations

from datetime import datetime, timedelta, timezone
import math
import time
from typing import Any

import pandas as pd
import yfinance as yf

from .market_fallback import alpha_request
from .market_snapshot import load_snapshot, save_snapshot


QUOTE_TTL_SECONDS = 15 * 60
FUNDAMENTALS_TTL_SECONDS = 24 * 60 * 60
SEARCH_TTL_SECONDS = 60 * 60
YAHOO_RATE_LIMIT_COOLDOWN_SECONDS = 5 * 60

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

_yahoo_blocked_until = 0.0


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().isoformat()


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


def _stamp(provider: str, source: str, ttl_seconds: int) -> dict[str, str]:
    fetched = utc_now()
    return {
        "provider": provider,
        "source": source,
        "fetched_at": fetched.isoformat(),
        "valid_until": (fetched + timedelta(seconds=ttl_seconds)).isoformat(),
    }


def _is_rate_limit_error(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        marker in text
        for marker in (
            "rate limit",
            "rate limited",
            "too many requests",
            "429",
            "yf ratelimit",
        )
    )


def _mark_yahoo_rate_limited(exc: Exception | None = None) -> None:
    global _yahoo_blocked_until
    if exc is not None and not _is_rate_limit_error(exc):
        return

    blocked_until = utc_now() + timedelta(seconds=YAHOO_RATE_LIMIT_COOLDOWN_SECONDS)
    _yahoo_blocked_until = max(_yahoo_blocked_until, blocked_until.timestamp())
    save_snapshot(
        "provider_state",
        "yahoo_rate_limit",
        {"blocked_until": blocked_until.isoformat()},
    )


def _yahoo_available() -> bool:
    global _yahoo_blocked_until
    now_ts = time.time()
    if now_ts < _yahoo_blocked_until:
        return False

    state = load_snapshot(
        "provider_state",
        "yahoo_rate_limit",
        YAHOO_RATE_LIMIT_COOLDOWN_SECONDS * 2,
    )
    if isinstance(state, dict) and state.get("blocked_until"):
        try:
            blocked = datetime.fromisoformat(str(state["blocked_until"]))
            if blocked.tzinfo is None:
                blocked = blocked.replace(tzinfo=timezone.utc)
            _yahoo_blocked_until = max(_yahoo_blocked_until, blocked.timestamp())
        except (TypeError, ValueError):
            pass

    return now_ts >= _yahoo_blocked_until


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
                selected = frame.xs("Close", axis=1, level=0)
                if symbol in selected.columns:
                    return selected[symbol].dropna()
                if len(selected.columns) == 1:
                    return selected.iloc[:, 0].dropna()
        if "Close" in frame.columns:
            return frame["Close"].dropna()
    except Exception:
        return None
    return None


def _quote_from_frame(frame: pd.DataFrame, symbol: str) -> dict[str, Any] | None:
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
        **_stamp("yahoo", "Yahoo Finance via yfinance", QUOTE_TTL_SECONDS),
    }


def _yahoo_quotes_batch(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols or not _yahoo_available():
        return {}

    try:
        frame = yf.download(
            tickers=symbols,
            period="5d",
            interval="1d",
            auto_adjust=True,
            progress=False,
            threads=False,
            group_by="column",
        )
    except Exception as exc:
        _mark_yahoo_rate_limited(exc)
        return {}

    output: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        quote = _quote_from_frame(frame, symbol)
        if quote is not None:
            output[symbol] = quote
    return output


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
        **_stamp("alpha_vantage", "Alpha Vantage", QUOTE_TTL_SECONDS),
    }


def get_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    normalized: list[str] = []
    seen: set[str] = set()

    for symbol in symbols:
        item = _normalize(symbol)
        if item and item not in seen:
            normalized.append(item)
            seen.add(item)

    output: dict[str, dict[str, Any]] = {}
    missing: list[str] = []

    for symbol in normalized:
        cached = load_snapshot("quote", symbol, QUOTE_TTL_SECONDS)
        if isinstance(cached, dict):
            output[symbol] = cached
        else:
            missing.append(symbol)

    yahoo_results = _yahoo_quotes_batch(missing)
    for symbol, quote in yahoo_results.items():
        output[symbol] = quote
        save_snapshot("quote", symbol, quote)

    for symbol in missing:
        if symbol in output:
            continue
        quote = _alpha_quote(symbol)
        if quote is not None:
            output[symbol] = quote
            save_snapshot("quote", symbol, quote)

    return output


def get_quote(symbol: str) -> dict[str, Any] | None:
    symbol = _normalize(symbol)
    if not symbol:
        return None
    return get_quotes([symbol]).get(symbol)


def _yahoo_fundamentals(symbol: str) -> dict[str, Any] | None:
    if not _yahoo_available():
        return None

    try:
        info = yf.Ticker(symbol).info or {}
    except Exception as exc:
        _mark_yahoo_rate_limited(exc)
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
        **_stamp("yahoo", "Yahoo Finance via yfinance", FUNDAMENTALS_TTL_SECONDS),
    }


def _alpha_fundamentals(symbol: str) -> dict[str, Any] | None:
    overview = alpha_request({"function": "OVERVIEW", "symbol": symbol}) or {}
    if not overview:
        return None

    return {
        "company": overview.get("Name") or symbol,
        "description": overview.get("Description"),
        "exchange": overview.get("Exchange"),
        "currency": overview.get("Currency") or "USD",
        "quote_type": overview.get("AssetType"),
        "sector": overview.get("Sector"),
        "industry": overview.get("Industry"),
        "target_price": safe_num(overview.get("AnalystTargetPrice")),
        "market_cap": safe_num(overview.get("MarketCapitalization")),
        "pe_ratio": safe_num(
            overview.get("PERatio")
            or overview.get("TrailingPE")
            or overview.get("ForwardPE")
        ),
        "revenue": safe_num(overview.get("RevenueTTM")),
        "shares_outstanding": safe_num(overview.get("SharesOutstanding")),
        "float_shares": None,
        "volume": None,
        "average_volume": None,
        "beta": safe_num(overview.get("Beta")),
        "revenue_growth_pct": pct(overview.get("QuarterlyRevenueGrowthYOY")),
        "earnings_growth_pct": pct(overview.get("QuarterlyEarningsGrowthYOY")),
        "roe_pct": pct(overview.get("ReturnOnEquityTTM")),
        "roa_pct": pct(overview.get("ReturnOnAssetsTTM")),
        "operating_margin_pct": pct(overview.get("OperatingMarginTTM")),
        "debt_to_equity": None,
        "current_ratio": None,
        "free_cash_flow": None,
        **_stamp("alpha_vantage", "Alpha Vantage", FUNDAMENTALS_TTL_SECONDS),
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
    if not _yahoo_available():
        return None

    try:
        frame = yf.Ticker(symbol).history(
            period=period,
            interval=interval,
            auto_adjust=False,
            actions=False,
            prepost=False,
        )
    except Exception as exc:
        _mark_yahoo_rate_limited(exc)
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


def _period_days(period: str) -> int | None:
    return {
        "1mo": 25,
        "3mo": 75,
        "6mo": 150,
        "1y": 300,
        "2y": 600,
    }.get(period)


def _has_reasonable_coverage(points: list[dict[str, Any]], period: str) -> bool:
    minimum = _period_days(period)
    if minimum is None:
        return True
    return len(points) >= minimum * 0.65


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

    if points is None and interval == "1d":
        alpha_points = _alpha_daily_history(symbol)
        if alpha_points and _has_reasonable_coverage(alpha_points, period):
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
        **_stamp(provider, source, ttl),
    }
    save_snapshot("provider_history", key, result)
    return result


def _alpha_search(query: str) -> list[dict[str, Any]]:
    payload = alpha_request({"function": "SYMBOL_SEARCH", "keywords": query}) or {}
    matches = payload.get("bestMatches") or []
    results: list[dict[str, Any]] = []

    for item in matches:
        symbol = item.get("1. symbol")
        asset_type = str(item.get("3. type") or "")
        if not symbol:
            continue
        if "equity" not in asset_type.lower() and "etf" not in asset_type.lower():
            continue
        results.append({
            "ticker": symbol,
            "name": item.get("2. name") or symbol,
            "exchange": item.get("4. region"),
            "type": "ETF" if "etf" in asset_type.lower() else "Stock",
            "provider": "alpha_vantage",
        })
    return results[:10]


def search_yahoo(query: str) -> list[dict[str, Any]]:
    q = str(query or "").strip()
    if not q:
        return []

    key = q.lower()
    cached = load_snapshot("search", key, SEARCH_TTL_SECONDS)
    if isinstance(cached, list):
        return cached

    quotes: list[dict[str, Any]] = []
    if _yahoo_available():
        try:
            search = yf.Search(q, max_results=10, news_count=0)
            quotes = getattr(search, "quotes", []) or []
        except Exception as exc:
            _mark_yahoo_rate_limited(exc)
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
            "provider": "yahoo",
        })

    if not results:
        results = _alpha_search(q)

    if results:
        save_snapshot("search", key, results)
    return results
