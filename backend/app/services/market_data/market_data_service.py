"""Public market-data policy: validate whole datasets, then cache and expose provenance."""
from datetime import timedelta
from . import massive_provider as massive, fmp_provider as fmp, alpha_vantage_provider as alpha, yahoo_provider as yahoo
from .common import symbol, valid, compatible, date_time, now, is_fresh, stale_copy, provenance
from ..market_snapshot import load_snapshot, load_snapshots, save_snapshot, save_snapshots
from ..market_requests import refreshes, remaining_budget
from ...config import settings

def fundamentals_policy():
    # Changing provider availability refreshes old fallback caches without
    # deleting them. No credential or credential hash is persisted.
    return f"v2:fmp={bool(settings.fmp_api_key)}:alpha={bool(settings.alpha_vantage_api_key)}"

QUOTE_TTL_SECONDS = 60
FUNDAMENTALS_TTL_SECONDS = 86400
SEARCH_TTL_SECONDS = 3600
HISTORY_TTL_SECONDS = {("1d", "5m"): 300, ("5d", "15m"): 900,
                       ("1mo", "1d"): 21600, ("3mo", "1d"): 21600, ("6mo", "1d"): 21600,
                       ("ytd", "1d"): 21600, ("1y", "1d"): 43200, ("2y", "1d"): 43200,
                       ("5y", "1wk"): 43200}
STALE_SECONDS = {"quote": 7*86400, "history": 7*86400, "fundamentals": 30*86400}

def _safe(call, *args):
    if remaining_budget() <= 0:
        return None
    try:
        return call(*args)
    except Exception:
        # Malformed upstream responses are isolated; credentials never reach logs.
        return None

def _cached(kind, keys, identities, ttl):
    values = load_snapshots("md_"+kind, keys, STALE_SECONDS[kind])
    fresh, stale = {}, {}
    for key, data in values.items():
        ticker = identities[key]
        if not valid(data, ticker, kind):
            continue
        # Partial fundamentals are retried without repeatedly fetching cached components.
        age_limit = min(ttl, 60) if kind == "fundamentals" and data.get("partial") else ttl
        policy_matches = kind != "fundamentals" or data.get("provider_policy") == fundamentals_policy()
        if is_fresh(data, age_limit) and policy_matches:
            fresh[ticker] = data
        else:
            stale[ticker] = stale_copy(data)
    return fresh, stale

def _acceptable(data, ticker, kind, previous=None):
    if not valid(data, ticker, kind) or not compatible(data, previous, kind):
        return False
    dt = date_time(data.get("data_timestamp"))
    # A response fetched now is not a current quote if its observation is weeks old.
    if kind in {"quote", "history"} and (not dt or now()-dt > timedelta(days=7)):
        return False
    return True

def _load_quotes(symbols):
    cached, stale = _cached("quote", symbols, {s:s for s in symbols}, QUOTE_TTL_SECONDS)
    result = dict(cached)
    for provider in (massive.quotes, fmp.quotes, yahoo.quotes):
        missing = [s for s in symbols if s not in result]
        if not missing:
            break
        rows = _safe(provider, missing) or {}
        accepted = {s:d for s,d in rows.items() if s in missing and _acceptable(d,s,"quote",stale.get(s))}
        save_snapshots("md_quote", accepted)
        result.update(accepted)
    return {**{s:d for s,d in stale.items() if s not in result}, **result}

def get_quotes(symbols):
    symbols = sorted({symbol(s) for s in symbols if symbol(s)})
    fresh, stale = _cached("quote", symbols, {s:s for s in symbols}, QUOTE_TTL_SECONDS)
    missing = [s for s in symbols if s not in fresh]
    if missing:
        loaded = refreshes.get(("md_quotes", *missing), lambda: _load_quotes(missing), stale) or {}
        # Workers can already have saved partial successes when the caller's wait expires.
        ready, _ = _cached("quote", missing, {s:s for s in missing}, QUOTE_TTL_SECONDS)
        fresh.update({**loaded, **ready})
    return fresh

def get_quote(ticker):
    ticker = symbol(ticker)
    return get_quotes([ticker]).get(ticker) if ticker else None

def _load_get_fundamentals(ticker):
    fresh, stale = _cached("fundamentals", [ticker], {ticker:ticker}, FUNDAMENTALS_TTL_SECONDS)
    if ticker in fresh:
        return fresh[ticker]
    previous = stale.get(ticker)
    partial = None
    for provider in (fmp.fundamentals, alpha.fundamentals):
        data = _safe(provider, ticker)
        if not _acceptable(data, ticker, "fundamentals", previous):
            continue
        # Prefer an actual financial dataset to a profile-only primary response.
        if data.get("revenue") is None and data.get("pe_ratio") is None and data.get("quote_type") != "ETF":
            partial = partial or data
            continue
        data["provider_policy"] = fundamentals_policy()
        save_snapshot("md_fundamentals", ticker, data)
        return data
    if previous:
        return previous
    if partial:
        partial["provider_policy"] = fundamentals_policy()
        save_snapshot("md_fundamentals", ticker, partial)
    return partial

