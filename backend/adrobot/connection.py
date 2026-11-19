"""One-time, local-browser setup. Saved secrets never enter API responses."""

import json
import os
import secrets
import tempfile
from pathlib import Path
from threading import Lock
from urllib.parse import urlsplit

from fastapi import Request
from pydantic import BaseModel, SecretStr
from sqlalchemy.engine import make_url

from .demo import DemoGateway
from .errors import AppError
from .keitaro import KeitaroGateway


class ConnectionInput(BaseModel):
    url: str
    api_key: SecretStr


def tracker_origin(value: str) -> str:
    try:
        value = value.strip()
        parsed = urlsplit(value)
        host = (parsed.hostname or "").rstrip(".").lower()
        port = parsed.port
        if (
            parsed.scheme not in ("http", "https")
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or any(c.isspace() for c in value)
        ):
            raise ValueError
        if any(
            host == suffix or host.endswith("." + suffix)
            for suffix in ("example", "example.com", "example.org", "example.net", "invalid")
        ):
            raise ValueError
        authority = f"[{host}]" if ":" in host else host
        return f"{parsed.scheme}://{authority}" + (f":{port}" if port else "")
    except ValueError:
        raise AppError(
            422, "Enter a real HTTP(S) Keitaro URL, such as https://tlgk.host/admin/."
        ) from None


class Connection:
    def __init__(self, settings, gateway=None):
        self.mode = settings.app_mode
        if self.mode == "demo":
            # Select the local boundary before touching any saved or environment secret.
            self.url = "local://demo"
            self.gateway = DemoGateway(settings.demo_database_url, settings.campaign_prefix)
            return
        database = make_url(settings.database_url).database
        self.path = settings.connection_file or (
            Path(database).resolve().parent / "keitaro.json"
            if database and settings.database_url.startswith("sqlite:")
            else Path("keitaro.json").resolve()
        )
        self.lock = Lock()
        self.token = secrets.token_urlsafe(32)
        self.url = settings.keitaro_base_url
        key = settings.keitaro_api_key.get_secret_value()
        if not key and gateway is None and self.path.is_file():
            try:
                saved = json.loads(self.path.read_text())
                self.url, key = tracker_origin(saved["url"]), saved["api_key"]
                if not isinstance(key, str) or not key.strip():
                    raise ValueError
            except (ValueError, KeyError, TypeError):
                raise RuntimeError(
                    "Saved Keitaro connection is invalid; see docs/usage.md."
                ) from None
        self.gateway = gateway or (KeitaroGateway(self.url, key) if key else None)

    @property
    def configured(self):
        return self.gateway is not None

    def close(self):
        close = getattr(self.gateway, "close", None)
        if close is not None:
            close()

    def local_request(self, request: Request):
        if request.url.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise AppError(403, "Open setup through http://127.0.0.1:8765/.")

    def public(self, request: Request):
        self.local_request(request)
        return {
            "configured": self.configured,
            "mode": self.mode,
            "url": self.url,
            **({"setup_token": self.token} if not self.configured else {}),
        }

    def connect(self, body: ConnectionInput, request: Request):
        self.local_request(request)
        if self.configured:
            raise AppError(409, "Keitaro is already connected. Reload Adrobot.")
        if (
            request.headers.get("origin") != str(request.base_url).rstrip("/")
            or request.headers.get("sec-fetch-site") == "cross-site"
            or not secrets.compare_digest(request.headers.get("x-setup-token", ""), self.token)
        ):
            raise AppError(403, "Reload Adrobot and connect from its setup page.")
        with self.lock:
            if self.configured:
                raise AppError(409, "Keitaro is already connected. Reload Adrobot.")
            url = tracker_origin(body.url)
            key = body.api_key.get_secret_value().strip()
            if not key or len(key) > 4096 or any(not 32 <= ord(c) < 127 for c in key):
                raise AppError(422, "Paste the Admin API key from Keitaro → Account → API keys.")
            candidate = KeitaroGateway(url, key)
            # Read-only, bounded connection check; never creates/updates remote resources.
            try:
                result = candidate.request("GET", "campaigns", params={"limit": 1})
                if not isinstance(result, list):
                    raise AppError(502, "Keitaro returned an unexpected campaign response.")
            except BaseException:
                candidate.close()
                raise
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".keitaro-")
            try:
                with os.fdopen(fd, "w") as file:
                    json.dump({"url": url, "api_key": key}, file)
                    file.flush()
                    os.fsync(file.fileno())
                os.replace(temporary, self.path)
            except OSError:
                candidate.close()
                raise AppError(
                    500, "Could not save connection. Check the server data volume permissions."
                ) from None
            finally:
                Path(temporary).unlink(missing_ok=True)
            self.url, self.gateway = url, candidate
            return {"configured": True, "url": url, "mode": self.mode}

    def __getattr__(self, name):
        if self.gateway is None:
            raise AppError(503, "Connect to Keitaro using the setup page first.")
        return getattr(self.gateway, name)
