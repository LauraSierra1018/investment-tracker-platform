from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from snaptrade_client import SnapTrade, SnapTradeAuth

from ..config import settings

from ..models import BrokerPosition, SnapTradeUser


def _env(name: str) -> str:
    setting_name = name.lower()

    value = getattr(settings, setting_name, None)

    if value:
        return str(value).strip()

    return (os.getenv(name) or "").strip()


def _configured() -> bool:
    return bool(
        _env("SNAPTRADE_CLIENT_ID")
        and _env("SNAPTRADE_CONSUMER_KEY")
        and _env("SNAPTRADE_ENCRYPTION_KEY")
    )


def _require_config():
    if not _configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "SnapTrade todavía no está configurado en el backend. "
                "Faltan SNAPTRADE_CLIENT_ID, SNAPTRADE_CONSUMER_KEY "
                "o SNAPTRADE_ENCRYPTION_KEY."
            ),
        )


def _fernet() -> Fernet:
    _require_config()
    try:
        return Fernet(_env("SNAPTRADE_ENCRYPTION_KEY").encode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="SNAPTRADE_ENCRYPTION_KEY no es una clave Fernet válida.",
        ) from exc


def _encrypt(secret: str) -> str:
    return _fernet().encrypt(secret.encode("utf-8")).decode("utf-8")


def _decrypt(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(
            status_code=500,
            detail="No fue posible descifrar las credenciales de SnapTrade.",
        ) from exc


def _client() -> SnapTrade:
    _require_config()

    auth = SnapTradeAuth.commercial_api_key(
        client_id=_env("SNAPTRADE_CLIENT_ID"),
        consumer_key=_env("SNAPTRADE_CONSUMER_KEY"),
    )

    return SnapTrade(auth=auth)


def _body(response: Any):
    if response is None:
        return None

    if isinstance(response, (dict, list)):
        return response

    body = getattr(response, "body", None)
    if body is not None:
        return body

    data = getattr(response, "data", None)
    if data is not None:
        return data

    return response


def _number(value: Any) -> float | None:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _snaptrade_user_id(app_user_id: str) -> str:
    # El UUID de Supabase es estable e inmutable. El prefijo evita colisiones
    # con usuarios de otros productos que pudieran usar la misma cuenta SnapTrade.
    return f"investment-tracker-{app_user_id}"


def get_local_snaptrade_user(
    db: Session,
    app_user_id: str,
) -> SnapTradeUser | None:
    return db.scalar(
        select(SnapTradeUser).where(
            SnapTradeUser.user_id == app_user_id
        )
    )


def ensure_snaptrade_user(
    db: Session,
    app_user_id: str,
) -> tuple[SnapTradeUser, str]:
    """
    Crea una identidad SnapTrade Commercial una sola vez y almacena
    su userSecret cifrado.
    """
    existing = get_local_snaptrade_user(db, app_user_id)

    if existing is not None:
        return existing, _decrypt(existing.user_secret_encrypted)

    snaptrade_user_id = _snaptrade_user_id(app_user_id)
    client = _client()

    try:
        response = client.authentication.register_snap_trade_user(
            user_id=snaptrade_user_id,
        )
        body = _body(response) or {}
        user_secret = body.get("userSecret") or body.get("user_secret")

        if not user_secret:
            raise RuntimeError("SnapTrade no devolvió userSecret.")

        row = SnapTradeUser(
            user_id=app_user_id,
            snaptrade_user_id=snaptrade_user_id,
            user_secret_encrypted=_encrypt(str(user_secret)),
        )

        db.add(row)
        db.commit()
        db.refresh(row)

        return row, str(user_secret)

    except HTTPException:
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible registrar el usuario en SnapTrade: {exc}",
        ) from exc


def connection_portal(
    db: Session,
    app_user_id: str,
    *,
    reconnect: str | None = None,
):
    """
    Genera exclusivamente una conexión READ. No existe ninguna ruta de órdenes
    o trading en esta integración.
    """
    row, user_secret = ensure_snaptrade_user(db, app_user_id)
    client = _client()

    kwargs: dict[str, Any] = {
        "user_id": row.snaptrade_user_id,
        "user_secret": user_secret,
        "connection_type": "read",
    }

    redirect = _env("SNAPTRADE_REDIRECT_URL")
    if redirect:
        kwargs["custom_redirect"] = redirect
        kwargs["immediate_redirect"] = True

    if reconnect:
        kwargs["reconnect"] = reconnect

    try:
        response = client.authentication.login_snap_trade_user(**kwargs)
        body = _body(response) or {}

        url = (
            body.get("redirectURI")
            or body.get("redirectUri")
            or body.get("redirect_uri")
        )

        if not url:
            raise RuntimeError("SnapTrade no devolvió la URL del Connection Portal.")

        return {
            "url": url,
            "connection_type": "read",
        }

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible abrir el Connection Portal: {exc}",
        ) from exc


