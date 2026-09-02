from __future__ import annotations

from collections import defaultdict
from typing import Any
import math

import yfinance as yf

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import BrokerPosition, PortfolioPosition, ResearchAsset
from .market import get_stock
from .research_universe import (
    list_research_candidates,
    upsert_research_asset,
)


def safe_float(value: Any) -> float | None:
    try:
        if value is None:
            return None

        number = float(value)

        if math.isnan(number) or math.isinf(number):
            return None

        return number
    except (TypeError, ValueError):
        return None


def normalized_percent(value: Any) -> float | None:
    number = safe_float(value)

    if number is None:
        return None

    return number * 100 if abs(number) <= 2 else number


def user_positions(db: Session, user_id: str):
    """
    Si el usuario ya sincronizó SnapTrade, el broker se convierte en la fuente
    canónica del Real Portfolio para análisis. Si no existe snapshot de broker,
    se conserva el portafolio manual actual.
    """
    broker_rows = list(
        db.scalars(
            select(BrokerPosition)
            .where(BrokerPosition.user_id == user_id)
            .order_by(BrokerPosition.ticker.asc())
        )
    )

    if broker_rows:
        return broker_rows

    return list(
        db.scalars(
            select(PortfolioPosition)
            .where(PortfolioPosition.user_id == user_id)
            .order_by(PortfolioPosition.created_at.asc())
        )
    )


def enrich_positions(db: Session, positions):
    """
    Enriquece las posiciones del usuario con datos de mercado y con
    Research Universe como respaldo persistente.

    Objetivos:
    - hacer como máximo una llamada get_stock() por ticker único;
    - registrar/actualizar automáticamente cada activo investigado
      desde Portfolio en research_assets;
    - reutilizar datos persistidos cuando Yahoo/market no tenga
      temporalmente algún campo;
    - evitar que varias compras del mismo ticker multipliquen llamadas
      externas innecesariamente.
    """

    result = []

    tickers = {
        str(position.ticker).strip().upper()
        for position in positions
        if position.ticker
    }

    if not tickers:
        return result

    # Cargamos en una sola consulta todos los activos ya persistidos.
    stored_assets = list(
        db.scalars(
            select(ResearchAsset).where(
                ResearchAsset.ticker.in_(tickers)
            )
        )
    )

    asset_map = {
        str(asset.ticker).strip().upper(): asset
        for asset in stored_assets
    }

    # Una sola consulta de mercado por ticker único.
    market_map: dict[str, dict[str, Any]] = {}

    for ticker in sorted(tickers):
        stock: dict[str, Any] = {}

        try:
            fetched = get_stock(ticker)

            if isinstance(fetched, dict):
                stock = dict(fetched)

            # Aseguramos que el ticker esté disponible para el upsert.
            stock.setdefault("ticker", ticker)

            market_map[ticker] = stock

            # Si conseguimos información válida, la persistimos en
            # Research Universe. Esto hace que Portfolio también alimente
            # automáticamente el universo global de investigación.
            if stock:
                try:
                    asset = upsert_research_asset(db, stock)
                    if asset is not None:
                        asset_map[ticker] = asset
                except Exception:
                    # Un error SQLAlchemy puede dejar la sesión en estado
                    # PendingRollbackError. Portfolio debe poder continuar.
                    db.rollback()

        except Exception:
            market_map[ticker] = {}

    for position in positions:
        ticker = str(position.ticker).strip().upper()
        stock = market_map.get(ticker, {})
        stored_asset = asset_map.get(ticker)

        price = safe_float(stock.get("price"))

        if price is None and stored_asset is not None:
            price = safe_float(stored_asset.last_price)

        invested = float(position.quantity) * float(position.average_cost)

        market_value = (
            float(position.quantity) * price
            if price is not None
            else invested
        )

        sector = stock.get("sector")

        if not sector and stored_asset is not None:
            sector = stored_asset.sector

        asset_type = (
            stock.get("quote_type")
            or stock.get("type")
            or (
                stored_asset.asset_type
                if stored_asset is not None
                else None
            )
        )

        # Un ETF no representa necesariamente un único sector.
        # Si no hay sector corporativo disponible, lo tratamos como
        # exposición diversificada en vez de inventar uno.
        if str(asset_type or "").upper() == "ETF":
            sector = "ETF"

        if not sector:
            sector = "Sin sector"

        score = safe_float(stock.get("score"))
        if score is None and stored_asset is not None:
            score = safe_float(stored_asset.score)

        beta = safe_float(stock.get("beta"))
        if beta is None and stored_asset is not None:
            beta = safe_float(stored_asset.beta)

        pe_ratio = safe_float(stock.get("pe_ratio"))
        if pe_ratio is None and stored_asset is not None:
            pe_ratio = safe_float(stored_asset.pe_ratio)

        revenue_growth = normalized_percent(
            stock.get("revenue_growth_pct")
            if stock.get("revenue_growth_pct") is not None
            else stock.get("revenue_growth")
        )

        if revenue_growth is None and stored_asset is not None:
            revenue_growth = normalized_percent(
                stored_asset.revenue_growth_percent
            )

        earnings_growth = normalized_percent(
            stock.get("earnings_growth_pct")
            if stock.get("earnings_growth_pct") is not None
            else stock.get("earnings_growth")
        )

        if earnings_growth is None and stored_asset is not None:
            earnings_growth = normalized_percent(
                stored_asset.earnings_growth_percent
            )

        result.append(
            {
                "ticker": ticker,
                "quantity": float(position.quantity),
                "invested": invested,
                "market_value": market_value,
                "sector": sector,
                "score": score,
                "beta": beta,
                "pe_ratio": pe_ratio,
                "revenue_growth": revenue_growth,
                "earnings_growth": earnings_growth,
            }
        )

    return result



