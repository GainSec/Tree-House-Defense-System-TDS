from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, RedirectResponse, Response

STATIC_DIR = Path(__file__).resolve().parents[1] / "static"

router = APIRouter(include_in_schema=False)


@router.get("/")
def dashboard_root() -> RedirectResponse:
    return RedirectResponse(url="/dashboard", status_code=307)


@router.get("/dashboard")
def dashboard_ui() -> Response:
    return frontend_ui()


@router.get("/lte")
def lte_ui() -> Response:
    return frontend_ui()


@router.get("/vr")
@router.get("/mr")
@router.get("/xr")
def xr_ui() -> Response:
    return frontend_ui()


@router.get("/settings")
def settings_ui() -> Response:
    return frontend_ui()


@router.get("/setting")
def setting_alias_ui() -> Response:
    return frontend_ui()


@router.get("/presence")
def presence_ui() -> Response:
    return frontend_ui()


@router.get("/presence/graph")
def presence_graph_ui() -> Response:
    return frontend_ui()


@router.get("/presence/entities/{entity_key:path}")
def presence_entity_ui(entity_key: str) -> Response:
    return frontend_ui()


def frontend_ui() -> Response:
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return Response(
        "TDS V3 frontend has not been built yet.\n",
        status_code=503,
        media_type="text/plain",
    )


@router.get("/favicon.ico")
def favicon() -> Response:
    favicon_path = STATIC_DIR / "favicon.ico"
    if favicon_path.exists():
        return FileResponse(favicon_path, media_type="image/x-icon")
    return Response(status_code=204)
