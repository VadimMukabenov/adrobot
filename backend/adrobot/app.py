from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .creator import Creator
from .db import Database
from .editor import Editor
from .errors import AppError
from .schemas import CreateCampaign, Edit, Revision
from .settings import Settings


def create_app(settings=None, gateway=None, db=None):
    settings = settings or Settings()
    db = db or Database(settings.database_url)
    if gateway is None:
        from .keitaro import KeitaroGateway

        gateway = KeitaroGateway(
            settings.keitaro_base_url, settings.keitaro_api_key.get_secret_value()
        )
    editor = Editor(db, gateway, settings.campaign_prefix)
    creator = Creator(db, gateway, settings.campaign_prefix)
    app = FastAPI(title="Adrobot", version="0.1.0")
    app.state.db, app.state.editor = db, editor

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message})

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "configured": bool(settings.keitaro_api_key.get_secret_value()),
            "campaign_prefix": settings.campaign_prefix,
        }

    @app.get("/api/campaigns")
    def campaigns():
        return editor.list_campaigns()

    @app.post("/api/campaigns")
    def create(body: CreateCampaign):
        result = creator.create(body)
        return JSONResponse(
            status_code=200 if result["status"] == "confirmed" else 202, content=result
        )

    @app.get("/api/operations/{operation_id}")
    def operation(operation_id: str):
        return creator.operation(operation_id)

    @app.get("/api/campaigns/{campaign_id}")
    def campaign(campaign_id: int):
        return editor.campaign(campaign_id)

    @app.post("/api/campaigns/{campaign_id}/fetch")
    def fetch(campaign_id: int):
        return editor.fetch(campaign_id)

    @app.get("/api/offers")
    def offers(q: str = ""):
        return editor.offers(q[:200])

    @app.get("/api/lookups")
    def lookups():
        return gateway.lookups()

    @app.post("/api/streams/{stream_id}/edit")
    def edit(stream_id: int, body: Edit):
        return editor.edit(stream_id, body)

    @app.post("/api/streams/{stream_id}/cancel")
    def cancel(stream_id: int, body: Revision):
        return editor.cancel(stream_id, body.expected_revision)

    @app.post("/api/streams/{stream_id}/push")
    def push(stream_id: int, body: Revision):
        return editor.push(stream_id, body.expected_revision)

    @app.post("/api/streams/{stream_id}/reconcile")
    def reconcile(stream_id: int, body: Revision):
        return editor.reconcile(stream_id, body.expected_revision)

    frontend = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if frontend.is_dir():
        app.mount("/", StaticFiles(directory=frontend, html=True), name="frontend")
    return app
