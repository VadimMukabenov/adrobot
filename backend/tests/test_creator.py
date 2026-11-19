import pytest


def body(**overrides):
    return dict(
        name="test_mukabenov_new",
        country="AU",
        offer_id=1,
        domain_id=1,
        group_id=2,
        traffic_source_id=3,
        operation_id="test-operation-1234",
        **overrides,
    )


def test_creation_checks_independent_dependencies_concurrently_before_any_write(setup):
    from threading import Barrier

    client, remote, *_ = setup
    gate = Barrier(2, timeout=2)
    lookups, offers = remote.lookups, remote.list_offers

    def blocked_lookups():
        gate.wait()
        return lookups()

    def blocked_offers(query=""):
        gate.wait()
        return offers(query)

    remote.lookups, remote.list_offers = blocked_lookups, blocked_offers
    result = client.post("/api/campaigns", json=body())
    assert result.status_code == 200
    assert result.json()["status"] == "confirmed"
    assert len(remote.campaigns) == 2


def test_fresh_creation_does_not_wait_for_unrelated_campaign_pagination(setup):
    client, remote, *_ = setup

    def unavailable_index():
        raise TimeoutError("campaign index is slow or unavailable")

    remote.list_campaigns = unavailable_index
    response = client.post("/api/campaigns", json=body())
    assert response.status_code == 200
    assert response.json()["status"] == "confirmed"


def test_browser_creation_streams_progress_and_only_finishes_after_confirmation(setup):
    import json

    client, remote, *_ = setup
    response = client.post(
        "/api/campaigns", json=body(), headers={"Accept": "application/x-ndjson"}
    )
    assert response.headers["content-type"].startswith("application/x-ndjson")
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[0]["type"] == "progress"
    assert events[0]["operation"]["phase"] == "validating_settings"
    assert events[-1]["type"] == "result"
    operation = events[-1]["operation"]
    assert operation["status"] == "confirmed"
    assert remote.get_campaign(operation["campaign_id"])["state"] == "active"


def test_progress_is_immediate_and_browser_disconnect_does_not_cancel_remote_write(setup):
    import json
    from threading import Event
    from time import monotonic

    from adrobot.creation_progress import CreationProgress
    from adrobot.creator import Creator
    from adrobot.schemas import CreateCampaign

    _, remote, settings, db = setup
    entered, release = Event(), Event()
    original = remote.lookups

    def slow_lookups():
        entered.set()
        assert release.wait(3)
        return original()

    remote.lookups = slow_lookups
    creator = Creator(db, remote, settings.campaign_prefix)
    progress = CreationProgress(creator)
    events = progress.events(CreateCampaign(**body()))
    started = monotonic()
    first = json.loads(next(events))
    assert monotonic() - started < 1
    assert first["operation"]["phase"] == "validating_settings"
    assert not entered.is_set()
    try:
        next(events)
        assert entered.wait(1)
        events.close()
    finally:
        release.set()
        progress.close()
    assert creator.operation(body()["operation_id"])["status"] == "confirmed"
    assert len(remote.campaigns) == 2


def test_stream_validation_error_does_not_claim_success_or_create_remote_resources(setup):
    import json

    client, remote, *_ = setup
    invalid = body()
    invalid["domain_id"] = 999
    response = client.post(
        "/api/campaigns", json=invalid, headers={"Accept": "application/x-ndjson"}
    )
    events = [json.loads(line) for line in response.text.splitlines()]
    assert events[-1]["type"] == "error"
    assert events[-1]["status"] == 422
    assert not any(event["type"] == "result" for event in events)
    assert len(remote.campaigns) == 1


def test_lost_remote_response_is_not_hidden_by_progress_and_retry_keeps_identity(setup):
    import json

    client, remote, *_ = setup
    remote.campaign_timeout_once = True
    headers = {"Accept": "application/x-ndjson"}
    first = client.post("/api/campaigns", json=body(), headers=headers)
    uncertain = json.loads(first.text.splitlines()[-1])["operation"]
    assert uncertain["status"] == "uncertain"
    second = client.post("/api/campaigns", json=body(), headers=headers)
    confirmed = json.loads(second.text.splitlines()[-1])["operation"]
    assert confirmed["status"] == "confirmed"
    assert confirmed["operation_id"] == uncertain["operation_id"]
    assert len(remote.campaigns) == 2