def aggregate_positions(enriched):
    """
    Consolida los distintos lotes/compras de un mismo ticker para el análisis.

    La base de datos puede conservar cada compra por separado, pero métricas
    como diversificación, concentración y número de posiciones deben trabajar
    con una única posición económica por activo.

    El costo promedio se calcula de forma ponderada:
        total invertido / cantidad total
    """
    grouped: dict[str, dict[str, Any]] = {}

    for row in enriched:
        ticker = str(row.get("ticker") or "").strip().upper()

        if not ticker:
            continue

        quantity = safe_float(row.get("quantity")) or 0.0
        invested = safe_float(row.get("invested")) or 0.0
        market_value = safe_float(row.get("market_value")) or 0.0

        if ticker not in grouped:
            grouped[ticker] = {
                "ticker": ticker,
                "quantity": 0.0,
                "invested": 0.0,
                "market_value": 0.0,
                "sector": row.get("sector") or "Sin sector",
                "score": safe_float(row.get("score")),
                "beta": safe_float(row.get("beta")),
                "pe_ratio": safe_float(row.get("pe_ratio")),
                "revenue_growth": safe_float(row.get("revenue_growth")),
                "earnings_growth": safe_float(row.get("earnings_growth")),
                "lots": 0,
            }

        item = grouped[ticker]
        item["quantity"] += quantity
        item["invested"] += invested
        item["market_value"] += market_value
        item["lots"] += 1

        # Preferimos cualquier dato válido frente a un fallback vacío.
        if item["sector"] == "Sin sector" and row.get("sector"):
            item["sector"] = row["sector"]

        for field in (
            "score",
            "beta",
            "pe_ratio",
            "revenue_growth",
            "earnings_growth",
        ):
            value = safe_float(row.get(field))
            if item[field] is None and value is not None:
                item[field] = value

    result = []

    for item in grouped.values():
        quantity = item["quantity"]
        invested = item["invested"]
        market_value = item["market_value"]

        item["average_cost"] = (
            invested / quantity
            if quantity > 0
            else None
        )

        item["current_price"] = (
            market_value / quantity
            if quantity > 0
            else None
        )

        item["pnl"] = market_value - invested
        item["pnl_percent"] = (
            (market_value - invested) / invested * 100
            if invested > 0
            else 0.0
        )

        result.append(item)

    result.sort(
        key=lambda x: x["market_value"],
        reverse=True,
    )

    return result

