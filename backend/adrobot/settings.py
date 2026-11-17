from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )
    database_url: str = "sqlite:///./adrobot.db"
    keitaro_base_url: str = "https://tracker.example"
    keitaro_api_key: SecretStr = SecretStr("")
    campaign_prefix: str = "test_mukabenov_"
