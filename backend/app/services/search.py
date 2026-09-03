from typing import Dict, List

from .market_provider import search_yahoo


def search_assets(query: str) -> List[Dict]:
    query = str(query or "").strip()
    if not query:
        query = "AAPL"

    results = search_yahoo(query)

    return [
        {
            "ticker": item.get("ticker"),
            "name": item.get("name") or item.get("ticker"),
            "type": item.get("type"),
            "exchange": item.get("exchange") or "",
            "logo_url": None,
        }
        for item in results
        if item.get("ticker")
    ]
