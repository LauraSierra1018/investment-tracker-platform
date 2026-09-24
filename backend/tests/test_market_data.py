"""Offline provider fixtures: never call paid APIs, Supabase, OpenAI or a broker."""
import copy
import io
import json
import math
import unittest
from contextlib import ExitStack
from datetime import timedelta
from unittest.mock import Mock, patch
from urllib.error import HTTPError
from fastapi.testclient import TestClient

from app.services.market_data import market_data_service as service
from app.services.market_data import common, transport, massive_provider as massive, fmp_provider as fmp
from app.services.market_data import alpha_vantage_provider as alpha, financials, risk, yahoo_provider as yahoo
from app.services import market
from app.main import app

def quote(ticker="AAPL", provider="massive", **values):
    return {**common.stamp(provider, ticker, common.now().isoformat(), "USD"),
            "price": 100.0, "previous_close": 99.0, "volume": 1000, **values}

def fundamentals(provider="fmp", **values):
    return {**common.stamp(provider, "AAPL", "2025-12-31", "USD"),
            "company": "Apple", "revenue": 1000.0, "eps": 5.0, "period_basis": "FY", **values}

def history(ticker="AAPL", count=80, **values):
    dates = []
    day = common.now().date()-timedelta(days=count*2)
    while len(dates) < count:
        if day.weekday() < 5:
            dates.append(day)
        day += timedelta(days=1)
    shift = common.now().date()-timedelta(days=1)-dates[-1]
    dates = [d+shift for d in dates]
    points = [{"date": d.isoformat(), "open": 100.+i, "high": 101.+i,
               "low": 99.+i, "close": 100.+i, "volume": 1000} for i,d in enumerate(dates)]
    return {**common.stamp("massive",ticker,points[-1]["date"],"USD"),
            "points": points, "period": "1y", "interval": "1d", "price_basis": "split_adjusted", **values}

