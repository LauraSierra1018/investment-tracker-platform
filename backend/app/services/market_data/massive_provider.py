"""Massive US equity data. Unsupported symbols are left to other adapters."""
from urllib.parse import quote
from .common import number, stamp, epoch, window_start, now, trim_points
from .transport import request

# Only explicit share-class aliases; never turn an international suffix into a US listing.
ALIASES = {"BRK-B": "BRK.B", "BRK-A": "BRK.A", "BF-B": "BF.B", "BF-A": "BF.A"}

def api_symbol(ticker):
    if ticker in ALIASES:
        return ALIASES[ticker]
    return ticker if ticker.isalpha() and len(ticker) <= 5 else None

def quotes(symbols):
    mapping = {api_symbol(s): s for s in symbols if api_symbol(s)}
    if not mapping:
        return {}
    payload = request("massive", "/v2/snapshot/locale/us/markets/stocks/tickers",
                      {"tickers": ",".join(mapping)}) or {}
    result = {}
    for row in payload.get("tickers") or []:
        ticker = mapping.get(row.get("ticker"))
        if not ticker:
            continue
        trade, minute, day, previous = (row.get(k) or {} for k in ("lastTrade", "min", "day", "prevDay"))
        # Use a bar close, which follows eligible-trade conditions, rather than any last trade.
        price = number(minute.get("c"))
        timestamp = epoch(minute.get("t"), 1000)
        kind = "minute_close"
        if price is None or not timestamp:
            price, timestamp = number(trade.get("p")), epoch(trade.get("t"), 1e9)
            kind = "last_trade"
        if price is None or not timestamp:
            continue
        prev = number(previous.get("c"))
        result[ticker] = {**stamp("massive", ticker, timestamp, "USD", quote_kind=kind),
            "price": price, "previous_close": prev,
            "change_percent": (price/prev-1)*100 if prev and prev > 0 else None,
            "volume": number(day.get("v")),
            "warning": "La disponibilidad y el retraso de la cotización dependen del plan contratado."}
    # Plans without snapshots can still provide verified end-of-day bars.
    for ticker in mapping.values():
        if ticker in result:
            continue
        data = history(ticker, "5d", "1d")
        if not data:
            continue
        points = data["points"]
        last = points[-1]
        previous = points[-2]["close"] if len(points) > 1 else None
        result[ticker] = {**stamp("massive", ticker, last["date"], "USD", quote_kind="daily_bar"),
            "price": last["close"], "previous_close": previous, "volume": last.get("volume"),
            "change_percent": (last["close"]/previous-1)*100 if previous and previous > 0 else None,
            "warning": "Cotización basada en la última barra diaria disponible."}
    return result

def history(ticker, period, interval):
    remote = api_symbol(ticker)
    units = {"5m": (5, "minute"), "15m": (15, "minute"), "1d": (1, "day"), "1wk": (1, "week")}
    if not remote or interval not in units:
        return None
    multiplier, unit = units[interval]
    path = f"/v2/aggs/ticker/{quote(remote, safe='')}/range/{multiplier}/{unit}/{window_start(period)}/{now().date()}"
    payload = request("massive", path, {"adjusted": "true", "sort": "asc", "limit": 50000}) or {}
    # Supported windows fit in one 50k page; never silently accept a truncated response.
    if payload.get("ticker") != remote or payload.get("adjusted") is not True or payload.get("next_url"):
        return None
    points = [{"date": epoch(r.get("t"), 1000), "open": number(r.get("o")),
               "high": number(r.get("h")), "low": number(r.get("l")), "close": number(r.get("c")),
               "volume": number(r.get("v"))} for r in payload.get("results") or []]
    if any(not p["date"] for p in points):
        return None
    # Match the regular-session Yahoo fallback for intraday bars.
    if interval in {"5m", "15m"}:
        from zoneinfo import ZoneInfo
        from datetime import datetime, time
        eastern = ZoneInfo("America/New_York")
        points = [p for p in points if time(9, 30) <= datetime.fromisoformat(p["date"]).astimezone(eastern).time() < time(16)]
    points = trim_points(points, period)
    if not points:
        return None
    return {**stamp("massive", ticker, points[-1]["date"], "USD"),
            "period": period, "interval": interval, "points": points, "price_basis": "split_adjusted",
            "session": "regular"}

def search(query):
    payload = request("massive", "/v3/reference/tickers",
                      {"search": query, "market": "stocks", "active": "true", "limit": 10}) or {}
    reverse = {v: k for k, v in ALIASES.items()}
    return [{"ticker": reverse.get(r["ticker"], r["ticker"]), "name": r.get("name") or r["ticker"],
             "exchange": r.get("primary_exchange"), "type": "ETF" if r.get("type") == "ETF" else "Stock",
             "provider": "massive"} for r in payload.get("results") or []
            if r.get("ticker") and r.get("type") in {"CS", "ETF", "ADRC", "PFD"}]

def market_status():
    data = request("massive", "/v1/marketstatus/now") or {}
    if data.get("market") not in {"open", "closed", "extended-hours"} or not data.get("serverTime"):
        return None
    return {**stamp("massive", "US", data["serverTime"]), "market": data["market"],
            "exchanges": data.get("exchanges") or {}}
