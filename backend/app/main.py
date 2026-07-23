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

@app.get("/watchlist",response_model=list[WatchlistOut])
def watchlist(db:Session=Depends(get_db)): return list(db.scalars(select(WatchlistItem).order_by(WatchlistItem.created_at.desc())))
@app.post("/watchlist",response_model=WatchlistOut)
def add_watchlist(body:WatchlistCreate,db:Session=Depends(get_db)):
    item=WatchlistItem(ticker=body.ticker.upper(),label=body.label,note=body.note)
    db.add(item)
    try: db.commit(); db.refresh(item)
    except Exception: db.rollback(); raise HTTPException(409,"El activo ya está en esta lista")
    return item
@app.delete("/watchlist/{item_id}")
def delete_watchlist(item_id:int,db:Session=Depends(get_db)):
    item=db.get(WatchlistItem,item_id)
    if not item: raise HTTPException(404,"No encontrado")
    db.delete(item); db.commit(); return {"deleted":True}

@app.get("/portfolio",response_model=list[PositionOut])
def portfolio(db:Session=Depends(get_db)):
    positions=list(db.scalars(select(PortfolioPosition).order_by(PortfolioPosition.created_at.desc())))
    out=[]
    for p in positions:
        try: price=get_stock(p.ticker)["price"]
        except Exception: price=None
        mv=price*p.quantity if price is not None else None
        cost=p.average_cost*p.quantity
        out.append(PositionOut(id=p.id,ticker=p.ticker,quantity=p.quantity,average_cost=p.average_cost,currency=p.currency,created_at=p.created_at,current_price=price,market_value=mv,unrealized_pnl=(mv-cost) if mv is not None else None,unrealized_pnl_percent=((mv-cost)/cost*100) if mv is not None and cost else None))
    return out
@app.post("/portfolio",response_model=PositionOut)
def add_position(body:PositionCreate,db:Session=Depends(get_db)):
    p=PortfolioPosition(ticker=body.ticker.upper(),quantity=body.quantity,average_cost=body.average_cost,currency=body.currency)
    db.add(p); db.commit(); db.refresh(p); return PositionOut.model_validate(p)
@app.delete("/portfolio/{position_id}")
def delete_position(position_id:int,db:Session=Depends(get_db)):
    p=db.get(PortfolioPosition,position_id)
    if not p: raise HTTPException(404,"No encontrado")
    db.delete(p); db.commit(); return {"deleted":True}

@app.get("/search")
def search(q: str = ""):
    return search_assets(q)
