from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from .connection import Connection, ConnectionInput
from .creator import Creator
from .db import Database
from .editor import Editor
from .errors import AppError
from .schemas import CreateCampaign, Edit, Revision
from .settings import Settings


def create_app(settings=None, gateway=None, db=None):
    settings = settings or Settings()
    db = db or Database(settings.database_url)
    gateway = Connection(settings, gateway)
    editor = Editor(db, gateway, settings.campaign_prefix)
    creator = Creator(db, gateway, settings.campaign_prefix)
    app = FastAPI(title="Adrobot", version="0.1.0")
    app.state.db, app.state.editor = db, editor

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        if request.url.path == "/api/connection":
            # FastAPI's default validation errors may echo the entire input body.
            return JSONResponse(
                status_code=422,
                content={"detail": "Enter the Keitaro URL and Admin API key in the setup form."},
            )
        return await request_validation_exception_handler(request, exc)

    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message})

    @app.middleware("http")
    async def require_connection(request: Request, call_next):
        if (
            request.url.path.startswith("/api/")
            and request.url.path not in ("/api/health", "/api/connection")
            and not gateway.configured
        ):
            return JSONResponse(
                status_code=503,
                content={"detail": "Connect to Keitaro using the setup page first."},
            )
        return await call_next(request)

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "mode": settings.app_mode,
            "configured": gateway.configured,
            "campaign_prefix": settings.campaign_prefix,
        }

    @app.get("/api/connection")
    def connection(request: Request):
        return JSONResponse(content=gateway.public(request), headers={"Cache-Control": "no-store"})

    @app.post("/api/connection")
    def connect(body: ConnectionInput, request: Request):
        return gateway.connect(body, request)

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
