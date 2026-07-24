from fastapi import APIRouter, Query

from ..services.history import get_price_history


router = APIRouter(tags=["Research"])


@router.get("/stocks/{ticker}/history")
def stock_history(
    ticker: str,
    range: str = Query(default="1M", alias="range"),
):
    return get_price_history(ticker=ticker, range_key=range)
