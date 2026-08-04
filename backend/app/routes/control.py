from typing import Any
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Rule
from app.site_settings import SITE_SETTINGS_RULE_ID, SiteSettingsPayload, get_site_settings, site_settings_response


router = APIRouter(prefix="/v1/control", tags=["control"])

COLLECTOR_SETTINGS_RULE_ID = "control_collector_settings"
DEVICE_SETTINGS_RULE_ID = "control_device_settings"
APPLY_NOTE = "Saved settings are desired state. Collector processes may need restart or reload before every setting is applied."


class CollectorSettingsPayload(BaseModel):
    enabled: bool = True
    values: dict[str, Any] = Field(default_factory=dict)


class DeviceSettingsPayload(BaseModel):
    alias: str | None = None
    family_override: str | None = None
    enabled: bool = True
    collector_ids: list[str] = Field(default_factory=list)


class ServiceActionPayload(BaseModel):
    action: str


@router.get("/health")
def control_health(request: Request):
    return proxy_control_request(request, "/control/health")


@router.get("/usb")
def control_usb(request: Request):
    return proxy_control_request(request, "/control/usb")


@router.get("/services")
def control_services(request: Request):
    return proxy_control_request(request, "/control/services")


@router.post("/services/{collector_id}/actions")
def control_service_action(collector_id: str, payload: ServiceActionPayload, request: Request):
    return proxy_control_write(request, "POST", f"/control/services/{collector_id}/actions", payload.model_dump())


@router.get("/settings")
def control_settings(session: Session = Depends(get_session)) -> dict:
    collector_rule = session.get(Rule, COLLECTOR_SETTINGS_RULE_ID)
    device_rule = session.get(Rule, DEVICE_SETTINGS_RULE_ID)
    return control_settings_response(
        collector_rule.config if collector_rule else {},
        device_rule.config if device_rule else {},
        get_site_settings(session),
    )


@router.get("/readiness")
def control_readiness(request: Request, session: Session = Depends(get_session)) -> dict:
    collector_rule = session.get(Rule, COLLECTOR_SETTINGS_RULE_ID)
    device_rule = session.get(Rule, DEVICE_SETTINGS_RULE_ID)
    collector_settings = collector_rule.config if collector_rule else {}
    device_settings = device_rule.config if device_rule else {}
    site = get_site_settings(session)

    checks: list[dict[str, str]] = []
    control_payload = safe_control_json(request, "/control/health")
    checks.append(
        readiness_check(
            "control_sidecar",
            "Control sidecar",
            "ready" if control_payload and control_payload.get("status") == "ok" else "missing",
            "Host USB/service control is reachable." if control_payload else "Control sidecar is not reachable.",
            "Start the control service or check TDS_CONTROL_URL." if not control_payload else None,
        )
    )

    checks.append(
        readiness_check(
            "site_origin",
            "Site origin",
            "ready" if site.get("source") == "saved" else "warn",
            f"{site['label']} at {site['latitude']:.6f}, {site['longitude']:.6f}",
            "Save this install's real GPS coordinates in Site / Floor Origin." if site.get("source") != "saved" else None,
        )
    )

    services_payload = safe_control_json(request, "/control/services") or {"services": []}
    usb_payload = safe_control_json(request, "/control/usb") or {"devices": []}
    services = services_payload.get("services") or []
    usb_devices = usb_payload.get("devices") or []

    checks.extend(collector_readiness_checks(services, collector_settings))
    checks.append(usb_assignment_check(usb_devices, services, device_settings))

    return {
        "overall": overall_readiness(checks),
        "generated_at": datetime.now(UTC).isoformat(),
        "checks": checks,
    }


@router.get("/site")
def control_site_settings(session: Session = Depends(get_session)) -> dict:
    return get_site_settings(session)


