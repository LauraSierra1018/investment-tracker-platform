from typing import Dict, List

from .market_provider import search_yahoo


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


def search_assets(query: str) -> List[Dict]:
    query = str(query or "").strip()

    if not query:
        return [_with_logo(item) for item in DEFAULT_SUGGESTIONS]

    results = search_yahoo(query)
    if not results:
        # Suggestions are known identifiers, never an invented asset for arbitrary input.
        results = [item for item in DEFAULT_SUGGESTIONS if query.lower() in
                   (item["ticker"]+" "+item["name"]).lower()]

    return [_with_logo(item) for item in results if item.get("ticker")]
