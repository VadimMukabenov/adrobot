import json

import httpx
import pytest

from adrobot.errors import AppError
from adrobot.keitaro import KeitaroGateway


def test_patch_only_sends_offers_and_preserves_header_and_url_contract():
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"id": 11, "offers": json.loads(request.content)["offers"]})

    gateway = KeitaroGateway(
        "https://tracker.example/", "fake-test-key", transport=httpx.MockTransport(handle)
    )
    gateway.update_stream(11, [dict(offer_id=2, share=100, state="active")])
    request = requests[0]
    assert str(request.url) == "https://tracker.example/admin_api/v1/streams/11"
    assert request.headers["Api-Key"] == "fake-test-key"
    assert json.loads(request.content) == {"offers": [dict(offer_id=2, share=100, state="active")]}


def test_auth_errors_never_reveal_upstream_body_or_api_key():
    gateway = KeitaroGateway(
        "https://tracker.example",
        "fake-secret",
        transport=httpx.MockTransport(
            lambda r: httpx.Response(401, text="leaked fake-secret and private request contents")
        ),
    )
    with pytest.raises(AppError) as exc:
        gateway.list_offers()
    assert exc.value.status == 502
    assert "fake-secret" not in exc.value.message
    assert "private request" not in exc.value.message


def test_campaign_pagination_is_not_silently_truncated():
    def handle(request):
        offset = int(request.url.params["offset"])
        return httpx.Response(
            200, json=[{"id": i, "name": f"C{i}"} for i in range(offset, min(offset + 100, 107))]
        )

    gateway = KeitaroGateway(
        "https://tracker.example", "fake", transport=httpx.MockTransport(handle)
    )
    result = gateway.list_campaigns()
    assert len(result) == 107
    assert result[-1]["id"] == 106


def test_offer_search_supports_numeric_id_and_name_and_excludes_archived():
    offers = [
        dict(id=1, name="Blue offer", state="active"),
        dict(id=2, name="Green offer", state="active"),
        dict(id=3, name="Blue archived", state="deleted"),
    ]
    gateway = KeitaroGateway(
        "https://tracker.example",
        "fake",
        transport=httpx.MockTransport(lambda r: httpx.Response(200, json=offers)),
    )
    assert [o["id"] for o in gateway.list_offers("2")] == [2]
    assert [o["id"] for o in gateway.list_offers("blue")] == [1]


def test_missing_configuration_is_clear_and_makes_no_network_request():
    gateway = KeitaroGateway("https://tracker.example", "")
    with pytest.raises(AppError) as exc:
        gateway.list_offers()
    assert exc.value.status == 503
