from copy import deepcopy

from fastapi.testclient import TestClient

from adrobot.app import create_app


def stream(client, stream_id=11):
    return next(s for s in client.get("/api/campaigns/7").json()["streams"] if s["id"] == stream_id)


def edit(client, action, offer_id, **fields):
    return client.post(
        "/api/streams/11/edit",
        json=dict(
            expected_revision=stream(client)["revision"], action=action, offer_id=offer_id, **fields
        ),
    )


def test_refresh_reads_independent_remote_resources_concurrently(setup):
    from threading import Barrier

    client, remote, *_ = setup
    gate = Barrier(3, timeout=2)

    def concurrent(method):
        def read(*args):
            gate.wait()
            return method(*args)

        return read

    remote.get_campaign = concurrent(remote.get_campaign)
    remote.list_streams = concurrent(remote.list_streams)
    remote.list_offers = concurrent(remote.list_offers)
    result = client.post("/api/campaigns/7/fetch")
    assert result.status_code == 200
    assert result.json()["name"] == "test_mukabenov_demo"
    assert len(result.json()["streams"]) == 2


def test_add_is_only_local_and_survives_an_application_restart(setup):
    c, remote, settings, db = setup
    assert edit(c, "add", 4).status_code == 200
    assert [o["share"] for o in stream(c)["offers"]] == [25, 25, 25, 25]
    assert len(remote.get_stream(11)["offers"]) == 3
    assert stream(c)["dirty"] is True
    with TestClient(create_app(settings, remote, db)) as restarted:
        assert len(stream(restarted)["offers"]) == 4


def test_cancel_removes_new_link_and_restores_weights_and_pins(setup):
    c, remote, *_ = setup
    edit(c, "pin", 1, share=25)
    edit(c, "add", 4)
    r = c.post("/api/streams/11/cancel", json={"expected_revision": stream(c)["revision"]})
    assert r.status_code == 200
    assert [(o["offer_id"], o["share"], o["pinned"]) for o in stream(c)["offers"]] == [
        (1, 34, False),
        (2, 33, False),
        (3, 33, False),
    ]
    assert not stream(c)["dirty"]


def test_remove_push_archives_link_restore_publishes_without_deleting_global_offer(setup):
    c, remote, *_ = setup
    edit(c, "remove", 2)
    assert stream(c)["offers"][1]["removed"] is True
    assert stream(c)["offers"][1]["share"] == 0
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 200
    )
    assert [o["offer_id"] for o in remote.get_stream(11)["offers"]] == [1, 3]
    assert 2 in remote.offers
    assert stream(c)["offers"][1]["removed"] is True
    edit(c, "restore", 2)
    assert [o["share"] for o in stream(c)["offers"]] == [34, 33, 33]
    c.post("/api/streams/11/push", json={"expected_revision": stream(c)["revision"]})
    assert [o["offer_id"] for o in remote.get_stream(11)["offers"]] == [1, 2, 3]


def test_fetch_archives_external_removal_and_does_not_duplicate_it(setup):
    c, remote, *_ = setup
    remote.streams[11]["offers"] = [dict(offer_id=1, share=100, state="active")]
    c.post("/api/campaigns/7/fetch")
    c.post("/api/campaigns/7/fetch")
    assert [(o["offer_id"], o["removed"], o["share"]) for o in stream(c)["offers"]] == [
        (1, False, 100),
        (2, True, 0),
        (3, True, 0),
    ]
    assert not stream(c)["dirty"]


def test_stale_tab_cannot_overwrite_a_newer_draft(setup):
    c, *_ = setup
    revision = stream(c)["revision"]
    edit(c, "add", 4)
    r = c.post(
        "/api/streams/11/edit", json=dict(expected_revision=revision, action="remove", offer_id=1)
    )
    assert r.status_code == 409
    assert len(stream(c)["offers"]) == 4
    assert not stream(c)["offers"][0]["removed"]