def allocations(enriched):
    total = sum(x["market_value"] for x in enriched)

    if total <= 0:
        return [], []

    assets = [
        {
            "ticker": x["ticker"],
            "value": round(x["market_value"], 2),
            "percent": round(x["market_value"] / total * 100, 2),
        }
        for x in enriched
    ]

    assets.sort(key=lambda x: x["percent"], reverse=True)

    sectors = defaultdict(float)

    for x in enriched:
        sectors[x["sector"]] += x["market_value"]

    sector_rows = [
        {
            "sector": sector,
            "value": round(value, 2),
            "percent": round(value / total * 100, 2),
        }
        for sector, value in sectors.items()
    ]

    sector_rows.sort(key=lambda x: x["percent"], reverse=True)

    return assets, sector_rows


def health(enriched, assets, sectors):
    """
    Portfolio Health trabaja sobre posiciones consolidadas por ticker.

    Devuelve cinco dimensiones:
    - overall_score
    - diversification_score
    - concentration_score
    - quality_score
    - valuation_score
    - risk_score

    Los ETF no se penalizan automáticamente por carecer de fundamentales
    corporativos. Si no hay P/E o score disponible, simplemente no entran
    en el denominador de esa dimensión.
    """
    if not enriched:
        return {
            "overall_score": 0,
            "diversification_score": 0,
            "concentration_score": 0,
            "quality_score": 0,
            "valuation_score": 0,
            "risk_score": 0,
            "growth_score": 0,
            "risk_label": "Sin datos",
            "largest_position_percent": 0,
            "top3_concentration_percent": 0,
            "portfolio_beta": None,
            "effective_positions": 0,
        }, []

    total = sum(
        safe_float(x.get("market_value")) or 0.0
        for x in enriched
    )

    largest = assets[0]["percent"] if assets else 0.0
    top3 = sum(x["percent"] for x in assets[:3])

    # Herfindahl-Hirschman Index de pesos de posiciones.
    weights = [
        (safe_float(x.get("market_value")) or 0.0) / total
        for x in enriched
        if total > 0
    ]
    hhi = sum(weight * weight for weight in weights)

    effective_positions = (
        1.0 / hhi
        if hhi > 0
        else 0.0
    )

    asset_count_component = min(100.0, effective_positions / 8.0 * 100.0)
    sector_count_component = min(100.0, len(sectors) / 5.0 * 100.0)

    diversification = (
        asset_count_component * 0.70
        + sector_count_component * 0.30
    )

    concentration = max(
        0.0,
        min(
            100.0,
            100.0
            - max(0.0, largest - 20.0) * 2.0
            - max(0.0, top3 - 60.0) * 1.25,
        ),
    )

    quality_num = 0.0
    quality_den = 0.0

    growth_num = 0.0
    growth_den = 0.0

    valuation_num = 0.0
    valuation_den = 0.0

    beta_num = 0.0
    beta_den = 0.0

    for x in enriched:
        market_value = safe_float(x.get("market_value")) or 0.0
        weight = market_value / total if total > 0 else 0.0

        score = safe_float(x.get("score"))
        if score is not None:
            quality_num += score * weight
            quality_den += weight

        growth_parts = [
            value
            for value in (
                safe_float(x.get("revenue_growth")),
                safe_float(x.get("earnings_growth")),
            )
            if value is not None
        ]

        if growth_parts:
            avg_growth = sum(growth_parts) / len(growth_parts)
            row_growth_score = max(
                0.0,
                min(100.0, 50.0 + avg_growth * 1.5),
            )
            growth_num += row_growth_score * weight
            growth_den += weight

        pe = safe_float(x.get("pe_ratio"))
        if pe is not None and pe > 0:
            row_valuation = valuation_score(pe, None)
            valuation_num += row_valuation * weight
            valuation_den += weight

        beta = safe_float(x.get("beta"))
        if beta is not None:
            beta_num += beta * weight
            beta_den += weight

    quality = (
        quality_num / quality_den
        if quality_den > 0
        else 50.0
    )

    growth_score = (
        growth_num / growth_den
        if growth_den > 0
        else 50.0
    )

    valuation = (
        valuation_num / valuation_den
        if valuation_den > 0
        else 50.0
    )

    portfolio_beta = (
        beta_num / beta_den
        if beta_den > 0
        else None
    )

    if portfolio_beta is None:
        risk_label = "Sin datos"
        risk_score = 50.0
    elif portfolio_beta <= 0.90:
        risk_label = "Bajo"
        risk_score = 90.0
    elif portfolio_beta <= 1.10:
        risk_label = "Moderado"
        risk_score = 100.0
    elif portfolio_beta <= 1.30:
        risk_label = "Moderado"
        risk_score = 80.0
    elif portfolio_beta <= 1.60:
        risk_label = "Alto"
        risk_score = 55.0
    else:
        risk_label = "Alto"
        risk_score = 30.0

    # Score global. Growth queda visible como dimensión informativa, pero
    # calidad ya incorpora buena parte de los fundamentales del scoring base.
    overall = (
        diversification * 0.25
        + concentration * 0.20
        + quality * 0.25
        + valuation * 0.15
        + risk_score * 0.15
    )

    alerts = []

    if largest >= 35:
        alerts.append({
            "type": "warning",
            "text": (
                f"La mayor posición representa {largest:.1f}% "
                "del portafolio."
            ),
        })
    elif largest > 0:
        alerts.append({
            "type": "positive",
            "text": (
                f"La mayor posición representa {largest:.1f}% "
                "del portafolio."
            ),
        })

    if top3 >= 70:
        alerts.append({
            "type": "warning",
            "text": (
                f"Las tres mayores posiciones concentran "
                f"{top3:.1f}% del portafolio."
            ),
        })

    if sectors and sectors[0]["percent"] >= 45:
        alerts.append({
            "type": "warning",
            "text": (
                f"{sectors[0]['sector']} representa "
                f"{sectors[0]['percent']:.1f}% del portafolio."
            ),
        })

    if len(assets) < 4:
        alerts.append({
            "type": "warning",
            "text": (
                "El portafolio tiene pocas posiciones diferentes "
                "y una diversificación limitada."
            ),
        })
    elif effective_positions >= 5:
        alerts.append({
            "type": "positive",
            "text": (
                f"La diversificación efectiva equivale a "
                f"{effective_positions:.1f} posiciones de igual peso."
            ),
        })

    if portfolio_beta is not None and portfolio_beta > 1.40:
        alerts.append({
            "type": "warning",
            "text": (
                f"La beta ponderada es {portfolio_beta:.2f}; "
                "el portafolio puede ser más sensible al mercado."
            ),
        })

    if quality >= 75:
        alerts.append({
            "type": "positive",
            "text": (
                f"La calidad ponderada de los activos con datos "
                f"es {quality:.0f}/100."
            ),
        })

    return {
        "overall_score": round(overall, 1),
        "diversification_score": round(diversification, 1),
        "concentration_score": round(concentration, 1),
        "quality_score": round(quality, 1),
        "valuation_score": round(valuation, 1),
        "risk_score": round(risk_score, 1),
        "growth_score": round(growth_score, 1),
        "risk_label": risk_label,
        "largest_position_percent": round(largest, 2),
        "top3_concentration_percent": round(top3, 2),
        "portfolio_beta": (
            round(portfolio_beta, 3)
            if portfolio_beta is not None
            else None
        ),
        "effective_positions": round(effective_positions, 2),
    }, alerts


