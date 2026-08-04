from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from app.db import configure_database
from app.models import Base
from app.routes.control import router as control_router
from app.routes.dashboard import router as dashboard_router
from app.routes.events import router as events_router
from app.routes.inventory import router as inventory_router
from app.routes.lte import router as lte_router
from app.routes.map import router as map_router
from app.routes.observations import router as observations_router
from app.routes.presence import router as presence_router
from app.routes.state import router as state_router
from app.routes.ui import router as ui_router
from app.routes.webhooks import router as webhooks_router
from app.settings import Settings

STATIC_DIR = Path(__file__).resolve().parent / "static"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine, SessionLocal = configure_database(settings)
    Base.metadata.create_all(engine)

    app = FastAPI(title="TDS Backend", version="0.1.0")
    app.state.settings = settings
    app.state.engine = engine
    app.state.SessionLocal = SessionLocal

    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    app.include_router(ui_router)
    app.include_router(control_router)
    app.include_router(observations_router)
    app.include_router(events_router)
    app.include_router(inventory_router)
    app.include_router(lte_router)
    app.include_router(map_router)
    app.include_router(presence_router)
    app.include_router(dashboard_router)
    app.include_router(state_router)
    app.include_router(webhooks_router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    def ready() -> dict:
        components = {"database": "ok", "mqtt": "disabled" if not settings.mqtt_enabled else "configured"}
        try:
            with engine.connect() as conn:
                conn.execute(text("select 1"))
        except Exception:
            components["database"] = "error"
        status = "ready" if components["database"] == "ok" else "degraded"
        return {"status": status, "components": components}

    return app
