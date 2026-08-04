from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite+pysqlite:///./tds.db"
    ingest_api_key: str = "change-me"
    mqtt_host: str = "127.0.0.1"
    mqtt_port: int = 1883
    mqtt_enabled: bool = False
    unknown_rssi_threshold: int = -55
    event_cooldown_seconds: int = 300
    unifi_webhook_token: str | None = None
    control_url: str = "http://control:8090"
    control_timeout_seconds: float = 3.0

    model_config = SettingsConfigDict(env_prefix="TDS_", env_file=".env", extra="ignore")
