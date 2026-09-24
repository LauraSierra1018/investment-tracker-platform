from typing import Any
from fastapi import HTTPException
from .market_requests import market_budget, refreshes
from .market_provider import get_fundamentals, get_history as provider_history, get_quote, search_yahoo
from .market_data.common import number as safe_num, provenance
from .scoring import evaluate

def _normalize_symbol(ticker):
    from .market_data.common import symbol
    result = symbol(ticker)
    if not result:
        raise HTTPException(status_code=400, detail="Ticker inválido")
    return result

@market_budget
def get_stock(ticker: str) -> dict[str, Any]:
    ticker = _normalize_symbol(ticker)
    # Quotes have priority within the shared wait budget; workers may finish fundamentals later.
    quote = get_quote(ticker) or {}
    fundamentals = get_fundamentals(ticker) or {}
    refreshing = (refreshes.is_pending(("md_fundamentals", ticker))
                  or refreshes.is_pending(("md_quotes", ticker)))
    if not quote and not fundamentals and not refreshing:
        raise HTTPException(status_code=503, detail="Los proveedores de mercado no están disponibles y no hay datos verificados guardados.")
    price = safe_num(quote.get("price"))
    quote_currency, fundamental_currency = quote.get("currency"), fundamentals.get("currency")
    currency = quote_currency or fundamental_currency or ""
    currencies_match = bool(quote_currency and quote_currency == fundamental_currency)
    financial_currency = fundamentals.get("financial_currency") or fundamental_currency
    financial_match = bool(quote_currency and quote_currency == financial_currency)
    target = safe_num(fundamentals.get("target_price")) if currencies_match else None
    eps = safe_num(fundamentals.get("eps"))
    pe = price/eps if financial_match and price is not None and eps is not None and eps > 0 else None
    # Do not expose a provider's older P/E as a valuation at today's price.
    upside = (target/price-1)*100 if target is not None and price and currencies_match else None
    shares, floating = safe_num(fundamentals.get("shares_outstanding")), safe_num(fundamentals.get("float_shares"))
    free_float = floating/shares*100 if floating is not None and shares and shares > 0 else None
    cap = safe_num(quote.get("market_cap"))
    if cap is None and currencies_match:
        cap = safe_num(fundamentals.get("market_cap"))
    revenue, cash = safe_num(fundamentals.get("revenue")), safe_num(fundamentals.get("free_cash_flow"))
    metrics = {k: safe_num(fundamentals.get(k)) for k in
               ("revenue_growth_pct", "earnings_growth_pct", "roe_pct", "roa_pct",
                "operating_margin_pct", "debt_to_equity", "current_ratio", "beta")}
    metrics.update(market_cap_b=cap/1e9 if cap is not None else None,
                   revenue_m=revenue/1e6 if revenue is not None else None, pe_ratio=pe,
                   free_float_pct=free_float, upside_pct=upside,
                   free_cash_flow_m=cash/1e6 if cash is not None else None)
    score, classification, criteria, strengths, risks, missing = evaluate(metrics)
    if all(item["status"] == "sin_dato" for item in criteria):
        classification = "Actualizando análisis" if refreshing else "Datos insuficientes"
    # Existing scoring labels assumed USD. Preserve units for other report currencies.
    for criterion in criteria:
        key = criterion["key"]
        unit = financial_currency if key in {"revenue_m", "free_cash_flow_m"} else currency
        if criterion["formatted_value"].startswith("USD "):
            criterion["formatted_value"] = criterion["formatted_value"].replace("USD ", (unit or "")+" ", 1).strip()
    warnings = list(dict.fromkeys(d.get("warning") for d in (quote, fundamentals) if d.get("warning")))
    if not fundamentals:
        warnings.append("No hay fundamentales verificados disponibles para este activo.")
    if quote and fundamentals and not currencies_match:
        warnings.append("No se confirmó una moneda común; la valoración combinada no está disponible.")
    if not quote_currency and quote:
        warnings.append("La moneda de la cotización no está confirmada.")
    dates = [d["retrieved_at"] for d in (quote, fundamentals) if d.get("retrieved_at")]
    sources = list(dict.fromkeys(d["source"] for d in (quote, fundamentals) if d.get("source")))
    valuation = {"price": price, "target_price": target, "upside_percent": upside, "pe_ratio": pe,
                 "eps": eps if financial_match else None, "earnings_period": fundamentals.get("period_basis"),
                 "currency_compatible": currencies_match, "financial_currency_compatible": financial_match,
                 "formula": "P/E = precio / EPS positivo del período indicado; potencial = (objetivo / precio - 1) × 100",
                 "inputs": {"quote": provenance(quote), "fundamentals": provenance(fundamentals)}}
    return {
        "ticker": ticker, "company": fundamentals.get("company") or ticker,
        "description": fundamentals.get("description"), "exchange": fundamentals.get("exchange"),
        "currency": currency, "financial_currency": financial_currency, "quote_type": fundamentals.get("quote_type"),
        "sector": fundamentals.get("sector"), "industry": fundamentals.get("industry"),
        "price": price, "previous_close": quote.get("previous_close"), "change_percent": quote.get("change_percent"),
        "daily_change_percent": quote.get("change_percent"), "target_price": target,
        "upside_percent": upside, "upside_pct": upside, "market_cap": cap, "pe_ratio": pe,
        "revenue": revenue, "revenue_millions": metrics["revenue_m"], "free_float_percent": free_float,
        "volume": quote.get("volume"), "average_volume": fundamentals.get("average_volume"),
        "dividend_yield_pct": fundamentals.get("dividend_yield_pct"), **metrics,
        "score": score, "classification": classification, "criteria": criteria,
        "refreshing": refreshing,
        "strengths": strengths, "risks": risks, "missing_data": missing,
        "updated_at": max(dates) if dates else None, "source": " + ".join(sources),
        "stale": any(d.get("stale", False) for d in (quote, fundamentals)),
        "warning": " ".join(warnings) or None,
        "period_basis": fundamentals.get("period_basis"), "statements": fundamentals.get("statements") or {},
        "calculation_notes": fundamentals.get("calculation_notes"),
        "valuation": valuation, "provenance": {"quote": provenance(quote), "fundamentals": provenance(fundamentals)}
    }

def search(query):
    return search_yahoo(query)

def history(ticker, period="1y"):
    ticker = _normalize_symbol(ticker)
    if period not in {"1mo", "3mo", "6mo", "1y", "2y", "5y"}:
        period = "1y"
    data = provider_history(ticker, period, "1wk" if period == "5y" else "1d")
    if not data:
        raise HTTPException(status_code=503, detail="No hay un histórico verificado disponible.")
    return [{"date": p["date"].split("T")[0], "close": p["close"], "volume": p.get("volume")} for p in data["points"]]

def clear_market_cache(ticker=None):
    return None