def test_invalid_pin_rolls_back_whole_edit_and_does_not_advance_revision(setup):
    c, *_ = setup
    edit(c, "pin", 1, share=80)
    before = stream(c)
    assert edit(c, "pin", 2, share=30).status_code == 422
    assert stream(c) == before


def test_fetch_does_not_discard_a_pending_draft(setup):
    c, *_ = setup
    edit(c, "add", 4)
    assert c.post("/api/campaigns/7/fetch").status_code == 409
    assert len(stream(c)["offers"]) == 4


def test_push_detects_external_offer_changes_and_preserves_both_sides(setup):
    c, remote, *_ = setup
    edit(c, "add", 4)
    remote.streams[11]["offers"] = [dict(offer_id=5, share=100, state="active")]
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 409
    )
    assert remote.streams[11]["offers"][0]["offer_id"] == 5
    assert len(stream(c)["offers"]) == 4


def test_push_failure_keeps_draft_and_timeout_readback_can_confirm_success(setup):
    c, remote, *_ = setup
    edit(c, "add", 4)
    remote.fail_push = True
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 502
    )
    assert stream(c)["dirty"]
    remote.fail_push = False
    remote.apply_then_timeout = True
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 200
    )
    assert not stream(c)["dirty"]


def test_non_offer_stream_is_preserved_and_cannot_be_edited(setup):
    c, remote, *_ = setup
    before = deepcopy(remote.get_stream(10))
    s = stream(c, 10)
    assert s["editable"] is False
    r = c.post(
        "/api/streams/10/edit", json=dict(expected_revision=s["revision"], action="add", offer_id=1)
    )
    assert r.status_code == 422
    assert remote.get_stream(10) == before


def test_last_offer_can_be_removed_locally_but_not_published(setup):
    c, remote, *_ = setup
    for i in (1, 2, 3):
        assert edit(c, "remove", i).status_code == 200
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 422
    )
    assert len(remote.get_stream(11)["offers"]) == 3


def test_duplicates_deleted_global_offers_and_decimal_pins_are_rejected(setup):
    c, remote, *_ = setup
    assert edit(c, "add", 1).status_code == 422
    remote.offers[4]["state"] = "deleted"
    assert edit(c, "add", 4).status_code == 422
    assert edit(c, "pin", 1, share=2.5).status_code == 422


def test_external_weight_change_clears_pin_on_fetch(setup):
    c, remote, *_ = setup
    edit(c, "pin", 1, share=25)
    c.post("/api/streams/11/push", json={"expected_revision": stream(c)["revision"]})
    remote.streams[11]["offers"][0]["share"] = 30
    c.post("/api/campaigns/7/fetch")
    assert stream(c)["offers"][0]["share"] == 30
    assert stream(c)["offers"][0]["pinned"] is False


def test_edits_are_blocked_during_push_even_in_another_request(setup):
    c, remote, *_ = setup
    edit(c, "add", 4)
    results = []
    remote.before_write = lambda: results.append(edit(c, "remove", 1).status_code)
    c.post("/api/streams/11/push", json={"expected_revision": stream(c)["revision"]})
    assert results == [409]


