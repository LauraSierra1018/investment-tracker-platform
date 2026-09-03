import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from openai import OpenAI

from ..auth import AuthUser, get_current_user
from ..config import settings
from ..db import get_db
from ..models import PortfolioPosition
from ..services.portfolio_v2 import build_analysis, research_impact
from ..services.portfolio_history import build_history
from ..services.market import get_stock
from ..services.research_universe import upsert_research_asset
from ..services.snaptrade_service import (
    broker_positions,
    broker_status,
    connection_portal,
    sync_portfolio,
)
from ..services.broker_sync_guard import (
    combined_broker_status,
    sync_snaptrade_preserving_imports,
)


router = APIRouter(
    prefix="/portfolio",
    tags=["portfolio-v2"],
)


class PositionUpdate(BaseModel):
    quantity: float = Field(gt=0)
    average_cost: float = Field(ge=0)


class AssistantRequest(BaseModel):
    goal: Literal[
        "preserve",
        "balanced",
        "growth",
        "aggressive",
        "income",
        "custom",
    ] = "balanced"

    risk_profile: Literal[
        "conservative",
        "moderate",
        "aggressive",
    ] = "moderate"

    horizon: str = "5+"
    priorities: list[str] = []
    prompt: str = ""


@router.post("/universe/{ticker}")
def register_research_asset(
    ticker: str,
    db: Session = Depends(get_db),
):
    """
    Registra/actualiza en la base de datos un activo que fue consultado
    desde Research. No crea órdenes ni modifica portafolios.
    """
    stock = get_stock(ticker)
    asset = upsert_research_asset(db, stock)

    if asset is None:
        raise HTTPException(
            status_code=400,
            detail="No fue posible registrar el activo.",
        )

    return {
        "ticker": asset.ticker,
        "registered": True,
    }


@router.get("/opportunities")
def opportunities(
    profile: Literal[
        "conservative",
        "moderate",
        "aggressive",
    ] = "moderate",
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Recomendaciones personalizadas para Research basadas en el Real Portfolio
    actual y en todo Research Universe, no únicamente en Watchlist.
    """
    data = build_analysis(db, user.id, profile)

    return {
        "profile": profile,
        "portfolio_summary": data["summary"],
        "portfolio_health": data["health"],
        "opportunities": data["recommendations"],
    }


@router.get("/impact/{ticker}")
def impact(
    ticker: str,
    profile: Literal[
        "conservative",
        "moderate",
        "aggressive",
    ] = "moderate",
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return research_impact(
        db,
        user.id,
        ticker,
        profile,
    )


@router.get("/broker/status")
def snaptrade_status(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return combined_broker_status(
        db,
        user.id,
        broker_status,
    )


@router.post("/broker/connect")
def snaptrade_connect(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return connection_portal(
        db,
        user.id,
    )


@router.post("/broker/reconnect/{authorization_id}")
def snaptrade_reconnect(
    authorization_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return connection_portal(
        db,
        user.id,
        reconnect=authorization_id,
    )


@router.post("/broker/sync")
def snaptrade_sync(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return sync_snaptrade_preserving_imports(
        db,
        user.id,
        sync_portfolio,
    )


@router.get("/broker/positions")
def snaptrade_positions(
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return broker_positions(
        db,
        user.id,
    )


@router.get("/analysis")
def analysis(
    profile: Literal[
        "conservative",
        "moderate",
        "aggressive",
    ] = "moderate",
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return build_analysis(
        db,
        user.id,
        profile,
    )


@router.get("/history")
def history(
    range: Literal["1M", "3M", "6M", "1Y"] = "3M",
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return build_history(
        db,
        user.id,
        range,
    )


@router.put("/{position_id}")
def update_position(
    position_id: int,
    body: PositionUpdate,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    position = db.scalar(
        select(PortfolioPosition).where(
            PortfolioPosition.id == position_id,
            PortfolioPosition.user_id == user.id,
        )
    )

    if not position:
        raise HTTPException(
            status_code=404,
            detail="Posición no encontrada.",
        )

    position.quantity = body.quantity
    position.average_cost = body.average_cost

    db.commit()
    db.refresh(position)

    return {"updated": True}


@router.post("/assistant")
def assistant(
    body: AssistantRequest,
    user: AuthUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=503,
            detail="OpenAI no está configurado.",
        )

    analysis_data = build_analysis(
        db,
        user.id,
        body.risk_profile,
    )

    context = {
        "goal": body.goal,
        "risk_profile": body.risk_profile,
        "horizon": body.horizon,
        "priorities": body.priorities,
        "user_request": body.prompt,
        "summary": analysis_data["summary"],
        "health": analysis_data["health"],
        "sectors": analysis_data["allocation_by_sector"],
        "alerts": analysis_data["alerts"],
        "portfolio_candidates": analysis_data["recommendations"][:6],
    }

    prompt = f"""
Eres un asistente educativo de análisis de portafolios.

Usa exclusivamente los datos del contexto.

Reglas:
- No inventes datos.
- No prometas rendimientos.
- No presentes una acción como una orden de compra o venta.
- Habla de opciones para explorar.
- Si incluyes una asignación, usa únicamente tickers presentes en portfolio_candidates.
- Si incluyes allocation_example, sus porcentajes deben sumar 100.
- Responde en español.
- Devuelve exclusivamente JSON válido.

Formato:
{{
  "summary": "resumen",
  "observations": ["observación"],
  "actions_to_explore": [
    {{
      "title": "acción a explorar",
      "rationale": "explicación",
      "ticker": "TICKER o null"
    }}
  ],
  "allocation_example": [
    {{
      "ticker": "TICKER",
      "percent": 40,
      "rationale": "explicación"
    }}
  ],
  "risks": ["riesgo"],
  "disclaimer": "texto breve"
}}

Contexto:
{json.dumps(context, ensure_ascii=False, default=str, indent=2)}
"""

    try:
        client = OpenAI(
            api_key=settings.openai_api_key.strip()
        )

        response = client.responses.create(
            model=settings.openai_model,
            input=prompt,
        )

        content = response.output_text.strip()

        if content.startswith("```json"):
            content = content[7:]

        if content.startswith("```"):
            content = content[3:]

        if content.endswith("```"):
            content = content[:-3]

        parsed = json.loads(content.strip())

        allocation = parsed.get("allocation_example") or []

        if allocation:
            total = sum(
                float(x.get("percent", 0))
                for x in allocation
            )

            if abs(total - 100) > 1:
                parsed["allocation_example"] = []

        parsed.setdefault(
            "disclaimer",
            "Herramienta educativa; no constituye asesoría financiera personalizada.",
        )

        return parsed

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible generar el análisis IA: {exc}",
        )
