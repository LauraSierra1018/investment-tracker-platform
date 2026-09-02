from pathlib import Path

from pydantic_settings import (
    BaseSettings,
    SettingsConfigDict,
)


BASE_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    database_url: str = (
        "sqlite:///./investment_tracker.db"
    )

    frontend_origin: str = (
        "http://localhost:3000"
    )

    openai_api_key: str = ""
    openai_model: str = "gpt-4.1-mini"

    alpha_vantage_api_key: str = ""

    # SnapTrade
    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""
    snaptrade_encryption_key: str = ""
    snaptrade_redirect_url: str = "http://localhost:3000/portfolio"

    # Supabase
    supabase_url: str = ""
    supabase_publishable_key: str = ""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()