def test_creator_sets_metadata_and_two_ordered_streams_and_confirms_active(setup):
    c, remote, *_ = setup
    response = c.post("/api/campaigns", json=body())
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "confirmed"
    campaign = remote.get_campaign(result["campaign_id"])
    assert (campaign["domain_id"], str(campaign["group_id"]), campaign["traffic_source_id"]) == (
        1,
        "2",
        3,
    )
    assert campaign["type"] == "position"
    assert campaign["state"] == "active"
    streams = remote.list_streams(campaign["id"])
    assert len(streams) == 2
    assert streams[0]["position"] == 1
    assert streams[0]["filters"] == [dict(name="country", mode="accept", payload=["AU"])]
    assert streams[0]["action_options"]["url"] == "https://www.google.com/"
    assert streams[1]["offers"] == [dict(offer_id=1, share=100, state="active")]


def test_same_creation_operation_is_idempotent_and_mismatched_input_is_rejected(setup):
    c, remote, *_ = setup
    first = c.post("/api/campaigns", json=body()).json()
    second = c.post("/api/campaigns", json=body()).json()
    assert first["campaign_id"] == second["campaign_id"]
    assert len(remote.campaigns) == 2
    changed = body()
    changed["country"] = "CA"
    assert c.post("/api/campaigns", json=changed).status_code == 409


def test_lost_creation_response_reconciles_by_alias_without_duplicate_campaign(setup):
    c, remote, *_ = setup
    remote.campaign_timeout_once = True
    result = c.post("/api/campaigns", json=body())
    assert result.status_code == 202
    assert result.json()["status"] == "uncertain"
    assert remote.get_campaign(8)["state"] == "disabled"
    recovered = c.post("/api/campaigns", json=body())
    assert recovered.status_code == 200
    assert "message" not in recovered.json()
    assert len(remote.campaigns) == 2
    assert len(remote.list_streams(8)) == 2


def test_partial_creation_stays_disabled_and_retry_does_not_duplicate_first_stream(setup):
    c, remote, *_ = setup
    remote.fail_second_stream = True
    assert c.post("/api/campaigns", json=body()).status_code == 202
    assert remote.get_campaign(8)["state"] == "disabled"
    assert len(remote.list_streams(8)) == 1
    remote.fail_second_stream = False
    assert c.post("/api/campaigns", json=body()).status_code == 200
    assert len(remote.list_streams(8)) == 2


def test_creator_rejects_non_test_names_and_unknown_metadata_before_any_remote_write(setup):
    c, remote, *_ = setup
    for field, value in [("name", "production"), ("domain_id", 999), ("country", "XX")]:
        invalid = body()
        invalid[field] = value
        assert c.post("/api/campaigns", json=invalid).status_code == 422
    assert len(remote.campaigns) == 1


def test_resume_retains_operation_if_offer_becomes_unavailable(setup):
    c, remote, *_ = setup
    remote.campaign_timeout_once = True
    assert c.post("/api/campaigns", json=body()).status_code == 202
    remote.offers[1]["state"] = "deleted"
    retry = c.post("/api/campaigns", json=body())
    assert retry.status_code == 202
    assert retry.json()["operation_id"] == body()["operation_id"]
    assert retry.json()["status"] == "uncertain"
    assert len(remote.campaigns) == 2
    remote.offers[1]["state"] = "active"
    assert c.post("/api/campaigns", json=body()).status_code == 200
    assert len(remote.campaigns) == 2


@pytest.mark.parametrize(
    "change",
    [
        "disabled",
        "type",
        "position",
        "extra_filter",
        "fallback_landing",
        "fallback_disabled",
        "fallback_type",
        "fallback_schema",
    ],
)
def test_resume_never_activates_modified_routing(setup, change):
    c, remote, *_ = setup
    remote.fail_second_stream = True
    assert c.post("/api/campaigns", json=body()).status_code == 202
    remote.fail_second_stream = False
    country = remote.streams[12]
    if change.startswith("fallback"):
        remote.create_stream(
            dict(
                campaign_id=8,
                name="Offers",
                type="default",
                position=2,
                schema="landings",
                action_type="http",
                state="active",
                filters=[],
                landings=[],
                offers=[dict(offer_id=1, share=100, state="active")],
            )
        )
        fallback = remote.streams[13]
        if change == "fallback_landing":
            fallback["landings"] = [dict(landing_id=5, share=100, state="active")]
        elif change == "fallback_disabled":
            fallback["state"] = "disabled"
        elif change == "fallback_type":
            fallback["type"] = "regular"
        else:
            fallback["schema"] = "redirect"
    elif change == "extra_filter":
        country["filters"].append(dict(name="device_type", mode="accept", payload=["mobile"]))
    else:
        field, value = {
            "disabled": ("state", "disabled"),
            "type": ("type", "default"),
            "position": ("position", 3),
        }[change]
        country[field] = value
    assert c.post("/api/campaigns", json=body()).status_code == 202
    assert remote.get_campaign(8)["state"] == "disabled"
