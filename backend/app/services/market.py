from __future__ import annotations

from datetime import datetime, timezone
import math
import threading
import time
from typing import Any

import pandas as pd
import yfinance as yf
from fastapi import HTTPException

from .market_fallback import alpha_stock_raw
from .market_snapshot import load_snapshot, save_snapshot
from .scoring import evaluate

INFO_TTL_SECONDS = 12 * 60 * 60
QUOTE_TTL_SECONDS = 15 * 60
HISTORY_TTL_SECONDS = 6 * 60 * 60
SEARCH_TTL_SECONDS = 60 * 60
RATE_LIMIT_COOLDOWN_SECONDS = 5 * 60
MAX_STALE_INFO_SECONDS = 30 * 24 * 60 * 60
MAX_STALE_QUOTE_SECONDS = 7 * 24 * 60 * 60
MAX_STALE_HISTORY_SECONDS = 30 * 24 * 60 * 60

_cache_lock = threading.RLock()
_info_cache: dict[str, dict[str, Any]] = {}
_quote_cache: dict[str, dict[str, Any]] = {}
_history_cache: dict[tuple[str, str], dict[str, Any]] = {}
_search_cache: dict[str, dict[str, Any]] = {}
_symbol_locks: dict[str, threading.Lock] = {}
_rate_limited_until: float = 0.0


def _now_ts() -> float:
    return time.time()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def safe_num(value, scale=1.0):
    try:
        value = float(value)
        if math.isfinite(value):
            return value / scale
    except (TypeError, ValueError):
        pass
    return None


def pct(value):
    x = safe_num(value)
    return x * 100 if x is not None else None


def _cache_get(cache: dict, key, ttl: int):
    with _cache_lock:
        item = cache.get(key)
    if not item:
        return None
    return item["data"] if _now_ts() - item["cached_at"] <= ttl else None


def _cache_get_stale(cache: dict, key, max_age: int):
    with _cache_lock:
        item = cache.get(key)
    if not item:
        return None
    return item["data"] if _now_ts() - item["cached_at"] <= max_age else None


def _cache_set(cache: dict, key, data):
    with _cache_lock:
        cache[key] = {"cached_at": _now_ts(), "data": data}


def _get_symbol_lock(key: str) -> threading.Lock:
    with _cache_lock:
        lock = _symbol_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _symbol_locks[key] = lock
        return lock


