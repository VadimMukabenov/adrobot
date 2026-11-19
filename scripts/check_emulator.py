"""Acceptance against actual running app and tracker containers (synthetic key only)."""

import json
import os
import sys
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

app = os.environ.get("EMULATOR_APP_ADDRESS", "http://127.0.0.1:8767")
tracker = os.environ.get("EMULATOR_TRACKER_ADDRESS", "http://127.0.0.1:8768")
snapshot = Path(os.environ.get("EMULATOR_SMOKE_SNAPSHOT", "/tmp/adrobot-emulator-smoke.json"))


def call(base, path, method="GET", payload=None):
    request = Request(
        base + path,
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json", "Api-Key": "adrobot-local-emulator"},
    )
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def remote(stream_id):
    return call(tracker, f"/admin_api/v1/streams/{stream_id}")


def check_recreated():
    expected = json.loads(snapshot.read_text())
    campaign = call(app, f"/api/campaigns/{expected['id']}")
    assert campaign == expected["local"], "Application draft/pins must survive recreation"
    assert remote(expected["sid"]) == expected["remote"], "HTTP tracker must persist independently"
    assert call(app, "/api/connection")["mode"] == "emulator"
    print("Container recreation preserved both HTTP tracker resources and application drafts.")


def check_fresh():
    assert call(app, "/api/health")["mode"] == "emulator"
    assert call(app, "/api/connection")["configured"]
    assert len(call(app, "/api/offers")) == 4
    operation = call(
        app,
        "/api/campaigns",
        "POST",
        {
            "name": "test_mukabenov_http_smoke_" + uuid.uuid4().hex[:8],
            "country": "NL",
            "offer_id": 1,
            "domain_id": 1,
            "group_id": 2,
            "traffic_source_id": 3,
            "operation_id": uuid.uuid4().hex,
        },
    )
    assert operation["status"] == "confirmed"
    cid = operation["campaign_id"]
    campaign = call(app, f"/api/campaigns/{cid}/fetch", "POST")
    assert campaign["visitor_url"].startswith(tracker + "/")
    routing = next(s for s in campaign["streams"] if not s["editable"])
    route_before = remote(routing["id"])
    sid = next(s["id"] for s in campaign["streams"] if s["editable"])

    def current():
        return next(s for s in call(app, f"/api/campaigns/{cid}")["streams"] if s["id"] == sid)

    def edit(action, offer_id, **extra):
        return call(
            app,
            f"/api/streams/{sid}/edit",
            "POST",
            {
                "expected_revision": current()["revision"],
                "action": action,
                "offer_id": offer_id,
                **extra,
            },
        )

    def publish():
        call(
            app,
            f"/api/streams/{sid}/push",
            "POST",
            {
                "expected_revision": current()["revision"],
            },
        )

    edit("add", 2)
    edit("add", 3)
    edit("pin", 1, share=25)
    edit("add", 4)
    assert len(remote(sid)["offers"]) == 1, "Local edits must not publish automatically"
    publish()
    assert [o["share"] for o in remote(sid)["offers"]] == [25, 25, 25, 25]
    edit("remove", 4)
    publish()
    assert [o["share"] for o in remote(sid)["offers"]] == [25, 38, 37]
    edit("restore", 4)
    publish()
    assert [o["share"] for o in remote(sid)["offers"]] == [25, 25, 25, 25]
    assert remote(routing["id"]) == route_before
    assert len(call(app, "/api/offers")) == 4
    # Leave a distinct unpublished draft as well as persisted remote state.
    edit("remove", 4)
    local = call(app, f"/api/campaigns/{cid}")
    snapshot.write_text(json.dumps({"id": cid, "sid": sid, "local": local, "remote": remote(sid)}))
    print(
        "HTTP creation, four offers, pin, remove/restore, verified publication and draft checked."
    )


if __name__ == "__main__":
    check_recreated() if "--recreated" in sys.argv else check_fresh()
