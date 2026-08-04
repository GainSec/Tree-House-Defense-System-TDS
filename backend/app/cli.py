import argparse
from pathlib import Path

from app.aircraft_db import import_aircraft_metadata
from app.db import configure_database
from app.models import Base
from app.settings import Settings


def main() -> None:
    parser = argparse.ArgumentParser(prog="tds")
    subparsers = parser.add_subparsers(dest="command", required=True)
    aircraft = subparsers.add_parser("import-aircraft-db", help="Import a local tar1090/readsb aircraft metadata CSV")
    aircraft.add_argument("path", type=Path, help="Path to aircraft.csv or aircraft.csv.gz")
    aircraft.add_argument("--source", default="tar1090-db", help="Metadata source label stored with imported rows")
    args = parser.parse_args()

    if args.command == "import-aircraft-db":
        settings = Settings()
        engine, SessionLocal = configure_database(settings)
        Base.metadata.create_all(engine)
        with SessionLocal() as session:
            result = import_aircraft_metadata(session, args.path, source=args.source)
        print(f"Imported {result['imported']} aircraft metadata rows; skipped {result['skipped']}.")


if __name__ == "__main__":
    main()
