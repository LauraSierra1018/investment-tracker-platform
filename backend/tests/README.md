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
