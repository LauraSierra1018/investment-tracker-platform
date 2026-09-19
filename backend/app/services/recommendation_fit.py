"""Deterministic research suitability, not a return forecast or trading instruction."""
import math

GOALS = {"preserve": "preservar capital", "balanced": "balance", "growth": "crecimiento",
         "aggressive": "crecimiento agresivo", "income": "ingresos", "custom": "tus prioridades"}
PROFILES = {"conservative": "bajo", "moderate": "medio", "aggressive": "alto"}

def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (ValueError, TypeError):
        return None

def fit(stock, preferences, sector_weights, held):
    ticker = str(stock.get("ticker") or "").upper()
    sector = stock.get("sector")
    quality = number(stock.get("score"))
    beta = number(stock.get("beta"))
    pe = number(stock.get("pe_ratio"))
    upside = number(stock.get("upside_percent"))
    # These provider fields already contain percentages, including values below 2%.
    growth_values = [number(stock.get(k)) for k in ("revenue_growth_pct", "earnings_growth_pct")]
    growth_values = [v for v in growth_values if v is not None]
    growth = sum(growth_values)/len(growth_values) if growth_values else None
    dividend = number(stock.get("dividend_yield_pct"))
    asset_type = str(stock.get("asset_type") or stock.get("quote_type") or "").upper()
    sector_weight = sector_weights.get(sector, 0) if sector else None
    diversification = max(0, 100 - 2 * sector_weight) if sector_weight is not None else None
    target_beta = {"conservative": .65, "moderate": 1., "aggressive": 1.35}[preferences.risk_profile]
    # Short horizons always tighten risk fit, even with an aggressive growth goal.
    if preferences.horizon == "<1":
        target_beta = min(target_beta, .5)
    elif preferences.horizon == "1-3":
        target_beta = min(target_beta, .8)
    risk = max(0, 100 - abs(beta-target_beta)*85) if beta is not None else None
    valuation_parts = []
    if pe is not None and pe > 0:
        valuation_parts.append(max(0, min(100, 110-pe*2)))
    if upside is not None:
        valuation_parts.append(max(0, min(100, 50+upside*2)))
    values = {
        "quality": quality, "diversification": diversification, "risk": risk,
        "valuation": sum(valuation_parts)/len(valuation_parts) if valuation_parts else None,
        "growth": max(0, min(100, 40+growth*2)) if growth is not None else None,
        # Do not reward extreme yields more than moderate positive yields.
        "income": (min(100, max(0, dividend)*25) if dividend <= 8 else 50) if dividend is not None else None,
        "etf": 100 if asset_type == "ETF" else 0,
    }
    weights = {"quality": .25, "diversification": .2, "risk": .25, "valuation": .15, "growth": .1, "income": .05, "etf": 0.}
    goal_weight = {"preserve": ("risk", .5), "balanced": ("diversification", .1),
                   "growth": ("growth", .45), "aggressive": ("growth", .5),
                   "income": ("income", .6), "custom": ("quality", 0)}
    component, extra = goal_weight[preferences.goal]
    weights[component] += extra
    for priority in preferences.priorities:
        weights[{"low_volatility": "risk"}.get(priority, priority)] += .2
    if preferences.horizon in {"<1", "1-3"}:
        weights["risk"] += .4
    total_weight = sum(weights.values())
    coverage = sum(weight for key, weight in weights.items() if values[key] is not None)/total_weight
    # Missing data never receives a fabricated average score.
    match = sum((values[key] or 0)*weight for key, weight in weights.items())/total_weight
    penalty = 100 if ticker in held else max(0, (sector_weight or 0)-30)*.4
    match = max(0, min(100, match-penalty))
    reasons, cautions = [], []
    if diversification is not None and diversification >= 80:
        reasons.append("Añade exposición a un sector poco representado en tu portafolio.")
    if risk is not None and risk >= 75:
        reasons.append(f"Su beta encaja con tu tolerancia al riesgo {PROFILES[preferences.risk_profile]} y tu horizonte.")
    if quality is not None and quality >= 70:
        reasons.append("Presenta una evaluación financiera favorable con los datos disponibles.")
    if preferences.goal in {"growth", "aggressive"} and growth is not None:
        reasons.append(f"Crecimiento financiero observado: {growth:.1f}%, relevante para tu objetivo de crecimiento.")
    if preferences.goal == "income" and dividend is not None and dividend > 0:
        reasons.append(f"Rentabilidad por dividendos reportada: {dividend:.1f}%, relevante para tu objetivo de ingresos.")
    if "etf" in preferences.priorities and asset_type == "ETF":
        reasons.append("Es un ETF, acorde con una de tus prioridades.")
    if sector_weight is not None and sector_weight >= 35:
        cautions.append("Su sector ya representa una parte importante de tu portafolio.")
    if beta is None:
        cautions.append("Falta beta para evaluar el ajuste de riesgo.")
    if coverage < .75:
        cautions.append("La información disponible es parcial; el ajuste puede cambiar al completar los datos.")
    if preferences.goal == "income" and dividend is None:
        cautions.append("No hay información de dividendos para comprobar el objetivo de ingresos.")
    if dividend is not None and dividend > 8:
        cautions.append("El rendimiento por dividendos elevado requiere revisar su sostenibilidad.")
    if preferences.horizon == "<1":
        cautions.append("Acciones y ETFs pueden perder valor en un horizonte menor a un año.")
    if not sector:
        cautions.append("No se puede confirmar la diversificación sectorial; en ETFs hay que revisar sus posiciones.")
    if not reasons:
        reasons.append(f"Opción para investigar según {GOALS[preferences.goal]}; revisa la información faltante.")
    components = {**{key: round(value, 1) if value is not None else None for key,value in values.items()},
                  "data_coverage": round(coverage*100), "concentration_penalty": round(penalty,1)}
    return round(match), reasons, cautions, components
