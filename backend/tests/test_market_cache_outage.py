import unittest
from unittest.mock import Mock, patch
from sqlalchemy.exc import OperationalError
from app.services import market_snapshot as cache


class CacheOutageTests(unittest.TestCase):
    def setUp(self):
        cache._memory.clear()
        cache._retry_after = 0

    def test_read_outage_does_not_break_market_and_does_not_repeat_connections(self):
        db = Mock()
        db.scalar.side_effect = OperationalError('select', {}, Exception('offline'))
        with patch.object(cache, 'SessionLocal', return_value=db) as factory:
            self.assertIsNone(cache.load_snapshot('quote', 'AAPL', 10))
            self.assertIsNone(cache.load_snapshot('quote', 'MSFT', 10))
            self.assertEqual(factory.call_count, 1)
        db.close.assert_called_once()

    def test_offline_cache_keeps_only_fresh_prices_and_copies_data(self):
        with patch.object(cache.time, 'monotonic', return_value=100):
            cache.mark_database_unavailable()
            cache.save_snapshot('quote', 'AAPL', {'price': 10})
            row = cache.load_snapshot('quote', 'AAPL', 10)
            row['price'] = 999
            self.assertEqual(cache.load_snapshot('quote', 'AAPL', 10), {'price': 10})
        with patch.object(cache.time, 'monotonic', return_value=111):
            self.assertIsNone(cache.load_snapshot('quote', 'AAPL', 10))

    def test_database_is_retried_after_cooldown(self):
        with patch.object(cache.time, 'monotonic', return_value=100):
            cache.mark_database_unavailable()
        db = Mock()
        db.scalar.return_value = None
        with patch.object(cache.time, 'monotonic', return_value=161), patch.object(cache, 'SessionLocal', return_value=db):
            self.assertIsNone(cache.load_snapshot('quote', 'AAPL', 10))
            db.scalar.assert_called_once()

    def test_write_outage_preserves_live_response(self):
        db = Mock()
        db.scalar.side_effect = OperationalError('select', {}, Exception('offline'))
        with patch.object(cache, 'SessionLocal', return_value=db):
            cache.save_snapshot('quote', 'AAPL', {'price': 10})
            self.assertEqual(cache.load_snapshot('quote', 'AAPL', 10), {'price': 10})
        db.rollback.assert_called_once()
        db.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()
