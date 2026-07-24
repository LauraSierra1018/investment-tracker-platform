\
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
from ..services.portfolio_v2 import build_analysis, build_history


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
        "watchlist_candidates": analysis_data["recommendations"][:6],
    }

    prompt = f"""
Eres un asistente educativo de análisis de portafolios.

Usa exclusivamente los datos del contexto.

Reglas:
- No inventes datos.
- No prometas rendimientos.
- No presentes una acción como una orden de compra o venta.
- Habla de opciones para explorar.
- Si incluyes una asignación, usa únicamente tickers presentes en watchlist_candidates.
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
