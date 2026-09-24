"""Yahoo fallback using the existing paced curl_cffi session and serialized batches."""
import pandas as pd
import yfinance as yf
from .common import number, stamp, trim_points
from ..market_requests import download, yahoo_session
from ..market_snapshot import load_snapshot, save_snapshot
from ..market_requests import remaining_budget

def currency_for(ticker):
    key = "yahoo:currency:"+ticker
    cached = load_snapshot("md_input", key, 3*86400)
    if cached:
        return cached.get("currency")
    if remaining_budget() < 2 or not available():
        return None
    try:
        asset = yf.Ticker(ticker, session=yahoo_session)
        asset.history(period="5d", interval="1d", auto_adjust=False, timeout=5)
        meta = asset.get_history_metadata() or {}
        if str(meta.get("symbol") or "").upper() == ticker and meta.get("currency"):
            save_snapshot("md_input", key, {"currency": meta["currency"]})
            return meta["currency"]
    except Exception:
        pass
    return None

def available():
    import time
    return time.monotonic() >= yahoo_session.blocked_until

def history_frame(frame, ticker):
    if frame is None or frame.empty:
        return pd.DataFrame()
    if isinstance(frame.columns, pd.MultiIndex):
        if ticker in frame.columns.get_level_values(0):
            selected = frame[ticker]
        elif ticker in frame.columns.get_level_values(1):
            selected = frame.xs(ticker, axis=1, level=1)
        else:
            return pd.DataFrame()
    else:
        selected = frame
    return selected.dropna(subset=["Close"]).sort_index() if "Close" in selected.columns else pd.DataFrame()

def frame_points(frame):
    if frame is None or frame.empty:
        return []
    return [{"date": index.isoformat() if hasattr(index, "isoformat") else str(index), "open": number(row.get("Open")), "high": number(row.get("High")),
             "low": number(row.get("Low")), "close": number(row.get("Close")), "volume": number(row.get("Volume"))}
            for index,row in frame.iterrows() if number(row.get("Close")) is not None]

def quotes(symbols):
    if not symbols or not available():
        return {}
    try:
        frame = download(yf, tickers=symbols, period="5d", interval="1d", auto_adjust=False, progress=False)
    except Exception:
        return {}
    output = {}
    for ticker in symbols:
        # A plain frame is only safe when exactly one ticker was requested.
        if not isinstance(frame.columns, pd.MultiIndex) and len(symbols) != 1:
            continue
        points = frame_points(history_frame(frame, ticker))
        if not points:
            continue
        price, prev = points[-1]["close"], points[-2]["close"] if len(points)>1 else None
        # Currency comes from Yahoo's own ticker metadata, never a guessed USD default.
        currency = currency_for(ticker)
        output[ticker] = {**stamp("yahoo", ticker, points[-1]["date"], currency, quote_kind="daily_bar"),
            "price": price, "previous_close": prev,
            "change_percent": (price/prev-1)*100 if prev and prev > 0 else None, "volume": points[-1]["volume"],
            "warning": "Cotización de respaldo basada en la última barra diaria disponible."}
    return output

def histories(symbols, period, interval):
    if not symbols or not available():
        return {}
    try:
        frame = download(yf, tickers=symbols, period=period, interval=interval,
                         auto_adjust=False, actions=False, progress=False)
    except Exception:
        return {}
    output = {}
    for ticker in symbols:
        if not isinstance(frame.columns, pd.MultiIndex) and len(symbols) != 1:
            continue
        points = trim_points(frame_points(history_frame(frame, ticker)), period)
        if points:
            output[ticker] = {**stamp("yahoo", ticker, points[-1]["date"], currency_for(ticker)),
                             "period": period, "interval": interval, "points": points,
                             "price_basis": "split_adjusted", "session": "regular"}
    return output

def search(query):
    if not available():
        return []
    try:
        rows = yf.Search(query, max_results=10, news_count=0, session=yahoo_session, timeout=6).quotes or []
    except Exception:
        return []
    return [{"ticker": r["symbol"], "name": r.get("longname") or r.get("shortname") or r["symbol"],
             "exchange": r.get("exchDisp") or r.get("exchange"),
             "type": "ETF" if r.get("quoteType") == "ETF" else "Stock", "provider": "yahoo"}
            for r in rows if r.get("symbol") and r.get("quoteType") in {"EQUITY", "ETF"}]
