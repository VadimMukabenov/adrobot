"""Explicit demo mode runs the real creator/editor against isolated persistent resources."""

from contextlib import contextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr, ValidationError

from adrobot.app import create_app
from adrobot.db import Database
from adrobot.models import Base
from adrobot.settings import Settings


@pytest.fixture
def settings(tmp_path):
    return Settings(
        _env_file=None,
        app_mode="demo",
        database_url=f"sqlite:///{tmp_path / 'drafts.db'}",
        keitaro_api_key="",
    )


@contextmanager
def client_for(settings):
    db = Database(settings.database_url)
    Base.metadata.create_all(db.engine)
    try:
        with TestClient(create_app(settings, db=db), base_url="http://127.0.0.1") as client:
            yield client
    finally:
        db.engine.dispose()


def test_mode_environment_is_explicit_and_rejects_unknown_modes(monkeypatch):
    monkeypatch.setenv("APP_MODE", "demo")
    monkeypatch.setenv("DEMO_DATABASE_URL", "sqlite:///samples.db")
    settings = Settings(_env_file=None)
    assert settings.app_mode == "demo"
    assert settings.demo_database_url == "sqlite:///samples.db"
    monkeypatch.setenv("APP_MODE", "mistyped-live")
    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_demo_is_configured_and_labels_both_public_endpoints(settings):
    with client_for(settings) as client:
        health = client.get("/api/health").json()
        assert health["mode"] == "demo"
        assert health["configured"] is True
        response = client.get("/api/connection")
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == {"configured": True, "mode": "demo", "url": "local://demo"}
        assert (
            client.post(
                "/api/connection", json={"url": "https://tracker.local", "api_key": "unused"}
            ).status_code
            == 409
        )


def test_demo_never_reads_saved_credentials_environment_key_or_real_gateway(
    settings, tmp_path, monkeypatch
):
    from adrobot import connection

    saved = tmp_path / "keitaro.json"
    saved.write_text("unreadable live connection placeholder")
    settings.connection_file = saved
    settings.keitaro_api_key = SecretStr("synthetic-live-key")
    original_read = Path.read_text

    def read_file(path, *args, **kwargs):
        if path == saved:
            pytest.fail("demo accessed the saved live connection")
        return original_read(path, *args, **kwargs)

    def forbidden(*args, **kwargs):
        pytest.fail("demo accessed a live key or network gateway")

    monkeypatch.setattr(Path, "read_text", read_file)
    monkeypatch.setattr(SecretStr, "get_secret_value", forbidden)
    monkeypatch.setattr(connection.KeitaroGateway, "__init__", forbidden)
    with client_for(settings) as client:
        assert client.get("/api/health").json()["mode"] == "demo"
        assert client.get("/api/campaigns").status_code == 200
        assert "synthetic-live-key" not in client.get("/api/connection").text
    assert original_read(saved) == "unreadable live connection placeholder"


def test_seed_contains_editable_owned_campaign_offers_and_creator_lookups(settings):
    with client_for(settings) as client:
        offers = client.get("/api/offers").json()
        assert len(offers) >= 4
        assert [(offer["id"], offer["name"]) for offer in offers[:4]] == [
            (1, "Demo offer 1"),
            (2, "Demo offer 2"),
            (3, "Demo offer 3"),
            (4, "Demo offer 4"),
        ]
        assert client.get("/api/offers?q=4").json() == [offers[3]]
        assert client.get("/api/offers?q=OFFER%202").json() == [offers[1]]
        assert client.get("/api/offers?q=absent").json() == []
        assert client.get("/api/lookups").json() == {
            "domains": [{"id": 1, "name": "demo.local"}],
            "groups": [{"id": 2, "name": "Demo campaigns"}],
            "traffic_sources": [{"id": 3, "name": "Demo traffic"}],
        }
        campaigns = client.get("/api/campaigns").json()
        assert len(campaigns) == 1
        assert campaigns[0]["name"] == settings.campaign_prefix + "demo"
        response = client.post(f"/api/campaigns/{campaigns[0]['id']}/fetch")
        assert response.status_code == 200, response.text
        campaign = response.json()
        assert campaign["writable"] is True
        assert [(s["name"], s["editable"]) for s in campaign["streams"]] == [
            ("Country redirect", False),
            ("Offers", True),
        ]
        assert [o["share"] for o in campaign["streams"][1]["offers"]] == [34, 33, 33]


