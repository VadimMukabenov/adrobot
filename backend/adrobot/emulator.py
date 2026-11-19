"""Local HTTP simulator for reviewer acceptance; never connects to real Keitaro."""

import os
import secrets
from html import escape

import pycountry
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from .demo import DemoGateway
from .errors import AppError

# Public synthetic credential, meaningful only inside the isolated emulator network.
EMULATOR_KEY = "adrobot-local-emulator"


def choose_offer(offers, draw=None):
    active = [o for o in offers if o.get("state", "active") == "active" and o["share"] > 0]
    total = sum(o["share"] for o in active)
    if not total:
        return None
    draw = secrets.randbelow(total) if draw is None else draw
    if not 0 <= draw < total:
        raise ValueError("Draw must be within the sum of active weights.")
    for offer in active:
        draw -= offer["share"]
        if draw < 0:
            return offer


def page(title, body):
    return HTMLResponse(
        '<!doctype html><html lang="en"><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)} · Keitaro emulator</title>"
        "<style>body{font:16px system-ui;color:#17223b;background:#f5f8fd;"
        "max-width:720px;margin:8vh auto;padding:24px}main{background:white;"
        "border:1px solid #d7e1f0;border-radius:8px;padding:28px}"
        "select,button{font:inherit;padding:10px;margin:12px 0}select{width:100%}"
        "button{background:#0755df;color:white;border:0;border-radius:5px;cursor:pointer}"
        "small{color:#657087}</style><main><strong>Keitaro emulator</strong>"
        f"<h1>{escape(title)}</h1>{body}</main></html>"
    )


def create_emulator(database_url=None):
    database_url = database_url or os.environ.get(
        "EMULATOR_RESOURCES_DATABASE_URL", "sqlite:///./adrobot-emulator-resources.db"
    )
    gateway = DemoGateway(database_url, "test_mukabenov_")
    app = FastAPI(title="Local Keitaro emulator")
    app.state.database_url = database_url

    @app.exception_handler(AppError)
    async def app_error(_, exc):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message})

    def authorized(api_key: str = Header(default="", alias="Api-Key")):
        if not secrets.compare_digest(api_key, EMULATOR_KEY):
            raise HTTPException(401, "Use the local emulator's synthetic key.")

    auth = [Depends(authorized)]

    @app.get("/api/health")
    def health():
        return {"status": "ok", "mode": "emulator"}

    @app.get("/admin_api/v1/campaigns", dependencies=auth)
    def campaigns(offset: int = 0, limit: int = 100):
        if offset < 0 or not 1 <= limit <= 1000:
            raise HTTPException(422, "Invalid pagination.")
        return gateway.list_campaigns()[offset : offset + limit]

    @app.get("/admin_api/v1/campaigns/{campaign_id}/streams", dependencies=auth)
    def streams(campaign_id: int):
        return gateway.list_streams(campaign_id)

    @app.get("/admin_api/v1/{kind}", dependencies=auth)
    def catalog(kind: str):
        if kind == "offers":
            return gateway.list_offers()
        if kind in ("domains", "groups", "traffic_sources"):
            return gateway.lookups()[kind]
        raise HTTPException(404, "Unknown emulator resource.")

    @app.get("/admin_api/v1/{kind}/{resource_id}", dependencies=auth)
    def resource(kind: str, resource_id: int):
        if kind == "campaigns":
            return gateway.get_campaign(resource_id)
        if kind == "streams":
            return gateway.get_stream(resource_id)
        raise HTTPException(404, "Unknown emulator resource.")

    @app.post("/admin_api/v1/{kind}", dependencies=auth)
    def create(kind: str, payload: dict):
        if kind == "campaigns":
            return gateway.create_campaign(payload)
        if kind == "streams":
            return gateway.create_stream({"offers": [], "landings": [], **payload})
        raise HTTPException(405, "The shared catalog cannot be changed.")

    @app.put("/admin_api/v1/{kind}/{resource_id}", dependencies=auth)
    def update(kind: str, resource_id: int, payload: dict):
        if kind not in ("campaigns", "streams"):
            raise HTTPException(405, "The shared catalog cannot be changed.")
        return gateway._update(kind, resource_id, payload)

    @app.get("/{alias}")
    def visitor(alias: str, country: str | None = None):
        campaign = next(
            (
                c
                for c in gateway.list_campaigns()
                if c.get("alias") == alias and c.get("state") == "active"
            ),
            None,
        )
        if campaign is None:
            raise HTTPException(404, "No active emulator campaign at this address.")
        if country is None:
            options = "".join(
                f'<option value="{c.alpha_2}">{escape(c.name)} ({c.alpha_2})</option>'
                for c in sorted(pycountry.countries, key=lambda c: c.name)
            )
            return page(
                campaign["name"],
                "<p>Choose a visitor country to test this campaign. "
                "This simulator uses your choice, not your IP or VPN.</p>"
                '<form method="get"><label for="country">Visitor country</label>'
                f'<select name="country" id="country">{options}</select>'
                '<button type="submit">Open as visitor</button></form>'
                "<small>Matching country → Google. Other countries → an offer "
                "chosen using the published weights.</small>",
            )
        country = country.strip().upper()
        if pycountry.countries.get(alpha_2=country) is None:
            raise HTTPException(422, "Select a valid visitor country.")
        ordered = sorted(gateway.list_streams(campaign["id"]), key=lambda s: s["position"])
        for stream in ordered:
            if stream.get("state", "active") != "active":
                continue
            if stream.get("schema") == "redirect":
                if any(
                    f.get("name") == "country"
                    and f.get("mode") == "accept"
                    and country in f.get("payload", [])
                    for f in stream.get("filters", [])
                ):
                    return RedirectResponse(stream["action_payload"], status_code=302)
                continue
            selected = choose_offer(stream.get("offers", []))
            if selected:
                offer = next(
                    (o for o in gateway.list_offers() if o["id"] == selected["offer_id"]), None
                )
                if offer:
                    name = escape(offer["name"])
                    return page(
                        f"Test offer {offer['id']}",
                        f"<h2>{name}</h2><p>Visitor country: {escape(country)}</p>"
                        "<p>This is a sample destination. No real ad or lead is sent.</p>"
                        '<a href="?">Choose another country</a>',
                    )
        raise HTTPException(409, "This campaign has no active destination for that country.")

    return app
