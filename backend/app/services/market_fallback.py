from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..config import settings


def safe_num(value: Any) -> float | None:
    try:
        if value in (None, "", "None", "-", "N/A"):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def pct(value: Any) -> float | None:
    number = safe_num(value)
    return number * 100 if number is not None else None


def alpha_request(params: dict[str, str]) -> dict[str, Any] | None:
    api_key = (settings.alpha_vantage_api_key or "").strip()
    if not api_key:
        return None

    query = dict(params)
    query["apikey"] = api_key
    url = "https://www.alphavantage.co/query?" + urlencode(query)

    try:
        request = Request(url, headers={"User-Agent": "InvestmentResearchAI/1.0"})
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        if payload.get("Note") or payload.get("Information"):
            return None
        return payload
    except Exception:
        return None


def alpha_stock_raw(symbol: str) -> dict[str, Any] | None:
    overview = alpha_request({"function": "OVERVIEW", "symbol": symbol}) or {}
    quote_payload = alpha_request({"function": "GLOBAL_QUOTE", "symbol": symbol}) or {}
    quote = quote_payload.get("Global Quote") or {}

    if not overview and not quote:
        return None

    return {
        "symbol": symbol,
        "company": overview.get("Name") or symbol,
        "description": overview.get("Description"),
        "exchange": overview.get("Exchange"),
        "currency": overview.get("Currency") or "USD",
        "quote_type": overview.get("AssetType"),
        "sector": overview.get("Sector"),
        "industry": overview.get("Industry"),
        "price": safe_num(quote.get("05. price")),
        "previous_close": safe_num(quote.get("08. previous close")),
        "target_price": safe_num(overview.get("AnalystTargetPrice")),
        "market_cap": safe_num(overview.get("MarketCapitalization")),
        "pe_ratio": safe_num(overview.get("PERatio") or overview.get("TrailingPE") or overview.get("ForwardPE")),
        "revenue": safe_num(overview.get("RevenueTTM")),
        "volume": safe_num(quote.get("06. volume")),
        "beta": safe_num(overview.get("Beta")),
        "revenue_growth_pct": pct(overview.get("QuarterlyRevenueGrowthYOY")),
        "earnings_growth_pct": pct(overview.get("QuarterlyEarningsGrowthYOY")),
        "roe_pct": pct(overview.get("ReturnOnEquityTTM")),
        "roa_pct": pct(overview.get("ReturnOnAssetsTTM")),
        "operating_margin_pct": pct(overview.get("OperatingMarginTTM")),
    }
