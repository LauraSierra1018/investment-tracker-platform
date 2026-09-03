from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field

Status = Literal["cumple", "revisar", "no_cumple", "sin_dato"]

class CriterionResult(BaseModel):
    key: str
    name: str
    category: str
    value: float | str | None
    formatted_value: str
    status: Status
    score: float
    weight: float
    explanation: str
    rule: str

class StockSummary(BaseModel):
    ticker: str
    company: str
    exchange: str | None = None
    currency: str = "USD"
    sector: str | None = None
    industry: str | None = None
    price: float | None = None
    target_price: float | None = None
    market_cap: float | None = None
    pe_ratio: float | None = None
    revenue: float | None = None
    free_float_percent: float | None = None
    volume: float | None = None
    average_volume: float | None = None
    score: float
    classification: str
    criteria: list[CriterionResult]
    strengths: list[str]
    risks: list[str]
    missing_data: list[str]
    updated_at: datetime
    source: str
    stale: bool = False
    warning: str | None = None
    provenance: dict[str, Any] = {}

class SearchResult(BaseModel):
    ticker: str
    name: str
    exchange: str | None = None
    type: str | None = None

class WatchlistCreate(BaseModel):
    ticker: str


class WatchlistOut(BaseModel):
    id: int
    ticker: str
    created_at: datetime

    model_config = {
        "from_attributes": True
    }

class PositionCreate(BaseModel):
    ticker: str
    quantity: float = Field(gt=0)
    average_cost: float = Field(ge=0)
    currency: str = "USD"

class PositionOut(PositionCreate):
    id: int
    created_at: datetime
    current_price: float | None = None
    market_value: float | None = None
    unrealized_pnl: float | None = None
    unrealized_pnl_percent: float | None = None
    model_config = {"from_attributes": True}

class AiRequest(BaseModel):
    ticker: str

class AiResponse(BaseModel):
    available: bool
    summary: str
    thesis: list[str] = []
    risks: list[str] = []
    questions: list[str] = []