def list_connections(
    db: Session,
    app_user_id: str,
) -> list[dict[str, Any]]:
    row = get_local_snaptrade_user(db, app_user_id)

    if row is None:
        return []

    user_secret = _decrypt(row.user_secret_encrypted)

    try:
        response = _client().connections.list_brokerage_authorizations(
            user_id=row.snaptrade_user_id,
            user_secret=user_secret,
        )
        body = _body(response) or []
        return body if isinstance(body, list) else []
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible consultar las conexiones de SnapTrade: {exc}",
        ) from exc


def list_accounts(
    db: Session,
    app_user_id: str,
) -> list[dict[str, Any]]:
    row = get_local_snaptrade_user(db, app_user_id)

    if row is None:
        return []

    user_secret = _decrypt(row.user_secret_encrypted)

    try:
        response = _client().account_information.list_user_accounts(
            user_id=row.snaptrade_user_id,
            user_secret=user_secret,
        )
        body = _body(response) or []
        return body if isinstance(body, list) else []
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible consultar las cuentas de SnapTrade: {exc}",
        ) from exc


def _account_positions(
    client: SnapTrade,
    *,
    account_id: str,
    snaptrade_user_id: str,
    user_secret: str,
):
    api = client.account_information

    # SDK actual: endpoint unificado /positions/all.
    method = getattr(api, "get_all_account_positions", None)

    if callable(method):
        response = method(
            account_id=account_id,
            user_id=snaptrade_user_id,
            user_secret=user_secret,
        )
        body = _body(response) or {}
        if isinstance(body, dict):
            return body.get("results") or []
        return body if isinstance(body, list) else []

    # Compatibilidad temporal si el entorno aún tiene un SDK anterior.
    legacy = getattr(api, "get_user_account_positions", None)
    if callable(legacy):
        response = legacy(
            account_id=account_id,
            user_id=snaptrade_user_id,
            user_secret=user_secret,
        )
        body = _body(response) or []
        return body if isinstance(body, list) else []

    raise RuntimeError(
        "La versión instalada de snaptrade-python-sdk no expone "
        "un método de posiciones compatible."
    )


def _account_balances(
    client: SnapTrade,
    *,
    account_id: str,
    snaptrade_user_id: str,
    user_secret: str,
):
    response = client.account_information.get_user_account_balance(
        account_id=account_id,
        user_id=snaptrade_user_id,
        user_secret=user_secret,
    )
    body = _body(response) or []
    return body if isinstance(body, list) else []


def _authorization_id(account: dict[str, Any]) -> str | None:
    candidate = (
        account.get("brokerage_authorization")
        or account.get("authorization")
        or account.get("brokerage_authorization_id")
    )

    if isinstance(candidate, dict):
        candidate = candidate.get("id")

    return str(candidate) if candidate else None


def _normalize_position(
    raw: dict[str, Any],
    *,
    account_id: str,
    authorization_id: str | None,
):
    instrument = raw.get("instrument") or raw.get("symbol") or {}

    if isinstance(instrument, str):
        instrument = {"symbol": instrument}

    ticker = (
        instrument.get("raw_symbol")
        or instrument.get("symbol")
        or raw.get("symbol")
        or raw.get("ticker")
    )

    if isinstance(ticker, dict):
        ticker = (
            ticker.get("raw_symbol")
            or ticker.get("symbol")
            or ticker.get("symbol_id")
        )

    ticker = str(ticker or "").strip().upper()

    if not ticker:
        return None

    quantity = _number(
        raw.get("units")
        if raw.get("units") is not None
        else raw.get("quantity")
    )

    if quantity is None or quantity == 0:
        return None

    price = _number(
        raw.get("price")
        if raw.get("price") is not None
        else raw.get("current_price")
    )

    average_cost = _number(
        raw.get("cost_basis")
        if raw.get("cost_basis") is not None
        else raw.get("average_purchase_price")
    )

    if average_cost is None:
        average_cost = price or 0.0

    currency = (
        raw.get("currency")
        or instrument.get("currency")
        or "USD"
    )

    if isinstance(currency, dict):
        currency = currency.get("code") or "USD"

    asset_type = (
        instrument.get("kind")
        or raw.get("type")
        or raw.get("security_type")
    )

    company = (
        instrument.get("description")
        or raw.get("description")
        or ticker
    )

    return {
        "account_id": account_id,
        "authorization_id": authorization_id,
        "ticker": ticker,
        "quantity": quantity,
        "average_cost": average_cost,
        "currency": str(currency or "USD"),
        "company": company,
        "asset_type": (
            str(asset_type).upper()
            if asset_type is not None
            else None
        ),
        "last_price": price,
    }


