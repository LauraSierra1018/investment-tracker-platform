"""Shared market discovery. No watchlists, account IDs or portfolio data are sent to Yahoo."""
from datetime import datetime, timezone
import re
import yfinance as yf
from .market_requests import refreshes, yahoo_session, remaining_budget
from .market_snapshot import load_snapshot, save_snapshot, load_snapshots
from .market_provider import _load_get_fundamentals, FUNDAMENTALS_TTL_SECONDS
from .recommendation_fit import number
from .scoring import evaluate
from .market_data import fmp_provider
from .market_data.common import valid, provenance

CATALOG_TTL = 6 * 60 * 60
# Seeds extend discovery to ETF categories unsupported by EquityQuery in 0.2.65.
# They are identifiers to research, not a recommendation list or assumed metrics.
ETF_SEEDS = ("VTI", "VXUS", "VOO", "VT", "BND", "BNDX", "SGOV", "SHY",
             "SCHD", "VIG", "USMV", "QUAL", "VUG", "VTV", "IWM", "VEA", "VWO", "VNQ")
_key = ("research_discovery", "catalog")


def as_candidate(row):
    ticker = str(row.get("symbol") or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=-]{0,29}", ticker):
        return None
    if row.get("quoteType", "EQUITY") not in {"EQUITY", "ETF"}:
        return None
    price = number(row.get("regularMarketPrice"))
    if price is None or price <= 0:
        return None
    dividend = number(row.get("trailingAnnualDividendYield"))
    return {"ticker": ticker, "company": row.get("longName") or row.get("shortName") or ticker,
            "asset_type": row.get("quoteType", "EQUITY"), "sector": row.get("sector"),
            "price": price, "currency": row.get("currency"), "market_cap": number(row.get("marketCap")),
            "pe_ratio": number(row.get("trailingPE")), "beta": number(row.get("beta")),
            "score": None, "dividend_yield_pct": dividend*100 if dividend is not None else None,
            "source": "yahoo_discovery", "fetched_at": datetime.now(timezone.utc).isoformat()}


def _discover():
    primary = fmp_provider.discover()
    if primary:
        payload = {"items": primary, "next_offset": 0, "partial": True,
                   "fetched_at": datetime.now(timezone.utc).isoformat()}
        save_snapshot("research_catalog", "default", payload)
        return payload
    previous = load_snapshot("research_catalog", "default", CATALOG_TTL*4) or {}
    # Paginate the broad screen across refreshes; merge still-current discoveries.
    offset = int(previous.get("next_offset", 0))
    queries = [
        (yf.EquityQuery("AND", [yf.EquityQuery("GT", ["intradayprice", 0]),
                               yf.EquityQuery("GT", ["dayvolume", 10000])]),
         {"size": 100, "offset": offset, "sortField": "intradaymarketcap", "sortAsc": False}),
        ("undervalued_growth_stocks", {"count": 50}),
        ("undervalued_large_caps", {"count": 50}),
        (yf.EquityQuery("AND", [yf.EquityQuery("GT", ["forward_dividend_yield", 0]),
                               yf.EquityQuery("GT", ["dayvolume", 10000])]),
         {"size": 50, "sortField": "intradaymarketcap", "sortAsc": False}),
    ]
    items = {r["ticker"]: r for r in previous.get("items", []) if fresh(r.get("fetched_at"), CATALOG_TTL*4)}
    completed, failed, next_offset = 0, 0, offset
    for index, (query, kwargs) in enumerate(queries):
        if remaining_budget() < 2:
            failed += 1
            continue
        try:
            result = yf.screen(query, session=yahoo_session, **kwargs)
            rows = result.get("quotes") or []
            for row in rows:
                candidate = as_candidate(row)
                if candidate:
                    items[candidate["ticker"]] = candidate
            completed += 1
            if index == 0:
                total = int(result.get("total", len(rows)))
                next_offset = offset + len(rows) if rows and offset + len(rows) < total else 0
        except Exception:
            failed += 1
    if not completed:
        return None
    payload = {"items": list(items.values()), "next_offset": next_offset,
               "partial": bool(failed), "fetched_at": datetime.now(timezone.utc).isoformat()}
    save_snapshot("research_catalog", "default", payload)
    return payload


