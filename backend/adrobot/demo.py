"""Persistent, local-only tracker resources for explicitly selected demo mode."""

import json
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path

from sqlalchemy.engine import make_url

from .errors import AppError


class DemoGateway:
    def __init__(self, database_url: str, prefix: str):
        self.path = Path(make_url(database_url).database).resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._transaction() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS resources "
                "(kind TEXT NOT NULL, id INTEGER NOT NULL, payload TEXT NOT NULL, "
                "PRIMARY KEY (kind, id))"
            )
            connection.execute("CREATE TABLE IF NOT EXISTS demo_seed (version INTEGER PRIMARY KEY)")
            if connection.execute("SELECT version FROM demo_seed").fetchone() is None:
                self._seed(connection, prefix)
                connection.execute("INSERT INTO demo_seed VALUES (1)")

    @contextmanager
    def _transaction(self):
        # Each call closes its own connection; no process-local state survives a restart.
        with closing(sqlite3.connect(self.path, timeout=15)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("BEGIN IMMEDIATE")
            with connection:
                yield connection

    @staticmethod
    def _put(connection, kind, resource):
        connection.execute(
            "INSERT INTO resources (kind, id, payload) VALUES (?, ?, ?) "
            "ON CONFLICT (kind, id) DO UPDATE SET payload=excluded.payload",
            (kind, resource["id"], json.dumps(resource)),
        )

    def _seed(self, connection, prefix):
        for offer_id in range(1, 5):
            self._put(
                connection,
                "offers",
                dict(id=offer_id, name=f"Demo offer {offer_id}", state="active"),
            )
        for kind, resource in [
            ("domains", dict(id=1, name="demo.local")),
            ("groups", dict(id=2, name="Demo campaigns")),
            ("traffic_sources", dict(id=3, name="Demo traffic")),
        ]:
            self._put(connection, kind, resource)
        self._put(
            connection,
            "campaigns",
            dict(
                id=1,
                name=prefix + "demo",
                alias=prefix + "demo",
                type="position",
                state="active",
                domain_id=1,
                group_id="2",
                traffic_source_id=3,
            ),
        )
        self._put(
            connection,
            "streams",
            dict(
                id=1,
                campaign_id=1,
                name="Country redirect",
                type="regular",
                position=1,
                schema="redirect",
                action_type="http",
                state="active",
                collect_clicks=True,
                action_options={"url": "https://www.google.com/"},
                filters=[dict(name="country", mode="accept", payload=["AU"])],
                offers=[],
                landings=[],
            ),
        )
        self._put(
            connection,
            "streams",
            dict(
                id=2,
                campaign_id=1,
                name="Offers",
                type="default",
                position=2,
                schema="landings",
                action_type="http",
                state="active",
                collect_clicks=True,
                filters=[],
                landings=[],
                offers=[
                    dict(offer_id=i, share=share, state="active")
                    for i, share in [(1, 34), (2, 33), (3, 33)]
                ],
            ),
        )

    @staticmethod
    def _get(connection, kind, resource_id):
        row = connection.execute(
            "SELECT payload FROM resources WHERE kind=? AND id=?", (kind, resource_id)
        ).fetchone()
        if row is None:
            raise AppError(404, "The requested demo resource is unavailable.")
        return json.loads(row[0])

    def _list(self, kind):
        with self._transaction() as connection:
            return [
                json.loads(row[0])
                for row in connection.execute(
                    "SELECT payload FROM resources WHERE kind=? ORDER BY id", (kind,)
                )
            ]

    def _create(self, kind, payload):
        with self._transaction() as connection:
            if kind == "streams":
                self._get(connection, "campaigns", payload["campaign_id"])
            resource_id = connection.execute(
                "SELECT COALESCE(MAX(id), 0) + 1 FROM resources WHERE kind=?", (kind,)
            ).fetchone()[0]
            resource = dict(payload, id=resource_id)
            self._put(connection, kind, resource)
            return resource

    def _update(self, kind, resource_id, payload):
        with self._transaction() as connection:
            resource = self._get(connection, kind, resource_id)
            resource.update(payload)
            resource["id"] = resource_id
            self._put(connection, kind, resource)
            return resource

    def list_campaigns(self):
        return self._list("campaigns")

    def get_campaign(self, campaign_id):
        with self._transaction() as connection:
            return self._get(connection, "campaigns", campaign_id)

    def list_streams(self, campaign_id):
        self.get_campaign(campaign_id)
        return [s for s in self._list("streams") if s["campaign_id"] == campaign_id]

    def get_stream(self, stream_id):
        with self._transaction() as connection:
            return self._get(connection, "streams", stream_id)

    def list_offers(self, query=""):
        query = query.strip().casefold()
        return [
            offer
            for offer in self._list("offers")
            if offer.get("state", "active") == "active"
            and (not query or query == str(offer["id"]) or query in offer["name"].casefold())
        ]

    def lookups(self):
        return {kind: self._list(kind) for kind in ("domains", "groups", "traffic_sources")}

    def update_stream(self, stream_id, offers):
        return self._update("streams", stream_id, {"offers": offers})

    def create_campaign(self, payload):
        return self._create("campaigns", payload)

    def update_campaign(self, campaign_id, payload):
        return self._update("campaigns", campaign_id, payload)

    def create_stream(self, payload):
        return self._create("streams", payload)
