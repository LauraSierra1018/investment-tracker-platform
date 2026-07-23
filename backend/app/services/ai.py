import json

from fastapi import HTTPException
from openai import (
    OpenAI,
    AuthenticationError,
    RateLimitError,
    BadRequestError,
    APIConnectionError,
    APIError,
)

from .market import get_stock
from ..config import settings


def analyze(ticker: str):
    """
    Genera un análisis educativo de una acción utilizando
    los datos cuantitativos obtenidos por el backend.

    La IA no inventa datos financieros adicionales:
    analiza únicamente la información proporcionada por get_stock().
    """

    # ---------------------------------------------------------
    # 1. Obtener datos financieros de la empresa
    # ---------------------------------------------------------

    try:
        data = get_stock(ticker)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"No fue posible obtener los datos de {ticker}: {str(exc)}",
        )

    # ---------------------------------------------------------
    # 2. Verificar que OpenAI esté configurado
    # ---------------------------------------------------------

    if not settings.openai_api_key:
        return {
            "available": False,
            "summary": (
                "La integración con OpenAI no está configurada. "
                "El análisis cuantitativo de la acción sigue disponible."
            ),
            "thesis": data.get("strengths", []),
            "risks": data.get("risks", []),
            "questions": [
                "¿Los resultados financieros recientes confirman el crecimiento de la empresa?",
                "¿La valoración actual es razonable frente a empresas comparables?",
            ],
        }

    # ---------------------------------------------------------
    # 3. Preparar únicamente los datos relevantes para la IA
    # ---------------------------------------------------------

    company_data = {
        "ticker": data.get("ticker"),
        "company": data.get("company"),
        "sector": data.get("sector"),
        "industry": data.get("industry"),
        "price": data.get("price"),
        "target_price": data.get("target_price"),
        "currency": data.get("currency"),
        "market_cap": data.get("market_cap"),
        "pe_ratio": data.get("pe_ratio"),
        "free_float_percent": data.get("free_float_percent"),
        "score": data.get("score"),
        "classification": data.get("classification"),
        "strengths": data.get("strengths", []),
        "risks": data.get("risks", []),
        "missing_data": data.get("missing_data", []),
        "criteria": data.get("criteria", []),
    }

    # ---------------------------------------------------------
    # 4. Crear cliente OpenAI
    # ---------------------------------------------------------

    try:
        client = OpenAI(
            api_key=settings.openai_api_key.strip(),
        )

        # -----------------------------------------------------
        # 5. Crear prompt
        # -----------------------------------------------------

        prompt = f"""
Eres un analista financiero educativo integrado en una plataforma
de investigación de inversiones.

Tu tarea es analizar los datos cuantitativos proporcionados sobre
una empresa.

REGLAS IMPORTANTES:

1. Utiliza exclusivamente los datos proporcionados.
2. No inventes cifras, noticias ni información financiera.
3. Si falta información, indícalo cuando sea relevante.
4. Distingue hechos de interpretaciones.
5. No des una orden directa de comprar o vender.
6. El análisis debe ayudar al usuario a comprender fortalezas,
   riesgos y aspectos que requieren investigación adicional.
7. Responde siempre en español.
8. Devuelve EXCLUSIVAMENTE JSON válido.
9. No uses bloques Markdown.
10. No escribas texto antes ni después del JSON.

Debes devolver exactamente esta estructura:

{{
    "summary": "Resumen general del análisis",
    "thesis": [
        "Fortaleza o argumento positivo 1",
        "Fortaleza o argumento positivo 2"
    ],
    "risks": [
        "Riesgo 1",
        "Riesgo 2"
    ],
    "questions": [
        "Pregunta que el inversionista debería investigar 1",
        "Pregunta que el inversionista debería investigar 2"
    ]
}}

DATOS DE LA EMPRESA:

{json.dumps(
    company_data,
    ensure_ascii=False,
    default=str,
    indent=2
)}
"""

        # ---------------------------------------------------------
        # 6. Llamar a OpenAI usando Responses API
        # ---------------------------------------------------------

        response = client.responses.create(
            model=settings.openai_model,
            input=prompt,
        )

        # ---------------------------------------------------------
        # 7. Extraer respuesta
        # ---------------------------------------------------------

        content = response.output_text

        if not content:
            raise HTTPException(
                status_code=502,
                detail="OpenAI respondió correctamente pero no generó contenido.",
            )

        # Limpiar posibles bloques Markdown por seguridad
        clean_content = content.strip()

        if clean_content.startswith("```json"):
            clean_content = clean_content[7:]

        if clean_content.startswith("```"):
            clean_content = clean_content[3:]

        if clean_content.endswith("```"):
            clean_content = clean_content[:-3]

        clean_content = clean_content.strip()

        # ---------------------------------------------------------
        # 8. Convertir respuesta JSON
        # ---------------------------------------------------------

        try:
            parsed = json.loads(clean_content)

        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "OpenAI respondió, pero el análisis no tenía "
                    f"un formato JSON válido: {str(exc)}"
                ),
            )

        # ---------------------------------------------------------
        # 9. Validar estructura básica
        # ---------------------------------------------------------

        summary = parsed.get("summary")
        thesis = parsed.get("thesis", [])
        risks = parsed.get("risks", [])
        questions = parsed.get("questions", [])

        if not isinstance(thesis, list):
            thesis = []

        if not isinstance(risks, list):
            risks = []

        if not isinstance(questions, list):
            questions = []

        # ---------------------------------------------------------
        # 10. Devolver resultado al frontend
        # ---------------------------------------------------------

        return {
            "available": True,
            "summary": (
                summary
                if isinstance(summary, str)
                else "No fue posible generar el resumen."
            ),
            "thesis": thesis,
            "risks": risks,
            "questions": questions,
        }

    # ---------------------------------------------------------
    # Manejo específico de errores OpenAI
    # ---------------------------------------------------------

    except AuthenticationError as exc:
        raise HTTPException(
            status_code=401,
            detail=(
                "OpenAI rechazó la autenticación. "
                "La API key cargada por este proceso puede ser diferente "
                "a la que verificaste directamente. "
                f"Detalle: {str(exc)}"
            ),
        )

    except RateLimitError as exc:
        raise HTTPException(
            status_code=429,
            detail=(
                "OpenAI rechazó temporalmente la solicitud por límites "
                "de uso, cuota o créditos disponibles. "
                f"Detalle: {str(exc)}"
            ),
        )

    except BadRequestError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"OpenAI rechazó la solicitud: {str(exc)}",
        )

    except APIConnectionError as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "El backend no pudo establecer conexión con OpenAI. "
                f"Detalle: {str(exc)}"
            ),
        )

    except APIError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI devolvió un error de API: {str(exc)}",
        )

    except HTTPException:
        raise

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=(
                "Error inesperado durante el análisis con IA: "
                f"{type(exc).__name__}: {str(exc)}"
            ),
        )