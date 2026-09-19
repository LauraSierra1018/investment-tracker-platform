from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from ..models import PortfolioPreference

class Preferences(BaseModel):
    goal: Literal["preserve", "balanced", "growth", "aggressive", "income", "custom"] = "balanced"
    risk_profile: Literal["conservative", "moderate", "aggressive"] = "moderate"
    horizon: Literal["<1", "1-3", "3-5", "5+"] = "5+"
    priorities: list[Literal["growth", "quality", "low_volatility", "valuation", "income", "etf", "diversification"]] = Field(default_factory=lambda: ["growth", "quality", "diversification"], max_length=7)

    @field_validator("priorities")
    @classmethod
    def unique(cls, values):
        return list(dict.fromkeys(values))


def get_preferences(db, user_id):
    row = db.get(PortfolioPreference, user_id)
    return Preferences.model_validate_json(row.payload) if row else Preferences()


def save_preferences(db, user_id, preferences):
    row = db.get(PortfolioPreference, user_id)
    if row is None:
        row = PortfolioPreference(user_id=user_id)
        db.add(row)
    row.payload = preferences.model_dump_json()
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return preferences


def resolve_preferences(db, user_id, profile=None):
    preferences = get_preferences(db, user_id)
    if profile is not None:
        preferences = preferences.model_copy(update={"risk_profile": profile})
    return preferences


def protect_preferences_table(engine):
    """Supabase clients access preferences only through our authenticated API."""
    if engine.dialect.name != "postgresql":
        return
    from sqlalchemy import text
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE portfolio_preferences ENABLE ROW LEVEL SECURITY"))
        # Backend's configured database owner retains access; public API roles do not.
        for role in ("anon", "authenticated"):
            exists = connection.scalar(text("SELECT 1 FROM pg_roles WHERE rolname = :role"), {"role": role})
            if exists:
                connection.execute(text(f"REVOKE ALL ON TABLE portfolio_preferences FROM {role}"))
