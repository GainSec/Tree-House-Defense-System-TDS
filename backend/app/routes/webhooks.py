from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Event
from app.mqtt import publish_event

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])


def require_unifi_webhook_token(request: Request, x_tds_webhook_token: str | None = Header(default=None)) -> None:
    expected = request.app.state.settings.unifi_webhook_token
    if expected and x_tds_webhook_token != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid webhook token")


@router.post("/unifi/alarm", status_code=status.HTTP_202_ACCEPTED)
def receive_unifi_alarm(
    payload: dict[str, Any],
    request: Request,
    _: None = Depends(require_unifi_webhook_token),
    session: Session = Depends(get_session),
) -> dict:
    return create_unifi_alarm_event(payload, request, session)


@router.get("/unifi/alarm", status_code=status.HTTP_202_ACCEPTED)
def receive_unifi_alarm_get(
    request: Request,
    _: None = Depends(require_unifi_webhook_token),
    session: Session = Depends(get_session),
) -> dict:
    payload = dict(request.query_params)
    if not payload:
        payload = {"message": "UniFi alarm received via GET"}
    return create_unifi_alarm_event(payload, request, session)


def create_unifi_alarm_event(payload: dict[str, Any], request: Request, session: Session) -> dict:
    normalized = normalize_unifi_payload(payload)
    event = Event(
        type="unifi_alarm",
        severity=severity_from_payload(payload),
        confidence=1.0,
        zone_id=zone_from_payload(payload, normalized),
        summary=summary_from_payload(payload),
        observation_refs=[],
        payload={
            "source": "unifi",
            "received_at": datetime.now(UTC).isoformat(),
            "normalized": normalized,
            "raw": payload,
        },
    )
    session.add(event)
    session.commit()
    publish_event(event, request.app.state.settings)
    return {"event_id": event.id, "accepted": True}


def summary_from_payload(payload: dict[str, Any]) -> str:
    alarm = payload.get("alarm") if isinstance(payload.get("alarm"), dict) else {}
    for value in [
        payload.get("message"),
        payload.get("msg"),
        alarm.get("name"),
        payload.get("name"),
        payload.get("event"),
    ]:
        if value:
            return str(value)
    return "UniFi alarm received"


def severity_from_payload(payload: dict[str, Any]) -> str:
    raw = str(payload.get("severity") or payload.get("level") or "").lower()
    if raw in {"critical", "error", "high", "3", "4", "5"}:
        return "high"
    if raw in {"warning", "warn", "medium", "2"}:
        return "medium"
    return "low"


def zone_from_payload(payload: dict[str, Any], normalized: dict[str, Any] | None = None) -> str | None:
    if normalized:
        for key in ("network_name", "network_subnet", "site"):
            if normalized.get(key):
                return str(normalized[key])
    for key in ("site", "site_id", "siteId", "networkName", "network_name"):
        if payload.get(key):
            return str(payload[key])
    alarm = payload.get("alarm") if isinstance(payload.get("alarm"), dict) else {}
    if alarm.get("scope"):
        return str(alarm["scope"])
    return None


def normalize_unifi_payload(payload: dict[str, Any]) -> dict[str, Any]:
    parameters = payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {}
    ap_name = first_present(parameters, "UNIFIconnectedToDeviceName", "UNIFIlastConnectedToDeviceName")
    ap_ip = first_present(parameters, "UNIFIconnectedToDeviceIp", "UNIFIlastConnectedToDeviceIp")
    ap_mac = first_present(parameters, "UNIFIconnectedToDeviceMac", "UNIFIlastConnectedToDeviceMac")
    ap_model = first_present(parameters, "UNIFIconnectedToDeviceModel", "UNIFIlastConnectedToDeviceModel")
    rssi = first_present(parameters, "UNIFIWiFiRssi", "UNIFIlastConnectedToWiFiRssi")
    return compact_dict(
        {
            "app": payload.get("app"),
            "event_name": payload.get("name") or payload.get("event"),
            "device_event_class_id": payload.get("deviceEventClassId"),
            "alarm_id": payload.get("alarm_id"),
            "site": payload.get("site") or payload.get("site_id") or payload.get("siteId"),
            "client_alias": first_present(parameters, "UNIFIclientAlias"),
            "client_hostname": first_present(parameters, "UNIFIclientHostname"),
            "client_ip": first_present(parameters, "UNIFIclientIp"),
            "client_mac": normalize_mac(first_present(parameters, "UNIFIclientMac")),
            "ap_name": ap_name,
            "ap_ip": ap_ip,
            "ap_mac": normalize_mac(ap_mac),
            "ap_model": ap_model,
            "rssi": parse_int(rssi),
            "wifi_name": first_present(parameters, "UNIFIwifiName"),
            "wifi_channel": first_present(parameters, "UNIFIwifiChannel"),
            "wifi_channel_width": first_present(parameters, "UNIFIwifiChannelWidth"),
            "wifi_band": first_present(parameters, "UNIFIwifiBand"),
            "network_name": first_present(parameters, "UNIFInetworkName"),
            "network_subnet": first_present(parameters, "UNIFInetworkSubnet"),
            "network_vlan": first_present(parameters, "UNIFInetworkVlan"),
            "duration": first_present(parameters, "UNIFIduration"),
            "usage_down": first_present(parameters, "UNIFIusageDown"),
            "usage_up": first_present(parameters, "UNIFIusageUp"),
            "utc_time": first_present(parameters, "UNIFIutcTime"),
        }
    )


def first_present(source: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = source.get(key)
        if value is not None and value != "":
            return value
    return None


def normalize_mac(value: Any) -> str | None:
    if not value:
        return None
    return str(value).lower()


def parse_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}