def sync_portfolio(
    db: Session,
    app_user_id: str,
):
    """
    Lee posiciones y balances desde SnapTrade y reemplaza únicamente
    el snapshot local de broker_positions del usuario.

    No crea, modifica ni cancela órdenes.
    """
    row = get_local_snaptrade_user(db, app_user_id)

    if row is None:
        raise HTTPException(
            status_code=400,
            detail="Primero conecta un broker con SnapTrade.",
        )

    user_secret = _decrypt(row.user_secret_encrypted)
    client = _client()

    try:
        accounts_response = client.account_information.list_user_accounts(
            user_id=row.snaptrade_user_id,
            user_secret=user_secret,
        )
        accounts = _body(accounts_response) or []

        if not isinstance(accounts, list):
            accounts = []

        normalized_positions: list[dict[str, Any]] = []
        balances_output: list[dict[str, Any]] = []

        for account in accounts:
            account_id = str(account.get("id") or "")
            if not account_id:
                continue

            authorization_id = _authorization_id(account)

            for raw in _account_positions(
                client,
                account_id=account_id,
                snaptrade_user_id=row.snaptrade_user_id,
                user_secret=user_secret,
            ):
                normalized = _normalize_position(
                    raw,
                    account_id=account_id,
                    authorization_id=authorization_id,
                )
                if normalized is not None:
                    normalized_positions.append(normalized)

            balances = _account_balances(
                client,
                account_id=account_id,
                snaptrade_user_id=row.snaptrade_user_id,
                user_secret=user_secret,
            )

            for balance in balances:
                currency = balance.get("currency") or {}
                if isinstance(currency, dict):
                    currency_code = currency.get("code")
                else:
                    currency_code = currency

                balances_output.append({
                    "account_id": account_id,
                    "currency": currency_code or "USD",
                    "cash": _number(balance.get("cash")),
                    "buying_power": _number(balance.get("buying_power")),
                })

        db.execute(
            delete(BrokerPosition).where(
                BrokerPosition.user_id == app_user_id
            )
        )

        for item in normalized_positions:
            db.add(
                BrokerPosition(
                    user_id=app_user_id,
                    account_id=item["account_id"],
                    authorization_id=item["authorization_id"],
                    ticker=item["ticker"],
                    quantity=item["quantity"],
                    average_cost=item["average_cost"],
                    currency=item["currency"],
                    company=item["company"],
                    asset_type=item["asset_type"],
                    last_price=item["last_price"],
                    updated_at=datetime.now(timezone.utc),
                )
            )

        db.commit()

        return {
            "synced": True,
            "read_only": True,
            "accounts": len(accounts),
            "positions": len(normalized_positions),
            "balances": balances_output,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible sincronizar el portafolio con SnapTrade: {exc}",
        ) from exc


def broker_positions(
    db: Session,
    app_user_id: str,
):
    rows = list(
        db.scalars(
            select(BrokerPosition)
            .where(BrokerPosition.user_id == app_user_id)
            .order_by(BrokerPosition.ticker.asc())
        )
    )

    return [
        {
            "id": row.id,
            "ticker": row.ticker,
            "quantity": row.quantity,
            "average_cost": row.average_cost,
            "currency": row.currency,
            "current_price": row.last_price,
            "market_value": (
                row.quantity * row.last_price
                if row.last_price is not None
                else None
            ),
            "unrealized_pnl": (
                row.quantity * (row.last_price - row.average_cost)
                if row.last_price is not None
                else None
            ),
            "unrealized_pnl_percent": (
                ((row.last_price - row.average_cost) / row.average_cost * 100)
                if row.last_price is not None and row.average_cost
                else None
            ),
            "account_id": row.account_id,
            "authorization_id": row.authorization_id,
            "company": row.company,
            "asset_type": row.asset_type,
            "read_only": True,
            "source": "snaptrade",
            "updated_at": row.updated_at,
        }
        for row in rows
    ]


def broker_status(
    db: Session,
    app_user_id: str,
):
    local = get_local_snaptrade_user(db, app_user_id)

    if not _configured():
        return {
            "configured": False,
            "registered": False,
            "connected": False,
            "read_only": True,
            "connections": [],
            "accounts": [],
        }

    if local is None:
        return {
            "configured": True,
            "registered": False,
            "connected": False,
            "read_only": True,
            "connections": [],
            "accounts": [],
        }

    connections = list_connections(db, app_user_id)
    accounts = list_accounts(db, app_user_id)

    return {
        "configured": True,
        "registered": True,
        "connected": len(accounts) > 0,
        "read_only": True,
        "connections": [
            {
                "id": x.get("id"),
                "name": (
                    (x.get("brokerage") or {}).get("name")
                    if isinstance(x.get("brokerage"), dict)
                    else x.get("name")
                ),
                "disabled": x.get("disabled"),
            }
            for x in connections
        ],
        "accounts": [
            {
                "id": x.get("id"),
                "name": x.get("name"),
                "number": x.get("number"),
                "institution_name": x.get("institution_name"),
                "account_category": x.get("account_category"),
            }
            for x in accounts
        ],
    }
