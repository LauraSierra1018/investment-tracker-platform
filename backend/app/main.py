from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import select
from .config import settings
from .db import Base, engine, get_db
from .models import WatchlistItem, PortfolioPosition
from .schemas import *
from .services.market import get_stock, search, history
from .services.market_overview import market_overview
from .services.ai import analyze
from .services.search import search_assets
from .auth import (
    AuthUser,
    get_current_user,
)

Base.metadata.create_all(engine)
app=FastAPI(title="Investment Research API",version="2.0.0")
app.add_middleware(CORSMiddleware,allow_origins=[settings.frontend_origin,"http://127.0.0.1:3000"],allow_credentials=True,allow_methods=["*"],allow_headers=["*"])

@app.get("/health")
def health(): return {"status":"ok"}
@app.get("/search",response_model=list[SearchResult])
def stock_search(q:str): return search(q)
@app.get("/stocks/{ticker}",response_model=StockSummary)
def stock_detail(ticker:str): return get_stock(ticker)
@app.get("/stocks/{ticker}/history")
def stock_history(ticker:str,period:str="1y"): return history(ticker,period)
@app.get("/market/overview")
def overview(): return market_overview()
@app.post("/ai/analyze",response_model=AiResponse)
def ai_analysis(body:AiRequest): return analyze(body.ticker)

@app.get(
    "/watchlist",
    response_model=list[WatchlistOut],
)
def watchlist(
    user: AuthUser = Depends(
        get_current_user
    ),
    db: Session = Depends(get_db),
):
    statement = (
        select(WatchlistItem)
        .where(
            WatchlistItem.user_id
            == user.id
        )
        .order_by(
            WatchlistItem.created_at.desc()
        )
    )

    return list(
        db.scalars(statement)
    )


@app.post(
    "/watchlist",
    response_model=WatchlistOut,
)
def add_watchlist(
    body: WatchlistCreate,

    user: AuthUser = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    ticker = (
        body.ticker
        .strip()
        .upper()
    )

    existing = db.scalar(
        select(WatchlistItem).where(
            WatchlistItem.user_id
            == user.id,

            WatchlistItem.ticker
            == ticker,
        )
    )

    if existing:
        return existing

    item = WatchlistItem(
        user_id=user.id,
        ticker=ticker,
    )

    db.add(item)

    try:
        db.commit()
        db.refresh(item)

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail=(
                "No fue posible guardar "
                "el activo."
            ),
        ) from exc

    return item


@app.delete(
    "/watchlist/{ticker}"
)
def delete_watchlist(
    ticker: str,

    user: AuthUser = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    item = db.scalar(
        select(WatchlistItem).where(
            WatchlistItem.user_id
            == user.id,

            WatchlistItem.ticker
            == ticker.upper(),
        )
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="Activo no encontrado.",
        )

    db.delete(item)
    db.commit()

    return {
        "deleted": True
    }


@app.get(
    "/portfolio",
    response_model=list[PositionOut],
)
def portfolio(
    user: AuthUser = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    statement = (
        select(PortfolioPosition)
        .where(
            PortfolioPosition.user_id
            == user.id
        )
        .order_by(
            PortfolioPosition.created_at.desc()
        )
    )

    positions = list(
        db.scalars(statement)
    )

    output = []

    for position in positions:
        try:
            price = get_stock(
                position.ticker
            )["price"]

        except Exception:
            price = None

        market_value = (
            price * position.quantity
            if price is not None
            else None
        )

        cost = (
            position.average_cost
            * position.quantity
        )

        pnl = (
            market_value - cost
            if market_value is not None
            else None
        )

        pnl_percent = (
            (pnl / cost) * 100
            if (
                pnl is not None
                and cost
            )
            else None
        )

        output.append(
            PositionOut(
                id=position.id,

                ticker=position.ticker,

                quantity=(
                    position.quantity
                ),

                average_cost=(
                    position.average_cost
                ),

                currency=(
                    position.currency
                ),

                created_at=(
                    position.created_at
                ),

                current_price=price,

                market_value=(
                    market_value
                ),

                unrealized_pnl=pnl,

                unrealized_pnl_percent=(
                    pnl_percent
                ),
            )
        )

    return output


@app.post(
    "/portfolio",
    response_model=PositionOut,
)
def add_position(
    body: PositionCreate,

    user: AuthUser = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    position = PortfolioPosition(
        user_id=user.id,

        ticker=(
            body.ticker
            .strip()
            .upper()
        ),

        quantity=body.quantity,

        average_cost=(
            body.average_cost
        ),

        currency=body.currency,
    )

    db.add(position)
    db.commit()
    db.refresh(position)

    return PositionOut(
        id=position.id,

        ticker=position.ticker,

        quantity=position.quantity,

        average_cost=(
            position.average_cost
        ),

        currency=position.currency,

        created_at=(
            position.created_at
        ),

        current_price=None,

        market_value=None,

        unrealized_pnl=None,

        unrealized_pnl_percent=None,
    )


@app.delete(
    "/portfolio/{position_id}"
)
def delete_position(
    position_id: int,

    user: AuthUser = Depends(
        get_current_user
    ),

    db: Session = Depends(get_db),
):
    position = db.scalar(
        select(
            PortfolioPosition
        ).where(
            PortfolioPosition.id
            == position_id,

            PortfolioPosition.user_id
            == user.id,
        )
    )

    if not position:
        raise HTTPException(
            status_code=404,
            detail=(
                "Posición no encontrada."
            ),
        )

    db.delete(position)
    db.commit()

    return {
        "deleted": True
    }

@app.get("/search")
def search(q: str = ""):
    return search_assets(q)
