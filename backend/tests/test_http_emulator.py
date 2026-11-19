"""The reviewer simulator implements an isolated HTTP boundary, not live Keitaro."""

from collections import Counter

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def emulator(tmp_path):
    from adrobot.emulator import EMULATOR_KEY, create_emulator

    app = create_emulator("sqlite:///" + str(tmp_path / "tracker.db"))
    with TestClient(app, headers={"Api-Key": EMULATOR_KEY}) as client:
        yield client, app


def test_http_contract_and_persistent_remote_state(emulator):
    client, app = emulator
    assert client.get("/api/health").json()["mode"] == "emulator"
    assert client.get("/admin_api/v1/offers", headers={"Api-Key": ""}).status_code == 401
    assert len(client.get("/admin_api/v1/offers").json()) == 4
    assert client.get("/admin_api/v1/campaigns?offset=99&limit=100").json() == []
    campaign = client.post(
        "/admin_api/v1/campaigns",
        json={
            "name": "test_mukabenov_http",
            "alias": "http-test",
            "state": "active",
        },
    ).json()
    stream = client.post(
        "/admin_api/v1/streams",
        json={
            "campaign_id": campaign["id"],
            "position": 1,
            "state": "active",
            "schema": "landings",
            "offers": [{"offer_id": 1, "share": 100}],
        },
    ).json()
    offers = [{"offer_id": i, "share": 25, "state": "active"} for i in range(1, 5)]
    assert (
        client.put(f"/admin_api/v1/streams/{stream['id']}", json={"offers": offers}).status_code
        == 200
    )
    from adrobot.emulator import EMULATOR_KEY, create_emulator

    with TestClient(
        create_emulator(app.state.database_url), headers={"Api-Key": EMULATOR_KEY}
    ) as restarted:
        assert restarted.get(f"/admin_api/v1/streams/{stream['id']}").json()["offers"] == offers
        assert len(restarted.get("/admin_api/v1/offers").json()) == 4
    assert client.delete("/admin_api/v1/offers/1").status_code == 405


def test_visitor_has_explicit_country_choice_and_correct_routing(emulator):
    client, _ = emulator
    preview = client.get("/test_mukabenov_demo")
    assert preview.status_code == 200
    assert "Keitaro emulator" in preview.text
    assert "Visitor country" in preview.text and "Netherlands" in preview.text
    redirect = client.get("/test_mukabenov_demo?country=AU", follow_redirects=False)
    assert redirect.status_code == 302
    assert redirect.headers["location"] == "https://www.google.com/"
    landing = client.get("/test_mukabenov_demo?country=NL")
    assert landing.status_code == 200 and "Test offer" in landing.text
    assert "Keitaro emulator" in landing.text
    assert client.get("/test_mukabenov_demo?country=FAKE").status_code == 422


def test_weighted_selection_honors_remote_shares_and_ignores_removed():
    from adrobot.emulator import choose_offer

    offers = [
        dict(offer_id=1, share=25),
        dict(offer_id=2, share=38),
        dict(offer_id=3, share=37),
        dict(offer_id=4, share=100, state="disabled"),
    ]
    assert Counter(choose_offer(offers, draw)["offer_id"] for draw in range(100)) == {
        1: 25,
        2: 38,
        3: 37,
    }
    assert choose_offer([], 0) is None
