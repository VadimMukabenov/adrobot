import os
from pathlib import Path
from typing import Literal

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore"
    )
    app_mode: Literal["live", "demo", "emulator"] = "live"
    demo_database_url: str | None = None
    emulator_api_url: str = "http://keitaro:8765"
    emulator_public_url: str = "http://127.0.0.1:8768"
    database_url: str = "sqlite:///./adrobot.db"
    keitaro_base_url: str = "https://tlgk.host"
    keitaro_api_key: SecretStr = SecretStr("")
    campaign_prefix: str = "test_mukabenov_"
    connection_file: Path | None = None

    def __init__(self, **values):
        environment = {name.lower(): value for name, value in os.environ.items()}
        selected_mode = values.get("app_mode", environment.get("app_mode"))
        if selected_mode == "demo":
            # A live checkout's dotenv can contain both credentials and its draft database.
            # Explicit demo startup must not import either of them.
            values["_env_file"] = None
            values["keitaro_api_key"] = ""
            if "database_url" not in values and "database_url" not in environment:
                values["database_url"] = "sqlite:///./adrobot-demo.db"
        elif selected_mode == "emulator":
            # Emulator startup has its own HTTP tracker, credentials and draft storage.
            # Discard live inputs before validation can use or include them in errors.
            values["_env_file"] = None
            values["keitaro_api_key"] = ""
            values["keitaro_base_url"] = type(self).model_fields["keitaro_base_url"].default
            values["connection_file"] = None
            if "database_url" not in values:
                values["database_url"] = environment.get(
                    "emulator_database_url", "sqlite:///./adrobot-emulator.db"
                )
        super().__init__(**values)

    @classmethod
    def settings_customise_sources(
        cls, settings_cls, init_settings, env_settings, dotenv_settings, file_secret_settings
    ):
        def live_dotenv():
            values = dotenv_settings()
            selected_mode = init_settings().get("app_mode", env_settings().get("app_mode"))
            mode = values.get("app_mode")
            if mode in ("demo", "emulator") and selected_mode not in (
                "live", "demo", "emulator"
            ):
                # Reject before these values enter model validation: errors can include inputs.
                raise ValueError(
                    f"Select {mode} with process APP_MODE={mode} or Settings(app_mode='{mode}'); "
                    f"dotenv cannot select {mode} mode."
                )
            return values

        return init_settings, env_settings, live_dotenv, file_secret_settings

    @model_validator(mode="after")
    def isolate_demo_resources(self):
        if self.app_mode != "demo":
            return self
        application = make_url(self.database_url)
        if application.get_backend_name() == "sqlite" and (
            application.drivername != "sqlite" or application.query or application.host
        ):
            raise ValueError("Demo application drafts must use a plain SQLite file URL.")
        application_path = (
            Path(application.database).resolve()
            if application.drivername == "sqlite"
            and application.database not in (None, "", ":memory:")
            else None
        )
        if self.demo_database_url is None:
            if application_path is None:
                raise ValueError("Set DEMO_DATABASE_URL to a separate persistent SQLite file.")
            sibling = application_path.with_name(application_path.stem + ".demo.db")
            self.demo_database_url = "sqlite:///" + str(sibling)
        demo = make_url(self.demo_database_url)
        if (
            demo.drivername != "sqlite"
            or demo.database in (None, "", ":memory:")
            or demo.host
            or demo.query
        ):
            raise ValueError("DEMO_DATABASE_URL must use a persistent local SQLite file.")
        demo_path = Path(demo.database).resolve()
        if application_path is not None and (
            application_path == demo_path
            or (
                application_path.exists()
                and demo_path.exists()
                and application_path.samefile(demo_path)
            )
        ):
            raise ValueError("Demo resources require a separate database from application drafts.")
        return self
