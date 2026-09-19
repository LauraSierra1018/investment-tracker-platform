import re
from typing import Any

def _number(value):
    return float(str(value).replace(chr(36), chr(32)).replace(chr(44), str()).strip())

def apex_cost_rows(text: str, default_currency: str) -> list[dict[str, Any]]:
    """Read the Apex holdings table only; never guess symbols from prose.

    Purchases establish cost only when they cover the entire current holding,
    with no sales and no prior-period position. Debit includes purchase fees.
    Unsupported layouts return no positions instead of importing false stocks.
    """
    number = r"\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?"
    holding = re.compile(
        rf"^(?P<company>.+?)\s+(?P<ticker>[A-Z][A-Z0-9.\-]{{0,11}})"
        rf"\s+[CM]\s+(?P<quantity>{number})\s+(?P<price>{number})"
        rf"\s+(?P<value>{number})(?=\s|$)(?P<rest>.*)$"
    )
    trade = re.compile(
        rf"^(BOUGHT|SOLD)\s+\d{{2}}/\d{{2}}/\d{{2,4}}\s+[CM]\s+"
        rf"(.+?)\s+({number})\s+({number})\s+({number})$"
    )
    output = []
    purchases: dict[str, list[tuple[float, float]]] = {}
    sold = set()
    in_equities = False
    in_trades = False
    for raw in text.splitlines():
        line = " ".join(raw.split())
        compact = re.sub(r"\s+", "", line).upper()
        if compact == "EQUITIES/OPTIONS":
            in_equities = True
            continue
        if compact.startswith(("TOTALEQUITIES", "TOTALPRICEDPORTFOLIO")):
            in_equities = False
        if compact.startswith("BUY/SELLTRANSACTIONS"):
            in_trades = True
            in_equities = False
            continue
        if compact.startswith(("TOTALBUY/SELL", "FUNDSPAID", "IMPORTANT")):
            in_trades = False
        if in_equities:
            match = holding.fullmatch(line)
            if not match:
                continue
            row = match.groupdict()
            quantity, price, value = (_number(row[k]) for k in ('quantity', 'price', 'value'))
            if quantity <= 0 or abs(quantity * price - value) > 0.02:
                continue
            if any(p['ticker'] == row['ticker'] for p in output):
                raise ValueError('Posición duplicada en el PDF; revisa las cuentas por separado.')
            output.append({
                'ticker': row['ticker'], 'company': row['company'],
                'quantity': quantity, 'last_price': price, 'market_value': value,
                'average_cost': None, 'invested_amount': None,
                'currency': default_currency, 'asset_type': None, 'confidence': 0.95,
                '_new': row['rest'].strip().startswith('N/A'),
            })
        if in_trades:
            match = trade.fullmatch(line)
            if match:
                action, company, qty, price, debit = match.groups()
                if action == 'SOLD':
                    sold.add(company)
                else:
                    purchases.setdefault(company, []).append((_number(qty), _number(debit)))
    for row in output:
        trades = purchases.get(row['company'], [])
        is_new = row.pop('_new')
        if (is_new and trades and row['company'] not in sold
                and abs(sum(q for q, _ in trades) - row['quantity']) < 1e-8):
            invested = round(sum(v for _, v in trades), 2)
            row['invested_amount'] = invested
            row['average_cost'] = invested / row['quantity']
    return output
