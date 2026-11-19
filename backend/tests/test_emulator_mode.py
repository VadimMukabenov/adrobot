"""Emulator mode is an isolated HTTP integration, never a saved live connection."""

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from adrobot.app import create_app
from adrobot.db import Database
from adrobot.keitaro import KeitaroGateway
from adrobot.models import Base
from adrobot.settings import Settings


@pytest.mark.parametrize("selection", ["constructor", "environment"])
def test_emulator_ignores_live_dotenv_and_inherited_configuration(tmp_path, monkeypatch, selection):
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "DATABASE_URL=sqlite:///live-dotenv.db\n"
        "KEITARO_API_KEY=synthetic-dotenv-live-marker\n"
        "KEITARO_BASE_URL=https://live-dotenv.invalid\n"
        "CONNECTION_FILE=live-dotenv.json\n"
    )
    monkeypatch.setenv("DATABASE_URL", "sqlite:///inherited-live.db")
    monkeypatch.setenv("KEITARO_API_KEY", "synthetic-inherited-live-marker")
    monkeypatch.setenv("KEITARO_BASE_URL", "https://inherited-live.invalid")
    monkeypatch.setenv("CONNECTION_FILE", str(tmp_path / "inherited-live.json"))
    monkeypatch.delenv("EMULATOR_DATABASE_URL", raising=False)
    arguments = {"_env_file": dotenv}
    if selection == "environment":
        monkeypatch.setenv("APP_MODE", "emulator")
    else:
        arguments["app_mode"] = "emulator"
    settings = Settings(**arguments)
    assert settings.app_mode == "emulator"
    assert settings.database_url == "sqlite:///./adrobot-emulator.db"
    assert settings.connection_file is None
    assert settings.keitaro_api_key.get_secret_value() == ""
    assert settings.keitaro_base_url not in (
        "https://inherited-live.invalid", "https://live-dotenv.invalid"
    )
    assert settings.emulator_api_url == "http://keitaro:8765"
    assert settings.emulator_public_url == "http://127.0.0.1:8768"


@pytest.mark.parametrize("explicit_database", [False, True])
def test_emulator_uses_only_its_database_override(tmp_path, monkeypatch, explicit_database):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///live.db")
    emulator_url = f"sqlite:///{tmp_path / 'emulator.db'}"
    monkeypatch.setenv("EMULATOR_DATABASE_URL", emulator_url)
    arguments = {"app_mode": "emulator", "_env_file": None}
    if explicit_database:
        arguments["database_url"] = f"sqlite:///{tmp_path / 'explicit.db'}"
    settings = Settings(**arguments)
    assert settings.database_url == (
        f"sqlite:///{tmp_path / 'explicit.db'}" if explicit_database else emulator_url
    )


@pytest.mark.parametrize("source", ["explicit-file", "default-file"])
def test_dotenv_cannot_silently_select_emulator(tmp_path, monkeypatch, source):
    monkeypatch.delenv("APP_MODE", raising=False)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "APP_MODE=emulator\nDATABASE_URL=sqlite:///live.db\n"
        "KEITARO_API_KEY=synthetic-dotenv-live-marker\n"
    )
    if source == "default-file":
        monkeypatch.setitem(Settings.model_config, "env_file", dotenv)
        arguments = {}
    else:
        arguments = {"_env_file": dotenv}
    with pytest.raises(ValueError, match="APP_MODE") as rejected:
        Settings(**arguments)
    assert not isinstance(rejected.value, ValidationError)
    assert "synthetic-dotenv-live-marker" not in str(rejected.value)


def test_explicit_live_mode_keeps_dotenv_loading_when_dotenv_requests_emulator(tmp_path):
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "APP_MODE=emulator\nDATABASE_URL=sqlite:///synthetic-live.db\n"
        "KEITARO_API_KEY=synthetic-live-marker\n"
    )
    settings = Settings(_env_file=dotenv, app_mode="live")
    assert settings.app_mode == "live"
    assert settings.database_url == "sqlite:///synthetic-live.db"
    assert settings.keitaro_api_key.get_secret_value() == "synthetic-live-marker"


def test_emulator_uses_real_http_gateway_without_reading_live_credentials(tmp_path, monkeypatch):
    from adrobot import connection

    requests = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            requests.append((self.path, self.headers.get("Api-Key")))
            if self.path.startswith("/admin_api/v1/campaigns?"):
                data = [{"id": 7, "name": "test_mukabenov_http", "alias": "sample"}]
                body = json.dumps(data).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    db = None
    try:
        settings = Settings(
            _env_file=None,
            app_mode="emulator",
            database_url=f"sqlite:///{tmp_path / 'drafts.db'}",
            emulator_api_url=f"http://127.0.0.1:{server.server_port}",
            emulator_public_url="http://127.0.0.1:8768",
        )
        saved = tmp_path / "live-keitaro.json"
        saved.write_text("synthetic unreadable live connection")
        settings.connection_file = saved
        settings.keitaro_api_key = SecretStr("synthetic-live-marker")
        original_read = Path.read_text

        def read_file(path, *args, **kwargs):
            if path == saved:
                pytest.fail("emulator read a saved live connection")
            return original_read(path, *args, **kwargs)

        def forbidden(*_args, **_kwargs):
            pytest.fail("emulator used a live SecretStr key or in-process DemoGateway")

        monkeypatch.setattr(Path, "read_text", read_file)
        monkeypatch.setattr(SecretStr, "get_secret_value", forbidden)
        monkeypatch.setattr(connection.DemoGateway, "__init__", forbidden)
        db = Database(settings.database_url)
        Base.metadata.create_all(db.engine)
        with TestClient(create_app(settings, db=db), base_url="http://127.0.0.1:8767") as client:
            health = client.get("/api/health").json()
            assert health["mode"] == "emulator" and health["configured"] is True
            public = client.get("/api/connection")
            assert public.json() == {
                "configured": True, "mode": "emulator", "url": "http://127.0.0.1:8768"
            }
            assert public.headers["cache-control"] == "no-store"
            campaign = client.get("/api/campaigns").json()[0]
            assert campaign["visitor_url"] == "http://127.0.0.1:8768/sample"
            assert client.post(
                "/api/connection", json={"url": "https://live.invalid", "api_key": "unused"}
            ).status_code == 409
        assert requests == [
            ("/admin_api/v1/campaigns?offset=0&limit=100", "adrobot-local-emulator")
        ]
        selected = connection.Connection(settings)
        try:
            assert isinstance(selected.gateway, KeitaroGateway)
        finally:
            selected.close()
    finally:
        if db is not None:
            db.engine.dispose()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
