from __future__ import annotations

from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
import re
from typing import Any

import pandas as pd
from pypdf import PdfReader
from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..models import BrokerPosition


COLUMN_ALIASES = {
    "ticker": ["ticker", "symbol", "simbolo", "símbolo", "activo", "instrument", "instrumento", "security"],
    "quantity": ["quantity", "qty", "shares", "units", "cantidad", "acciones", "unidades"],
    "average_cost": ["average_cost", "avg_cost", "average price", "avg price", "precio promedio", "costo promedio", "cost basis", "precio compra"],
    "market_price": ["price", "market_price", "market price", "precio", "precio actual", "last price"],
    "market_value": ["market_value", "market value", "valor mercado", "valor de mercado", "current value", "valor actual"],
    "currency": ["currency", "moneda"],
    "company": ["name", "company", "description", "nombre", "empresa", "security name"],
    "asset_type": ["asset_type", "asset type", "type", "tipo"],
}

PDF_STOPWORDS = {
    "TOTAL", "ACCOUNT", "STATEMENT", "CASH", "BALANCE", "DATE", "PRICE", "VALUE",
    "CURRENCY", "QUANTITY", "DESCRIPTION", "MARKET", "COST", "PORTFOLIO", "HAPI",
    "TRII", "USD", "COP", "ETF", "STOCK", "EQUITY", "ACCIONES", "ACTIVO", "VALOR",
}


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _ticker(value: Any) -> str:
    return re.sub(r"\s+", "", _text(value).upper())


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    raw = re.sub(r"[^0-9,\.\-()]", "", str(value).strip())
    if not raw:
        return None

    negative = raw.startswith("(") and raw.endswith(")")
    raw = raw.replace("(", "").replace(")", "")

    if "," in raw and "." in raw:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif "," in raw:
        tail = raw.rsplit(",", 1)[-1]
        raw = raw.replace(",", ".") if len(tail) in (1, 2) else raw.replace(",", "")
    elif raw.count(".") > 1:
        raw = raw.replace(".", "")

    try:
        number = float(raw)
        return -number if negative else number
    except ValueError:
        return None


def _currency(value: Any, default: str = "USD") -> str:
    raw = _text(value).upper()
    if raw in {"COP", "COL$", "COP$", "PESO", "PESOS"}:
        return "COP"
    if raw in {"USD", "US$", "USD$", "DOLAR", "DÓLAR", "DOLARES", "DÓLARES", "$"}:
        return "USD"
    return raw[:10] if raw else default


def detect_broker(filename: str, text: str = "") -> str:
    haystack = f"{filename} {text}".lower()
    if "hapi" in haystack or "hapi securities" in haystack:
        return "hapi"
    if "trii" in haystack or "accivalores" in haystack:
        return "trii"
    if "tyba" in haystack:
        return "tyba"
    return "generic"


def _column(df: pd.DataFrame, key: str):
    normalized = {str(col).strip().lower(): col for col in df.columns}
    for alias in COLUMN_ALIASES[key]:
        if alias in normalized:
            return normalized[alias]
    return None


def _rows_from_dataframe(df: pd.DataFrame, default_currency: str) -> list[dict[str, Any]]:
    ticker_col = _column(df, "ticker")
    quantity_col = _column(df, "quantity")
    if ticker_col is None or quantity_col is None:
        return []

    cost_col = _column(df, "average_cost")
    price_col = _column(df, "market_price")
    value_col = _column(df, "market_value")
    currency_col = _column(df, "currency")
    company_col = _column(df, "company")
    type_col = _column(df, "asset_type")

    output: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        ticker = _ticker(row[ticker_col])
        quantity = _number(row[quantity_col])
        if not ticker or quantity is None or quantity <= 0:
            continue

        average_cost = _number(row[cost_col]) if cost_col is not None else None
        market_price = _number(row[price_col]) if price_col is not None else None
        market_value = _number(row[value_col]) if value_col is not None else None
        if market_price is None and market_value is not None and quantity:
            market_price = market_value / quantity
        if average_cost is None:
            average_cost = market_price or 0.0

        output.append({
            "ticker": ticker,
            "quantity": quantity,
            "average_cost": max(average_cost, 0.0),
            "currency": _currency(row[currency_col], default_currency) if currency_col is not None else default_currency,
            "company": _text(row[company_col]) if company_col is not None else ticker,
            "asset_type": _text(row[type_col]).upper() if type_col is not None else None,
            "last_price": market_price,
            "confidence": 0.98 if cost_col is not None else 0.88,
        })
    return output