def get_fundamentals(ticker):
    ticker = symbol(ticker)
    if not ticker:
        return None
    fresh, stale = _cached("fundamentals", [ticker], {ticker:ticker}, FUNDAMENTALS_TTL_SECONDS)
    if ticker in fresh:
        return fresh[ticker]
    loaded = refreshes.get(("md_fundamentals", ticker), lambda: _load_get_fundamentals(ticker), stale.get(ticker))
    ready, _ = _cached("fundamentals", [ticker], {ticker:ticker}, FUNDAMENTALS_TTL_SECONDS)
    return ready.get(ticker) or loaded

def _load_histories(symbols, period, interval):
    ttl = HISTORY_TTL_SECONDS.get((period, interval), 21600)
    keys = {s:f"{s}:{period}:{interval}" for s in symbols}
    identities = {k:s for s,k in keys.items()}
    fresh, stale = _cached("history", list(identities), identities, ttl)
    def accept(ticker, data):
        if data and data.get("period") == period and data.get("interval") == interval and _acceptable(data,ticker,"history",stale.get(ticker)):
            # Coverage remains explicit; do not fill missing trading days or combine series.
            points = data["points"]
            data["coverage"] = {"start": points[0]["date"], "end": points[-1]["date"], "observations": len(points)}
            fresh[ticker] = data
            save_snapshot("md_history", keys[ticker], data)
    for ticker in symbols:
        if ticker not in fresh:
            accept(ticker, _safe(massive.history, ticker, period, interval))
    missing = [s for s in symbols if s not in fresh]
    for ticker, data in (_safe(yahoo.histories, missing, period, interval) or {}).items():
        if ticker in missing:
            accept(ticker, data)
    return {**{s:d for s,d in stale.items() if s not in fresh}, **fresh}

def get_histories(symbols, period, interval):
    symbols = sorted({symbol(s) for s in symbols if symbol(s)})
    if (period, interval) not in HISTORY_TTL_SECONDS:
        return {}
    keys = {s:f"{s}:{period}:{interval}" for s in symbols}
    identities = {k:s for s,k in keys.items()}
    ttl = HISTORY_TTL_SECONDS[(period, interval)]
    fresh, stale = _cached("history", list(identities), identities, ttl)
    missing = [s for s in symbols if s not in fresh]
    if missing:
        data = refreshes.get(("md_histories", period, interval, *missing),
                             lambda: _load_histories(missing, period, interval), stale) or {}
        ready, _ = _cached("history", [keys[s] for s in missing], identities, ttl)
        fresh.update({**data, **ready})
    return fresh

def get_history(ticker, period, interval):
    ticker = symbol(ticker)
    return get_histories([ticker], period, interval).get(ticker) if ticker else None

def _load_search(query):
    for provider in (massive.search, fmp.search, alpha.search, yahoo.search):
        rows = _safe(provider, query) or []
        rows = [r for r in rows if symbol(r.get("ticker")) and r.get("name")][:10]
        if rows:
            save_snapshot("md_search", query.lower(), rows)
            return rows
    return []

def search_assets(query):
    query = str(query or "").strip()[:120]
    if not query:
        return []
    cached = load_snapshot("md_search", query.lower(), SEARCH_TTL_SECONDS)
    if isinstance(cached, list):
        return cached
    stale = load_snapshot("md_search", query.lower(), 7*86400) or []
    return refreshes.get(("md_search", query.lower()), lambda: _load_search(query), stale)

def get_market_status():
    cached = load_snapshot("md_status", "US", 60)
    if cached:
        return cached
    def load():
        data = _safe(massive.market_status)
        if data and date_time(data.get("data_timestamp")):
            save_snapshot("md_status", "US", data)
            return data
        return stale_copy(load_snapshot("md_status", "US", 86400))
    stale = stale_copy(load_snapshot("md_status", "US", 86400))
    return refreshes.get(("md_status", "US"), load, stale)

def get_statements(ticker):
    data = get_fundamentals(ticker) or {}
    return {"ticker": symbol(ticker), "statements": data.get("statements") or {},
            "period_basis": data.get("period_basis"), "provenance": provenance(data),
            "partial": data.get("partial", True), "warning": data.get("warning")}
