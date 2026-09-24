"""Bounded REST requests, per-provider pacing and circuit breakers.

No request URL, payload or exception text is logged: query strings contain keys.
State is per process; use a distributed gate before deploying multiple workers.
"""
import json
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from ...config import settings
from ..market_requests import remaining_budget

class RestTransport:
    def __init__(self):
        self.lock = threading.Lock()
        self.next_request = 0.0
        self.blocked_until = 0.0
        self.endpoint_blocks = {}
        self.failures = 0

    def block(self, seconds, endpoint=None):
        until = time.monotonic() + seconds
        if endpoint:
            self.endpoint_blocks[endpoint] = until
        else:
            self.blocked_until = max(self.blocked_until, until)

    @staticmethod
    def retry_after(value):
        try:
            seconds = float(value)
        except (TypeError, ValueError):
            try:
                dt = parsedate_to_datetime(value)
                seconds = (dt - datetime.now(timezone.utc)).total_seconds()
            except (TypeError, ValueError, OverflowError):
                seconds = 300
        return max(60, min(seconds, 86400))

    def get(self, url, params, key, key_name, spacing, endpoint):
        if not key or remaining_budget() <= 0:
            return None
        if not self.lock.acquire(timeout=min(1, remaining_budget())):
            return None
        try:
            now = time.monotonic()
            if now < max(self.blocked_until, self.endpoint_blocks.get(endpoint, 0)):
                return None
            delay = max(0, self.next_request-now)
            # Keep quota waits out of refresh workers. A later refresh can continue.
            if delay > min(1, remaining_budget()):
                return None
            if delay:
                time.sleep(delay)
            timeout = min(5, remaining_budget())
            if timeout <= 0:
                return None
            self.next_request = time.monotonic() + max(0, float(spacing))
            query = urlencode({**params, key_name: key.strip()})
            request = Request(url + "?" + query, headers={"User-Agent": "InvestmentTracker/1.0"})
            try:
                with urlopen(request, timeout=timeout) as response:
                    raw = response.read(8*1024*1024+1)
                    if len(raw) > 8*1024*1024:
                        return None
                    payload = json.loads(raw)
            except HTTPError as exc:
                if exc.code == 429:
                    self.block(self.retry_after(exc.headers.get("Retry-After")))
                elif exc.code == 401:
                    self.block(3600)
                elif exc.code in (402, 403):
                    # A plan may allow bars while denying snapshots.
                    self.block(3600, endpoint)
                elif exc.code >= 500:
                    self.failures += 1
                    self.block(min(30*2**min(self.failures-1, 4), 300))
                return None
            except Exception:
                self.failures += 1
                self.block(min(30*2**min(self.failures-1, 4), 300))
                return None
            if isinstance(payload, dict):
                error = " ".join(str(payload.get(k) or "") for k in
                                 ("Note", "Information", "Error Message", "error", "message")).lower()
                status = str(payload.get("status") or "").upper()
                if error.strip() or status in {"ERROR", "NOT_AUTHORIZED"}:
                    if any(k in error for k in ("rate", "frequency", "limit", "requests per")):
                        self.block(86400 if any(k in error for k in ("per day", "daily")) else 300)
                    else:
                        self.block(300, endpoint)
                    return None
            self.failures = 0
            return payload
        finally:
            self.lock.release()

transports = {p: RestTransport() for p in ("massive", "fmp", "alpha_vantage")}

def request(provider, endpoint, params=None):
    config = {
        "massive": ("https://api.massive.com", settings.massive_api_key, "apiKey", settings.massive_request_spacing),
        "fmp": ("https://financialmodelingprep.com/stable", settings.fmp_api_key, "apikey", settings.fmp_request_spacing),
        "alpha_vantage": ("https://www.alphavantage.co", settings.alpha_vantage_api_key, "apikey", settings.alpha_vantage_request_spacing),
    }
    base, key, key_name, spacing = config[provider]
    scope = (params or {}).get("function", endpoint)
    if provider == "massive" and endpoint.startswith("/v2/aggs/"):
        scope = "/v2/aggs"
    return transports[provider].get(base+endpoint, params or {}, key, key_name, spacing, scope)
