"""Risk uses one daily, split-adjusted series, independently of the chart interval."""
import math
import statistics
from fastapi import HTTPException
from .market_data_service import get_history
from .common import provenance, date_time, valid

def get_risk(ticker):
    ticker = ticker.strip().upper()
    data = get_history(ticker, "1y", "1d")
    if not data or not valid(data, ticker, "history"):
        raise HTTPException(503, "No hay un histórico diario verificado para calcular el riesgo.")
    points = data["points"]
    closes = [p["close"] for p in points]
    dates = [date_time(p["date"]) for p in points]
    enough = (len(closes) >= 61 and data.get("interval") == "1d"
              and data.get("price_basis") == "split_adjusted"
              and max((b-a).days for a,b in zip(dates, dates[1:])) <= 7)
    volatility, drawdown = None, None
    if enough:
        returns = [math.log(b/a) for a,b in zip(closes, closes[1:])]
        volatility = statistics.stdev(returns)*math.sqrt(252)*100
        peak, drawdown = closes[0], 0.0
        for close in closes:
            peak = max(peak, close)
            drawdown = min(drawdown, (close/peak-1)*100)
    partial_year = (dates[-1]-dates[0]).days < 330
    warning = data.get("warning")
    if not enough:
        warning = "Se necesitan al menos 61 cierres diarios consistentes, sin huecos prolongados."
    elif partial_year:
        warning = "El histórico cubre menos de un año; las métricas reflejan solamente el período disponible."
    return {"ticker": ticker, "period": "1y", "interval": "1d", "observations": len(closes),
            "annualized_volatility": volatility, "max_drawdown": drawdown,
            "start": points[0]["date"], "end": points[-1]["date"], "partial": partial_year,
            "stale": data.get("stale", False), "warning": warning,
            "method": "Retornos logarítmicos diarios, desviación muestral × √252; caída desde el máximo previo. Precios ajustados por splits, sin reinversión de dividendos.",
            "provenance": provenance(data)}
