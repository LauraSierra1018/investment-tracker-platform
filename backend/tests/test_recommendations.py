import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import uuid4
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app.db import Base, get_db
from app.auth import AuthUser, get_current_user
from app.main import app
from app.models import ResearchAsset, PortfolioPosition
from app.services.portfolio_preferences import Preferences, get_preferences, save_preferences
from app.services.recommendation_fit import fit
from app.services.portfolio_v2 import recommendations
from app.services.research_universe import list_research_candidates, upsert_research_asset
from app.services import research_discovery as discovery
from app.services.market_data.common import stamp

def stock(ticker, **changes):
    return {"ticker": ticker, "company": ticker, "asset_type": "EQUITY", "price": 100,
            "score": 70, "beta": 1, "pe_ratio": 20, "sector": "Health",
            "revenue_growth_pct": 10, "earnings_growth_pct": 10, "dividend_yield_pct": 2,
            **changes}

class FitTests(unittest.TestCase):
    def test_income_and_growth_change_order(self):
        income = stock("INCOME", dividend_yield_pct=5, revenue_growth_pct=1, earnings_growth_pct=1)
        growth = stock("GROW", dividend_yield_pct=0, revenue_growth_pct=35, earnings_growth_pct=35)
        for goal, expected, other in [("income", income, growth), ("growth", growth, income)]:
            prefs = Preferences(goal=goal, priorities=[])
            self.assertGreater(fit(expected, prefs, {}, set())[0], fit(other, prefs, {}, set())[0])

    def test_short_horizon_changes_risk_fit(self):
        row = stock("RISK", beta=1.35)
        long = fit(row, Preferences(risk_profile="aggressive", horizon="5+"), {}, set())
        short = fit(row, Preferences(risk_profile="aggressive", horizon="<1"), {}, set())
        self.assertGreater(long[0], short[0])
        self.assertTrue(any("menor a un año" in x for x in short[2]))

    def test_portfolio_sector_changes_ranking(self):
        health, tech = stock("HEALTH"), stock("TECH", sector="Technology")
        prefs = Preferences()
        self.assertGreater(fit(health,prefs,{"Technology": 90},set())[0],
                           fit(tech,prefs,{"Technology":90},set())[0])

    def test_missing_data_is_not_invented_and_zero_score_remains_zero(self):
        empty = stock("EMPTY", score=None, beta=None, pe_ratio=None, sector=None,
                      revenue_growth_pct=None, earnings_growth_pct=None, dividend_yield_pct=None)
        result = fit(empty, Preferences(goal="income"), {}, set())
        self.assertIsNone(result[3]["income"])
        self.assertIsNone(result[3]["quality"])
        self.assertTrue(result[2])
        self.assertEqual(fit(stock("ZERO",score=0), Preferences(),{},set())[3]["quality"],0)

    def test_growth_is_already_percentage(self):
        result = fit(stock("SMALL",revenue_growth_pct=1.2,earnings_growth_pct=1.2),Preferences(),{},set())
        self.assertEqual(result[3]["growth"],42.4)

    def test_etf_priority_affects_match(self):
        row=stock("ETF",asset_type="ETF")
        plain=Preferences(priorities=[])
        etf=Preferences(priorities=["etf"])
        self.assertGreater(fit(row,etf,{},set())[0],fit(row,plain,{},set())[0])

