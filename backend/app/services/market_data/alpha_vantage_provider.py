from .common import number, stamp
from .financials import normalize, annual_metrics
from .transport import request
from ..market_snapshot import load_snapshot, save_snapshot

def alpha_request(params):
    result = request("alpha_vantage", "/query", params)
    return result if isinstance(result, dict) else None

def resource(function, ticker, kind=None):
    key = f"alpha:{function}:{ticker}"
    cached = load_snapshot("md_input", key, 86400)
    if cached:
        return cached
    payload = alpha_request({"function": function, "symbol": ticker}) or {}
    if (payload.get("symbol") if kind else payload.get("Symbol")) != ticker:
        return None
    value = normalize(payload.get("annualReports"), kind, "alpha_vantage", ticker) if kind else payload
    if not value:
        return None
    data = {"value": value, **stamp("alpha_vantage", ticker)}
    save_snapshot("md_input", key, data)
    return data

def fundamentals(ticker):
    data = resource("OVERVIEW", ticker)
    if not data:
        return None
    row = data["value"]
    result = {**stamp("alpha_vantage", ticker, row.get("LatestQuarter"), row.get("Currency")),
        "retrieved_at": data["retrieved_at"], "fetched_at": data["retrieved_at"],
        "company": row.get("Name") or ticker, "description": row.get("Description"),
        "exchange": row.get("Exchange"), "sector": row.get("Sector"), "industry": row.get("Industry"),
        "quote_type": row.get("AssetType"), "period_basis": "TTM",
        "financial_currency": row.get("Currency")}
    mapping = {"target_price": "AnalystTargetPrice", "market_cap": "MarketCapitalization",
               "pe_ratio": "PERatio", "eps": "EPS", "revenue": "RevenueTTM", "shares_outstanding": "SharesOutstanding",
               "beta": "Beta"}
    percent = {"revenue_growth_pct": "QuarterlyRevenueGrowthYOY", "earnings_growth_pct": "QuarterlyEarningsGrowthYOY",
               "roe_pct": "ReturnOnEquityTTM", "roa_pct": "ReturnOnAssetsTTM", "operating_margin_pct": "OperatingMarginTTM",
               "dividend_yield_pct": "DividendYield"}
    result.update({k: number(row.get(v)) for k,v in mapping.items()})
    result.update({k: number(row.get(v))*100 if number(row.get(v)) is not None else None for k,v in percent.items()})
    statements, components = {}, {}
    for kind, function in (("income", "INCOME_STATEMENT"), ("balance", "BALANCE_SHEET"), ("cash_flow", "CASH_FLOW")):
        report = resource(function, ticker, kind)
        statements[kind] = report["value"] if report else []
        if report:
            components[kind] = {"retrieved_at": report["retrieved_at"], "data_timestamp": report["value"][0]["period_end"]}
    result["statements"] = statements
    result["components"] = {"overview": {"retrieved_at": data["retrieved_at"], "data_timestamp": row.get("LatestQuarter")}, **components}
    # Keep the overview's TTM metrics as one dataset; annual statements are separate.
    # Do not overwrite TTM revenue/earnings with one annual statement.
    result["partial"] = not all(statements.values())
    result["warning"] = "Ratios TTM del proveedor; estados anuales incompletos." if result["partial"] else None
    return result

def search(query):
    payload = alpha_request({"function": "SYMBOL_SEARCH", "keywords": query}) or {}
    return [{"ticker": r["1. symbol"], "name": r.get("2. name") or r["1. symbol"],
             "exchange": r.get("4. region"), "type": "ETF" if "etf" in str(r.get("3. type")).lower() else "Stock",
             "provider": "alpha_vantage"} for r in payload.get("bestMatches") or []
            if r.get("1. symbol") and str(r.get("3. type")).lower() in {"equity", "etf"}][:10]
