import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pandas as pd
from app.services.market_data import market_data_service as provider, yahoo_provider as yahoo
from app.services.market_data.common import stamp, now
from app.services import market_requests as network


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.pool = network.RefreshPool(workers=2, capacity=2)
        self.release = threading.Event()

    def tearDown(self):
        self.release.set()
        self.pool.executor.shutdown(wait=True)

    def test_identical_concurrent_requests_share_one_call(self):
        entered = threading.Event()
        def slow():
            entered.set()
            self.release.wait(2)
            return {'price': 42}
        loader = Mock(side_effect=slow)
        with ThreadPoolExecutor(max_workers=8) as callers:
            tasks = [callers.submit(self.pool.get, ('quote', 'AAPL'), loader, {}, .05) for _ in range(8)]
            self.assertTrue(entered.wait(1))
            self.assertEqual([task.result() for task in tasks], [{}] * 8)
            self.assertEqual(loader.call_count, 1)
            self.release.set()

    def test_queue_is_bounded_and_timeout_does_not_cancel_cache_fill(self):
        completed = []
        def slow():
            self.release.wait(2)
            completed.append(True)
            return {'price': 1}
        for i in range(2):
            self.assertEqual(self.pool.get(('quote', i), slow, {}, .01), {})
        unwanted = Mock()
        started = time.monotonic()
        self.assertEqual(self.pool.get(('quote', 3), unwanted, {}, .5), {})
        self.assertLess(time.monotonic() - started, .2)
        unwanted.assert_not_called()
        self.release.set()
        self.pool.executor.shutdown(wait=True)
        self.assertEqual(len(completed), 2)

    def test_failed_results_are_not_retried_until_cooldown(self):
        loader = Mock(return_value=None)
        self.pool.get(('fundamentals', 'BAD'), loader)
        self.pool.executor.shutdown(wait=True)
        self.pool.get(('fundamentals', 'BAD'), loader)
        loader.assert_called_once()

    def test_nested_budget_does_not_multiply_wait_for_many_assets(self):
        loader = lambda: self.release.wait(2)
        started = time.monotonic()
        with network.budget(.05):
            for i in range(8):
                with network.budget(12):
                    self.pool.get(('quote', i), loader, {}, wait=8)
        self.assertLess(time.monotonic() - started, .3)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.session = network.YahooSession(spacing=.02)

    def tearDown(self):
        self.session.close()

    def test_paces_real_requests_and_caps_internal_timeout(self):
        starts = []
        def response(*args, **kwargs):
            starts.append(time.monotonic())
            self.assertLessEqual(kwargs['timeout'], 6)
            return SimpleNamespace(status_code=200, headers={})
        with patch.object(network.requests.Session, 'request', side_effect=response):
            self.session.get('https://query1.finance.yahoo.com', timeout=30)
            self.session.get('https://query1.finance.yahoo.com', timeout=30)
        self.assertGreaterEqual(starts[1] - starts[0], .018)

    def test_429_blocks_internal_retries_and_respects_retry_after(self):
        response = SimpleNamespace(status_code=429, headers={'Retry-After': '600'})
        with patch.object(network.requests.Session, 'request', return_value=response) as send:
            self.session.get('https://query1.finance.yahoo.com')
            with self.assertRaises(RuntimeError):
                self.session.get('https://query1.finance.yahoo.com')
            send.assert_called_once()
            self.assertGreater(self.session.blocked_until - time.monotonic(), 599)

    def test_timeout_opens_circuit(self):
        with patch.object(network.requests.Session, 'request', side_effect=TimeoutError) as send:
            with self.assertRaises(TimeoutError):
                self.session.get('https://query1.finance.yahoo.com')
            with self.assertRaises(RuntimeError):
                self.session.get('https://query1.finance.yahoo.com')
            send.assert_called_once()

    def test_session_is_accepted_by_installed_yfinance(self):
        from yfinance.data import YfData
        YfData(session=self.session)
        YfData(session=network.yahoo_session)


