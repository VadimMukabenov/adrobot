import logging
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit

import httpx

from .errors import AppError

logger = logging.getLogger(__name__)


class KeitaroGateway:
    def __init__(self, base_url: str, api_key: str, transport=None):
        parsed = urlsplit(base_url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username:
            raise ValueError("Keitaro URL must be an HTTP(S) origin without credentials.")
        self.base_url = base_url.rstrip("/") + "/admin_api/v1/"
        self._api_key, self._transport = api_key, transport
        self._snapshots = {}
        self._snapshot_lock = Lock()
        self._client = httpx.Client(
            base_url=self.base_url,
            headers={"Api-Key": self._api_key},
            timeout=httpx.Timeout(20, connect=10),
            # Live HTTPX probes lost replies on reused tracker connections;
            # fresh connections completed with the same headers and timeout.
            # Keep client configuration shared, but do not retain idle sockets.
            limits=httpx.Limits(max_keepalive_connections=0),
            transport=self._transport,
            follow_redirects=False,
        )

    def close(self):
        self._client.close()

    def request(self, method, path, **kwargs):
        if not self._api_key:
            raise AppError(
                503, "Set KEITARO_API_KEY in the server environment before using Keitaro."
            )
        read_only = method.upper() == "GET"
        attempts = 2 if read_only else 1
        try:
            for attempt in range(attempts):
                try:
                    response = self._client.request(method, path, **kwargs)
                    break
                except httpx.TransportError as error:
                    # Never log headers, response bodies or exception text containing secrets.
                    logger.warning(
                        "Keitaro %s transport failure: %s (attempt %d/%d)",
                        method.upper(),
                        type(error).__name__,
                        attempt + 1,
                        attempts,
                    )
                    if attempt + 1 == attempts:
                        raise
        except httpx.HTTPError as error:
            if not read_only:
                message = "Keitaro connection failed or timed out. Check the remote state."
            elif isinstance(error, httpx.TimeoutException):
                message = "Keitaro timed out. Check the Adrobot server's network/VPN and try again."
            else:
                message = (
                    "Cannot reach Keitaro from the Adrobot server. "
                    "Check its network, DNS/VPN and the tracker URL, then try again."
                )
            raise AppError(502, message) from None
        if response.status_code == 404:
            raise AppError(404, "The requested Keitaro resource is unavailable.")
        if response.status_code in (401, 403):
            raise AppError(502, "Keitaro denied access. Check the server API key and permissions.")
        if not 200 <= response.status_code < 300:
            raise AppError(
                502, f"Keitaro returned HTTP {response.status_code}. No success is assumed."
            )
        try:
            return response.json()
        except ValueError:
            raise AppError(502, "Keitaro returned an invalid JSON response.") from None

    def list_campaigns(self):
        result = []
        for offset in range(0, 100_000, 100):
            batch = self.request("GET", "campaigns", params={"offset": offset, "limit": 100})
            if not isinstance(batch, list):
                raise AppError(502, "Unexpected campaign list response.")
            result.extend(batch)
            if len(batch) < 100:
                return result
        raise AppError(502, "Campaign pagination limit reached; result was not silently truncated.")

    def get_campaign(self, campaign_id):
        return self.request("GET", f"campaigns/{campaign_id}")

    def list_streams(self, campaign_id):
        return self.request("GET", f"campaigns/{campaign_id}/streams")

    def get_stream(self, stream_id):
        return self.request("GET", f"streams/{stream_id}")

    def _remember(self, name, value, started):
        with self._snapshot_lock:
            self._snapshots[name] = (started + 60, deepcopy(value))

    def _recent(self, name):
        with self._snapshot_lock:
            snapshot = self._snapshots.get(name)
            if snapshot is not None and monotonic() < snapshot[0]:
                return deepcopy(snapshot[1])
            return None

    def creation_lookups(self):
        snapshot = self._recent("lookups")
        return snapshot if snapshot is not None else self.lookups()

    def creation_offers(self, query=""):
        snapshot = self._recent("offers")
        if snapshot is not None:
            return self._filter_offers(snapshot, query)
        return self.list_offers(query)

    @staticmethod
    def _filter_offers(offers, query):
        query = query.strip().casefold()
        return [
            o for o in offers
            if not query or query == str(o["id"]) or query in o["name"].casefold()
        ]

    def list_offers(self, query=""):
        started = monotonic()
        offers = [
            dict(id=int(o["id"]), name=o["name"], state=o.get("state", "active"))
            for o in self.request("GET", "offers")
            if o.get("state", "active") == "active"
        ]
        self._remember("offers", offers, started)
        return self._filter_offers(offers, query)

    def lookups(self):
        started = monotonic()
        paths = [
            ("domains", "domains"),
            ("groups", "groups?type=campaigns"),
            ("traffic_sources", "traffic_sources"),
        ]
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda pair: self.request("GET", pair[1]), paths))
        lookups = {
            name: [
                dict(id=int(x["id"]), name=x["name"])
                for x in rows
                if x.get("state", "active") == "active"
            ]
            for (name, _), rows in zip(paths, results, strict=True)
        }
        self._remember("lookups", lookups, started)
        return lookups

    def update_stream(self, stream_id, offers):
        # Do not echo a GET payload: that could overwrite unrelated settings or send read-only IDs.
        return self.request("PUT", f"streams/{stream_id}", json={"offers": offers})

    def create_campaign(self, payload):
        return self.request("POST", "campaigns", json=payload)

    def update_campaign(self, campaign_id, payload):
        return self.request("PUT", f"campaigns/{campaign_id}", json=payload)

    def create_stream(self, payload):
        return self.request("POST", "streams", json=payload)
