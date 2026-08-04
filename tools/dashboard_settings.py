from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Mapping
import json
import os
from urllib.request import urlopen


@dataclass(frozen=True)
class DashboardCollectorSettings:
    enabled: bool
    values: dict[str, Any]
    source: str = "saved"


def dashboard_enabled(environ: Mapping[str, str], collector_id: str) -> bool:
    collector_env = f"TDS_{collector_id.upper()}_USE_DASHBOARD_SETTINGS"
    value = environ.get(collector_env, environ.get("TDS_USE_DASHBOARD_SETTINGS", ""))
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def collector_settings_from_dashboard(
    base_url: str,
    collector_id: str,
    *,
    timeout: float = 3.0,
    getter: Callable[..., Any] | None = None,
) -> DashboardCollectorSettings | None:
    url = f"{base_url.rstrip('/')}/v1/control/settings"
    try:
        response = getter(url, timeout=timeout) if getter else urlopen(url, timeout=timeout)
        if hasattr(response, "raise_for_status"):
            response.raise_for_status()
        payload = response.json() if hasattr(response, "json") else json.loads(response.read().decode("utf-8"))
    except Exception:
        return None

    collector = ((payload or {}).get("collectors") or {}).get(collector_id)
    if not isinstance(collector, dict):
        return None
    values = collector.get("values") or {}
    if not isinstance(values, dict):
        values = {}
    return DashboardCollectorSettings(
        enabled=bool(collector.get("enabled", True)),
        values=values,
        source=str(collector.get("source") or "saved"),
    )


def merge_dashboard_values(
    defaults: Mapping[str, Any],
    dashboard_values: Mapping[str, Any] | None,
    cli_values: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    merged = dict(defaults)
    if dashboard_values:
        merged.update(dashboard_values)
    if cli_values:
        merged.update({key: value for key, value in cli_values.items() if value is not None})
    return merged


def apply_dashboard_settings_to_namespace(
    namespace: Any,
    collector_id: str,
    field_map: Mapping[str, str | tuple[str, Callable[[Any], Any]]],
    *,
    environ: Mapping[str, str] | None = None,
    getter: Callable[..., Any] | None = None,
    settings_loader: Callable[..., DashboardCollectorSettings | None] | None = None,
    timeout: float = 3.0,
) -> bool:
    env = os.environ if environ is None else environ
    if not dashboard_enabled(env, collector_id):
        return False
    base_url = str(getattr(namespace, "base_url", "") or env.get("TDS_BASE_URL") or "http://127.0.0.1:8080")
    if settings_loader:
        settings = settings_loader(base_url, collector_id, timeout=timeout)
    else:
        settings = collector_settings_from_dashboard(base_url, collector_id, timeout=timeout, getter=getter)
    if settings is None:
        return False
    if settings.enabled is False:
        setattr(namespace, "collector_enabled", False)
    for source_key, target in field_map.items():
        if source_key not in settings.values:
            continue
        if isinstance(target, tuple):
            target_name, converter = target
        else:
            target_name, converter = target, lambda value: value
        setattr(namespace, target_name, converter(settings.values[source_key]))
    return True


def bool_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}
