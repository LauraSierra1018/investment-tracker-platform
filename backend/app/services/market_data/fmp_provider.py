from .common import number, stamp, epoch, date_time, now
from .financials import normalize, annual_metrics
from .transport import request
from ..market_snapshot import load_snapshot, save_snapshot

PROFILE_TTL = 3*86400
STATEMENT_TTL = 86400

def resource(endpoint, ticker, ttl, kind=None):
    key = f"fmp:{endpoint}:{ticker}"
    cached = load_snapshot("md_input", key, ttl)
    if cached:
        return cached
    params = {"symbol": ticker}
    if kind:
        params.update(period="annual", limit=3)
    rows = request("fmp", "/"+endpoint, params)
    if not isinstance(rows, list) or not rows:
        return None
    if kind:
        value = normalize(rows, kind, "fmp", ticker)
    else:
        value = next((r for r in rows if r.get("symbol") == ticker and r.get("companyName") and r.get("currency")), None)
    if not value:
        return None
    data = {"value": value, **stamp("fmp", ticker)}
    save_snapshot("md_input", key, data)
    return data

def profile(ticker):
    data = resource("profile", ticker, PROFILE_TTL)
    if not data:
        return None
    row = data["value"]
    return {**stamp("fmp", ticker, currency=row["currency"]), "retrieved_at": data["retrieved_at"],
            "fetched_at": data["retrieved_at"], "company": row["companyName"],
            "description": row.get("description"), "exchange": row.get("exchangeShortName") or row.get("exchange"),
            "sector": row.get("sector"), "industry": row.get("industry"),
            "quote_type": "ETF" if row.get("isEtf") else "EQUITY", "beta": number(row.get("beta")),
            "market_cap": number(row.get("marketCap")),
            "market_cap_as_of": data["retrieved_at"]}

def supplement(endpoint, ticker, fields):
    """Cache a complete same-symbol component; denied endpoints never erase statements."""
    key = f"fmp:{endpoint}:{ticker}"
    cached = load_snapshot("md_input", key, STATEMENT_TTL)
    if cached:
        return cached
    rows = request("fmp", "/"+endpoint, {"symbol": ticker})
    if not isinstance(rows, list):
        return None
    row = next((r for r in rows if isinstance(r, dict) and r.get("symbol") == ticker), None)
    if not row:
        return None
    values = {target: number(row.get(source)) for target, source in fields.items()}
    if not any(v is not None and v > 0 for v in values.values()):
        return None
    observed = date_time(row.get("date"))
    if observed and observed > now():
        return None
    data = {**stamp("fmp", ticker, observed.isoformat() if observed else None), "value": values}
    save_snapshot("md_input", key, data)
    return data

def fundamentals(ticker):
    company = profile(ticker)
    if not company:
        return None
    statements, components = {}, {"profile": {k: company.get(k) for k in ("retrieved_at", "data_timestamp", "currency")}}
    if company.get("quote_type") == "ETF":
        return {**company, "statements": {}, "components": components, "partial": False,
                "warning": "Un ETF no tiene estados financieros corporativos comparables."}
    for kind, endpoint in (("income", "income-statement"), ("balance", "balance-sheet-statement"), ("cash_flow", "cash-flow-statement")):
        data = resource(endpoint, ticker, STATEMENT_TTL, kind)
        statements[kind] = data["value"] if data else []
        if data:
            components[kind] = {"retrieved_at": data["retrieved_at"],
                                "data_timestamp": data["value"][0]["period_end"],
                                "currency": data["value"][0]["currency"]}
    metrics = annual_metrics(statements)
    extras = {}
    for name, endpoint, fields in (
        ("share_float", "shares-float", {"float_shares": "floatShares", "shares_outstanding": "outstandingShares"}),
        ("analyst_target", "price-target-consensus", {"target_price": "targetConsensus"}),
    ):
        data = supplement(endpoint, ticker, fields)
        if data:
            values = data["value"]
            if name == "share_float" and not (
                values.get("shares_outstanding") and values["shares_outstanding"] > 0
                and values.get("float_shares") is not None
                and 0 <= values["float_shares"] <= values["shares_outstanding"]
            ):
                continue
            extras.update({k: v for k, v in values.items() if v is not None and v >= 0})
            components[name] = {k: data.get(k) for k in ("retrieved_at", "data_timestamp")}
            components[name]["currency"] = company["currency"] if name == "analyst_target" else None
    retrieved = min((c["retrieved_at"] for k,c in components.items() if k != "profile"), default=company["retrieved_at"])
    return {**company, "partial": True, **metrics, **extras, "statements": statements,
            "retrieved_at": retrieved, "fetched_at": retrieved, "components": components,
            "warning": "Estados financieros incompletos." if not metrics or metrics.get("partial") else None}

def quotes(symbols):
    output = {}
    # The single-symbol stable quote endpoint is available across more plans than bulk quotes.
    for ticker in symbols:
        rows = request("fmp", "/quote", {"symbol": ticker}) or []
        if not isinstance(rows, list):
            continue
        row = next((r for r in rows if r.get("symbol") == ticker), None)
        if not row:
            continue
        company = profile(ticker) or {}
        price, previous = number(row.get("price")), number(row.get("previousClose"))
        output[ticker] = {**stamp("fmp", ticker, epoch(row.get("timestamp")), company.get("currency"), quote_kind="quote"),
                         "price": price, "previous_close": previous,
                         "change_percent": (price/previous-1)*100 if price is not None and previous and previous > 0 else None,
                         "volume": number(row.get("volume")), "market_cap": number(row.get("marketCap"))}
    return output

def search(query):
    results = []
    for endpoint in ("search-symbol", "search-name"):
        rows = request("fmp", "/"+endpoint, {"query": query, "limit": 10}) or []
        if isinstance(rows, list):
            for r in rows:
                if r.get("symbol") and r.get("name"):
                    results.append({"ticker": r["symbol"], "name": r["name"], "exchange": r.get("exchangeShortName") or r.get("exchange"),
                                    "type": "Stock", "provider": "fmp"})
        if results:
            break
    return results[:10]

def discover():
    rows = request("fmp", "/company-screener", {"isActivelyTrading": "true", "volumeMoreThan": 10000, "limit": 200})
    if not isinstance(rows, list):
        return []
    return [{"ticker": r["symbol"], "company": r.get("companyName") or r["symbol"],
             "asset_type": "ETF" if r.get("isEtf") else "EQUITY", "sector": r.get("sector"),
             "price": number(r.get("price")), "currency": r.get("currency"),
             "market_cap": number(r.get("marketCap")), "beta": number(r.get("beta")),
             "source": "fmp_discovery", "fetched_at": stamp("fmp", r["symbol"])["retrieved_at"]}
            for r in rows if r.get("symbol") and number(r.get("price")) and number(r.get("price")) > 0]