def test_deleted_remote_stream_preserves_draft_and_can_cancel_then_fetch(setup):
    from adrobot.errors import AppError

    c, remote, *_ = setup
    edit(c, "add", 4)
    original_get = remote.get_stream
    remote.get_stream = lambda sid: (
        (_ for _ in ()).throw(AppError(404, "Gone")) if sid == 11 else original_get(sid)
    )
    del remote.streams[11]
    assert (
        c.post(
            "/api/streams/11/push", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 404
    )
    missing = stream(c)
    assert missing["status"] == "ready" and not missing["available"]
    assert missing["dirty"] and len(missing["offers"]) == 4
    assert (
        c.post(
            "/api/streams/11/cancel", json={"expected_revision": missing["revision"]}
        ).status_code
        == 200
    )
    assert c.post("/api/campaigns/7/fetch").status_code == 200
    assert len(stream(c)["offers"]) == 3


def test_deleted_remote_stream_can_be_resolved_from_uncertain_state(setup):
    from adrobot.errors import AppError
    from adrobot.models import Stream

    c, remote, _, db = setup
    edit(c, "add", 4)
    with db.session.begin() as session:
        session.get(Stream, 11).status = "uncertain"
    remote.get_stream = lambda sid: (_ for _ in ()).throw(AppError(404, "Gone"))
    result = c.post("/api/streams/11/reconcile", json={"expected_revision": stream(c)["revision"]})
    assert result.status_code == 200
    assert result.json()["status"] == "ready"
    assert not result.json()["available"]
    assert result.json()["dirty"] and len(result.json()["offers"]) == 4


def test_fetch_marks_deleted_global_offer_unavailable_without_losing_history(setup):
    c, remote, *_ = setup
    remote.offers[2]["state"] = "deleted"
    remote.streams[11]["offers"] = [dict(offer_id=1, share=100, state="active")]
    assert c.post("/api/campaigns/7/fetch").status_code == 200
    offer = stream(c)["offers"][1]
    assert offer["removed"] and not offer["available"]


def test_push_rechecks_live_campaign_prefix_and_preserves_draft(setup):
    c, remote, *_ = setup
    edit(c, "add", 4)
    before = deepcopy(remote.streams[11])
    remote.campaigns[7]["name"] = "production_campaign"
    response = c.post("/api/streams/11/push", json={"expected_revision": stream(c)["revision"]})
    assert response.status_code == 403
    assert remote.streams[11] == before
    assert stream(c)["dirty"]
    assert stream(c)["status"] == "ready"
    assert (
        c.post(
            "/api/streams/11/cancel", json={"expected_revision": stream(c)["revision"]}
        ).status_code
        == 200
    )


def test_push_rejects_stream_moved_to_another_campaign(setup):
    c, remote, *_ = setup
    edit(c, "add", 4)
    remote.campaigns[8] = dict(remote.campaigns[7], id=8)
    remote.streams[11]["campaign_id"] = 8
    before = deepcopy(remote.streams[11])
    response = c.post("/api/streams/11/push", json={"expected_revision": stream(c)["revision"]})
    assert response.status_code == 409
    assert remote.streams[11] == before
    assert stream(c)["dirty"]
    assert stream(c)["status"] == "ready"


def test_visitor_link_uses_public_alias_and_connected_origin_without_private_fields(setup):
    c, remote, *_ = setup
    remote.campaigns[7].update(
        alias="test_public_123", token="private-secret", url="https://private.invalid/secret"
    )
    c.app.state.editor.gateway.url = "https://tracker.test/admin/"
    listed = c.get("/api/campaigns").json()[0]
    assert listed["visitor_url"] == "https://tracker.test/test_public_123"
    assert "private-secret" not in str(listed) and "private.invalid" not in str(listed)
    refreshed = c.post("/api/campaigns/7/fetch").json()
    assert refreshed["visitor_url"] == listed["visitor_url"]
    assert refreshed["visitor_url_observed_at"] >= listed["visitor_url_observed_at"]
    assert (
        c.get("/api/campaigns/7").json()["visitor_url_observed_at"]
        == refreshed["visitor_url_observed_at"]
    )
    assert c.get("/api/campaigns/7").json()["visitor_url"] == listed["visitor_url"]


def test_visitor_link_rejects_unsafe_alias_origin_and_demo_mode(setup):
    c, remote, *_ = setup
    gateway = c.app.state.editor.gateway
    for alias, origin in [
        ("../admin", "https://tracker.test"),
        ("test_ok", "javascript:alert(1)"),
        ("test_ok", "https://user:secret@tracker.test"),
    ]:
        remote.campaigns[7]["alias"] = alias
        gateway.url = origin
        assert c.get("/api/campaigns").json()[0]["visitor_url"] is None
    gateway.mode = "demo"
    gateway.url = "https://tracker.test"
    assert c.get("/api/campaigns").json()[0]["visitor_url"] is None
