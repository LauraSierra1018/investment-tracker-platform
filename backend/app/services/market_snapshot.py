from __future__ import annotations

from datetime import datetime, timezone
import json
import time
from copy import deepcopy
from sqlalchemy.exc import OperationalError
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import MarketDataSnapshot


# Market data is disposable cache, not user portfolio storage. When PostgreSQL
# is offline, retain only fresh market responses in this process.
_retry_after = 0.0
_memory: dict[tuple[str, str], tuple[float, Any]] = {}


def mark_database_unavailable() -> None:
    global _retry_after
    _retry_after = time.monotonic() + 60


def _memory_snapshot(kind, key, max_age_seconds):
    item = _memory.get((kind, key))
    if item is None:
        return None
    saved, payload = item
    if max_age_seconds is not None and time.monotonic() - saved > max_age_seconds:
        return None
    return deepcopy(payload)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _json_default(value: Any):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def load_snapshot(kind: str, key: str, max_age_seconds: int | None = None) -> dict[str, Any] | list[Any] | None:
    cached = _memory_snapshot(kind, key, max_age_seconds)
    if cached is not None:
        return cached
    if time.monotonic() < _retry_after:
        return None
    db: Session = SessionLocal()
    try:
        row = db.scalar(
            select(MarketDataSnapshot).where(
                MarketDataSnapshot.kind == kind,
                MarketDataSnapshot.cache_key == key,
            )
        )
        if row is None:
            return None

        updated_at = row.updated_at
        if updated_at is not None and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)

        if max_age_seconds is not None and updated_at is not None:
            age = (_utcnow() - updated_at).total_seconds()
            if age > max_age_seconds:
                return None

        try:
            payload = json.loads(row.payload)
            # Preserve original data age: reading SQL must not restart its TTL.
            age = max(0, (_utcnow() - updated_at).total_seconds()) if updated_at else 0
            _remember(kind, key, payload, time.monotonic() - age)
            return payload
        except Exception:
            return None
    except OperationalError:
        mark_database_unavailable()
        return _memory_snapshot(kind, key, max_age_seconds)
    finally:
        db.close()


def save_snapshot(kind: str, key: str, payload: dict[str, Any] | list[Any]) -> None:
    _remember(kind, key, payload)
    if time.monotonic() < _retry_after:
        return
    db: Session = SessionLocal()
    try:
        row = db.scalar(
            select(MarketDataSnapshot).where(
                MarketDataSnapshot.kind == kind,
                MarketDataSnapshot.cache_key == key,
            )
        )
        if row is None:
            row = MarketDataSnapshot(kind=kind, cache_key=key)
            db.add(row)

        row.payload = json.dumps(payload, default=_json_default, separators=(",", ":"))
        row.updated_at = _utcnow()
        db.commit()
    except OperationalError:
        mark_database_unavailable()
        db.rollback()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _remember(kind, key, payload, saved=None):
    if len(_memory) >= 512 and (kind, key) not in _memory:
        _memory.pop(next(iter(_memory)), None)
    _memory[(kind, key)] = (time.monotonic() if saved is None else saved, deepcopy(payload))


def load_snapshots(kind: str, keys: list[str], max_age_seconds: int) -> dict[str, Any]:
    """Read a market batch with one SQL query instead of one per symbol."""
    output = {}
    missing = []
    for key in dict.fromkeys(keys):
        cached = _memory_snapshot(kind, key, max_age_seconds)
        if cached is None:
            missing.append(key)
        else:
            output[key] = cached
    if not missing or time.monotonic() < _retry_after:
        return output
    db = SessionLocal()
    try:
        rows = db.scalars(select(MarketDataSnapshot).where(
            MarketDataSnapshot.kind == kind, MarketDataSnapshot.cache_key.in_(missing)))
        for row in rows:
            updated = row.updated_at
            if updated is None:
                continue
            if updated.tzinfo is None:
                updated = updated.replace(tzinfo=timezone.utc)
            age = max(0, (_utcnow() - updated).total_seconds())
            if age > max_age_seconds:
                continue
            try:
                payload = json.loads(row.payload)
            except (TypeError, ValueError):
                continue
            _remember(kind, row.cache_key, payload, time.monotonic() - age)
            output[row.cache_key] = payload
    except OperationalError:
        mark_database_unavailable()
    finally:
        db.close()
    return output


def save_snapshots(kind: str, payloads: dict[str, Any]) -> None:
    for key, payload in payloads.items():
        _remember(kind, key, payload)
    if not payloads or time.monotonic() < _retry_after:
        return
    db = SessionLocal()
    try:
        rows = {row.cache_key: row for row in db.scalars(select(MarketDataSnapshot).where(
            MarketDataSnapshot.kind == kind, MarketDataSnapshot.cache_key.in_(list(payloads))))}
        for key, payload in payloads.items():
            row = rows.get(key)
            if row is None:
                row = MarketDataSnapshot(kind=kind, cache_key=key)
                db.add(row)
            row.payload = json.dumps(payload, default=_json_default, separators=(",", ":"))
            row.updated_at = _utcnow()
        db.commit()
    except OperationalError:
        mark_database_unavailable()
        db.rollback()
    except Exception:
        db.rollback()
    finally:
        db.close()
