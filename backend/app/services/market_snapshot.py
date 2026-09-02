from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..models import MarketDataSnapshot


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _json_default(value: Any):
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def load_snapshot(kind: str, key: str, max_age_seconds: int | None = None) -> dict[str, Any] | list[Any] | None:
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
            return json.loads(row.payload)
        except Exception:
            return None
    finally:
        db.close()


def save_snapshot(kind: str, key: str, payload: dict[str, Any] | list[Any]) -> None:
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
    except Exception:
        db.rollback()
    finally:
        db.close()
