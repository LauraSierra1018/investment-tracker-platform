from typing import Dict, List

import httpx

from .market_provider import search_yahoo


YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"

DEFAULT_SUGGESTIONS: List[Dict] = [
    {"ticker": "AAPL", "name": "Apple Inc.", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "MSFT", "name": "Microsoft Corporation", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "NVDA", "name": "NVIDIA Corporation", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "AMZN", "name": "Amazon.com, Inc.", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "META", "name": "Meta Platforms, Inc.", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "GOOGL", "name": "Alphabet Inc.", "type": "Stock", "exchange": "NASDAQ"},
    {"ticker": "VOO", "name": "Vanguard S&P 500 ETF", "type": "ETF", "exchange": "NYSE Arca"},
    {"ticker": "QQQ", "name": "Invesco QQQ Trust", "type": "ETF", "exchange": "NASDAQ"},
]


def _guess_domain(item: dict) -> str:
    name = str(item.get("name") or item.get("ticker") or "").lower()
    mappings = {
        "apple": "apple.com", "microsoft": "microsoft.com", "nvidia": "nvidia.com",
        "amazon": "amazon.com", "alphabet": "google.com", "google": "google.com",
        "meta": "meta.com", "tesla": "tesla.com", "netflix": "netflix.com",
        "adobe": "adobe.com", "salesforce": "salesforce.com", "uber": "uber.com",
        "airbnb": "airbnb.com", "spotify": "spotify.com", "paypal": "paypal.com",
        "intel": "intel.com", "advanced micro": "amd.com", "nike": "nike.com",
        "walmart": "walmart.com", "disney": "thewaltdisneycompany.com",
    }
    for key, domain in mappings.items():
        if key in name:
            return domain
    return ""


def _with_logo(item: dict) -> Dict:
    asset_type = item.get("type") or "Stock"
    domain = _guess_domain(item) if asset_type == "Stock" else ""
    return {
        "ticker": item.get("ticker"),
        "name": item.get("name") or item.get("ticker"),
        "type": asset_type,
        "exchange": item.get("exchange") or "",
        "logo_url": f"https://logo.clearbit.com/{domain}" if domain else None,
    }


def _direct_yahoo_search(query: str) -> List[Dict]:
    """Autocomplete fallback using Yahoo's lightweight search endpoint.

    This endpoint only resolves symbols/names; it does not fetch quotes or
    fundamentals, so it is intentionally independent from the market-data
    rate-limit circuit.
    """
    try:
        response = httpx.get(
            YAHOO_SEARCH_URL,
            params={
                "q": query,
                "quotesCount": 10,
                "newsCount": 0,
                "enableFuzzyQuery": "true",
                "quotesQueryId": "tss_match_phrase_query",
                "multiQuoteQueryId": "multi_quote_single_token_query",
            },
            headers={"User-Agent": "Mozilla/5.0 InvestmentResearchAI/1.0"},
            timeout=6.0,
        )
        response.raise_for_status()
        payload = response.json()
    except Exception:
        return []

    output: List[Dict] = []
    for item in payload.get("quotes", []):
        quote_type = str(item.get("quoteType") or "").upper()
        symbol = item.get("symbol")
        if not symbol or quote_type not in {"EQUITY", "ETF"}:
            continue
        output.append({
            "ticker": symbol,
            "name": item.get("longname") or item.get("shortname") or symbol,
            "type": "ETF" if quote_type == "ETF" else "Stock",
            "exchange": item.get("exchDisp") or item.get("exchange") or "",
        })
    return output[:10]


def search_assets(query: str) -> List[Dict]:
    query = str(query or "").strip()

    if not query:
        return [_with_logo(item) for item in DEFAULT_SUGGESTIONS]

    results = search_yahoo(query)
    if not results:
        results = _direct_yahoo_search(query)
    if not results:
        symbol = query.upper()
        results = [{"ticker": symbol, "name": symbol, "type": "Stock", "exchange": ""}]

    return [_with_logo(item) for item in results if item.get("ticker")]
