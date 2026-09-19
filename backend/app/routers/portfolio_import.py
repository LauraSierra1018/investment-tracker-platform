from typing import Any

from starlette.concurrency import run_in_threadpool

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy.orm import Session

from ..auth import AuthUser, get_current_user
from ..db import get_db
from ..services.statement_import import import_snapshot, preview_statement


router = APIRouter(
    prefix="/portfolio/import",
    tags=["portfolio-import"],
)

MAX_FILE_SIZE = 10 * 1024 * 1024


class ImportPosition(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    ticker: str = Field(min_length=1, max_length=25, pattern=r"^[A-Z0-9^][A-Z0-9.^=:/-]*$")
    quantity: float = Field(gt=0)
    average_cost: float = Field(ge=0)
    currency: str = Field(default="USD", pattern=r"^[A-Z]{3}$")
    company: str | None = None
    asset_type: str | None = None
    last_price: float | None = Field(default=None, ge=0)


class ConfirmImportRequest(BaseModel):
    broker: str = "generic"
    account_name: str = "Main account"
    positions: list[ImportPosition]


@router.post("/preview")
async def preview(
    file: UploadFile = File(...),
    user: AuthUser = Depends(get_current_user),
):
    filename = file.filename or "statement"
    contents = await file.read()

    if not contents:
        raise HTTPException(status_code=400, detail="El archivo está vacío.")
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="El archivo supera el límite de 10 MB.")

    try:
        return await run_in_threadpool(preview_statement, filename, contents)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"No fue posible interpretar el archivo: {exc}",
        ) from exc


@router.post("/confirm")
def confirm(
    body: ConfirmImportRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.positions:
        raise HTTPException(status_code=400, detail="No hay posiciones para importar.")

    payload: list[dict[str, Any]] = [position.model_dump() for position in body.positions]
    return import_snapshot(
        db,
        user.id,
        broker=body.broker,
        account_name=body.account_name,
        positions=payload,
    )
