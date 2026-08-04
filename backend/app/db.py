from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool
from starlette.requests import Request

from app.settings import Settings


def make_engine(database_url: str) -> Engine:
    if database_url == "sqlite+pysqlite:///:memory:":
        return create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
            future=True,
        )
    return create_engine(database_url, future=True)


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def configure_database(settings: Settings) -> tuple[Engine, sessionmaker[Session]]:
    engine = make_engine(settings.database_url)
    return engine, make_session_factory(engine)


def get_session(request: Request) -> Iterator[Session]:
    SessionLocal = request.app.state.SessionLocal
    with SessionLocal() as session:
        yield session