@router.put("/site")
def put_site_settings(payload: SiteSettingsPayload, session: Session = Depends(get_session)) -> dict:
    site_rule = get_or_create_rule(session, SITE_SETTINGS_RULE_ID, "Control site settings")
    site_rule.enabled = True
    site_rule.config = {
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "label": payload.label or "TDS Lab",
        "floor_heading_degrees": payload.floor_heading_degrees,
    }
    session.commit()
    session.refresh(site_rule)
    return get_site_settings(session)


@router.put("/settings/collectors/{collector_id}")
def put_collector_settings(
    collector_id: str,
    payload: CollectorSettingsPayload,
    request: Request,
    session: Session = Depends(get_session),
) -> dict:
    services = fetch_control_json(request, "/control/services").get("services", [])
    service = next((service for service in services if service.get("id") == collector_id), None)
    if service is None:
        raise HTTPException(status_code=404, detail="Unknown collector")

    supported_keys = set((service.get("settings_schema") or {}).keys())
    unsupported_keys = sorted(set(payload.values) - supported_keys)
    if unsupported_keys:
        raise HTTPException(status_code=422, detail=f"Unsupported collector settings: {', '.join(unsupported_keys)}")

    collector_rule = get_or_create_rule(session, COLLECTOR_SETTINGS_RULE_ID, "Control collector settings")
    collector_config = dict(collector_rule.config or {})
    existing_values = dict((collector_config.get(collector_id) or {}).get("values") or {})
    collector_config[collector_id] = {
        "enabled": payload.enabled,
        "values": {**existing_values, **payload.values},
        "source": "saved",
    }
    collector_rule.enabled = True
    collector_rule.config = collector_config
    session.commit()
    session.refresh(collector_rule)

    device_rule = session.get(Rule, DEVICE_SETTINGS_RULE_ID)
    return control_settings_response(collector_rule.config, device_rule.config if device_rule else {}, get_site_settings(session))


@router.put("/settings/devices/{stable_id:path}")
def put_device_settings(stable_id: str, payload: DeviceSettingsPayload, session: Session = Depends(get_session)) -> dict:
    device_rule = get_or_create_rule(session, DEVICE_SETTINGS_RULE_ID, "Control USB device settings")
    device_config = dict(device_rule.config or {})
    device_config[stable_id] = {
        "alias": stripped_or_none(payload.alias),
        "family_override": stripped_or_none(payload.family_override),
        "enabled": payload.enabled,
        "collector_ids": payload.collector_ids,
        "source": "saved",
    }
    device_rule.enabled = True
    device_rule.config = device_config
    session.commit()
    session.refresh(device_rule)

    collector_rule = session.get(Rule, COLLECTOR_SETTINGS_RULE_ID)
    return control_settings_response(collector_rule.config if collector_rule else {}, device_rule.config, get_site_settings(session))


def proxy_control_request(request: Request, path: str):
    response = request_control(request, "GET", path)
    return control_response(response)


def proxy_control_write(request: Request, method: str, path: str, payload: dict):
    response = request_control(request, method, path, payload)
    return control_response(response)


def control_response(response: httpx.Response):
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        return JSONResponse(status_code=response.status_code, content=response.json())
    return Response(status_code=response.status_code, content=response.text, media_type=content_type or None)


def fetch_control_json(request: Request, path: str) -> dict:
    response = request_control(request, "GET", path)
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail="TDS control sidecar rejected request")
    return response.json()


def safe_control_json(request: Request, path: str) -> dict | None:
    try:
        return fetch_control_json(request, path)
    except HTTPException:
        return None


def request_control(request: Request, method: str, path: str, json: dict | None = None) -> httpx.Response:
    settings = request.app.state.settings
    url = f"{settings.control_url.rstrip('/')}{path}"
    try:
        if method == "GET":
            response = httpx.get(url, timeout=settings.control_timeout_seconds)
        else:
            response = httpx.request(method, url, timeout=settings.control_timeout_seconds, json=json)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="TDS control sidecar unavailable") from exc
    return response


