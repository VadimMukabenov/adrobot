"""Isolated real HTTP boundary for browser tests. Never loads an operator's .env/key."""

import json
import os
import socket
import sys
import tempfile
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, RLock, Thread
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import uvicorn
from alembic import command
from alembic.config import Config

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from adrobot.app import create_app  # noqa: E402
from adrobot.settings import Settings  # noqa: E402

APP_PORT = int(os.environ.get("ADROBOT_E2E_APP_PORT", "18782"))
TRACKER_PORT = int(os.environ.get("ADROBOT_E2E_TRACKER_PORT", "18781"))


class Tracker:
    def __init__(self):
        self.lock = RLock()
        self.lookup_gate = Event()
        self.lookup_gate.set()
        self.drop_create = False
        self.drop_update = False
        self.fail_read_after_update = False
        self.failed_read_id = None
        self.events = []
        self.campaigns = {
            100: dict(
                id=100,
                name="test_mukabenov_seed",
                alias="seed",
                type="position",
                state="active",
                domain_id=7,
                group_id="8",
                traffic_source_id=9,
            )
        }
        self.offers = [
            dict(id=i, name=name, state="active")
            for i, name in [
                (101, "Offer Alpha"),
                (102, "Offer Beta"),
                (103, "Offer Gamma"),
                (104, "Offer Delta"),
            ]
        ]
        self.streams = {
            1001: dict(
                id=1001,
                campaign_id=100,
                name="Country redirect",
                position=1,
                type="regular",
                schema="redirect",
                action_type="http",
                state="active",
                action_payload="https://www.google.com/",
                filters=[dict(name="country", mode="accept", payload=["AU"])],
                offers=[],
            ),
            1002: dict(
                id=1002,
                campaign_id=100,
                name="Offers",
                position=2,
                type="default",
                schema="landings",
                action_type="http",
                state="active",
                filters=[],
                landings=[],
                offers=[
                    dict(offer_id=i, share=s, state="active")
                    for i, s in [(101, 34), (102, 33), (103, 33)]
                ],
            ),
        }