class DataTests(unittest.TestCase):
    def test_missing_ticker_never_uses_another_tickers_close(self):
        for columns in [[('Close', 'AAPL')], [('AAPL', 'Close')]]:
            frame = pd.DataFrame([[100], [101]], columns=pd.MultiIndex.from_tuples(columns))
            self.assertTrue(yahoo.history_frame(frame, 'MISSING').empty)
            self.assertEqual(yahoo.frame_points(yahoo.history_frame(frame, 'AAPL'))[-1]['close'], 101)

    def test_distinct_trading_days_and_ohlc_are_preserved_in_batch(self):
        dates = pd.to_datetime(['2026-09-09', '2026-09-10', '2026-09-11'])
        frame = pd.DataFrame({
            ('AAPL', 'Close'): [10., None, 12.],
            ('AAPL', 'Open'): [9., None, 11.],
            ('AAPL', 'Volume'): [100., None, 120.],
            ('TM', 'Close'): [None, 200., 210.],
            ('TM', 'Open'): [None, 190., 205.],
            ('TM', 'Volume'): [None, 30., 40.],
        }, index=dates)
        with patch.object(yahoo, 'available', return_value=True), \
             patch.object(yahoo, 'currency_for', return_value='USD'), \
             patch.object(yahoo, 'download', return_value=frame) as fetch:
            result = yahoo.histories(['AAPL', 'TM', 'BAD'], '1mo', '1d')
        self.assertEqual(set(result), {'AAPL', 'TM'})
        self.assertEqual([p['date'][:10] for p in result['AAPL']['points']], ['2026-09-09', '2026-09-11'])
        self.assertEqual([p['close'] for p in result['TM']['points']], [200., 210.])
        self.assertEqual(result['TM']['points'][0]['open'], 190.)
        self.assertEqual(result['TM']['points'][0]['volume'], 30)
        fetch.assert_called_once()

    def test_download_contract_disables_threads_and_groups_by_ticker(self):
        yf = SimpleNamespace(download=Mock(return_value=pd.DataFrame()))
        network.download(yf, tickers=['AAPL', 'TM'], period='1mo')
        kwargs = yf.download.call_args.kwargs
        self.assertEqual(kwargs['group_by'], 'ticker')
        self.assertFalse(kwargs['threads'])
        self.assertEqual(kwargs['timeout'], 6)
        self.assertIs(kwargs['session'], network.yahoo_session)

    def test_fresh_cached_quotes_do_not_enqueue_network_work(self):
        data = {'AAPL': {**stamp('massive', 'AAPL', now().isoformat(), 'USD'), 'price': 10}}
        with patch.object(provider, 'load_snapshots', return_value=data), \
             patch.object(provider.refreshes, 'get') as refresh:
            self.assertEqual(provider.get_quotes(['aapl', 'AAPL']), data)
            refresh.assert_not_called()

    def test_partial_cache_is_returned_when_refresh_is_busy(self):
        data = {'AAPL': {**stamp('massive', 'AAPL', now().isoformat(), 'USD'), 'price': 10}}
        with patch.object(provider, 'load_snapshots', side_effect=lambda kind, keys, ttl: {k:v for k,v in data.items() if k in keys}), \
             patch.object(provider.refreshes, 'get', return_value={}):
            self.assertEqual(provider.get_quotes(['AAPL', 'TM']), data)

    def test_background_refresh_writes_cache_after_caller_times_out(self):
        pool = network.RefreshPool(workers=1)
        release = threading.Event()
        called = threading.Event()
        data = {**stamp('fmp', 'AAPL', '2025-12-31', 'USD'), 'company': 'Apple', 'revenue': 20}
        def financials(symbol):
            called.set()
            release.wait(2)
            return data
        try:
            with patch.object(provider, 'load_snapshots', return_value={}), \
                 patch.object(provider.fmp, 'fundamentals', side_effect=financials), \
                 patch.object(provider, 'save_snapshot') as save:
                self.assertIsNone(pool.get(('fundamentals', 'AAPL'), lambda: provider._load_get_fundamentals('AAPL'), wait=.01))
                self.assertTrue(called.wait(1))
                release.set()
                pool.executor.shutdown(wait=True)
                save.assert_called_once_with('md_fundamentals', 'AAPL', data)
        finally:
            release.set()
            pool.executor.shutdown(wait=True)




class PartialResponseTests(unittest.TestCase):
    def test_partial_fundamentals_without_quote_do_not_cause_500(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services import market
        with patch.object(market, 'get_fundamentals', return_value={'company': 'Apple'}), \
             patch.object(market, 'get_quote', return_value=None):
            response = TestClient(app).get('/stocks/AAPL')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['price'])
        self.assertIsNone(response.json()['updated_at'])

    def test_no_provider_or_cache_returns_controlled_unavailability(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services import market
        with patch.object(market, 'get_fundamentals', return_value=None), \
             patch.object(market, 'get_quote', return_value=None):
            response = TestClient(app).get('/stocks/AAPL')
        self.assertEqual(response.status_code, 503)


if __name__ == '__main__':
    unittest.main()
