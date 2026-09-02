from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BrokerPosition


def sync_snaptrade_preserving_imports(db: Session, app_user_id: str, sync_callable):
    imported_rows = list(
        db.scalars(
            select(BrokerPosition).where(
                BrokerPosition.user_id == app_user_id,
                BrokerPosition.account_id.like("import:%"),
            )
        )
    )

    snapshots = [
        {
            "account_id": row.account_id,
            "authorization_id": row.authorization_id,
            "ticker": row.ticker,
            "quantity": row.quantity,
            "average_cost": row.average_cost,
            "currency": row.currency,
            "company": row.company,
            "asset_type": row.asset_type,
            "last_price": row.last_price,
            "updated_at": row.updated_at,
        }
        for row in imported_rows
    ]

    result = sync_callable(db, app_user_id)

    existing_keys = {
        (row.account_id, row.ticker)
        for row in db.scalars(
            select(BrokerPosition).where(
                BrokerPosition.user_id == app_user_id
            )
        )
    }

    for item in snapshots:
        key = (item["account_id"], item["ticker"])
        if key in existing_keys:
            continue
        db.add(
            BrokerPosition(
                user_id=app_user_id,
                **item,
            )
        )

    db.commit()
    result["imported_snapshots_preserved"] = len(snapshots)
    return result
