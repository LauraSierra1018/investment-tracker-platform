"""Bounded market refreshes and a paced transport compatible with yfinance 0.2.65.

Limits are per backend process. Cached financial data remains in market_snapshot;
HTTP authentication responses/cookies are never stored in a response cache here.
"""
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from contextlib import contextmanager
from copy import deepcopy
from functools import wraps
import logging
import threading
import time

from curl_cffi import requests

logger = logging.getLogger(__name__)
_local = threading.local()


def remaining_budget(default=30.0):
    return max(0.0, getattr(_local, "deadline", time.monotonic() + default) - time.monotonic())


@contextmanager
def budget(seconds):
    previous = getattr(_local, "deadline", None)
    _local.deadline = min(previous or float("inf"), time.monotonic() + seconds)
    try:
        yield
    finally:
        if previous is None:
            del _local.deadline
        else:
            _local.deadline = previous


def market_budget(function):
    """Nested services share one maximum wait, including portfolios with many assets."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        with budget(12):
            return function(*args, **kwargs)
    return wrapped


class RefreshPool:
    def __init__(self, workers=4, capacity=24, retry_seconds=30):
        self.executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="market")
        self.capacity = capacity
        self.retry_seconds = retry_seconds
        self.lock = threading.Lock()
        self.pending = {}
        self.failed = {}

    def _run(self, loader):
        with budget(30):
            return loader()

    def _done(self, key, future):
        try:
            failed = not future.result()
        except Exception:
            failed = True
            # Avoid logging provider exception text which can contain API credentials.
            logger.warning("Market refresh failed (%s)", key[0])
        with self.lock:
            self.pending.pop(key, None)
            if failed:
                if len(self.failed) >= 1024:
                    self.failed.pop(next(iter(self.failed)), None)
                self.failed[key] = time.monotonic() + self.retry_seconds

    def is_pending(self, key):
        with self.lock:
            return key in self.pending

    def get(self, key, loader, fallback=None, wait=8):
        # Check and enqueue atomically; identical requests share the same work.
        with self.lock:
            now = time.monotonic()
            self.failed = {k: expiry for k, expiry in self.failed.items() if expiry > now}
            if key in self.failed:
                return deepcopy(fallback)
            future = self.pending.get(key)
            created = future is None
            if created:
                if len(self.pending) >= self.capacity:
                    return deepcopy(fallback)
                future = self.executor.submit(self._run, loader)
                self.pending[key] = future
        # add_done_callback may run immediately, so never call it holding lock.
        if created:
            future.add_done_callback(lambda done: self._done(key, done))
        try:
            return deepcopy(future.result(timeout=min(wait, remaining_budget())))
        except TimeoutError:
            # The bounded worker continues and populates the ordinary cache.
            return deepcopy(fallback)
        except Exception:
            return deepcopy(fallback)


class YahooSession(requests.Session):
    def __init__(self, spacing=0.75, request_timeout=6):
        super().__init__(impersonate="chrome")
        self.spacing = spacing
        self.request_timeout = request_timeout
        self.gate = threading.Lock()
        self.next_request = 0.0
        self.blocked_until = 0.0

    def request(self, method, url, **kwargs):
        # Includes cookie/crumb requests and yfinance's internal retries.
        if not self.gate.acquire(timeout=remaining_budget()):
            raise TimeoutError("Yahoo request budget exhausted")
        try:
            now = time.monotonic()
            if now < self.blocked_until:
                raise RuntimeError("Yahoo temporarily unavailable")
            delay = max(0, self.next_request - now)
            if delay >= remaining_budget():
                raise TimeoutError("Yahoo request budget exhausted")
            while delay > 0:
                time.sleep(delay)
                delay = max(0, self.next_request - time.monotonic())
                if delay >= remaining_budget():
                    raise TimeoutError("Yahoo request budget exhausted")
            timeout = min(self.request_timeout, remaining_budget())
            if timeout <= 0:
                raise TimeoutError("Yahoo request budget exhausted")
            requested = kwargs.get("timeout")
            if isinstance(requested, (float, int)) and requested > 0:
                timeout = min(timeout, requested)
            kwargs["timeout"] = timeout
            self.next_request = time.monotonic() + self.spacing
            try:
                response = super().request(method, url, **kwargs)
            except Exception:
                self.blocked_until = time.monotonic() + 30
                raise
            if response.status_code == 429:
                retry = response.headers.get("Retry-After", "300")
                try:
                    cooldown = max(300, min(float(retry), 3600))
                except (ValueError, TypeError):
                    cooldown = 300
                self.blocked_until = time.monotonic() + cooldown
            elif response.status_code >= 500:
                self.blocked_until = time.monotonic() + 30
            return response
        finally:
            self.gate.release()


refreshes = RefreshPool()
yahoo_session = YahooSession()
# yfinance 0.2.65 shares mutable download state: serialize whole downloads too.
download_lock = threading.Lock()


def download(yf, **kwargs):
    if not download_lock.acquire(timeout=remaining_budget()):
        raise TimeoutError("Yahoo download budget exhausted")
    try:
        if remaining_budget() <= 0:
            raise TimeoutError("Yahoo download budget exhausted")
        return yf.download(session=yahoo_session, threads=False, timeout=6,
                           group_by="ticker", **kwargs)
    finally:
        download_lock.release()
