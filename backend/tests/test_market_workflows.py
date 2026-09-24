import unittest
from uuid import uuid4
from unittest.mock import patch
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
import app.main as main
from app.auth import AuthUser, get_current_user
from app.db import Base, get_db
from app.models import PortfolioPosition, BrokerPosition, ResearchAsset, WatchlistItem
from app.services import market_overview, portfolio_v2, portfolio_history
from app.routers import portfolio_v2 as portfolio_routes
from app.services.market_data.common import stamp, now
from app.services.market_data import market_data_service
from test_market_data import quote, fundamentals, history
from app.services.market import get_stock

class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine)
        self.user, self.other = str(uuid4()), str(uuid4())
        main.app.dependency_overrides[get_current_user] = lambda: AuthUser(self.user)
        main.app.dependency_overrides[get_db] = lambda: self.db
        self.client = TestClient(main.app)

    def tearDown(self):
        main.app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def test_watchlist_and_portfolio_read_contract_and_ownership(self):
        self.db.add_all([
            WatchlistItem(user_id=self.user,ticker="AAPL"),
            WatchlistItem(user_id=self.other,ticker="MSFT"),
            PortfolioPosition(user_id=self.user,ticker="AAPL",quantity=2,average_cost=80,currency="USD"),
            PortfolioPosition(user_id=self.other,ticker="MSFT",quantity=20,average_cost=80,currency="USD")])
        self.db.commit()
        self.assertEqual([r["ticker"] for r in self.client.get("/watchlist").json()],["AAPL"])
        with patch.object(main,"get_quotes",return_value={"AAPL":quote()}):
            response = self.client.get("/portfolio")
        self.assertEqual(response.status_code,200)
        self.assertEqual(len(response.json()),1)
        row = response.json()[0]
        self.assertEqual(row["market_value"],200)
        self.assertEqual(row["unrealized_pnl"],40)
        self.assertEqual(row["provenance"]["provider"],"massive")

    def test_portfolio_does_not_subtract_cost_in_another_currency(self):
        self.db.add(PortfolioPosition(user_id=self.user,ticker="AAPL",quantity=2,average_cost=80,currency="EUR"))
        self.db.commit()
        with patch.object(main,"get_quotes",return_value={"AAPL":quote(currency="USD")}):
            data = self.client.get("/portfolio").json()[0]
        self.assertIsNone(data["current_price"])
        self.assertIsNone(data["market_value"])
        self.assertIsNone(data["unrealized_pnl"])
        self.assertTrue(data["warning"])

    def test_dashboard_keeps_actual_sources_and_stale_flags(self):
        data = quote(stale=True,warning="Saved quote")
        with patch.object(market_overview,"get_quotes",return_value={"AAPL":data}), \
             patch.object(market_overview,"load_snapshot",return_value=None), \
             patch.object(market_overview,"load_snapshots",return_value={}), \
             patch.object(market_overview,"save_snapshot"):
            response = self.client.get("/market/overview")
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()["source"],"Massive")
        self.assertTrue(response.json()["stale"])
        self.assertEqual(response.json()["refresh_seconds"],10)
        self.assertEqual(response.json()["provenance"]["AAPL"]["quote"]["data_timestamp"],data["data_timestamp"])

    def test_dashboard_rechecks_partial_cache_after_ten_seconds(self):
        cached = {"stale": True, "refresh_seconds": 10, "stocks": []}
        fresh = {"stale": False, "refresh_seconds": 60, "stocks": [{"ticker": "AAPL", "price": 100}]}
        with patch.object(market_overview,"load_snapshot",side_effect=[cached, None]) as read, \
             patch.object(market_overview,"_build_payload",return_value=fresh) as build, \
             patch.object(market_overview,"save_snapshot"):
            self.assertEqual(market_overview.market_overview(),fresh)
        self.assertEqual(read.call_args_list[-1].args[-1],10)
        build.assert_called_once()

    def test_analysis_never_uses_unverified_research_prices_or_ratios(self):
        self.db.add_all([
            PortfolioPosition(user_id=self.user,ticker="AAPL",quantity=2,average_cost=80,currency="USD"),
            ResearchAsset(ticker="AAPL",last_price=999,pe_ratio=900,beta=900)])
        self.db.commit()
        with patch.object(portfolio_v2,"get_stock",side_effect=RuntimeError("offline")), \
             patch.object(portfolio_v2,"research_candidates",return_value=([],{})):
            response = self.client.get("/portfolio/analysis")
        self.assertEqual(response.status_code,200)
        data = response.json()
        self.assertTrue(data["summary"]["estimated"])
        self.assertEqual(data["summary"]["market_value"],160)
        position = data["consolidated_positions"][0]
        self.assertIsNone(position["current_price"])
        self.assertEqual(position["average_cost"],80)
        self.assertIsNone(position["beta"])
        self.assertTrue(data["alerts"])

    def test_portfolio_small_growth_percent_is_not_multiplied_again(self):
        position = PortfolioPosition(user_id=self.user,ticker="AAPL",quantity=2,average_cost=80,currency="USD")
        self.db.add(position); self.db.commit()
        data = {"ticker":"AAPL","price":100,"revenue_growth_pct":0.5,"earnings_growth_pct":1.2,
                "provenance":{"quote":{"currency":"USD"}}, "updated_at": now().isoformat()}
        with patch.object(portfolio_v2,"get_stock",return_value=data):
            row = portfolio_v2.enrich_positions(self.db,[position])[0]
        self.assertEqual(row["revenue_growth"],0.5)
        self.assertEqual(row["earnings_growth"],1.2)

    def test_broker_positions_and_import_remain_separate_from_general_market(self):
        body = {"broker":"generic","account_name":"Synthetic","positions":[
            {"ticker":"AAPL","quantity":2,"average_cost":80,"currency":"USD","last_price":95}]}
        with patch.object(market_data_service,"get_quote",side_effect=AssertionError("Broker import must not query shared data")):
            response = self.client.post("/portfolio/import/confirm",json=body)
            self.assertEqual(response.status_code,200)
            result = self.client.get("/portfolio/broker/positions")
        self.assertEqual(result.status_code,200)
        rows = result.json()
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["quantity"],2)
        self.assertEqual(rows[0]["average_cost"],80)
        self.assertEqual(rows[0]["current_price"],95)
        self.assertTrue(rows[0]["read_only"])
        with patch.object(portfolio_routes,"broker_status",return_value={
                "configured":False,"registered":False,"connected":False,"read_only":True,"connections":[],"accounts":[]}):
            status = self.client.get("/portfolio/broker/status")
        self.assertEqual(status.status_code,200)
        self.assertEqual(status.json()["imported_positions"],1)
        self.assertTrue(status.json()["connected"])

    def test_snaptrade_positions_remain_canonical_and_scoped_to_user(self):
        self.db.add_all([
            PortfolioPosition(user_id=self.user,ticker="MANUAL",quantity=1,average_cost=10,currency="USD"),
            BrokerPosition(user_id=self.user,account_id="broker-test",ticker="AAPL",quantity=2,average_cost=80,currency="USD",last_price=95),
            BrokerPosition(user_id=self.other,account_id="other-test",ticker="MSFT",quantity=2,average_cost=80,currency="USD",last_price=95)])
        self.db.commit()
        self.assertEqual([r.ticker for r in portfolio_v2.user_positions(self.db,self.user)],["AAPL"])
        with patch.object(portfolio_v2,"get_stock",return_value={}):
            row = portfolio_v2.enrich_positions(self.db,portfolio_v2.user_positions(self.db,self.user))[0]
        self.assertEqual(row["market_value"],190)
        self.assertEqual(row["provenance"]["quote"]["source"],"SnapTrade (snapshot del broker)")
        self.assertTrue(row["stale"])

    def test_portfolio_history_uses_a_complete_same_currency_dataset(self):
        self.db.add(PortfolioPosition(user_id=self.user,ticker="AAPL",quantity=2,average_cost=80,currency="USD"))
        self.db.commit()
        dataset = history(period="3mo")
        with patch.object(portfolio_history,"get_histories",return_value={"AAPL":dataset}):
            result = portfolio_history.build_history(self.db,self.user,"3M")
        self.assertEqual(result["points"][-1]["value"],dataset["points"][-1]["close"]*2)
        self.assertEqual(result["provenance"]["AAPL"]["provider"],"massive")

if __name__ == "__main__":
    unittest.main()
