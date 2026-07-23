from dataclasses import dataclass
from typing import Callable
import math

@dataclass
class Rule:
    key: str
    name: str
    category: str
    weight: float
    explanation: str
    evaluator: Callable[[float | None], tuple[str, float, str]]


def _range(v, ideal_min, ideal_max, review_min, review_max):
    if v is None or not math.isfinite(v): return "sin_dato", 0.0, f"Ideal: {ideal_min:g}–{ideal_max:g}."
    if ideal_min <= v <= ideal_max: return "cumple", 100.0, f"Está dentro del rango ideal {ideal_min:g}–{ideal_max:g}."
    if review_min <= v <= review_max: return "revisar", 55.0, f"Está fuera del ideal, pero dentro del rango de revisión {review_min:g}–{review_max:g}."
    return "no_cumple", 15.0, f"Está fuera del rango de revisión {review_min:g}–{review_max:g}."

def _minimum(v, ideal, review):
    if v is None or not math.isfinite(v): return "sin_dato", 0.0, f"Ideal: al menos {ideal:g}."
    if v >= ideal: return "cumple", 100.0, f"Supera el mínimo ideal de {ideal:g}."
    if v >= review: return "revisar", 55.0, f"Supera el mínimo de revisión de {review:g}, pero no el ideal."
    return "no_cumple", 15.0, f"Está por debajo del mínimo de revisión de {review:g}."

def _maximum(v, ideal, review):
    if v is None or not math.isfinite(v): return "sin_dato", 0.0, f"Ideal: máximo {ideal:g}."
    if v <= ideal: return "cumple", 100.0, f"Está por debajo del máximo ideal de {ideal:g}."
    if v <= review: return "revisar", 55.0, f"Está por encima del ideal, pero debajo del máximo de revisión {review:g}."
    return "no_cumple", 15.0, f"Supera el máximo de revisión de {review:g}."

def rules():
    return [
      Rule("market_cap_b", "Capitalización", "Tamaño y liquidez", 8, "Valor total de las acciones de la empresa. Una capitalización mayor suele implicar más estabilidad y cobertura institucional.", lambda v: _minimum(v, 2, .3)),
      Rule("pe_ratio", "Relación P/E", "Valoración", 10, "Compara el precio de la acción con las ganancias por acción. Tu rango preferido es 20–25 veces ganancias; debe interpretarse junto con crecimiento y sector.", lambda v: _range(v, 20, 25, 10, 40)),
      Rule("revenue_m", "Ventas totales", "Crecimiento", 7, "Ingresos anuales de la compañía en millones de USD. Ayudan a distinguir empresas con escala comercial de negocios todavía pequeños.", lambda v: _minimum(v, 1000, 100)),
      Rule("free_float_pct", "Free float", "Liquidez y propiedad", 6, "Porcentaje de acciones disponible para negociarse públicamente. Un float muy bajo puede aumentar volatilidad y riesgo de manipulación.", lambda v: _minimum(v, 40, 20)),
      Rule("upside_pct", "Potencial al precio objetivo", "Analistas", 8, "Diferencia porcentual entre el precio actual y el precio objetivo promedio de analistas. No es garantía de retorno.", lambda v: _minimum(v, 15, 0)),
      Rule("revenue_growth_pct", "Crecimiento de ingresos", "Crecimiento", 9, "Variación interanual de las ventas. El crecimiento sostenido suele apoyar valoraciones superiores.", lambda v: _minimum(v, 10, 0)),
      Rule("earnings_growth_pct", "Crecimiento de ganancias", "Crecimiento", 9, "Variación interanual de las utilidades. Puede ser volátil; conviene comparar varios periodos.", lambda v: _minimum(v, 10, 0)),
      Rule("roe_pct", "ROE", "Rentabilidad", 7, "Rentabilidad sobre el patrimonio. Mide cuánto beneficio genera la empresa con el capital de los accionistas.", lambda v: _minimum(v, 15, 8)),
      Rule("roa_pct", "ROA", "Rentabilidad", 5, "Rentabilidad sobre activos. Indica la eficiencia con que la empresa utiliza sus recursos totales.", lambda v: _minimum(v, 7, 3)),
      Rule("operating_margin_pct", "Margen operativo", "Rentabilidad", 7, "Porcentaje de ventas que queda después de costos operativos. Márgenes altos y estables dan mayor resiliencia.", lambda v: _minimum(v, 15, 5)),
      Rule("debt_to_equity", "Deuda / patrimonio", "Solvencia", 7, "Compara deuda con patrimonio. Un valor menor suele significar menor riesgo financiero, aunque depende del sector.", lambda v: _maximum(v, 100, 200)),
      Rule("current_ratio", "Razón corriente", "Solvencia", 5, "Capacidad de cubrir obligaciones de corto plazo con activos corrientes.", lambda v: _minimum(v, 1.2, .8)),
      Rule("free_cash_flow_m", "Flujo de caja libre", "Caja", 7, "Efectivo que queda después de inversión operativa. Permite pagar deuda, recomprar acciones, invertir o repartir dividendos.", lambda v: _minimum(v, 0, -1)),
      Rule("beta", "Beta", "Riesgo", 5, "Sensibilidad histórica frente al mercado. Cerca de 1 implica movimiento similar; valores mayores indican más volatilidad relativa.", lambda v: _range(v, .7, 1.3, 0, 2)),
    ]

def evaluate(metrics: dict):
    output=[]; total=0; available_weight=0
    for rule in rules():
        value=metrics.get(rule.key)
        status,score,rule_text=rule.evaluator(value)
        if status != "sin_dato":
            total += score*rule.weight
            available_weight += rule.weight
        output.append({"key":rule.key,"name":rule.name,"category":rule.category,"value":value,"formatted_value":format_value(rule.key,value),"status":status,"score":score,"weight":rule.weight,"explanation":rule.explanation,"rule":rule_text})
    final=round(total/available_weight,1) if available_weight else 0
    classification = "Oportunidad prioritaria" if final>=80 else "En seguimiento" if final>=65 else "Neutral" if final>=50 else "Precaución"
    strengths=[x["name"] for x in output if x["status"]=="cumple"][:5]
    risks=[x["name"] for x in output if x["status"]=="no_cumple"][:5]
    missing=[x["name"] for x in output if x["status"]=="sin_dato"]
    return final,classification,output,strengths,risks,missing

def format_value(key,v):
    if v is None: return "Sin dato"
    if key.endswith("_pct"): return f"{v:,.1f}%"
    if key.endswith("_m"): return f"USD {v:,.0f} M"
    if key=="market_cap_b": return f"USD {v:,.2f} B"
    if key=="pe_ratio": return f"{v:,.1f}x"
    if key in {"debt_to_equity"}: return f"{v:,.1f}%"
    return f"{v:,.2f}"
