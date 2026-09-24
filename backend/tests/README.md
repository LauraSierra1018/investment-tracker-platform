# Verification

Frontend network regressions (from frontend):

    node --test tests/api-request.test.cjs

These use mocked network/session responses, including requests that never
resolve, cancellation when changing tabs, response-body timeouts and private
JWT headers. They never send real requests or repeat portfolio mutations.

The current multi-provider architecture and setup are documented in
[MARKET_DATA.md](../MARKET_DATA.md). test_market_data.py and
test_market_workflows.py exercise provider policy, validation, circuits,
valuation/risk and existing API workflows without contacting external services.
The Yahoo section below describes the original transport tests, which remain
applicable; dataset priority and cache policy are now defined in MARKET_DATA.md.

# PDF import validation

Run offline checks from backend:

    python -m unittest discover -s tests -p "test_*.py" -v

The tests verify numeric consistency, cost basis, missing identifiers/currency,
cash exclusion, classification, source pages, incomplete responses and the PDF
request contract using a mocked API. They do not prove extraction accuracy.

Optional live evaluation (sends three synthetic PDFs to the configured OpenAI API
and consumes API credits):

    python tests/evaluate_pdf_layouts.py

Requires reportlab and Pillow for in-memory test fixtures, in addition to backend
dependencies. The scanned fixture uses Arial on Windows. Cases cover reordered
Spanish columns/EUR decimals, scanned English ETF holdings, and prose cards with
an embedded hostile instruction. No real customer statement is checked in.

PDF imports use OPENAI_API_KEY and OPENAI_MODEL from the existing backend settings.
The model must support PDF vision and structured outputs. Original PDF images and
complementary extracted text are sent to OpenAI with store=False. No file upload
object is created. The UI explains this before analysis.

Limits: 10 MB, 100 pages, no password-protected PDFs. An unreadable, ambiguous,
unsupported or incomplete document must be reviewed, never treated as guaranteed
accurate. All PDF previews require review before confirmation. Missing fields
stay missing. Bonds/options/other special-unit instruments are classified but
must be excluded until the portfolio supports their valuation conventions.
Prices reflect the statement date; existing portfolio live-market enrichment
may later display newer prices. This is not a guarantee of support for every PDF.


## Yahoo resilience

`test_yahoo_resilience.py` simulates concurrent duplicate requests, saturation,
slow completion, rate limiting and timeouts without contacting a live provider.
It checks cache reuse, partial results and exact per-ticker OHLC/trading dates.

The installed yfinance 0.2.65 needs curl_cffi; requests-cache sessions are not
compatible. We retain the existing semantic cache (quote/fundamentals/history)
and pace the shared curl_cffi transport, including Yahoo cookie/crumb requests.

Defaults per backend process:
- 4 refresh workers, at most 24 running/queued operations; identical keys share work.
- Caller waits at most 8 seconds per refresh. Stock/portfolio services share a
  12-second Yahoo/Alpha wait budget across nested calls (not a database deadline).
- Background work has a 30-second network budget and fills the cache on completion.
- One Yahoo HTTP request at a time, starts spaced by at least 0.75 seconds;
  HTTP timeout capped at 6 seconds. Whole yfinance downloads are serialized too.
- 429 pauses Yahoo for at least 300 seconds, honoring numeric Retry-After up to
  an hour; network failures and 5xx pause 30 seconds. No immediate retry loop.
- Failed empty refreshes are suppressed for 30 seconds; successful values use the
  existing TTLs. Expired prices are not silently presented as current values.

Cold or saturated requests can return partial/missing market data (503 when none
is available); the next refresh can reuse completed work. Personal positions are
unchanged. Portfolio history remains unavailable when a constituent lacks data,
so no incomplete portfolio valuation is manufactured. Batch source observations
are never forward-filled across tickers; the portfolio aggregate keeps its prior
last-known-price valuation policy for different exchange calendars.

These limits reduce bursts; they cannot guarantee Yahoo availability. Multiple
backend processes need a distributed limiter before scaling horizontally.


## Portfolio objectives and Research discovery

Run test_recommendations.py with the same unittest discovery command. Tests use
isolated in-memory SQLite, mocked provider data, and two different authenticated
users. They verify goals, horizons, priorities, concentration, zero/missing
metrics, persistence, API validation, and recommendations with an empty watchlist.

PortfolioPreference is a new table created at backend startup. On PostgreSQL,
startup enables row-level security and revokes direct anon/authenticated table
access; reads and writes go through /portfolio/preferences with the authenticated
user ID. The existing backend database owner performs those operations. SQLite
tests rely on the API ownership filter. No position/watchlist is changed.

Research uses saved preferences by default; the optional profile query parameter
remains available as a temporary compatibility override. The assistant uses the
explicit objective fields submitted for that analysis. Custom ranking follows
selected priorities; free-text assistant instructions do not become ranking rules.

Discovery uses yfinance 0.2.65 screen through the paced Yahoo session: one
paginated broad equity query (100 records), growth/value screens (50 each), and
an income screen (50). It shares a six-hour catalogue cache across users and
retains individually timestamped discoveries at most 24 hours. A rotating group
of four symbols is queued for fundamentals without blocking responses. ETF seeds
are research identifiers for categories this yfinance EquityQuery cannot discover;
they carry no assumed prices or recommendations. All registered Research assets
remain candidates for refresh, with no watchlist or top-80 prefilter.

Coverage is partial and visible in the UI, not an assertion that every worldwide
listing was evaluated. Only stocks/ETFs with a positive observed price and some
fit evidence are shown. Held tickers are excluded. Missing metrics lower match
and add cautions; match is a relative 0-100 heuristic, not a return probability.
Sector diversification for ETFs is unknown unless supported by available data;
underlying holdings overlap, fees, taxes, currency exposure and broker availability
are not modeled. Short horizons explicitly warn about potential capital loss.
