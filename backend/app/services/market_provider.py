"""Compatibility facade: existing callers use the centralized market-data policy."""
from .market_data.market_data_service import (
    get_quote, get_quotes, get_fundamentals, get_history, get_histories,
    search_assets as search_yahoo, _load_get_fundamentals,
    QUOTE_TTL_SECONDS, FUNDAMENTALS_TTL_SECONDS, HISTORY_TTL_SECONDS, SEARCH_TTL_SECONDS,
)
