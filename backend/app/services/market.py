from datetime import datetime, timezone
from functools import lru_cache
import math
import pandas as pd
import yfinance as yf
from fastapi import HTTPException
from .scoring import evaluate


def safe_num(value, scale=1.0):
    try:
        value=float(value)
        if math.isfinite(value): return value/scale
    except (TypeError,ValueError): pass
    return None

def pct(value):
    x=safe_num(value)
    return x*100 if x is not None else None

@lru_cache(maxsize=256)
def get_stock(ticker: str):
    symbol=ticker.strip().upper()
    if not symbol or len(symbol)>20: raise HTTPException(400,"Ticker inválido")
    t=yf.Ticker(symbol)
    try:
        fast=t.fast_info
        info=t.info or {}
        hist=t.history(period="1y", interval="1d", auto_adjust=True)
    except Exception as exc:
        raise HTTPException(502,f"No fue posible consultar la fuente de mercado: {exc}")
    if not info and (hist is None or hist.empty): raise HTTPException(404,"No se encontró el activo")
    price=safe_num(info.get("currentPrice") or info.get("regularMarketPrice") or getattr(fast,"last_price",None))
    target=safe_num(info.get("targetMeanPrice"))
    shares=safe_num(info.get("sharesOutstanding")); float_shares=safe_num(info.get("floatShares"))
    free_float=(float_shares/shares*100) if shares and float_shares else None
    metrics={
      "market_cap_b": safe_num(info.get("marketCap"),1e9),
      "pe_ratio": safe_num(info.get("trailingPE") or info.get("forwardPE")),
      "revenue_m": safe_num(info.get("totalRevenue"),1e6),
      "free_float_pct": free_float,
      "upside_pct": ((target-price)/price*100) if target and price else None,
      "revenue_growth_pct": pct(info.get("revenueGrowth")),
      "earnings_growth_pct": pct(info.get("earningsGrowth")),
      "roe_pct": pct(info.get("returnOnEquity")),
      "roa_pct": pct(info.get("returnOnAssets")),
      "operating_margin_pct": pct(info.get("operatingMargins")),
      "debt_to_equity": safe_num(info.get("debtToEquity")),
      "current_ratio": safe_num(info.get("currentRatio")),
      "free_cash_flow_m": safe_num(info.get("freeCashflow"),1e6),
      "beta": safe_num(info.get("beta")),
    }
    score,classification,criteria,strengths,risks,missing=evaluate(metrics)
    return {
      "ticker":symbol,"company":info.get("longName") or info.get("shortName") or symbol,
      "exchange":info.get("exchange"),"currency":info.get("currency") or "USD",
      "sector":info.get("sector"),"industry":info.get("industry"),"price":price,"target_price":target,
      "market_cap":safe_num(info.get("marketCap")),"pe_ratio":metrics["pe_ratio"],"revenue":safe_num(info.get("totalRevenue")),
      "free_float_percent":free_float,"volume":safe_num(info.get("volume")),"average_volume":safe_num(info.get("averageVolume")),
      "score":score,"classification":classification,"criteria":criteria,"strengths":strengths,"risks":risks,"missing_data":missing,
      "updated_at":datetime.now(timezone.utc),"source":"Yahoo Finance via yfinance"
    }

def search(query: str):
    q=query.strip()
    if not q: return []
    try:
        s=yf.Search(q,max_results=8,news_count=0)
        quotes=getattr(s,"quotes",[]) or []
        results=[]
        for item in quotes:
            if item.get("symbol"):
                results.append({"ticker":item["symbol"],"name":item.get("shortname") or item.get("longname") or item["symbol"],"exchange":item.get("exchDisp") or item.get("exchange"),"type":item.get("quoteType")})
        return results
    except Exception:
        return [{"ticker":q.upper(),"name":q.upper(),"exchange":None,"type":"EQUITY"}]

def history(ticker: str, period="1y"):
    allowed={"1mo","3mo","6mo","1y","2y","5y"}
    if period not in allowed: period="1y"
    try:
        df=yf.Ticker(ticker.upper()).history(period=period,interval="1d",auto_adjust=True)
    except Exception as exc: raise HTTPException(502,str(exc))
    if df.empty: return []
    return [{"date":idx.date().isoformat(),"close":round(float(row.Close),4),"volume":int(row.Volume)} for idx,row in df.iterrows()]