class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.cache = {}
        self.stack.enter_context(patch.object(service,"load_snapshots",side_effect=lambda kind,keys,ttl:
            {k:copy.deepcopy(self.cache[(kind,k)]) for k in keys if (kind,k) in self.cache}))
        self.stack.enter_context(patch.object(service,"save_snapshot",side_effect=lambda kind,key,data:
            self.cache.__setitem__((kind,key),copy.deepcopy(data))))
        self.stack.enter_context(patch.object(service,"save_snapshots",side_effect=lambda kind,values:
            self.cache.update({(kind,k):copy.deepcopy(v) for k,v in values.items()})))
        self.stack.enter_context(patch.object(service.refreshes,"get",side_effect=lambda key,loader,fallback=None,**kw: loader() or fallback))
        self.mq = self.stack.enter_context(patch.object(service.massive,"quotes",return_value={}))
        self.fq = self.stack.enter_context(patch.object(service.fmp,"quotes",return_value={}))
        self.yq = self.stack.enter_context(patch.object(service.yahoo,"quotes",return_value={}))
        self.ff = self.stack.enter_context(patch.object(service.fmp,"fundamentals",return_value=None))
        self.af = self.stack.enter_context(patch.object(service.alpha,"fundamentals",return_value=None))
        self.mh = self.stack.enter_context(patch.object(service.massive,"history",return_value=None))
        self.yh = self.stack.enter_context(patch.object(service.yahoo,"histories",return_value={}))

    def test_quote_primary_and_cache(self):
        self.mq.return_value = {"AAPL":quote()}
        first = service.get_quote(" aapl ")
        second = service.get_quote("AAPL")
        self.assertEqual(first,second)
        self.mq.assert_called_once_with(["AAPL"])
        self.fq.assert_not_called()
        self.yq.assert_not_called()

    def test_partial_batch_only_requests_missing_tickers(self):
        self.cache[("md_quote","AAPL")] = quote()
        self.mq.return_value = {"MSFT":quote("MSFT")}
        self.assertEqual(set(service.get_quotes(["AAPL","MSFT"])),{"AAPL","MSFT"})
        self.mq.assert_called_once_with(["MSFT"])

    def test_fallback_rejects_wrong_symbol(self):
        self.mq.return_value = {"AAPL":quote("MSFT")}
        self.fq.return_value = {"AAPL":quote(provider="fmp")}
        self.assertEqual(service.get_quote("AAPL")["provider"],"fmp")
        self.yq.assert_not_called()

    def test_stale_fallback_retains_dates_and_currency(self):
        old = quote()
        old["retrieved_at"] = old["fetched_at"] = (common.now()-timedelta(hours=1)).isoformat()
        self.cache[("md_quote","AAPL")] = copy.deepcopy(old)
        self.fq.return_value = {"AAPL":quote(provider="fmp",currency="EUR")}
        result = service.get_quote("AAPL")
        self.assertTrue(result["stale"])
        self.assertEqual(result["retrieved_at"],old["retrieved_at"])
        self.assertEqual(self.cache[("md_quote","AAPL")],old)

    def test_older_quote_does_not_displace_last_verified(self):
        old = quote()
        old["retrieved_at"] = (common.now()-timedelta(hours=1)).isoformat()
        self.cache[("md_quote","AAPL")] = old
        self.mq.return_value = {"AAPL":quote(data_timestamp=(common.now()-timedelta(days=2)).isoformat())}
        self.assertTrue(service.get_quote("AAPL")["stale"])

    def test_invalid_or_ancient_quote_not_cached(self):
        for price, date in ((0,common.now()),(float("nan"),common.now()),(10,common.now()-timedelta(days=30))):
            self.mq.return_value = {"AAPL":quote(price=price,data_timestamp=date.isoformat())}
            self.assertIsNone(service.get_quote("AAPL"))
            self.assertNotIn(("md_quote","AAPL"),self.cache)

    def test_legacy_unversioned_cache_is_not_verified(self):
        self.cache[("md_quote","AAPL")] = {"price": 50, "provider": "yahoo"}
        self.assertIsNone(service.get_quote("AAPL"))

    def test_fundamentals_are_not_filled_from_another_provider(self):
        self.ff.return_value = fundamentals(roe_pct=None)
        self.af.return_value = fundamentals("alpha_vantage",roe_pct=30)
        result = service.get_fundamentals("AAPL")
        self.assertIsNone(result["roe_pct"])
        self.af.assert_not_called()

    def test_profile_only_primary_can_fall_back_to_actual_financials(self):
        self.ff.return_value = fundamentals(revenue=None,partial=True)
        self.af.return_value = fundamentals("alpha_vantage")
        self.assertEqual(service.get_fundamentals("AAPL")["provider"],"alpha_vantage")

    def test_enabling_fmp_refreshes_cached_alpha_and_accepts_annual_window(self):
        old = fundamentals("alpha_vantage", period_basis="TTM", data_timestamp="2026-06-30")
        with patch.object(service.settings, "fmp_api_key", ""):
            old["provider_policy"] = service.fundamentals_policy()
        self.cache[("md_fundamentals", "AAPL")] = old
        self.ff.return_value = fundamentals()
        with patch.object(service.settings, "fmp_api_key", "fixture"):
            result = service.get_fundamentals("AAPL")
            self.assertEqual(result["provider"], "fmp")
            self.assertEqual(result["period_basis"], "FY")
            service.get_fundamentals("AAPL")
        self.ff.assert_called_once()
        self.af.assert_not_called()

    def test_existing_fallback_survives_primary_failure_after_configuration_change(self):
        old = fundamentals("alpha_vantage")
        old["provider_policy"] = "old configuration"
        self.cache[("md_fundamentals", "AAPL")] = old
        result = service.get_fundamentals("AAPL")
        self.assertTrue(result["stale"])
        self.assertEqual(result["revenue"], old["revenue"])
        self.assertEqual(result["retrieved_at"], old["retrieved_at"])

    def test_history_primary_fallback_keeps_one_series(self):
        self.yh.return_value = {"AAPL":history(provider="yahoo",source="Yahoo Finance")}
        result = service.get_history("AAPL","1y","1d")
        self.assertEqual(result["provider"],"yahoo")
        self.assertEqual(len(result["points"]),80)
        self.assertEqual(result["coverage"]["observations"],80)

    def test_history_invalid_ohlc_is_rejected(self):
        data = history()
        data["points"][5]["high"] = 1
        self.mh.return_value = data
        self.assertIsNone(service.get_history("AAPL","1y","1d"))

    def test_history_cache_returns_without_network(self):
        data = history()
        self.cache[("md_history","AAPL:1y:1d")] = data
        self.assertEqual(service.get_history("AAPL","1y","1d"),data)
        self.mh.assert_not_called()

    def test_stale_history_retains_observations_and_timestamp(self):
        data = history()
        data["retrieved_at"] = (common.now()-timedelta(days=1)).isoformat()
        self.cache[("md_history","AAPL:1y:1d")] = data
        result = service.get_history("AAPL","1y","1d")
        self.assertTrue(result["stale"])
        self.assertEqual(result["points"],data["points"])
        self.assertEqual(result["data_timestamp"],data["data_timestamp"])