def _looks_like_rate_limit(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(
        s in text
        for s in (
            "too many requests",
            "rate limit",
            "rate limited",
            "429",
            "try after a while",
        )
    )


def _register_rate_limit(exc: Exception):
    global _rate_limited_until
    if _looks_like_rate_limit(exc):
        with _cache_lock:
            _rate_limited_until = max(
                _rate_limited_until,
                _now_ts() + RATE_LIMIT_COOLDOWN_SECONDS,
            )


def _circuit_open() -> bool:
    with _cache_lock:
        return _now_ts() < _rate_limited_until


def _normalize_symbol(ticker: str) -> str:
    symbol = ticker.strip().upper()
    if not symbol or len(symbol) > 20:
        raise HTTPException(400, "Ticker inválido")
    return symbol


def _persistent_stock(symbol: str, max_age: int | None = None):
    data = load_snapshot("stock", symbol, max_age)
    return dict(data) if isinstance(data, dict) else None


def _persistent_history(symbol: str, period: str, max_age: int | None = None):
    data = load_snapshot("history", f"{symbol}:{period}", max_age)
    return data if isinstance(data, list) else None


def _alpha_as_yahoo_info(symbol: str) -> dict[str, Any] | None:
    raw = alpha_stock_raw(symbol)
    if not raw:
        return None
    return {
        "longName": raw.get("company") or symbol,
        "longBusinessSummary": raw.get("description"),
        "exchange": raw.get("exchange"),
        "currency": raw.get("currency") or "USD",
        "quoteType": raw.get("quote_type"),
        "sector": raw.get("sector"),
        "industry": raw.get("industry"),
        "currentPrice": raw.get("price"),
        "previousClose": raw.get("previous_close"),
        "targetMeanPrice": raw.get("target_price"),
        "marketCap": raw.get("market_cap"),
        "trailingPE": raw.get("pe_ratio"),
        "totalRevenue": raw.get("revenue"),
        "volume": raw.get("volume"),
        "beta": raw.get("beta"),
        "revenueGrowth": (raw.get("revenue_growth_pct") / 100 if raw.get("revenue_growth_pct") is not None else None),
        "earningsGrowth": (raw.get("earnings_growth_pct") / 100 if raw.get("earnings_growth_pct") is not None else None),
        "returnOnEquity": (raw.get("roe_pct") / 100 if raw.get("roe_pct") is not None else None),
        "returnOnAssets": (raw.get("roa_pct") / 100 if raw.get("roa_pct") is not None else None),
        "operatingMargins": (raw.get("operating_margin_pct") / 100 if raw.get("operating_margin_pct") is not None else None),
        "_fallback_source": "Alpha Vantage fallback",
    }


def _fetch_info(symbol: str) -> dict[str, Any]:
    if _circuit_open():
        stale = _cache_get_stale(_info_cache, symbol, MAX_STALE_INFO_SECONDS)
        if stale is not None:
            return {**stale, "_stale": True}
        persisted = _persistent_stock(symbol, MAX_STALE_INFO_SECONDS)
        if persisted:
            return {"_persistent_stock": persisted, "_stale": True}
        fallback = _alpha_as_yahoo_info(symbol)
        if fallback:
            _cache_set(_info_cache, symbol, fallback)
            return fallback
        return {"longName": symbol, "_fallback_source": "Market data temporarily unavailable", "_stale": True}

    try:
        info = yf.Ticker(symbol).info or {}
        if not info:
            raise ValueError("Yahoo Finance no devolvió información del activo")
        _cache_set(_info_cache, symbol, info)
        return info
    except Exception as exc:
        _register_rate_limit(exc)
        stale = _cache_get_stale(_info_cache, symbol, MAX_STALE_INFO_SECONDS)
        if stale is not None:
            return {**stale, "_stale": True}
        persisted = _persistent_stock(symbol, MAX_STALE_INFO_SECONDS)
        if persisted:
            return {"_persistent_stock": persisted, "_stale": True}
        fallback = _alpha_as_yahoo_info(symbol)
        if fallback:
            _cache_set(_info_cache, symbol, fallback)
            return fallback
        if _looks_like_rate_limit(exc):
            return {"longName": symbol, "_fallback_source": "Market data temporarily unavailable", "_stale": True}
        raise HTTPException(502, f"No fue posible consultar la fuente de mercado: {exc}")


def _get_info(symbol: str) -> dict[str, Any]:
    fresh = _cache_get(_info_cache, symbol, INFO_TTL_SECONDS)
    if fresh is not None:
        return fresh
    lock = _get_symbol_lock(f"info:{symbol}")
    with lock:
        fresh = _cache_get(_info_cache, symbol, INFO_TTL_SECONDS)
        return fresh if fresh is not None else _fetch_info(symbol)


def _extract_quote(df: pd.DataFrame, symbol: str):
    if df is None or df.empty:
        return None
    try:
        if isinstance(df.columns, pd.MultiIndex):
            if ("Close", symbol) in df.columns:
                close = df[("Close", symbol)]
            elif "Close" in df.columns.get_level_values(0):
                close = df.xs("Close", axis=1, level=0).iloc[:, 0]
            else:
                return None
        elif "Close" in df.columns:
            close = df["Close"]
        else:
            return None
    except Exception:
        return None
    close = close.dropna()
    if close.empty:
        return None
    price = safe_num(close.iloc[-1])
    previous_close = safe_num(close.iloc[-2]) if len(close) >= 2 else None
    change_percent = (((price - previous_close) / previous_close * 100) if price is not None and previous_close not in (None, 0) else None)
    return {"price": price, "previous_close": previous_close, "change_percent": change_percent}


def _fetch_quote(symbol: str) -> dict[str, Any]:
    if _circuit_open():
        stale = _cache_get_stale(_quote_cache, symbol, MAX_STALE_QUOTE_SECONDS)
        if stale is not None:
            return {**stale, "_stale": True}
        persisted = _persistent_stock(symbol, MAX_STALE_QUOTE_SECONDS)
        if persisted:
            return {
                "price": persisted.get("price"),
                "previous_close": persisted.get("previous_close"),
                "change_percent": persisted.get("change_percent"),
                "_stale": True,
            }
        return {}
    try:
        df = yf.download(symbol, period="5d", interval="1d", auto_adjust=True, progress=False, threads=False)
        quote = _extract_quote(df, symbol)
        if quote:
            _cache_set(_quote_cache, symbol, quote)
            return quote
        return {}
    except Exception as exc:
        _register_rate_limit(exc)
        stale = _cache_get_stale(_quote_cache, symbol, MAX_STALE_QUOTE_SECONDS)
        if stale is not None:
            return {**stale, "_stale": True}
        persisted = _persistent_stock(symbol, MAX_STALE_QUOTE_SECONDS)
        if persisted:
            return {
                "price": persisted.get("price"),
                "previous_close": persisted.get("previous_close"),
                "change_percent": persisted.get("change_percent"),
                "_stale": True,
            }
        return {}


def _get_quote(symbol: str) -> dict[str, Any]:
    fresh = _cache_get(_quote_cache, symbol, QUOTE_TTL_SECONDS)
    if fresh is not None:
        return fresh
    lock = _get_symbol_lock(f"quote:{symbol}")
    with lock:
        fresh = _cache_get(_quote_cache, symbol, QUOTE_TTL_SECONDS)
        return fresh if fresh is not None else _fetch_quote(symbol)


def get_stock(ticker: str):
    symbol = _normalize_symbol(ticker)

    persisted_fresh = _persistent_stock(symbol, QUOTE_TTL_SECONDS)
    if persisted_fresh:
        persisted_fresh["stale"] = False
        persisted_fresh["warning"] = None
        persisted_fresh["source"] = persisted_fresh.get("source") or "Persistent market cache"
        return persisted_fresh

    info = dict(_get_info(symbol))
    persistent_fallback = info.pop("_persistent_stock", None)
    if persistent_fallback:
        persistent_fallback["stale"] = True
        persistent_fallback["warning"] = "La fuente de mercado está limitada temporalmente. Se muestran los últimos datos persistidos disponibles."
        persistent_fallback["source"] = persistent_fallback.get("source") or "Persistent market cache"
        return persistent_fallback

    fallback_source = info.pop("_fallback_source", None)
    quote = dict(_get_quote(symbol))
    info_stale = bool(info.pop("_stale", False))
    quote_stale = bool(quote.pop("_stale", False))

    price = safe_num(quote.get("price") or info.get("currentPrice") or info.get("regularMarketPrice") or info.get("previousClose"))
    previous_close = safe_num(quote.get("previous_close") or info.get("previousClose") or info.get("regularMarketPreviousClose"))
    change_percent = safe_num(quote.get("change_percent"))
    if change_percent is None and price is not None and previous_close not in (None, 0):
        change_percent = ((price - previous_close) / previous_close) * 100

    target = safe_num(info.get("targetMeanPrice"))
    shares = safe_num(info.get("sharesOutstanding"))
    float_shares = safe_num(info.get("floatShares"))
    free_float = ((float_shares / shares * 100) if shares and float_shares else None)
    upside = (((target - price) / price * 100) if target is not None and price not in (None, 0) else None)

    metrics = {
        "market_cap_b": safe_num(info.get("marketCap"), 1e9),
        "pe_ratio": safe_num(info.get("trailingPE") or info.get("forwardPE")),
        "revenue_m": safe_num(info.get("totalRevenue"), 1e6),
        "free_float_pct": free_float,
        "upside_pct": upside,
        "revenue_growth_pct": pct(info.get("revenueGrowth")),
        "earnings_growth_pct": pct(info.get("earningsGrowth")),
        "roe_pct": pct(info.get("returnOnEquity")),
        "roa_pct": pct(info.get("returnOnAssets")),
        "operating_margin_pct": pct(info.get("operatingMargins")),
        "debt_to_equity": safe_num(info.get("debtToEquity")),
        "current_ratio": safe_num(info.get("currentRatio")),
        "free_cash_flow_m": safe_num(info.get("freeCashflow"), 1e6),
        "beta": safe_num(info.get("beta")),
    }
    score, classification, criteria, strengths, risks, missing = evaluate(metrics)
    stale = info_stale or quote_stale

    result = {
        "ticker": symbol,
        "company": info.get("longName") or info.get("shortName") or symbol,
        "description": info.get("longBusinessSummary"),
        "exchange": info.get("exchange"),
        "currency": info.get("currency") or "USD",
        "quote_type": info.get("quoteType") or info.get("type"),
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "price": price,
        "previous_close": previous_close,
        "change_percent": change_percent,
        "daily_change_percent": change_percent,
        "target_price": target,
        "upside_percent": upside,
        "upside_pct": upside,
        "market_cap": safe_num(info.get("marketCap")),
        "pe_ratio": metrics["pe_ratio"],
        "revenue": safe_num(info.get("totalRevenue")),
        "revenue_millions": metrics["revenue_m"],
        "free_float_percent": free_float,
        "volume": safe_num(info.get("volume")),
        "average_volume": safe_num(info.get("averageVolume")),
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
        "updated_at": _utc_now().isoformat(),
        "source": fallback_source or "Yahoo Finance via yfinance",
        "stale": stale,
        "warning": (
            "Yahoo Finance está limitado temporalmente. Se usó una fuente de respaldo."
            if fallback_source == "Alpha Vantage fallback"
            else (
                "Las fuentes de mercado están limitadas temporalmente. La app seguirá disponible y reintentará la actualización."
                if fallback_source == "Market data temporarily unavailable"
                else ("La fuente de mercado limitó temporalmente las consultas. Se muestran los últimos datos disponibles." if stale else None)
            )
        ),
    }

    if price is not None or fallback_source == "Alpha Vantage fallback":
        save_snapshot("stock", symbol, result)
    return result


def search(query: str):
    q = query.strip()
    if not q:
        return []
    key = q.lower()
    fresh = _cache_get(_search_cache, key, SEARCH_TTL_SECONDS)
    if fresh is not None:
        return fresh
    persisted = load_snapshot("search", key, SEARCH_TTL_SECONDS)
    if isinstance(persisted, list):
        _cache_set(_search_cache, key, persisted)
        return persisted
    if _circuit_open():
        persisted = load_snapshot("search", key, 7 * 24 * 60 * 60)
        if isinstance(persisted, list):
            return persisted
        return [{"ticker": q.upper(), "name": q.upper(), "exchange": None, "type": "EQUITY"}]
    try:
        s = yf.Search(q, max_results=8, news_count=0)
        quotes = getattr(s, "quotes", []) or []
        results = []
        for item in quotes:
            symbol = item.get("symbol")
            if symbol:
                results.append({
                    "ticker": symbol,
                    "name": item.get("shortname") or item.get("longname") or symbol,
                    "exchange": item.get("exchDisp") or item.get("exchange"),
                    "type": item.get("quoteType"),
                })
        _cache_set(_search_cache, key, results)
        save_snapshot("search", key, results)
        return results
    except Exception as exc:
        _register_rate_limit(exc)
        persisted = load_snapshot("search", key, 7 * 24 * 60 * 60)
        if isinstance(persisted, list):
            return persisted
        return [{"ticker": q.upper(), "name": q.upper(), "exchange": None, "type": "EQUITY"}]


def history(ticker: str, period="1y"):
    symbol = _normalize_symbol(ticker)
    allowed = {"1mo", "3mo", "6mo", "1y", "2y", "5y"}
    if period not in allowed:
        period = "1y"
    key = (symbol, period)
    fresh = _cache_get(_history_cache, key, HISTORY_TTL_SECONDS)
    if fresh is not None:
        return fresh
    persisted = _persistent_history(symbol, period, HISTORY_TTL_SECONDS)
    if persisted is not None:
        _cache_set(_history_cache, key, persisted)
        return persisted
    lock = _get_symbol_lock(f"history:{symbol}:{period}")
    with lock:
        fresh = _cache_get(_history_cache, key, HISTORY_TTL_SECONDS)
        if fresh is not None:
            return fresh
        if _circuit_open():
            persisted = _persistent_history(symbol, period, MAX_STALE_HISTORY_SECONDS)
            if persisted is not None:
                return persisted
            return []
        try:
            df = yf.Ticker(symbol).history(period=period, interval="1d", auto_adjust=True)
        except Exception as exc:
            _register_rate_limit(exc)
            persisted = _persistent_history(symbol, period, MAX_STALE_HISTORY_SECONDS)
            if persisted is not None:
                return persisted
            return []
        if df is None or df.empty:
            persisted = _persistent_history(symbol, period, MAX_STALE_HISTORY_SECONDS)
            return persisted if persisted is not None else []
        result = [{"date": idx.date().isoformat(), "close": round(float(row.Close), 4), "volume": int(row.Volume)} for idx, row in df.iterrows()]
        _cache_set(_history_cache, key, result)
        save_snapshot("history", f"{symbol}:{period}", result)
        return result


def clear_market_cache(ticker: str | None = None):
    with _cache_lock:
        if ticker is None:
            _info_cache.clear()
            _quote_cache.clear()
            _history_cache.clear()
            _search_cache.clear()
            return
        symbol = ticker.strip().upper()
        _info_cache.pop(symbol, None)
        _quote_cache.pop(symbol, None)
        for key in [k for k in _history_cache if k[0] == symbol]:
            _history_cache.pop(key, None)
