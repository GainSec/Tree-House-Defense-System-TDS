"""The map exposes state_key so clients can open the presence dossier (keyed by state_key)."""
from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings


def make_client(tmp_path):
    settings = Settings(database_url=f"sqlite+pysqlite:///{tmp_path / 'tds.db'}", ingest_api_key="test-key", mqtt_enabled=False)
    return TestClient(create_app(settings))


def test_rf_map_item_carries_state_key_that_resolves_the_dossier(tmp_path):
    client = make_client(tmp_path)
    observation = {
        "timestamp": datetime.now(UTC).isoformat(),
        "source": "kismet",
        "sensor_id": "kismet-test",
        "zone_id": "yard",
        "protocol": "wifi",
        "identity_hint": "AA:BB:CC:00:11:22",
        "rssi": -60,
        "known": True,
        "metadata": {"kind": "device", "state_key": "kismet:device:aabbcc001122", "name": "Test phone"},
        "raw_payload": {},
    }
    created = client.post("/v1/observations", json=observation, headers={"x-tds-api-key": "test-key"})
    assert created.status_code == 201, created.text

    items = client.get("/v1/map/rf").json()["items"]
    item = next(entry for entry in items if entry["label"] == "Test phone")
    assert item["identity"] == "AA:BB:CC:00:11:22"
    assert item["state_key"] == "kismet:device:aabbcc001122"

    # identity_hint alone does not resolve; state_key does.
    assert client.get(f"/v1/presence/entities/{item['state_key']}/dossier").status_code == 200
