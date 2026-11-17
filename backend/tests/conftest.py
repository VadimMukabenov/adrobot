from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from adrobot.app import create_app
from adrobot.db import Database
from adrobot.models import Base
from adrobot.settings import Settings


class Remote:
    """Stateful external boundary. Application SQL state remains real in tests."""

    def __init__(self):
        self.campaigns = {
            7: dict(
                id=7,
                name="test_mukabenov_demo",
                domain_id=1,
                group_id=2,
                traffic_source_id=3,
                state="active",
            )
        }
        self.offers = {i: dict(id=i, name=f"Product {i}", state="active") for i in range(1, 6)}
        self.streams = {
            10: dict(
                id=10,
                campaign_id=7,
                name="Country redirect",
                schema="redirect",
                action_type="http",
                action_payload="https://www.google.com/",
                position=1,
                filters=[dict(name="country", mode="accept", payload=["AU"])],
                offers=[],
            ),
            11: dict(
                id=11,
                campaign_id=7,
                name="Offers",
                schema="landings",
                position=2,
                filters=[],
                offers=[
                    dict(offer_id=1, share=34, state="active"),
                    dict(offer_id=2, share=33, state="active"),
                    dict(offer_id=3, share=33, state="active"),
                ],
            ),
        }
        self.fail_push = False
        self.apply_then_timeout = False
        self.before_write = None
        self.fail_second_stream = False
        self.campaign_timeout_once = False

    def lookups(self):
        return dict(
            domains=[dict(id=1, name="demo.example")],
            groups=[dict(id=2, name="Tests")],
            traffic_sources=[dict(id=3, name="Demo")],
        )

    def create_campaign(self, payload):
        campaign_id = max(self.campaigns) + 1
        self.campaigns[campaign_id] = dict(payload, id=campaign_id)
        if self.campaign_timeout_once:
            self.campaign_timeout_once = False
            raise TimeoutError("lost creation response")
        return self.get_campaign(campaign_id)

    def create_stream(self, payload):
        if self.fail_second_stream and payload["position"] == 2:
            raise TimeoutError("lost stream response")
        stream_id = max(self.streams) + 1
        self.streams[stream_id] = dict(payload, id=stream_id)
        return self.get_stream(stream_id)

    def update_campaign(self, campaign_id, payload):
        self.campaigns[campaign_id].update(payload)
        return self.get_campaign(campaign_id)

    def list_campaigns(self):
        return deepcopy(list(self.campaigns.values()))

    def get_campaign(self, campaign_id):
        return deepcopy(self.campaigns[campaign_id])

    def list_streams(self, campaign_id):
        return deepcopy([s for s in self.streams.values() if s["campaign_id"] == campaign_id])

    def get_stream(self, stream_id):
        return deepcopy(self.streams[stream_id])

    def list_offers(self, query=""):
        return deepcopy(
            [
                o
                for o in self.offers.values()
                if o["state"] == "active"
                and (not query or query.lower() in o["name"].lower() or query == str(o["id"]))
            ]
        )

    def update_stream(self, stream_id, offers):
        if self.before_write:
            self.before_write()
        if self.fail_push:
            raise RuntimeError("upstream unavailable")
        self.streams[stream_id]["offers"] = deepcopy(offers)
        if self.apply_then_timeout:
            raise TimeoutError("response lost after successful remote write")
        return self.get_stream(stream_id)


@pytest.fixture
def remote():
    return Remote()


@pytest.fixture
def setup(tmp_path, remote):
    settings = Settings(database_url=f"sqlite:///{tmp_path / 'test.db'}")
    db = Database(settings.database_url)
    Base.metadata.create_all(db.engine)
    app = create_app(settings, remote, db)
    with TestClient(app) as client:
        assert client.post("/api/campaigns/7/fetch").status_code == 200
        yield client, remote, settings, db
    db.engine.dispose()
