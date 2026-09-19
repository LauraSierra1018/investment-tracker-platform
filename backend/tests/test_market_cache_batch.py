import unittest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from unittest.mock import Mock, patch
from app.services import market_snapshot as cache


class CacheBatchTests(unittest.TestCase):
    def setUp(self):
        cache._memory.clear()
        cache._retry_after = 0

    def test_multiple_symbols_use_one_database_read_and_then_memory(self):
        db = Mock()
        db.scalars.return_value = [
            SimpleNamespace(cache_key=symbol, payload='{"price": 10}', updated_at=datetime.now(timezone.utc))
            for symbol in ['AAPL', 'MSFT']
        ]
        with patch.object(cache, 'SessionLocal', return_value=db) as factory:
            rows = cache.load_snapshots('quote', ['AAPL', 'MSFT', 'AAPL'], 60)
            self.assertEqual(set(rows), {'AAPL', 'MSFT'})
            self.assertEqual(cache.load_snapshots('quote', ['MSFT'], 60)['MSFT']['price'], 10)
            factory.assert_called_once()
            db.scalars.assert_called_once()

    def test_sql_read_does_not_extend_original_expiration(self):
        now = datetime(2026, 9, 11, tzinfo=timezone.utc)
        db = Mock()
        db.scalar.return_value = SimpleNamespace(payload='{"price": 10}', updated_at=now - timedelta(seconds=59))
        with patch.object(cache, 'SessionLocal', return_value=db), patch.object(cache, '_utcnow', return_value=now), patch.object(cache.time, 'monotonic', return_value=100):
            self.assertEqual(cache.load_snapshot('quote', 'AAPL', 60), {'price': 10})
        with patch.object(cache.time, 'monotonic', return_value=102):
            self.assertIsNone(cache._memory_snapshot('quote', 'AAPL', 60))

    def test_batch_discards_expired_and_corrupt_rows(self):
        now = datetime.now(timezone.utc)
        db = Mock()
        db.scalars.return_value = [
            SimpleNamespace(cache_key='OLD', payload='{"price": 10}', updated_at=now - timedelta(seconds=61)),
            SimpleNamespace(cache_key='BAD', payload='broken', updated_at=now),
        ]
        with patch.object(cache, 'SessionLocal', return_value=db):
            self.assertEqual(cache.load_snapshots('quote', ['OLD', 'BAD'], 60), {})

    def test_batch_write_commits_once(self):
        db = Mock()
        db.scalars.return_value = []
        with patch.object(cache, 'SessionLocal', return_value=db):
            cache.save_snapshots('quote', {'AAPL': {'price': 10}, 'MSFT': {'price': 20}})
        db.scalars.assert_called_once()
        db.commit.assert_called_once()
        self.assertEqual(db.add.call_count, 2)


if __name__ == '__main__':
    unittest.main()
