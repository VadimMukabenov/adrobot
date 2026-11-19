import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from adrobot.app import create_app
from adrobot.settings import Settings


@pytest.fixture
def connection(tmp_path, monkeypatch):
    from adrobot.keitaro import KeitaroGateway

    calls = []

    def reply(request):
        calls.append(request)
        return httpx.Response(200 if request.headers["Api-Key"] == "test-secret" else 401, json=[])

    original = KeitaroGateway.__init__

    def initialize(self, base_url, api_key, transport=None):
        original(self, base_url, api_key, httpx.MockTransport(reply))

    monkeypatch.setattr(KeitaroGateway, "__init__", initialize)
    settings = Settings(
        _env_file=None, database_url=f"sqlite:///{tmp_path / 'test.db'}", keitaro_api_key=""
    )
    return settings, calls


def submit(client, key="test-secret", url="https://tlgk.host/admin/#!/campaigns", **headers):
    config = client.get("/api/connection").json()
    return client.post(
        "/api/connection",
        json={"url": url, "api_key": key},
        headers={
            "X-Setup-Token": config.get("setup_token", ""),
            "Origin": "http://127.0.0.1",
            **headers,
        },
    )


def test_bootstrap_persists_only_verified_credentials_and_survives_restart(connection):
    settings, calls = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        assert client.get("/api/health").json()["configured"] is False
        assert client.get("/api/campaigns").status_code == 503
        config = client.get("/api/connection").json()
        assert config["url"] == "https://tlgk.host"
        assert config["configured"] is False
        response = submit(client)
        assert response.status_code == 200, response.text
        assert "test-secret" not in response.text
        assert client.get("/api/health").json()["configured"] is True
        assert "test-secret" not in client.get("/api/connection").text
        assert submit(client).status_code == 409
    assert calls and all(r.method == "GET" for r in calls)
    assert calls[0].url == "https://tlgk.host/admin_api/v1/campaigns?limit=1"
    path = Path(settings.database_url.removeprefix("sqlite:///")).parent / "keitaro.json"
    assert path.stat().st_mode & 0o777 == 0o600
    assert json.loads(path.read_text()) == {"url": "https://tlgk.host", "api_key": "test-secret"}
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as restarted:
        assert restarted.get("/api/health").json()["configured"] is True
        assert restarted.get("/api/connection").json()["url"] == "https://tlgk.host"


def test_rejected_key_is_not_saved_and_can_be_corrected(connection):
    settings, _ = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        response = submit(client, key="incorrect-secret")
        assert response.status_code == 502
        assert "incorrect-secret" not in response.text
        assert client.get("/api/health").json()["configured"] is False
        assert not list(
            Path(settings.database_url.removeprefix("sqlite:///")).parent.glob("*.json")
        )
        assert submit(client).status_code == 200


@pytest.mark.parametrize(
    "url",
    [
        "https://tracker.example.com",
        "https://user:password@tlgk.host",
        "file:///etc/passwd",
        "https://tlgk.host:bad",
        "",
    ],
)
def test_invalid_urls_never_contact_tracker(connection, url):
    settings, calls = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        assert submit(client, url=url).status_code == 422
    assert calls == []


def test_setup_rejects_cross_origin_requests_missing_token_and_foreign_host(connection):
    settings, calls = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        assert submit(client, Origin="https://other.example").status_code == 403
        assert submit(client, **{"X-Setup-Token": "wrong"}).status_code == 403
        assert client.get("/api/connection", headers={"Host": "foreign.example"}).status_code == 403
        assert submit(client, Host="foreign.example").status_code == 403
    assert not calls


@pytest.mark.parametrize("key", ["", "\r\n", "invalid\tkey", "не-api-key"])
def test_invalid_key_characters_are_explained_without_network_request(connection, key):
    settings, calls = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        assert submit(client, key=key).status_code == 422
    assert not calls


def test_malformed_setup_request_does_not_echo_key(connection):
    settings, _ = connection
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        response = client.post("/api/connection", json={"api_key": "secret-not-to-echo"})
        assert response.status_code == 422
        assert "secret-not-to-echo" not in response.text


def test_environment_configuration_takes_precedence_over_saved_setup(connection):
    settings, _ = connection
    path = Path(settings.database_url.removeprefix("sqlite:///")).parent / "keitaro.json"
    path.write_text(json.dumps({"url": "https://saved.local", "api_key": "saved-secret"}))
    settings.keitaro_api_key = SecretStr("environment-secret")
    settings.keitaro_base_url = "https://env.local"
    with TestClient(create_app(settings), base_url="http://127.0.0.1") as client:
        response = client.get("/api/connection")
        assert response.json() == {"configured": True, "url": "https://env.local"}
        assert "secret" not in response.text