class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
        Base.metadata.create_all(self.engine)
        self.db=Session(self.engine)
        self.user=str(uuid4())
        self.other=str(uuid4())

    def tearDown(self):
        app.dependency_overrides.clear()
        self.db.close()
        self.engine.dispose()

    def test_preferences_are_persistent_and_isolated(self):
        save_preferences(self.db,self.user,Preferences(goal="income",risk_profile="conservative",horizon="1-3",priorities=["income"]))
        self.db.close()
        self.db=Session(self.engine)
        self.assertEqual(get_preferences(self.db,self.user).goal,"income")
        self.assertEqual(get_preferences(self.db,self.other).goal,"balanced")

    def test_api_preferences_use_authenticated_owner(self):
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[get_current_user]=lambda:AuthUser(self.user)
        client=TestClient(app)
        body={"goal":"income","risk_profile":"conservative","horizon":"1-3","priorities":["income"]}
        self.assertEqual(client.put("/portfolio/preferences",json=body).status_code,200)
        self.assertEqual(client.get("/portfolio/preferences").json(),body)
        self.assertEqual(client.put("/portfolio/preferences",json={"goal":"invalid"}).status_code,422)
        app.dependency_overrides[get_current_user]=lambda:AuthUser(self.other)
        self.assertEqual(client.get("/portfolio/preferences").json()["goal"],"balanced")

    def test_unauthenticated_preferences_rejected(self):
        app.dependency_overrides[get_db]=lambda:self.db
        self.assertEqual(TestClient(app).get("/portfolio/preferences").status_code,401)

    def test_entire_registered_universe_is_considered_not_only_recent_top_80(self):
        old=datetime.now(timezone.utc)-timedelta(days=10)
        self.db.add_all([ResearchAsset(ticker=f"T{i}",score=i,updated_at=old,last_seen_at=old) for i in range(105)])
        self.db.commit()
        self.assertEqual(len(list_research_candidates(self.db)),105)

    def test_outside_watchlist_can_rank_and_held_asset_is_excluded(self):
        # This database has no watchlist entries at all.
        rows=[stock("NEW"),stock("HELD",score=100),stock("ETF",asset_type="ETF")]
        enriched=[{"ticker":"HELD","market_value":100,"sector":"Technology"}]
        with patch("app.services.portfolio_v2.research_candidates",return_value=(rows,{"evaluated":3})):
            results=recommendations(self.db,"moderate",enriched,Preferences())
        self.assertEqual({x["ticker"] for x in results},{"NEW","ETF"})

    def test_opportunities_uses_saved_goal_and_not_a_fixed_moderate_profile(self):
        save_preferences(self.db,self.user,Preferences(goal="income",risk_profile="conservative",priorities=["income"]))
        app.dependency_overrides[get_db]=lambda:self.db
        app.dependency_overrides[get_current_user]=lambda:AuthUser(self.user)
        rows=[stock("INCOME",dividend_yield_pct=5),stock("GROW",dividend_yield_pct=0)]
        with patch("app.services.portfolio_v2.research_candidates",return_value=(rows,{"evaluated":2})):
            response=TestClient(app).get("/portfolio/opportunities")
            analysis=TestClient(app).get("/portfolio/analysis")
        self.assertEqual(response.status_code,200)
        data=response.json()
        self.assertEqual(data["profile"],"conservative")
        self.assertEqual(data["preferences"]["goal"],"income")
        self.assertEqual(data["opportunities"][0]["ticker"],"INCOME")
        self.assertEqual(data["opportunities"],analysis.json()["recommendations"])

    def test_old_snapshot_registration_does_not_reset_data_freshness(self):
        old=(datetime.now(timezone.utc)-timedelta(days=5)).isoformat()
        asset=upsert_research_asset(self.db,stock("OLD",updated_at=old))
        self.assertFalse(discovery.fresh(asset.updated_at))
        self.assertEqual(len(list_research_candidates(self.db)),1)

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        provider = patch.object(discovery.fmp_provider, "discover", return_value=[])
        provider.start()
        self.addCleanup(provider.stop)
    def test_screening_uses_shared_limited_session_and_no_watchlist(self):
        response={"quotes":[{"symbol":"NEW","quoteType":"EQUITY","regularMarketPrice":20,"trailingPE":15}],"total":500}
        with patch.object(discovery,"load_snapshot",return_value=None), \
             patch.object(discovery,"save_snapshot") as save, \
             patch.object(discovery.yf,"screen",return_value=response) as screen:
            result=discovery._discover()
        self.assertEqual([r["ticker"] for r in result["items"]],["NEW"])
        self.assertEqual(result["next_offset"],1)
        self.assertEqual(screen.call_count,4)
        self.assertTrue(all(call.kwargs["session"] is discovery.yahoo_session for call in screen.call_args_list))
        save.assert_called_once()

    def test_provider_outage_does_not_create_fake_candidates(self):
        with patch.object(discovery,"load_snapshot",return_value=None), \
             patch.object(discovery,"save_snapshot") as save, \
             patch.object(discovery.yf,"screen",side_effect=RuntimeError("offline")):
            self.assertIsNone(discovery._discover())
        save.assert_not_called()

    def test_partial_fundamentals_preserves_fresh_catalog_price(self):
        now = datetime.now(timezone.utc).isoformat()
        catalog = {"items": [{"ticker": "NEW", "price": 20, "pe_ratio": 15, "fetched_at": now}]}
        data = {"NEW": {**stamp("fmp", "NEW", "2025-12-31", "USD"),
                        "company": "New", "price": None, "pe_ratio": None, "beta": 1, "fetched_at": now}}
        with patch.object(discovery, "load_snapshot", side_effect=lambda kind, *args: catalog if kind == "research_catalog" else None), \
             patch.object(discovery, "load_snapshots", return_value=data), \
             patch.object(discovery, "save_snapshot"), \
             patch.object(discovery.refreshes, "get"):
            rows, _ = discovery.research_candidates(None, [])
        self.assertEqual(rows[0]["price"], 20)
        self.assertIsNone(rows[0]["pe_ratio"])
        self.assertEqual(rows[0]["beta"], 1)
        self.assertEqual(rows[0]["provenance"]["fundamentals"]["provider"], "fmp")

    def test_screen_ignores_invalid_prices_and_unsupported_assets(self):
        for row in [{"symbol":"BAD","regularMarketPrice":float("nan")},
                    {"symbol":"BAD","regularMarketPrice":10,"quoteType":"OPTION"},
                    {"symbol":"BAD SYMBOL","regularMarketPrice":10}]:
            self.assertIsNone(discovery.as_candidate(row))

if __name__=="__main__":
    unittest.main()
