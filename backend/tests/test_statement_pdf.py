import base64
import unittest
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

from pypdf import PdfWriter
from app.services.statement_pdf import Holding, Statement, extract_pdf, validate_statement


def holding(**patch):
    data = dict(ticker='ACME', company='Acme', asset_type='STOCK', quantity=2,
                currency='USD', last_price=12, market_value=24, average_cost=None,
                invested_amount=20, cost_source='reported', source_page=1,
                evidence='Acme ACME 2 12 24', cost_evidence='Page 1 total cost 20', issues=[])
    data.update(patch)
    return Holding(**data)


def statement(*rows):
    return Statement(broker='Example', statement_date='2026-07-31', positions=list(rows), warnings=[])


class PDFTests(unittest.TestCase):
    def row(self, **patch):
        return validate_statement(statement(holding(**patch)), 1)['positions'][0]

    def test_total_cost_is_divided_by_quantity(self):
        self.assertEqual(self.row()['average_cost'], 10)

    def test_no_market_value_as_cost(self):
        row = self.row(cost_source='unknown', average_cost=12)
        self.assertIsNone(row['average_cost'])
        self.assertIsNone(row['invested_amount'])

    def test_cost_requires_evidence(self):
        self.assertIsNone(self.row(cost_evidence=None)['average_cost'])

    def test_fractional_holdings(self):
        row = self.row(quantity=0.00005, last_price=283.29, market_value=0.01)
        self.assertFalse(any('Cantidad ×' in x for x in row['issues']))

    def test_inconsistent_columns_flagged(self):
        self.assertTrue(any('Cantidad ×' in x for x in self.row(market_value=240)['issues']))

    def test_missing_price_derived(self):
        self.assertEqual(self.row(last_price=None)['last_price'], 12)

    def test_missing_currency_not_assumed(self):
        self.assertEqual(self.row(currency=None)['currency'], '')

    def test_isin_is_not_ticker(self):
        self.assertEqual(self.row(ticker='US0378331005')['ticker'], '')

    def test_cash_excluded(self):
        self.assertEqual(validate_statement(statement(holding(asset_type='CASH')), 1)['positions'], [])

    def test_funds_classified(self):
        self.assertEqual(self.row(asset_type='ETF')['asset_type'], 'ETF')
        self.assertTrue(self.row(asset_type='FUND')['supported'])

    def test_options_not_stock_arithmetic(self):
        row = self.row(asset_type='OPTION', last_price=None)
        self.assertFalse(row['supported'])
        self.assertIsNone(row['last_price'])

    def test_duplicate_accounts_require_review(self):
        rows = validate_statement(statement(holding(), holding()), 1)['positions']
        self.assertTrue(any('repetido' in x for x in rows[1]['issues']))

    def test_invalid_source_and_nan(self):
        row = self.row(source_page=12, quantity=float('nan'))
        self.assertIsNone(row['quantity'])
        self.assertTrue(any('referencia' in x for x in row['issues']))

    def test_pdf_input_includes_images_and_strict_schema(self):
        pdf = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=400, height=600)
        writer.write(pdf)
        client = SimpleNamespace(responses=SimpleNamespace(create=Mock(return_value=SimpleNamespace(
            status='completed', output_text=statement(holding()).model_dump_json()))))
        result = extract_pdf('scan.pdf', pdf.getvalue(), client=client)
        args = client.responses.create.call_args.kwargs
        self.assertFalse(args['store'])
        self.assertTrue(args['text']['format']['strict'])
        encoded = args['input'][0]['content'][0]['file_data'].split(',', 1)[1]
        self.assertEqual(base64.b64decode(encoded), pdf.getvalue())
        self.assertTrue(result['requires_review'])

    def test_incomplete_response_never_imports_partial_rows(self):
        pdf = BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=400, height=600)
        writer.write(pdf)
        client = SimpleNamespace(responses=SimpleNamespace(create=Mock(return_value=SimpleNamespace(
            status='incomplete', output_text='{}'))))
        with self.assertRaises(ValueError):
            extract_pdf('scan.pdf', pdf.getvalue(), client=client)

    def test_invalid_pdf(self):
        with self.assertRaises(ValueError):
            extract_pdf('fake.pdf', b'not a pdf')


if __name__ == '__main__':
    unittest.main()