def profile_fit(beta: float | None, profile: str) -> float:
    if beta is None:
        return 50.0

    if profile == "conservative":
        if beta <= 0.9:
            return 100.0
        if beta <= 1.1:
            return 75.0
        if beta <= 1.35:
            return 45.0
        return 15.0

    if profile == "aggressive":
        if 1.0 <= beta <= 1.7:
            return 100.0
        if 0.8 <= beta < 1.0:
            return 75.0
        if 1.7 < beta <= 2.1:
            return 60.0
        return 35.0

    if 0.8 <= beta <= 1.3:
        return 100.0
    if 0.6 <= beta < 0.8 or 1.3 < beta <= 1.5:
        return 70.0
    return 35.0


def valuation_score(pe: float | None, upside: float | None) -> float:
    parts: list[float] = []

    if pe is not None and pe > 0:
        if 15 <= pe <= 30:
            parts.append(100)
        elif 10 <= pe < 15 or 30 < pe <= 40:
            parts.append(70)
        elif pe <= 50:
            parts.append(45)
        else:
            parts.append(20)

    if upside is not None:
        if upside >= 20:
            parts.append(100)
        elif upside >= 10:
            parts.append(80)
        elif upside >= 0:
            parts.append(60)
        elif upside >= -10:
            parts.append(35)
        else:
            parts.append(15)

    return sum(parts) / len(parts) if parts else 50.0


