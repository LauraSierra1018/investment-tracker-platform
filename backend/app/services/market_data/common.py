"""Dataset identity, timestamps and validation shared by every adapter."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import calendar
import math
import re

VERSION = 1
SOURCES = {"massive": "Massive", "fmp": "Financial Modeling Prep",
           "alpha_vantage": "Alpha Vantage", "yahoo": "Yahoo Finance"}

def now():
    return datetime.now(timezone.utc)

def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and not isinstance(value, bool) else None
    except (TypeError, ValueError, OverflowError):
        return None

def symbol(value):
    value = str(value or "").strip().upper()
    return value if re.fullmatch(r"[A-Z0-9^][A-Z0-9.^=\-]{0,29}", value) else ""

def date_time(value):
    if not value:
        return None
    try:
        result = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return result.replace(tzinfo=timezone.utc) if result.tzinfo is None else result.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None

def epoch(value, divisor=1):
    value = number(value)
    try:
        return datetime.fromtimestamp(value/divisor, timezone.utc).isoformat() if value is not None else None
    except (ValueError, OverflowError, OSError):
        return None

def stamp(provider, ticker, timestamp=None, currency=None, **extra):
    retrieved = now().isoformat()
    return {"schema_version": VERSION, "ticker": ticker, "provider": provider,
            "source": SOURCES[provider], "retrieved_at": retrieved, "fetched_at": retrieved,
            "data_timestamp": timestamp, "currency": currency, "stale": False,
            "warning": None, **extra}

def provenance(data):
    return {key: data.get(key) for key in (
        "provider", "source", "retrieved_at", "fetched_at", "data_timestamp",
        "currency", "stale", "warning", "price_basis", "period_basis", "coverage",
        "quote_kind", "partial", "components", "market_cap_as_of")}

def stale_copy(data):
    if not data:
        return None
    result = deepcopy(data)
    result["stale"] = True
    result["warning"] = "Mostrando el último dato verificado; no se pudo actualizar."
    return result

def is_fresh(data, ttl):
    dt = date_time((data or {}).get("retrieved_at"))
    return bool(dt and 0 <= (now()-dt).total_seconds() <= ttl and not data.get("stale"))

def window_start(period):
    today = now().date()
    if period == "ytd":
        return today.replace(month=1, day=1)
    months = {"1mo": 1, "3mo": 3, "6mo": 6, "1y": 12, "2y": 24, "5y": 60}.get(period)
    if months:
        index = today.year*12 + today.month-1 - months
        year, month = divmod(index, 12)
        return today.replace(year=year, month=month+1,
                             day=min(today.day, calendar.monthrange(year, month+1)[1]))
    return today - timedelta(days=7 if period == "1d" else 14)

def trim_points(points, period):
    start = window_start(period).isoformat()
    points = [p for p in points if str(p.get("date", ""))[:10] >= start]
    if period in {"1d", "5d"}:
        sessions = sorted({p["date"][:10] for p in points})[-(1 if period == "1d" else 5):]
        points = [p for p in points if p["date"][:10] in sessions]
    return points

def _finite_tree(value):
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, dict):
        return all(_finite_tree(v) for v in value.values())
    if isinstance(value, list):
        return all(_finite_tree(v) for v in value)
    return True

def valid(data, ticker, kind):
    if not isinstance(data, dict) or data.get("schema_version") != VERSION:
        return False
    if data.get("ticker") != ticker or data.get("provider") not in SOURCES or not _finite_tree(data):
        return False
    fetched = date_time(data.get("retrieved_at"))
    observed = date_time(data.get("data_timestamp"))
    if not fetched or fetched > now()+timedelta(minutes=5):
        return False
    if data.get("data_timestamp") and (not observed or observed > now()+timedelta(minutes=5)):
        return False
    currency = data.get("currency")
    if currency and not re.fullmatch(r"[A-Z]{3}|GBp|GBX", currency):
        return False
    if kind == "quote":
        if any(data.get(k) is not None and (not isinstance(data[k], (int, float)) or isinstance(data[k], bool)) for k in ("price", "previous_close", "volume")):
            return False
        return bool(number(data.get("price")) is not None and data["price"] > 0 and observed
                    and (data.get("previous_close") is None or data["previous_close"] > 0)
                    and (data.get("volume") is None or data["volume"] >= 0))
    if kind == "history":
        points = data.get("points") or []
        previous = None
        for point in points:
            if not isinstance(point, dict) or any(point.get(k) is not None and (not isinstance(point[k], (int,float)) or isinstance(point[k], bool)) for k in ("open", "high", "low", "close", "volume")):
                return False
            dt = date_time(point.get("date"))
            close = number(point.get("close"))
            if not dt or dt > now()+timedelta(minutes=5) or (previous and dt <= previous) or close is None or close <= 0:
                return False
            previous = dt
            values = [number(point.get(k)) for k in ("open", "high", "low", "close")]
            if any(v is not None and v <= 0 for v in values):
                return False
            op, hi, lo, cl = values
            if hi is not None and hi < max(v for v in (op, lo, cl) if v is not None):
                return False
            if lo is not None and lo > min(v for v in (op, hi, cl) if v is not None):
                return False
            if point.get("volume") is not None and (number(point["volume"]) is None or point["volume"] < 0):
                return False
        return bool(points and observed == previous and data.get("price_basis"))
    if kind == "fundamentals":
        return bool(data.get("company") and currency)
    return True

def compatible(candidate, previous, kind):
    """Do not replace verified data with an older observation or another currency."""
    if not previous:
        return True
    old_currency, new_currency = previous.get("currency"), candidate.get("currency")
    if old_currency and old_currency != new_currency:
        return False
    old, new = date_time(previous.get("data_timestamp")), date_time(candidate.get("data_timestamp"))
    # FY and TTM refer to different reporting windows. A latest annual report
    # must not be rejected merely because a TTM overview ends in a later quarter.
    different_window = (kind == "fundamentals"
                        and {candidate.get("period_basis"), previous.get("period_basis")} == {"FY", "TTM"})
    if old and (not new or (new < old and not different_window)):
        return False
    if kind == "quote" and previous.get("provider") != candidate.get("provider") and old and new and (new-old).days < 7:
        # A large discontinuity needs corporate-action verification, not silent substitution.
        before, after = number(previous.get("price")), number(candidate.get("price"))
        if before and after and not 0.25 <= after/before <= 4:
            return False
    if kind == "history" and candidate.get("price_basis") != previous.get("price_basis"):
        return False
    if kind == "fundamentals" and any((previous.get("statements") or {}).values()) and not any((candidate.get("statements") or {}).values()):
        return False
    return True
