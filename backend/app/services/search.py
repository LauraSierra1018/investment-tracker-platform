from typing import List, Dict

import requests


YAHOO_SEARCH_URL = "https://query2.finance.yahoo.com/v1/finance/search"


def search_assets(query: str) -> List[Dict]:
    query = query.strip()

    if not query:
        query = "AAPL"

    params = {
        "q": query,
        "quotesCount": 10,
        "newsCount": 0,
        "enableFuzzyQuery": "true",
        "quotesQueryId": "tss_match_phrase_query",
        "multiQuoteQueryId": "multi_quote_single_token_query",
    }

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 Chrome/120 Safari/537.36"
        )
    }

    response = requests.get(
        YAHOO_SEARCH_URL,
        params=params,
        headers=headers,
        timeout=10,
    )

    response.raise_for_status()

    data = response.json()

    results = []

    for item in data.get("quotes", []):
        quote_type = item.get("quoteType")

        if quote_type not in {"EQUITY", "ETF"}:
            continue

        symbol = item.get("symbol")

        if not symbol:
            continue

        results.append(
            {
                "ticker": symbol,
                "name": (
                    item.get("longname")
                    or item.get("shortname")
                    or symbol
                ),
                "type": "ETF" if quote_type == "ETF" else "Stock",
                "exchange": (
                    item.get("exchDisp")
                    or item.get("exchange")
                    or ""
                ),
                "logo_url": (
                    f"https://logo.clearbit.com/"
                    f"{_guess_domain(item)}"
                    if quote_type == "EQUITY"
                    else None
                ),
            }
        )

    return results


def _guess_domain(item: dict) -> str:
    name = (
        item.get("longname")
        or item.get("shortname")
        or ""
    ).lower()

    mappings = {
        "apple": "apple.com",
        "microsoft": "microsoft.com",
        "nvidia": "nvidia.com",
        "amazon": "amazon.com",
        "alphabet": "google.com",
        "google": "google.com",
        "meta": "meta.com",
        "tesla": "tesla.com",
        "netflix": "netflix.com",
        "adobe": "adobe.com",
        "salesforce": "salesforce.com",
        "uber": "uber.com",
        "airbnb": "airbnb.com",
        "spotify": "spotify.com",
        "paypal": "paypal.com",
        "intel": "intel.com",
        "amd": "amd.com",
        "coca-cola": "coca-colacompany.com",
        "coca cola": "coca-colacompany.com",
        "nike": "nike.com",
        "disney": "thewaltdisneycompany.com",
        "walmart": "walmart.com",
    }

    for key, domain in mappings.items():
        if key in name:
            return domain

    return ""