def diversification_benefit(
    sector: str | None,
    current_sector_weights: dict[str, float],
) -> float:
    if not sector:
        return 50.0

    current_weight = current_sector_weights.get(sector, 0.0)

    if current_weight == 0:
        return 100.0
    if current_weight < 15:
        return 80.0
    if current_weight < 30:
        return 55.0
    if current_weight < 45:
        return 30.0
    return 10.0


def concentration_penalty(
    ticker: str,
    sector: str | None,
    tickers_in_portfolio: set[str],
    current_sector_weights: dict[str, float],
) -> float:
    penalty = 0.0

    if ticker in tickers_in_portfolio:
        penalty += 100

    if sector:
        sector_weight = current_sector_weights.get(sector, 0.0)
        if sector_weight >= 50:
            penalty += 45
        elif sector_weight >= 40:
            penalty += 30
        elif sector_weight >= 30:
            penalty += 15

    return min(penalty, 100.0)


def candidate_score(
    stock: dict[str, Any],
    profile: str,
    tickers_in_portfolio: set[str],
    current_sector_weights: dict[str, float],
):
    ticker = str(stock.get("ticker") or "").upper()
    sector = stock.get("sector")
    investment_quality = safe_float(stock.get("score")) or 50.0
    beta = safe_float(stock.get("beta"))
    pe = safe_float(stock.get("pe_ratio"))
    upside = safe_float(
        stock.get("upside_percent")
        if stock.get("upside_percent") is not None
        else stock.get("upside_pct")
    )
    revenue_growth = normalized_percent(
        stock.get("revenue_growth_pct")
        if stock.get("revenue_growth_pct") is not None
        else stock.get("revenue_growth")
    )
    earnings_growth = normalized_percent(
        stock.get("earnings_growth_pct")
        if stock.get("earnings_growth_pct") is not None
        else stock.get("earnings_growth")
    )

    growth_values = [
        x for x in (revenue_growth, earnings_growth)
        if x is not None
    ]
    growth = (
        sum(growth_values) / len(growth_values)
        if growth_values
        else None
    )

    diversification = diversification_benefit(
        sector,
        current_sector_weights,
    )
    risk_fit = profile_fit(beta, profile)
    valuation = valuation_score(pe, upside)
    penalty = concentration_penalty(
        ticker,
        sector,
        tickers_in_portfolio,
        current_sector_weights,
    )

    match = (
        investment_quality * 0.45
        + diversification * 0.20
        + risk_fit * 0.20
        + valuation * 0.15
        - penalty * 0.25
    )

    reasons: list[str] = []
    cautions: list[str] = []

    if investment_quality >= 80:
        reasons.append("Score de inversión alto.")
    elif investment_quality >= 65:
        reasons.append("Score de inversión competitivo.")

    if diversification >= 80:
        reasons.append("Mejora la diversificación sectorial.")

    if risk_fit >= 80:
        reasons.append(f"Encaja bien con el perfil {profile}.")

    if upside is not None and upside >= 15:
        reasons.append("Potencial frente al precio objetivo superior al 15%.")

    if growth is not None and growth >= 10:
        reasons.append("Crecimiento financiero atractivo.")

    if beta is not None and beta > 1.6:
        cautions.append("Beta elevada; puede aumentar la volatilidad.")

    if pe is not None and pe > 40:
        cautions.append("Valoración P/E elevada.")

    if sector and current_sector_weights.get(sector, 0) >= 35:
        cautions.append("Aumentaría una exposición sectorial ya relevante.")

    if not reasons:
        reasons.append("Presenta una combinación equilibrada de métricas disponibles.")

    components = {
        "investment_quality": round(investment_quality, 1),
        "diversification_benefit": round(diversification, 1),
        "risk_fit": round(risk_fit, 1),
        "valuation": round(valuation, 1),
        "concentration_penalty": round(penalty, 1),
    }

    return (
        int(max(0, min(100, round(match)))),
        reasons,
        cautions,
        components,
    )