def test_creator_uses_persistent_demo_resources_and_operation_identity(settings):
    body = {
        "name": settings.campaign_prefix + "created",
        "country": "AU",
        "offer_id": 4,
        "domain_id": 1,
        "group_id": 2,
        "traffic_source_id": 3,
        "operation_id": "persistent-demo-operation-1234",
    }
    with client_for(settings) as client:
        response = client.post("/api/campaigns", json=body)
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["status"] == "confirmed"
        campaign_id = result["campaign_id"]
        fetched = client.post(f"/api/campaigns/{campaign_id}/fetch").json()
        assert fetched["name"] == body["name"]
        assert fetched["streams"][1]["offers"][0]["offer_id"] == 4
    with client_for(settings) as restarted:
        assert restarted.post("/api/campaigns", json=body).json() == result
        campaigns = restarted.get("/api/campaigns").json()
        assert len(campaigns) == 2
        created = next(c for c in campaigns if c["id"] == campaign_id)
        assert created["state"] == "active"
        assert (created["domain_id"], int(created["group_id"]), created["traffic_source_id"]) == (
            1,
            2,
            3,
        )
        assert restarted.get(f"/api/operations/{body['operation_id']}").json() == result
        assert restarted.post(f"/api/campaigns/{campaign_id}/fetch").status_code == 200
        changed = dict(body, country="CA")
        assert restarted.post("/api/campaigns", json=changed).status_code == 409


def test_editor_draft_cancel_pin_remove_restore_and_push_survive_restart(settings):
    with client_for(settings) as client:
        campaign_id = client.get("/api/campaigns").json()[0]["id"]
        fetched = client.post(f"/api/campaigns/{campaign_id}/fetch").json()
        stream = fetched["streams"][1]
        stream_id = stream["id"]
        stream = client.post(
            f"/api/streams/{stream_id}/edit",
            json={"action": "add", "offer_id": 4, "expected_revision": stream["revision"]},
        ).json()
        assert [o["share"] for o in stream["offers"]] == [25, 25, 25, 25]
    with client_for(settings) as client:
        campaign = client.get(f"/api/campaigns/{campaign_id}").json()
        assert campaign["streams"][1] == stream
        assert client.post(f"/api/campaigns/{campaign_id}/fetch").status_code == 409
        stream = client.post(
            f"/api/streams/{stream_id}/cancel", json={"expected_revision": stream["revision"]}
        ).json()
        assert [o["share"] for o in stream["offers"]] == [34, 33, 33]
        for action, offer_id, extra in [
            ("pin", 1, {"share": 40}),
            ("remove", 2, {}),
            ("restore", 2, {}),
            ("add", 4, {}),
        ]:
            response = client.post(
                f"/api/streams/{stream_id}/edit",
                json=dict(
                    action=action, offer_id=offer_id, expected_revision=stream["revision"], **extra
                ),
            )
            assert response.status_code == 200, response.text
            stream = response.json()
        assert [o["share"] for o in stream["offers"]] == [40, 20, 20, 20]
        pushed = client.post(
            f"/api/streams/{stream_id}/push", json={"expected_revision": stream["revision"]}
        )
        assert pushed.status_code == 200, pushed.text
        assert pushed.json()["dirty"] is False
    with client_for(settings) as restarted:
        fetched = restarted.post(f"/api/campaigns/{campaign_id}/fetch").json()
        assert [o["share"] for o in fetched["streams"][1]["offers"]] == [40, 20, 20, 20]
        assert len(restarted.get("/api/campaigns").json()) == 1
        assert len(restarted.get("/api/offers").json()) >= 4


@pytest.mark.parametrize("alias", ["same", "relative", "symlink", "hardlink"])
def test_demo_rejects_application_database_path_aliases(tmp_path, monkeypatch, alias):
    application = tmp_path / "drafts.db"
    application.touch()
    if alias == "relative":
        monkeypatch.chdir(tmp_path)
        demo_url = "sqlite:///./drafts.db"
    elif alias in ("symlink", "hardlink"):
        duplicate = tmp_path / "alias.db"
        if alias == "symlink":
            duplicate.symlink_to(application)
        else:
            duplicate.hardlink_to(application)
        demo_url = f"sqlite:///{duplicate}"
    else:
        demo_url = f"sqlite:///{application}"
    with pytest.raises(ValueError, match="separate"):
        Settings(
            _env_file=None,
            app_mode="demo",
            database_url=f"sqlite:///{application}",
            demo_database_url=demo_url,
        )