class ValidationTests(unittest.TestCase):
    def test_annual_refresh_still_rejects_older_annual_period(self):
        self.assertFalse(common.compatible(
            fundamentals(data_timestamp="2024-12-31"), fundamentals(), "fundamentals"))
        self.assertFalse(common.compatible(
            fundamentals(currency="EUR"), fundamentals("alpha_vantage", period_basis="TTM"), "fundamentals"))

    def test_invalid_ohlc_order_duplicates_and_future_dates(self):
        for mutation in ("duplicate","unsorted","future","negative","string"):
            data = history()
            if mutation == "duplicate": data["points"][1]["date"] = data["points"][0]["date"]
            if mutation == "unsorted": data["points"].reverse()
            if mutation == "future": data["points"][-1]["date"] = (common.now()+timedelta(days=1)).isoformat()
            if mutation == "negative": data["points"][0]["volume"] = -1
            if mutation == "string": data["points"][0]["close"] = "100"
            self.assertFalse(common.valid(data,"AAPL","history"),mutation)

    def test_discontinuous_currency_or_price_change_is_not_silently_accepted(self):
        previous = quote()
        candidate = quote(provider="fmp",price=10000)
        self.assertFalse(common.compatible(candidate,previous,"quote"))
        self.assertFalse(common.compatible(quote(currency="EUR"),previous,"quote"))

    def test_quotes_require_observation_timestamp(self):
        self.assertFalse(common.valid(quote(data_timestamp=None),"AAPL","quote"))
        self.assertFalse(common.valid(quote(price=True),"AAPL","quote"))
        self.assertFalse(common.valid(quote(previous_close="N/A"),"AAPL","quote"))

    def test_annual_ratios_align_currency_and_period(self):
        statements = {
            "income":[{"period_end":"2025-12-31","currency":"USD","revenue":200,"net_income":20,"operating_income":30,"eps":2},
                      {"period_end":"2024-12-31","currency":"USD","revenue":100,"net_income":10}],
            "balance":[{"period_end":"2025-12-31","currency":"USD","assets":200,"equity":100,"debt":25,"current_assets":80,"current_liabilities":40}],
            "cash_flow":[{"period_end":"2025-12-31","currency":"USD","free_cash_flow":12}],
        }
        result = financials.annual_metrics(statements)
        self.assertEqual(result["revenue_growth_pct"],100)
        self.assertEqual(result["roe_pct"],20)
        self.assertEqual(result["debt_to_equity"],25)
        self.assertEqual(result["current_ratio"],2)
        self.assertFalse(result["partial"])
        statements["balance"][0]["currency"] = "EUR"
        statements["cash_flow"][0]["period_end"] = "2024-12-31"
        result = financials.annual_metrics(statements)
        self.assertIsNone(result["roe_pct"])
        self.assertIsNone(result["free_cash_flow"])
        self.assertTrue(result["partial"])

    def test_statement_mapper_rejects_wrong_identity_and_quarter(self):
        rows = [{"symbol":"MSFT","date":"2025-12-31","period":"FY","reportedCurrency":"USD","revenue":100},
                {"symbol":"AAPL","date":"2025-12-31","period":"Q4","reportedCurrency":"USD","revenue":100}]
        self.assertEqual(financials.normalize(rows,"income","fmp","AAPL"),[])

    def test_negative_earnings_base_has_no_misleading_growth(self):
        result = financials.annual_metrics({"income":[
            {"period_end":"2025-12-31","currency":"USD","net_income":5},
            {"period_end":"2024-12-31","currency":"USD","net_income":-5}]})
        self.assertIsNone(result["earnings_growth_pct"])