def _read_pdf(contents: bytes) -> str:
    reader = PdfReader(BytesIO(contents))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _rows_from_pdf(text: str, default_currency: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()

    for line in text.splitlines():
        clean = " ".join(line.split())
        if not clean:
            continue

        tokens = clean.split()
        ticker = None
        ticker_index = -1
        for idx, token in enumerate(tokens):
            candidate = token.strip("()[],:;").upper()
            if re.fullmatch(r"[A-Z][A-Z0-9.\-]{1,11}", candidate) and candidate not in PDF_STOPWORDS:
                ticker = candidate
                ticker_index = idx
                break

        if not ticker or ticker in seen:
            continue

        numbers = [_number(token) for token in tokens[ticker_index + 1:]]
        numbers = [number for number in numbers if number is not None]
        if not numbers:
            continue

        quantity = numbers[0]
        if quantity is None or quantity <= 0:
            continue

        average_cost = numbers[1] if len(numbers) >= 2 and numbers[1] >= 0 else 0.0
        last_price = numbers[2] if len(numbers) >= 3 and numbers[2] >= 0 else None

        output.append({
            "ticker": ticker,
            "quantity": quantity,
            "average_cost": average_cost,
            "currency": default_currency,
            "company": ticker,
            "asset_type": None,
            "last_price": last_price,
            "confidence": 0.62,
        })
        seen.add(ticker)

    return output


def preview_statement(filename: str, contents: bytes) -> dict[str, Any]:
    suffix = Path(filename).suffix.lower()
    if suffix not in {".pdf", ".csv", ".xlsx", ".xls"}:
        raise ValueError("Formato no soportado. Usa PDF, CSV, XLSX o XLS.")

    text = _read_pdf(contents) if suffix == ".pdf" else ""
    broker = detect_broker(filename, text)
    default_currency = "COP" if broker in {"trii", "tyba"} else "USD"
    warnings: list[str] = []

    if suffix == ".csv":
        try:
            df = pd.read_csv(BytesIO(contents))
        except Exception:
            df = pd.read_csv(BytesIO(contents), sep=None, engine="python")
        positions = _rows_from_dataframe(df, default_currency)
    elif suffix in {".xlsx", ".xls"}:
        workbook = pd.ExcelFile(BytesIO(contents))
        positions = []
        for sheet in workbook.sheet_names:
            candidate = _rows_from_dataframe(pd.read_excel(workbook, sheet_name=sheet), default_currency)
            if candidate:
                positions = candidate
                break
    else:
        positions = _rows_from_pdf(text, default_currency)
        if positions:
            warnings.append("Las filas de PDF se detectan heurísticamente. Revisa ticker, cantidad y costo antes de confirmar.")

    if not positions:
        warnings.append("No se detectaron posiciones automáticamente. Prueba CSV/XLSX o un estado de cuenta con texto seleccionable.")

    if broker == "generic":
        warnings.append("Broker no identificado; puedes indicar el nombre antes de importar.")

    return {
        "broker": broker,
        "source_filename": filename,
        "currency": default_currency,
        "positions": positions,
        "warnings": warnings,
        "read_only": True,
    }


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return cleaned[:40] or "main"


def import_snapshot(
    db: Session,
    app_user_id: str,
    *,
    broker: str,
    account_name: str,
    positions: list[dict[str, Any]],
) -> dict[str, Any]:
    broker_slug = _slug(broker or "generic")
    account_slug = _slug(account_name or "main")
    account_id = f"import:{broker_slug}:{account_slug}"

    db.execute(
        delete(BrokerPosition).where(
            BrokerPosition.user_id == app_user_id,
            BrokerPosition.account_id == account_id,
        )
    )

    imported = 0
    now = datetime.now(timezone.utc)
    for raw in positions:
        ticker = _ticker(raw.get("ticker"))
        quantity = _number(raw.get("quantity"))
        if not ticker or quantity is None or quantity <= 0:
            continue

        average_cost = _number(raw.get("average_cost")) or 0.0
        last_price = _number(raw.get("last_price"))
        currency = _currency(raw.get("currency"), "COP" if broker_slug in {"trii", "tyba"} else "USD")

        db.add(BrokerPosition(
            user_id=app_user_id,
            account_id=account_id,
            authorization_id=f"statement:{broker_slug}",
            ticker=ticker,
            quantity=quantity,
            average_cost=max(average_cost, 0.0),
            currency=currency,
            company=_text(raw.get("company")) or ticker,
            asset_type=_text(raw.get("asset_type")).upper() or None,
            last_price=last_price,
            updated_at=now,
        ))
        imported += 1

    db.commit()
    return {
        "imported": imported,
        "broker": broker_slug,
        "account_name": account_name or "Main account",
        "account_id": account_id,
        "read_only": True,
        "synced_at": now.isoformat(),
    }