def recommendations(db: Session, profile: str, enriched):
    tickers_in_portfolio = {
        str(x["ticker"]).upper()
        for x in enriched
    }

    current_sector_weights: dict[str, float] = defaultdict(float)
    total_value = sum(x["market_value"] for x in enriched)

    if total_value > 0:
        for x in enriched:
            current_sector_weights[x["sector"]] += (
                x["market_value"] / total_value * 100
            )

    universe = list_research_candidates(
        db,
        exclude_tickers=tickers_in_portfolio,
        limit=80,
    )

    output = []

    for asset in universe:
        stock = {
            "ticker": asset.ticker,
            "company": asset.company or asset.ticker,
            "sector": asset.sector,
            "score": asset.score,
            "beta": asset.beta,
            "pe_ratio": asset.pe_ratio,
            "upside_percent": asset.upside_percent,
            "revenue_growth_pct": asset.revenue_growth_percent,
            "earnings_growth_pct": asset.earnings_growth_percent,
        }

        match, reasons, cautions, components = candidate_score(
            stock,
            profile,
            tickers_in_portfolio,
            current_sector_weights,
        )

        output.append(
            {
                "ticker": asset.ticker,
                "company": asset.company or asset.ticker,
                "match": match,
                "score": asset.score,
                "beta": asset.beta,
                "sector": asset.sector,
                "reasons": reasons,
                "cautions": cautions,
                "components": components,
                "source": "research_universe",
            }
        )

    output.sort(
        key=lambda x: (
            x["match"],
            x["score"] if x["score"] is not None else -1,
        ),
        reverse=True,
    )

    return output[:10]




def research_impact(
    db: Session,
    user_id: str,
    ticker: str,
    profile: str,
):
    """
    Evalúa un activo concreto frente al portafolio actual sin agregarlo.
    Se usa desde Research > Ver impacto.
    """
    positions = user_positions(db, user_id)
    enriched_lots = enrich_positions(db, positions)
    enriched = aggregate_positions(enriched_lots)

    tickers_in_portfolio = {
        str(x["ticker"]).upper()
        for x in enriched
    }

    current_sector_weights: dict[str, float] = defaultdict(float)
    total_value = sum(x["market_value"] for x in enriched)

    if total_value > 0:
        for x in enriched:
            current_sector_weights[x["sector"]] += (
                x["market_value"] / total_value * 100
            )

    stock = get_stock(ticker)
    stock.setdefault("ticker", str(ticker).strip().upper())

    try:
        upsert_research_asset(db, stock)
    except Exception:
        db.rollback()

    match, reasons, cautions, components = candidate_score(
        stock,
        profile,
        tickers_in_portfolio,
        current_sector_weights,
    )

    return {
        "ticker": stock.get("ticker"),
        "company": stock.get("company") or stock.get("ticker"),
        "sector": stock.get("sector"),
        "match": match,
        "score": stock.get("score"),
        "beta": stock.get("beta"),
        "reasons": reasons,
        "cautions": cautions,
        "components": components,
        "already_in_portfolio": (
            str(stock.get("ticker") or "").upper() in tickers_in_portfolio
        ),
    }