class RestTests(unittest.TestCase):
    def request(self, client):
        return client.get("https://example.com/data",{},"test-key","apikey",0,"quotes")

    def test_429_cooldown_honors_retry_after(self):
        client = transport.RestTransport()
        with patch.object(transport,"urlopen",side_effect=HTTPError("url",429,"limited",{"Retry-After":"600"},None)) as call:
            self.assertIsNone(self.request(client))
            self.assertIsNone(self.request(client))
            call.assert_called_once()
        self.assertGreater(client.blocked_until,0)

    def test_timeout_and_5xx_open_circuit(self):
        for error in (TimeoutError(),HTTPError("url",503,"down",{},None)):
            client = transport.RestTransport()
            with patch.object(transport,"urlopen",side_effect=error) as call:
                self.request(client); self.request(client)
                call.assert_called_once()

    def test_quota_error_inside_http_200_opens_circuit(self):
        client = transport.RestTransport()
        response = Mock()
        response.__enter__ = Mock(return_value=io.BytesIO(json.dumps({"Information":"25 requests per day limit"}).encode()))
        response.__exit__ = Mock(return_value=False)
        with patch.object(transport,"urlopen",return_value=response) as call:
            self.request(client); self.request(client)
            call.assert_called_once()

    def test_missing_key_does_not_contact_provider(self):
        with patch.object(transport,"urlopen") as call:
            self.assertIsNone(transport.RestTransport().get("https://example.com",{},"","apikey",0,"test"))
            call.assert_not_called()

    def test_entitlement_denial_does_not_disable_other_endpoints(self):
        client = transport.RestTransport()
        with patch.object(transport,"urlopen",side_effect=HTTPError("url",403,"plan",{},None)) as call:
            self.request(client)
            self.request(client)
            client.get("https://example.com/history",{},"test-key","apikey",0,"history")
            self.assertEqual(call.call_count,2)

class AdapterTests(unittest.TestCase):
    def test_fmp_supplements_validate_symbol_and_cache_own_observation_dates(self):
        rows = [{"symbol":"AAPL", "date":"2026-01-02 08:00:00",
                 "floatShares":90, "outstandingShares":100}]
        with patch.object(fmp, "load_snapshot", return_value=None), patch.object(fmp, "save_snapshot") as save, \
             patch.object(fmp, "request", return_value=rows):
            result = fmp.supplement("shares-float", "AAPL",
                                    {"float_shares":"floatShares", "shares_outstanding":"outstandingShares"})
            self.assertEqual(result["value"]["float_shares"], 90)
            self.assertTrue(result["data_timestamp"].startswith("2026-01-02"))
            self.assertIsNone(fmp.supplement("shares-float", "MSFT", {"float_shares":"floatShares"}))
        save.assert_called_once()

    def test_fmp_complete_financials_keep_target_and_float_separate_from_annual_metrics(self):
        company = fundamentals(beta=1)
        report = {"retrieved_at":common.now().isoformat(), "value":[
            {"period_end":"2025-12-31", "currency":"USD", "revenue":100, "eps":5,
             "assets":200, "equity":100, "current_assets":40, "current_liabilities":20,
             "net_income":10, "operating_income":20, "debt":10, "free_cash_flow":12}]}
        def supplement(endpoint, *args):
            return {**common.stamp("fmp","AAPL"), "value":
                    {"float_shares":90, "shares_outstanding":100} if endpoint == "shares-float" else {"target_price":120}}
        with patch.object(fmp,"profile",return_value=company), patch.object(fmp,"resource",return_value=report), \
             patch.object(fmp,"supplement",side_effect=supplement):
            result = fmp.fundamentals("AAPL")
        self.assertFalse(result["partial"])
        self.assertEqual(result["target_price"],120)
        self.assertEqual(result["float_shares"],90)
        self.assertEqual(result["period_basis"],"FY")
        self.assertIn("analyst_target",result["components"])
        self.assertEqual(result["revenue"],100)

    def test_massive_snapshot_symbol_mapping_and_millisecond_bar_timestamp(self):
        timestamp = int(common.now().timestamp()*1000)
        row = {"ticker":"BRK.B","min":{"c":400,"t":timestamp},"prevDay":{"c":390},"day":{"v":200}}
        with patch.object(massive,"request",return_value={"tickers":[row]}):
            result = massive.quotes(["BRK-B"])
        self.assertEqual(result["BRK-B"]["price"],400)
        self.assertEqual(result["BRK-B"]["currency"],"USD")
        self.assertTrue(common.valid(result["BRK-B"],"BRK-B","quote"))

    def test_massive_refuses_unsupported_symbol_mapping_and_truncation(self):
        self.assertIsNone(massive.api_symbol("ABC.L"))
        self.assertIsNone(massive.api_symbol("^GSPC"))
        with patch.object(massive,"request",return_value={"ticker":"AAPL","adjusted":True,"next_url":"next","results":[]}):
            self.assertIsNone(massive.history("AAPL","1y","1d"))

    def test_fmp_profile_and_statements_have_separate_cache_lifetimes(self):
        calls = []
        def cache(kind,key,ttl):
            calls.append(ttl)
            return {"value":{"symbol":"AAPL"}}
        with patch.object(fmp,"load_snapshot",side_effect=cache):
            fmp.resource("profile","AAPL",fmp.PROFILE_TTL)
            fmp.resource("income-statement","AAPL",fmp.STATEMENT_TTL,"income")
        self.assertEqual(calls,[3*86400,86400])

    def test_alpha_preserves_ttm_overview_without_merging_annual_revenue(self):
        overview = {"Symbol":"AAPL","Name":"Apple","Currency":"USD","LatestQuarter":"2026-06-30","RevenueTTM":"500","EPS":"5"}
        def resource(function,ticker,kind=None):
            return {"retrieved_at":common.now().isoformat(), "value":overview if not kind else [
                {"period_end":"2025-12-31","currency":"USD","revenue":100,"period":"FY"}]}
        with patch.object(alpha,"resource",side_effect=resource):
            result = alpha.fundamentals("AAPL")
        self.assertEqual(result["revenue"],500)
        self.assertEqual(result["statements"]["income"][0]["revenue"],100)
        self.assertEqual(result["period_basis"],"TTM")