def fresh(value, seconds=86400):
    if not value:
        return False
    try:
        dt = datetime.fromisoformat(str(value))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return 0 <= (datetime.now(timezone.utc)-dt).total_seconds() <= seconds
    except (ValueError, TypeError):
        return False


def from_fundamentals(ticker, data):
    metrics = {key: number(data.get(key)) for key in
               ("pe_ratio", "revenue_growth_pct", "earnings_growth_pct", "roe_pct", "roa_pct",
                "operating_margin_pct", "debt_to_equity", "current_ratio", "beta")}
    for target, source, scale in (("market_cap_b", "market_cap", 1e9), ("revenue_m", "revenue", 1e6),
                                   ("free_cash_flow_m", "free_cash_flow", 1e6)):
        value = number(data.get(source))
        metrics[target] = value/scale if value is not None else None
    score = evaluate(metrics)[0] if any(v is not None for v in metrics.values()) else None
    return {**data, "ticker": ticker, "score": score, "asset_type": data.get("quote_type", "EQUITY"),
            "source": data.get("source"), "provenance": {"fundamentals": provenance(data)}}


def research_candidates(db, registered):
    catalog = load_snapshot("research_catalog", "default", CATALOG_TTL)
    if catalog is None:
        refreshes.get(_key, _discover, wait=0)
        catalog = load_snapshot("research_catalog", "default", CATALOG_TTL*4) or {}
    output = {r["ticker"]: dict(r) for r in catalog.get("items", [])
              if fresh(r.get("fetched_at"), CATALOG_TTL*4)}
    known = {}
    for asset in registered:
        known[asset.ticker.upper()] = asset
        if fresh(asset.updated_at):
            output[asset.ticker.upper()] = {
                "ticker": asset.ticker.upper(), "company": asset.company, "sector": asset.sector,
                "asset_type": asset.asset_type, "score": asset.score, "beta": asset.beta,
                "pe_ratio": asset.pe_ratio, "upside_percent": asset.upside_percent,
                "revenue_growth_pct": asset.revenue_growth_percent,
                "earnings_growth_pct": asset.earnings_growth_percent, "price": asset.last_price,
                "source": "research_universe", "fetched_at": asset.updated_at.isoformat()}
    symbols = list(dict.fromkeys([*known, *ETF_SEEDS, *output]))
    # Bounded SQL batches; this does not download one quote per candidate.
    fundamentals = {}
    for start in range(0, len(symbols), 250):
        fundamentals.update(load_snapshots("md_fundamentals", symbols[start:start+250], FUNDAMENTALS_TTL_SECONDS))
    for ticker, data in fundamentals.items():
        if fresh(data.get("fetched_at")) and valid(data, ticker, "fundamentals"):
            record = from_fundamentals(ticker, data)
            previous = output.get(ticker, {})
            # A quote and fundamentals are distinct datasets. Keep only the observed
            # catalog price, with explicit provenance; never fill missing ratios.
            record["price"] = previous.get("price") if not previous.get("currency") or previous.get("currency") == data.get("currency") else None
            record["provenance"]["quote"] = {"source": previous.get("source"),
                "retrieved_at": previous.get("fetched_at"), "currency": previous.get("currency")}
            output[ticker] = record
    # Refresh a small rotating group. Existing registered assets stay discoverable
    # after 24h, but old numerical data is never treated as newly fetched.
    missing = [s for s in symbols if not fresh(fundamentals.get(s, {}).get("fetched_at"))]
    cursor_state = load_snapshot("research_rotation", "default", 86400) or {}
    cursor = int(cursor_state.get("cursor", 0)) % max(1, len(missing))
    selected = (missing[cursor:] + missing[:cursor])[:4]
    for ticker in selected:
        refreshes.get(("md_fundamentals", ticker), lambda t=ticker: _load_get_fundamentals(t), wait=0)
    if selected:
        save_snapshot("research_rotation", "default", {"cursor": cursor+len(selected)})
    with refreshes.lock:
        refreshing = _key in refreshes.pending or any(("md_fundamentals", t) in refreshes.pending for t in selected)
    return list(output.values()), {"evaluated": len(output), "known": len(symbols),
        "refreshing": refreshing, "partial": bool(catalog.get("partial")) or bool(missing),
        "as_of": catalog.get("fetched_at"),
        "scope": "Research y descubrimiento de mercado; la cobertura depende de los datos disponibles."}
