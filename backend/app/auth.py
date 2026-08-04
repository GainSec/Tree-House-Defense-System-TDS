from fastapi import Header, HTTPException, Request, status


def require_ingest_api_key(request: Request, x_tds_api_key: str | None = Header(default=None)) -> None:
    expected = request.app.state.settings.ingest_api_key
    if not expected or x_tds_api_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid ingest API key")