class ApiAndCalculationTests(unittest.TestCase):
    def test_cold_load_returns_retryable_state_while_providers_are_still_running(self):
        with patch.object(market,"get_quote",return_value=None), patch.object(market,"get_fundamentals",return_value=None), \
             patch.object(market.refreshes,"is_pending",return_value=True):
            response = TestClient(app).get("/stocks/AAPL")
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json()["refreshing"])
        self.assertIsNone(response.json()["price"])

    def test_stock_reports_background_refresh_instead_of_final_missing_result(self):
        with patch.object(market,"get_quote",return_value=quote()), patch.object(market,"get_fundamentals",return_value=None), \
             patch.object(market.refreshes,"is_pending",return_value=True):
            data = TestClient(app).get("/stocks/AAPL").json()
        self.assertTrue(data["refreshing"])
        self.assertEqual(data["classification"],"Actualizando análisis")

    def test_stock_contract_keeps_numbers_and_provenance(self):
        with patch.object(market,"get_quote",return_value=quote()), patch.object(market,"get_fundamentals",return_value=fundamentals(target_price=120)):
            response = TestClient(app).get("/stocks/AAPL")
        self.assertEqual(response.status_code,200)
        data = response.json()
        self.assertEqual(data["pe_ratio"],20)
        self.assertAlmostEqual(data["valuation"]["upside_percent"],20)
        self.assertEqual(data["provenance"]["quote"]["provider"],"massive")
        self.assertEqual(data["valuation"]["earnings_period"],"FY")

    def test_valuation_does_not_combine_currencies(self):
        with patch.object(market,"get_quote",return_value=quote(currency="EUR")), patch.object(market,"get_fundamentals",return_value=fundamentals(target_price=120)):
            data = market.get_stock("AAPL")
        self.assertIsNone(data["pe_ratio"])
        self.assertIsNone(data["target_price"])
        self.assertIsNone(data["valuation"]["upside_percent"])

    def test_risk_is_daily_and_independent_of_chart_range(self):
        series = history()
        with patch.object(risk,"get_history",return_value=series) as load:
            response = TestClient(app).get("/stocks/AAPL/risk?range=1D")
        self.assertEqual(response.status_code,200)
        load.assert_called_once_with("AAPL","1y","1d")
        data = response.json()
        self.assertGreater(data["annualized_volatility"],0)
        self.assertEqual(data["max_drawdown"],0)
        self.assertEqual(data["observations"],80)

    def test_short_history_has_no_risk_estimate(self):
        with patch.object(risk,"get_history",return_value=history(count=20)):
            data = risk.get_risk("AAPL")
        self.assertIsNone(data["annualized_volatility"])
        self.assertIsNone(data["max_drawdown"])

    def test_statements_endpoint_exposes_source_without_changing_stock_endpoint(self):
        with patch.object(service,"get_fundamentals",return_value=fundamentals(statements={"income":[]})):
            response = TestClient(app).get("/stocks/AAPL/statements")
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["provenance"]["provider"],"fmp")

    def test_search_fallback_and_cache(self):
        rows = [{"ticker":"AAPL","name":"Apple","type":"Stock","provider":"fmp"}]
        with patch.object(service.massive,"search",return_value=[]), patch.object(service.fmp,"search",return_value=rows), patch.object(service,"save_snapshot") as save:
            self.assertEqual(service._load_search("Apple"),rows)
        save.assert_called_once_with("md_search","apple",rows)

if __name__ == "__main__":
    unittest.main()