tracker = Tracker()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def respond(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def drop_response(self):
        self.close_connection = True
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/__state":
            with tracker.lock:
                return self.respond(
                    deepcopy(
                        dict(
                            campaigns=list(tracker.campaigns.values()),
                            streams=list(tracker.streams.values()),
                            events=tracker.events,
                        )
                    )
                )
        if not path.startswith("/admin_api/v1/"):
            # Public visitor routes need no Admin API key. Fixture geography
            # chooses either the country redirect or the default offer.
            with tracker.lock:
                campaign = next(
                    (
                        c
                        for c in tracker.campaigns.values()
                        if path == "/" + c.get("alias", "") and c.get("state") == "active"
                    ),
                    None,
                )
                if campaign:
                    country = self.headers.get("X-Test-Country", "ZZ")
                    redirect = next(
                        (
                            s
                            for s in tracker.streams.values()
                            if s["campaign_id"] == campaign["id"]
                            and s.get("schema") == "redirect"
                            and s.get("state") == "active"
                            and any(
                                f.get("name") == "country"
                                and f.get("mode") == "accept"
                                and country in f.get("payload", [])
                                for f in s.get("filters", [])
                            )
                        ),
                        None,
                    )
                    if redirect:
                        # Match live Keitaro: URL is action_payload. A missing
                        # URL yields an empty Location, never options.url.
                        self.send_response(302)
                        self.send_header("Location", redirect.get("action_payload") or "")
                        self.send_header("Content-Length", "0")
                        self.end_headers()
                        return
                    stream = next(
                        (
                            s
                            for s in tracker.streams.values()
                            if s["campaign_id"] == campaign["id"] and s.get("offers")
                        ),
                        None,
                    )
                    if stream:
                        offer_id = int(stream["offers"][0]["offer_id"])
                        body = (
                            f"<!doctype html><title>Test offer</title><h1>Offer {offer_id}</h1>"
                        ).encode()
                        self.send_response(200)
                        self.send_header("Content-Type", "text/html; charset=utf-8")
                        self.send_header("Content-Length", str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
            return self.respond({}, 404)
        if self.headers.get("Api-Key") != "e2e-local-key":
            return self.respond({}, 401)
        route = path.removeprefix("/admin_api/v1/")
        if route in ("domains", "groups", "traffic_sources"):
            if not tracker.lookup_gate.wait(20):
                return self.respond({}, 503)
            lookups = {
                "domains": [dict(id=7, name="demo.example.test")],
                "groups": [dict(id=8, name="Demo group")],
                "traffic_sources": [dict(id=9, name="Demo source")],
            }
            return self.respond(lookups[route])
        with tracker.lock:
            if route == "campaigns":
                query = parse_qs(urlsplit(self.path).query)
                offset, limit = int(query.get("offset", [0])[0]), int(query.get("limit", [100])[0])
                return self.respond(
                    deepcopy(list(tracker.campaigns.values())[offset : offset + limit])
                )
            if route == "offers":
                return self.respond(tracker.offers)
            parts = route.split("/")
            if len(parts) == 3 and parts[0] == "campaigns" and parts[2] == "streams":
                return self.respond(
                    deepcopy(
                        [s for s in tracker.streams.values() if s["campaign_id"] == int(parts[1])]
                    )
                )
            if len(parts) == 2 and parts[0] in ("streams", "campaigns"):
                rid = int(parts[1])
                if parts[0] == "streams" and tracker.failed_read_id == rid:
                    tracker.failed_read_id = None
                    return self.respond({"message": "Controlled read-back failure"}, 503)
                rows = tracker.streams if parts[0] == "streams" else tracker.campaigns
                return self.respond(deepcopy(rows[rid])) if rid in rows else self.respond({}, 404)
            return self.respond({}, 404)

    def do_POST(self):
        path, data = urlsplit(self.path).path, self.body()
        with tracker.lock:
            if path == "/__control":
                if "hold_lookups" in data:
                    tracker.lookup_gate.clear() if data[
                        "hold_lookups"
                    ] else tracker.lookup_gate.set()
                tracker.drop_create = data.get("drop_create", tracker.drop_create)
                tracker.drop_update = data.get("drop_update", tracker.drop_update)
                tracker.fail_read_after_update = data.get(
                    "fail_read_after_update", tracker.fail_read_after_update
                )
                if "stream_id" in data:
                    tracker.streams[int(data["stream_id"])]["offers"] = data["offers"]
                return self.respond({"ok": True})
            if self.headers.get("Api-Key") != "e2e-local-key":
                return self.respond({}, 401)
            route = path.removeprefix("/admin_api/v1/")
            if route not in ("campaigns", "streams"):
                return self.respond({}, 404)
            rows = tracker.campaigns if route == "campaigns" else tracker.streams
            rid = max(rows, default=0) + 1
            defaults = {"offers": [], "landings": []} if route == "streams" else {}
            rows[rid] = deepcopy({**defaults, **data, "id": rid})
            tracker.events.append(dict(method="POST", path=route, id=rid, body=data))
            if route == "campaigns" and tracker.drop_create:
                tracker.drop_create = False
                return self.drop_response()
            return self.respond(rows[rid])

    def do_PUT(self):
        path, data = urlsplit(self.path).path, self.body()
        if self.headers.get("Api-Key") != "e2e-local-key":
            return self.respond({}, 401)
        with tracker.lock:
            route = path.removeprefix("/admin_api/v1/")
            parts = route.split("/")
            if len(parts) != 2 or parts[0] not in ("campaigns", "streams"):
                return self.respond({}, 404)
            rows = tracker.campaigns if parts[0] == "campaigns" else tracker.streams
            rid = int(parts[1])
            if rid not in rows:
                return self.respond({}, 404)
            rows[rid].update(deepcopy(data))
            tracker.events.append(dict(method="PUT", path=route, id=rid, body=data))
            if parts[0] == "streams" and tracker.drop_update:
                tracker.drop_update = False
                if tracker.fail_read_after_update:
                    tracker.failed_read_id = rid
                    tracker.fail_read_after_update = False
                return self.drop_response()
            return self.respond(rows[rid])


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="adrobot-e2e-") as directory:
        database_url = "sqlite:///" + str(Path(directory) / "application.db")
        settings = Settings(
            _env_file=None,
            database_url=database_url,
            keitaro_base_url=f"http://127.0.0.1:{TRACKER_PORT}",
            keitaro_api_key="",
            app_mode="live",
            campaign_prefix="test_mukabenov_",
            connection_file=Path(directory) / "connection.json",
        )
        config = Config(str(ROOT / "backend/alembic.ini"))
        config.set_main_option("script_location", str(ROOT / "backend/alembic"))
        # The migration env imports Settings itself; pin it to this test-only instance.
        # Even a user's existing .env or exported key must never enter the harness.
        with patch("adrobot.settings.Settings", return_value=settings):
            command.upgrade(config, "head")
        remote = ThreadingHTTPServer(("127.0.0.1", TRACKER_PORT), Handler)
        Thread(target=remote.serve_forever, daemon=True).start()
        try:
            uvicorn.run(
                create_app(settings=settings),
                host="127.0.0.1",
                port=APP_PORT,
                log_level="warning",
                access_log=False,
            )
        finally:
            remote.shutdown()
            remote.server_close()
