# Market data

Add MASSIVE_API_KEY and FMP_API_KEY to the existing backend/.env, following
.env.example. Keep the existing database, OpenAI, Supabase and SnapTrade values.
Restart the backend after configuring keys. Blank keys disable that provider;
they do not disable other providers. No keys go to the browser.

The configured database can be PostgreSQL or SQLite. No new tables or migrations
are needed: the layer reuses MarketDataSnapshot and its memory/outage fallback.

## Dataset policy

| Dataset | Priority | Fresh cache | Saved fallback |
| --- | --- | --- | --- |
| Quotes | Massive snapshot/daily bars → FMP → Yahoo | 60 s | 7 days |
| History/OHLCV | Massive → Yahoo | intraday 5–15 min; daily/weekly 6–12 h | 7 days |
| Fundamentals | FMP → Alpha Vantage | 24 h; partial data retried after 60 s | 30 days |
| Company profile | FMP, also included in Alpha overview | 3 days (FMP) | fundamentals fallback |
| Annual statements | same provider as fundamentals | 24 h per component | fundamentals fallback |
| US market status | Massive | 60 s | 1 day, marked stale |
| Search | Massive → FMP → Alpha → Yahoo | 1 h | identifiers retained up to 7 days |

The former market_provider module is a compatibility facade. New code lives in
app/services/market_data. SnapTrade stays in the broker services and never enters
this shared market cache. Yahoo's paced curl_cffi session, serialized downloads,
group_by=ticker and exact per-ticker dates remain in use for fallback.

New cache entries use md_* namespaces and schema_version=1. Unversioned prices
and old composite stock snapshots are not promoted to verified data. No old data
is deleted. A first request can therefore need to warm the new cache.

Fundamental snapshots also record a non-secret provider policy. Enabling FMP
invalidates the freshness of older fallback selections, retaining those values
while the new provider is queried. FY statements and TTM overviews have separate
reporting windows: switching the whole dataset does not compare a fiscal year-end
against a later TTM quarter as though they were the same period.

Research receives refreshing=true while background work is running, including
an empty cold cache. The screen retrieves the completed result automatically
with up to four spaced checks; switching ticker cancels obsolete updates.

Each dataset includes provider, source, retrieved_at, data_timestamp, currency,
stale and warning. fetched_at remains as a compatibility alias. A daily-bar quote
is labeled as such, not presented as a guaranteed real-time trade. An unknown
timestamp or currency is not invented. Stale fallback never changes timestamps.

Validation checks symbol, finite positive prices, timestamps, OHLC ordering,
non-negative volume, chronological unique history, currency and adjustment basis.
Fallback cannot replace a newer observation with an older one or change currency.
A large unexplained price discontinuity between providers is rejected. Entire
history series are replaced; points from different providers are never stitched.
Provider observation times can differ; no averages of provider prices are used.

FMP annual metrics use matched fiscal dates and reporting currencies across
income, balance and cash-flow statements. ROE/ROA use average balances where a
comparable prior year exists, otherwise the available ending balance. Growth
with a non-positive prior earnings base is left unavailable. Debt/equity is in
percent to preserve existing score units. Missing data stays missing.
Alpha's TTM overview remains one dataset; its annual statements are exposed
separately and do not overwrite TTM inputs.

FMP also supplies share float and analyst price-target consensus. Each component
is cached for 24 hours with its own retrieval/observation metadata, independently
of the annual statements. A denied or empty optional endpoint leaves that metric
unavailable and preserves the financial statements already obtained.

Valuation computes P/E from the selected quote and positive EPS, labeled FY or
TTM, only with matching financial currency. Targets/upside also require confirmed
quote currency. Risk uses one split-adjusted daily series for the last year,
minimum 61 closes, sample log-return volatility × sqrt(252), and peak-to-trough
drawdown. Long gaps prevent an estimate; shorter coverage is disclosed. Dividend
reinvestment and FX conversion are not modeled.

Portfolio records and broker snapshots remain unchanged. The analysis retains
its cost-based allocation estimate when market prices are unavailable, now
explicitly labeled estimated; it does not use old ResearchAsset prices as live
quotes. Saved broker prices are labeled separately. Multi-currency historical
totals require a conversion policy and return controlled unavailability.

## Availability and operational limits

REST transports cap network waits at 5 seconds, pace each provider, honor numeric
and HTTP-date Retry-After, and pause after quota errors (including HTTP 200 quota
messages), timeouts, and 5xx. Authentication failures pause a provider; entitlement
failures pause the endpoint family. There is no immediate retry loop.
Workers skip long quota waits and continue cached work on a later refresh.

The existing shared refresh pool limits workers to 4 and queued/running work to
24. Identical requests share work, callers wait up to 8 seconds, and nested
stock/portfolio services share a 12-second wait budget. Background network work
has a 30-second budget. Database timeouts remain governed by db.py.

Rate gates and circuit breakers are per process, not distributed. Shared semantic
cache persists in SQL, but multiple server workers need a distributed limiter.
Coverage, real-time availability and endpoints depend on provider subscriptions.
Massive's adapter covers US equities and explicit BRK/BF class aliases; other
identifiers (including the dashboard indices) use appropriate fallback. It does
not guess an equivalent index or international ticker. FMP is the primary shared
discovery screen; the existing Yahoo screens remain a fallback.

Live checks on September 23, 2026 (Bogota) verified the configured FMP account's
profile, annual income/balance/cash-flow, quote, shares-float and target-consensus
endpoints. AAPL and MSFT supplied all 14 scoring inputs and three annual periods
for each statement. Massive daily history returned 250 observations for AAPL;
its snapshot endpoint returned HTTP 403, so quotes use available daily bars or
FMP fallback. This does not establish complete coverage for every symbol or plan.
Offline fixtures also verify parsing, fallback, caching, circuits and API
compatibility, including activation of new providers over old fallback caches.

## Verification

From backend: python -m unittest discover -s tests -p "test_*.py" -v

From frontend: npx tsc --noEmit --incremental false

Tests use synthetic responses and isolated SQLite. They do not send statements
to OpenAI, sync brokers, send emails or change real portfolios.

Provider references:
- https://massive.com/docs/rest/stocks/snapshots/full-market-snapshot
- https://massive.com/docs/rest/stocks/aggregates/custom-bars
- https://site.financialmodelingprep.com/developer/docs/quickstart
- https://site.financialmodelingprep.com/developer/docs/stable/income-statement
- https://site.financialmodelingprep.com/developer/docs/stable/balance-sheet-statement
- https://site.financialmodelingprep.com/developer/docs/stable/cashflow-statement
- https://www.alphavantage.co/documentation/