@pytest.mark.parametrize("url", ["sqlite:///:memory:", "postgresql://localhost/demo"])
def test_demo_requires_a_persistent_local_sqlite_resource_database(settings, url):
    with pytest.raises(ValueError, match="SQLite"):
        Settings(
            _env_file=None,
            app_mode="demo",
            database_url=settings.database_url,
            demo_database_url=url,
        )


def test_default_resource_database_is_a_separate_sibling(settings, tmp_path):
    with client_for(settings) as client:
        assert client.get("/api/campaigns").status_code == 200
    assert (tmp_path / "drafts.db").is_file()
    assert (tmp_path / "drafts.demo.db").is_file()


def test_live_error_never_switches_to_demo(tmp_path):
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{tmp_path / 'live.db'}", keitaro_api_key=""
    )
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        assert client.get("/api/health").json()["mode"] == "live"
        assert client.get("/api/connection").json()["configured"] is False
        assert client.get("/api/campaigns").status_code == 503
    assert not (tmp_path / "live.demo.db").exists()


def test_explicit_demo_startup_does_not_import_live_dotenv(tmp_path, monkeypatch):
    live_env = tmp_path / ".env"
    live_env.write_text(
        "DATABASE_URL=sqlite:///live-data.db\n"
        "KEITARO_API_KEY=synthetic-live-dotenv-key\n"
        "KEITARO_BASE_URL=https://live-tracker.local\n"
    )
    monkeypatch.setenv("APP_MODE", "demo")
    for name in ("DATABASE_URL", "KEITARO_API_KEY", "KEITARO_BASE_URL"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings(_env_file=live_env)
    assert settings.database_url == "sqlite:///./adrobot-demo.db"
    assert settings.keitaro_api_key.get_secret_value() == ""
    assert settings.keitaro_base_url == "https://tlgk.host"


@pytest.mark.parametrize(
    "application_url", ["sqlite:///file:drafts.db?uri=true", "sqlite+pysqlite:///drafts.db"]
)
def test_demo_rejects_ambiguous_application_sqlite_urls(application_url, tmp_path):
    with pytest.raises(ValueError, match="SQLite"):
        Settings(
            _env_file=None,
            app_mode="demo",
            database_url=application_url,
            demo_database_url=f"sqlite:///{tmp_path / 'demo.db'}",
        )


@pytest.mark.parametrize("source", ["explicit-file", "default-file"])
def test_dotenv_alone_cannot_select_demo_and_import_live_configuration(
    tmp_path, monkeypatch, source
):
    for name in ("APP_MODE", "DATABASE_URL", "KEITARO_API_KEY", "DEMO_DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    live_database = tmp_path / "live.db"
    live_database.write_bytes(b"synthetic-live-database-placeholder")
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        f"APP_MODE=demo\nDATABASE_URL=sqlite:///{live_database}\n"
        "KEITARO_API_KEY=synthetic-review-marker\n"
    )
    if source == "default-file":
        monkeypatch.setitem(Settings.model_config, "env_file", dotenv)
        arguments = {}
    else:
        arguments = {"_env_file": dotenv}
    with pytest.raises(ValueError, match="APP_MODE") as rejected:
        Settings(**arguments)
    assert "synthetic-review-marker" not in str(rejected.value)
    assert live_database.read_bytes() == b"synthetic-live-database-placeholder"
    assert sorted(path.name for path in tmp_path.iterdir()) == [".env", "live.db"]


@pytest.mark.parametrize("source", ["constructor", "process"])
@pytest.mark.parametrize("mode", ["live", "demo"])
def test_explicit_mode_overrides_dotenv_selection_without_changing_live_loading(
    tmp_path, monkeypatch, source, mode
):
    for name in ("APP_MODE", "DATABASE_URL", "KEITARO_API_KEY", "DEMO_DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    dotenv = tmp_path / ".env"
    dotenv.write_text(
        "APP_MODE=demo\nDATABASE_URL=sqlite:///synthetic-live.db\n"
        "KEITARO_API_KEY=synthetic-review-marker\n"
    )
    arguments = {"_env_file": dotenv}
    if source == "constructor":
        arguments["app_mode"] = mode
    else:
        monkeypatch.setenv("APP_MODE", mode)
    settings = Settings(**arguments)
    assert settings.app_mode == mode
    if mode == "live":
        assert settings.database_url == "sqlite:///synthetic-live.db"
        assert settings.keitaro_api_key.get_secret_value() == "synthetic-review-marker"
    else:
        assert settings.database_url == "sqlite:///./adrobot-demo.db"
        assert settings.keitaro_api_key.get_secret_value() == ""
