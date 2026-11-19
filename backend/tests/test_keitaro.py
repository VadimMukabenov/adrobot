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


def test_transient_get_network_failure_is_retried_once():
    calls = []

    def handle(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ConnectTimeout("temporary connection problem with fake-secret")
        return httpx.Response(200, json=[])

    gateway = KeitaroGateway(
        "https://tracker.example", "fake-secret", transport=httpx.MockTransport(handle)
    )
    assert gateway.list_campaigns() == []
    assert len(calls) == 2


@pytest.mark.parametrize("method", ["POST", "PUT", "DELETE"])
def test_remote_writes_are_never_automatically_retried(method):
    calls = []

    def handle(request):
        calls.append(request)
        raise httpx.ReadTimeout("response lost after write; fake-secret")

    gateway = KeitaroGateway(
        "https://tracker.example", "fake-secret", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(AppError) as exc:
        gateway.request(method, "campaigns", json={"name": "test_demo"})
    assert len(calls) == 1
    assert "remote state" in exc.value.message.lower()
    assert "fake-secret" not in exc.value.message


@pytest.mark.parametrize(
    ("error", "explanation"),
    [
        (httpx.ConnectError, "network"),
        (httpx.ReadTimeout, "timed out"),
    ],
)
def test_persistent_get_failure_has_bounded_retries_and_clear_safe_error(
    error, explanation, caplog
):
    calls = []

    def handle(request):
        calls.append(request)
        raise error("internal transport detail with fake-secret")

    gateway = KeitaroGateway(
        "https://tracker.example", "fake-secret", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(AppError) as exc:
        gateway.request("GET", "campaigns", params={"limit": 1})
    assert len(calls) == 2
    assert explanation in exc.value.message.lower()
    assert "remote state" not in exc.value.message.lower()
    assert "fake-secret" not in exc.value.message
    assert "internal transport detail" not in exc.value.message
    assert "fake-secret" not in caplog.text
    assert "internal transport detail" not in caplog.text
    assert "attempt 2/2" in caplog.text


def test_access_denied_is_not_retried():
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(403, text="fake-secret")

    gateway = KeitaroGateway(
        "https://tracker.example", "fake-secret", transport=httpx.MockTransport(handle)
    )
    with pytest.raises(AppError):
        gateway.request("GET", "campaigns")
    assert len(calls) == 1