def control_settings_response(collectors: dict, devices: dict, site: dict | None = None) -> dict:
    active_site = site or site_settings_response()
    source = "saved" if collectors or devices or active_site.get("source") == "saved" else "defaults"
    return {
        "collectors": collectors,
        "devices": devices,
        "site": active_site,
        "source": source,
        "apply_note": APPLY_NOTE,
    }


def get_or_create_rule(session: Session, rule_id: str, name: str) -> Rule:
    rule = session.get(Rule, rule_id)
    if rule is None:
        rule = Rule(id=rule_id, name=name, enabled=True, config={})
        session.add(rule)
    return rule


def stripped_or_none(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def readiness_check(id: str, label: str, status: str, detail: str, action: str | None = None) -> dict[str, str]:
    check = {"id": id, "label": label, "status": status, "detail": detail}
    if action:
        check["action"] = action
    return check


def collector_readiness_checks(services: list[dict[str, Any]], collector_settings: dict[str, Any]) -> list[dict[str, str]]:
    checks = []
    for service in services:
        collector_id = str(service.get("id") or "")
        if not collector_id:
            continue
        label = str(service.get("label") or collector_id)
        saved = collector_settings.get(collector_id) or {}
        values = saved.get("values") or {}
        missing_keys = required_collector_keys(service, values)
        if missing_keys:
            checks.append(
                readiness_check(
                    f"collector:{collector_id}",
                    label,
                    "warn",
                    f"Dashboard settings are missing: {', '.join(missing_keys)}. The collector can still use .env or CLI fallback values.",
                    f"Save {label} settings to make this host self-describing from the dashboard.",
                )
            )
        elif saved:
            checks.append(readiness_check(f"collector:{collector_id}", label, "ready", "Saved collector settings are present."))
        else:
            checks.append(
                readiness_check(
                    f"collector:{collector_id}",
                    label,
                    "warn",
                    "No saved dashboard settings; collector will use .env or CLI defaults.",
                    f"Save {label} settings if this collector should run on this host.",
                )
            )
    return checks


def required_collector_keys(service: dict[str, Any], values: dict[str, Any]) -> list[str]:
    schema = service.get("settings_schema") or {}
    missing = []
    for key, meta in schema.items():
        metadata = meta if isinstance(meta, dict) else {}
        is_required = metadata.get("required") is True or metadata.get("secret") is True
        if not is_required:
            continue
        value = values.get(key)
        if value is None or value == "":
            missing.append(str(key))
    return missing


def usb_assignment_check(usb_devices: list[dict[str, Any]], services: list[dict[str, Any]], device_settings: dict[str, Any]) -> dict[str, str]:
    collector_families = {
        family
        for service in services
        for family in (service.get("device_families") or [])
        if isinstance(family, str) and family
    }
    unassigned = []
    for device in usb_devices:
        stable_id = str(device.get("stable_id") or "")
        family = str(device.get("family") or "")
        if not stable_id or family not in collector_families:
            continue
        saved = device_settings.get(stable_id) or {}
        if not saved.get("collector_ids"):
            unassigned.append(str(device.get("product") or stable_id))
    if unassigned:
        return readiness_check(
            "usb_assignments",
            "USB assignments",
            "warn",
            f"Assignable hardware without collector roles: {', '.join(unassigned[:4])}.",
            "Assign each SDR/radio device to the collector that should own it.",
        )
    if collector_families and not usb_devices:
        return readiness_check("usb_assignments", "USB assignments", "warn", "No USB hardware reported by the control sidecar.", "Attach hardware or check USB sidecar permissions.")
    return readiness_check("usb_assignments", "USB assignments", "ready", "Detected eligible USB hardware is assigned or no hardware-backed collectors are enabled.")


def overall_readiness(checks: list[dict[str, str]]) -> str:
    statuses = {check.get("status") for check in checks}
    if "missing" in statuses:
        return "missing"
    if "warn" in statuses:
        return "warn"
    return "ready"