def build_analysis(db, user_id, profile):
    positions = user_positions(db, user_id)
    portfolio_source = (
        "snaptrade"
        if positions and isinstance(positions[0], BrokerPosition)
        else "manual"
    )

    # enrich_positions conserva los lotes originales.
    enriched_lots = enrich_positions(db, positions)

    # Todo el análisis económico se realiza por ticker consolidado.
    enriched = aggregate_positions(enriched_lots)

    invested = sum(x["invested"] for x in enriched)
    market_value = sum(x["market_value"] for x in enriched)
    pnl = market_value - invested
    pnl_percent = pnl / invested * 100 if invested else 0

    assets, sectors = allocations(enriched)
    health_data, alerts = health(enriched, assets, sectors)

    return {
        "summary": {
            "market_value": round(market_value, 2),
            "invested": round(invested, 2),
            "pnl": round(pnl, 2),
            "pnl_percent": round(pnl_percent, 2),

            # Número real de activos diferentes, no número de compras/lotes.
            "positions": len(enriched),
            "lots": len(enriched_lots),
            "sectors": len(sectors),
            "source": portfolio_source,
        },
        "health": health_data,
        "allocation_by_asset": assets,
        "allocation_by_sector": sectors,
        "alerts": alerts,
        "recommendations": recommendations(
            db,
            profile,
            enriched,
        ),

        # Útil para una futura tabla de posiciones consolidada en frontend.
        "consolidated_positions": [
            {
                "ticker": x["ticker"],
                "quantity": round(x["quantity"], 8),
                "average_cost": (
                    round(x["average_cost"], 4)
                    if x["average_cost"] is not None
                    else None
                ),
                "current_price": (
                    round(x["current_price"], 4)
                    if x["current_price"] is not None
                    else None
                ),
                "invested": round(x["invested"], 2),
                "market_value": round(x["market_value"], 2),
                "pnl": round(x["pnl"], 2),
                "pnl_percent": round(x["pnl_percent"], 2),
                "sector": x["sector"],
                "score": x["score"],
                "beta": x["beta"],
                "lots": x["lots"],
            }
            for x in enriched
        ],
    }


PERIODS = {
    "1M": "1mo",
    "3M": "3mo",
    "6M": "6mo",
    "1Y": "1y",
}


def build_history(db, user_id, range_name):
    positions = user_positions(db, user_id)

    if not positions:
        return {"range": range_name, "points": []}

    period = PERIODS.get(range_name, "3mo")

    # Consolidamos cantidades por ticker antes de construir la serie.
    quantities: dict[str, float] = defaultdict(float)

    for position in positions:
        ticker = str(position.ticker).strip().upper()
        quantities[ticker] += float(position.quantity)

    series = {}
    all_dates = set()

    for ticker, quantity in quantities.items():
        try:
            frame = yf.Ticker(ticker).history(
                period=period,
                interval="1d",
                auto_adjust=False,
            )

            if frame.empty:
                continue

            closes = frame["Close"].dropna()

            if closes.empty:
                continue

            series[ticker] = (
                closes,
                quantity,
            )

            all_dates.update(closes.index)

        except Exception:
            continue

    last_prices = {}
    points = []

    for date in sorted(all_dates):
        total = 0.0
        has_value = False

        for ticker, (closes, quantity) in series.items():
            if date in closes.index:
                price = safe_float(closes.loc[date])

                if price is not None:
                    last_prices[ticker] = price

            price = last_prices.get(ticker)

            if price is not None:
                total += price * quantity
                has_value = True

        if has_value:
            dt = (
                date.to_pydatetime()
                if hasattr(date, "to_pydatetime")
                else date
            )

            points.append({
                "date": dt.isoformat(),
                "value": round(total, 2),
            })

    return {
        "range": range_name,
        "points": points,
    }

