import csv
import gzip
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TextIO

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import AircraftMetadata

ICAO_RE = re.compile(r"^[0-9a-f]{6}$")
DEFAULT_IMPORT_BATCH_SIZE = 5000


def normalize_icao_hex(value: Any) -> str | None:
    text = "" if value is None else str(value).strip().lower()
    if text.startswith("0x"):
        text = text[2:]
    text = re.sub(r"[^0-9a-f]", "", text)
    return text if ICAO_RE.match(text) else None


def import_aircraft_metadata(
    session: Session,
    path: str | Path,
    *,
    source: str = "tar1090-db",
    batch_size: int = DEFAULT_IMPORT_BATCH_SIZE,
) -> dict[str, int]:
    imported = 0
    skipped = 0
    batch: list[tuple[dict[str, str | None], dict[str, Any]]] = []
    with open_aircraft_csv(path) as handle:
        reader = aircraft_metadata_rows(handle)
        for row in reader:
            values = aircraft_metadata_from_row(row)
            if values is None:
                skipped += 1
                continue
            batch.append((values, dict(row)))
            if len(batch) >= batch_size:
                imported += flush_aircraft_metadata_batch(session, batch, source=source)
                batch.clear()
        imported += flush_aircraft_metadata_batch(session, batch, source=source)
    session.commit()
    return {"imported": imported, "skipped": skipped}


def open_aircraft_csv(path: str | Path) -> Iterator[TextIO]:
    aircraft_path = Path(path)
    if aircraft_path.suffix == ".gz":
        return gzip.open(aircraft_path, "rt", encoding="utf-8", newline="")
    return aircraft_path.open("r", encoding="utf-8", newline="")


def aircraft_metadata_rows(handle: TextIO) -> Iterator[dict[str, Any]]:
    sample = handle.read(4096)
    handle.seek(0)
    dialect = csv.Sniffer().sniff(sample, delimiters=",;") if sample else csv.excel
    first_line = sample.splitlines()[0] if sample.splitlines() else ""
    first_row = next(csv.reader([first_line], dialect=dialect), [])
    if first_row and normalize_icao_hex(first_row[0]):
        for row in csv.reader(handle, dialect=dialect):
            yield aircraft_metadata_from_tar1090_row(row)
        return
    yield from csv.DictReader(handle, dialect=dialect)


def aircraft_metadata_from_tar1090_row(row: list[str]) -> dict[str, Any]:
    values = [clean_value(value) or "" for value in row]
    return {
        "icao": values[0] if len(values) > 0 else None,
        "registration": values[1] if len(values) > 1 else None,
        "type": values[2] if len(values) > 2 else None,
        "flags": values[3] if len(values) > 3 else None,
        "description": values[4] if len(values) > 4 else None,
        "row": list(row),
    }


def aircraft_metadata_from_row(row: dict[str, Any]) -> dict[str, str | None] | None:
    icao = normalize_icao_hex(first_row_value(row, "icao", "icao_hex", "hex", "icao24", "mode_s", "mode_s_code"))
    if icao is None:
        return None
    return {
        "icao_hex": icao,
        "registration": clean_value(first_row_value(row, "registration", "reg", "tail", "tail_number")),
        "aircraft_type": clean_value(first_row_value(row, "type", "aircraft_type", "t", "model", "icao_type")),
        "operator": clean_value(first_row_value(row, "operator", "owner", "airline", "registered_owner", "description")),
    }


def upsert_aircraft_metadata(session: Session, values: dict[str, str | None], *, source: str, raw: dict[str, Any]) -> AircraftMetadata:
    aircraft = session.get(AircraftMetadata, values["icao_hex"])
    if aircraft is None:
        aircraft = AircraftMetadata(icao_hex=values["icao_hex"])
        session.add(aircraft)
    aircraft.registration = values["registration"]
    aircraft.aircraft_type = values["aircraft_type"]
    aircraft.operator = values["operator"]
    aircraft.source = source
    aircraft.raw_json = dict(raw)
    return aircraft


def flush_aircraft_metadata_batch(
    session: Session,
    batch: list[tuple[dict[str, str | None], dict[str, Any]]],
    *,
    source: str,
) -> int:
    if not batch:
        return 0
    rows_by_icao = {str(values["icao_hex"]): (values, raw) for values, raw in batch}
    session.execute(delete(AircraftMetadata).where(AircraftMetadata.icao_hex.in_(rows_by_icao)))
    session.add_all(
        AircraftMetadata(
            icao_hex=icao_hex,
            registration=values["registration"],
            aircraft_type=values["aircraft_type"],
            operator=values["operator"],
            source=source,
            raw_json=raw,
        )
        for icao_hex, (values, raw) in rows_by_icao.items()
    )
    session.flush()
    return len(rows_by_icao)


def first_row_value(row: dict[str, Any], *keys: str) -> Any:
    normalized = {key.strip().lower(): value for key, value in row.items() if key is not None}
    for key in keys:
        if key in normalized and clean_value(normalized[key]):
            return normalized[key]
    return None


def clean_value(value: Any) -> str | None:
    text = "" if value is None else str(value).strip()
    return text or None
