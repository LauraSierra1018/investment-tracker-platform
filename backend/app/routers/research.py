from fastapi import APIRouter, Query

from ..services.history import get_price_history
from ..services.market_data.risk import get_risk
from ..services.market_data.market_data_service import get_statements, get_market_status


router = APIRouter(tags=["Research"])


@router.get("/stocks/{ticker}/risk")
def stock_risk(ticker: str):
    return get_risk(ticker)


@router.get("/stocks/{ticker}/statements")
def stock_statements(ticker: str):
    return get_statements(ticker)


@router.get("/market/status")
def market_status():
    data = get_market_status()
    return data or {"market": "unknown", "source": None, "data_timestamp": None}


@router.get("/stocks/{ticker}/history")
def stock_history(
    ticker: str,
    range: str = Query(default="1M", alias="range"),
):
    return get_price_history(ticker=ticker, range_key=range)
