"""Normalize statements first, then derive annual ratios without provider mixing."""
from .common import number, date_time, now

FIELDS = {
    "income": {"revenue": ("revenue", "totalRevenue"), "net_income": ("netIncome", "netIncome"),
               "operating_income": ("operatingIncome", "operatingIncome"),
               "eps": ("epsDiluted", None)},
    "balance": {"assets": ("totalAssets", "totalAssets"), "equity": ("totalStockholdersEquity", "totalShareholderEquity"),
                "debt": ("totalDebt", "shortLongTermDebtTotal"),
                "current_assets": ("totalCurrentAssets", "totalCurrentAssets"),
                "current_liabilities": ("totalCurrentLiabilities", "totalCurrentLiabilities")},
    "cash_flow": {"operating_cash_flow": ("operatingCashFlow", "operatingCashflow"),
                  "capital_expenditure": ("capitalExpenditure", "capitalExpenditures"),
                  "free_cash_flow": ("freeCashFlow", None)},
}

def normalize(rows, kind, provider, ticker):
    output = []
    if not isinstance(rows, list):
        return output
    for row in rows:
        if not isinstance(row, dict):
            return []
        if provider == "fmp" and (row.get("symbol") != ticker or row.get("period") != "FY"):
            continue
        date = row.get("date") if provider == "fmp" else row.get("fiscalDateEnding")
        currency = row.get("reportedCurrency")
        dt = date_time(date)
        if not dt or dt > now() or not currency:
            continue
        data = {"period_end": date, "currency": currency, "period": "FY"}
        for target, sources in FIELDS[kind].items():
            key = sources[0 if provider == "fmp" else 1]
            data[target] = number(row.get(key)) if key else None
        if kind == "cash_flow" and data["free_cash_flow"] is None:
            op, capex = data["operating_cash_flow"], data["capital_expenditure"]
            if op is not None and capex is not None:
                data["free_cash_flow"] = op - abs(capex)
        output.append(data)
    if len({r["period_end"] for r in output}) != len(output):
        return []
    return sorted(output, key=lambda r: r["period_end"], reverse=True)

def ratio(a, b, scale=1):
    return a/b*scale if a is not None and b is not None and b > 0 else None

def annual_metrics(statements):
    incomes = statements.get("income") or []
    if not incomes:
        return {}
    current = incomes[0]
    date, currency = current["period_end"], current["currency"]
    def matching(kind, date):
        return next((r for r in statements.get(kind, []) if r["period_end"] == date and r["currency"] == currency), {})
    balance, cash = matching("balance", date), matching("cash_flow", date)
    previous = incomes[1] if len(incomes) > 1 else {}
    if previous and (previous["currency"] != currency or not 300 <= (date_time(date)-date_time(previous["period_end"])).days <= 430):
        previous = {}
    prior_balance = matching("balance", previous["period_end"]) if previous else {}
    def growth(key):
        current_value, prior = current.get(key), previous.get(key)
        return (current_value/prior-1)*100 if current_value is not None and prior is not None and prior > 0 else None
    def average(key):
        a, b = balance.get(key), prior_balance.get(key)
        return (a+b)/2 if a is not None and b is not None else a
    return {"financial_currency": currency, "data_timestamp": date, "period_basis": "FY",
            "revenue": current.get("revenue"), "eps": current.get("eps"),
            "revenue_growth_pct": growth("revenue"), "earnings_growth_pct": growth("net_income"),
            "roe_pct": ratio(current.get("net_income"), average("equity"), 100),
            "roa_pct": ratio(current.get("net_income"), average("assets"), 100),
            "operating_margin_pct": ratio(current.get("operating_income"), current.get("revenue"), 100),
            "debt_to_equity": ratio(balance.get("debt"), balance.get("equity"), 100),
            "current_ratio": ratio(balance.get("current_assets"), balance.get("current_liabilities")),
            "free_cash_flow": cash.get("free_cash_flow"),
            "partial": not bool(balance and cash),
            "calculation_notes": "Ratios anuales; ROE/ROA usan saldos medios si hay dos ejercicios comparables, o saldo final disponible."}
