import re
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Collector, CurrentState, Integration, Rule, Sensor, Zone

router = APIRouter(prefix="/v1", tags=["inventory"])


def list_response(items: list[dict]) -> dict:
    return {"items": items, "count": len(items)}


def text_value(value: Any) -> str:
    return "" if value is None else str(value).strip()


def first_text(*values: Any) -> str | None:
    for value in values:
        text = text_value(value)
        if text:
            return text
    return None


def normalize_mac(value: Any) -> str | None:
    text = re.sub(r"[^0-9a-fA-F]", "", text_value(value))
    if len(text) != 12:
        return None
    return ":".join(text[index : index + 2].lower() for index in range(0, 12, 2))


def append_unique(values: list[str], value: str | None) -> None:
    if value and value not in values:
        values.append(value)


def iso_or_none(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def client_record_details(state: CurrentState) -> dict:
    metadata = state.metadata_json or {}
    raw = state.raw_payload or {}
    mac = normalize_mac(
        state.identity_hint
        or raw.get("macAddress")
        or raw.get("macaddr")
        or raw.get("mac")
        or raw.get("client_mac")
        or metadata.get("mac_address")
        or metadata.get("mac")
    )
    alias = first_text(metadata.get("alias"), metadata.get("name"), raw.get("alias"), raw.get("name"))
    hostname = first_text(metadata.get("hostname"), raw.get("hostname"), raw.get("hostName"))
    ip_address = first_text(metadata.get("ip_address"), metadata.get("ip"), raw.get("ipAddress"), raw.get("ipaddr"), raw.get("ip"))

    return {
        "source": state.source,
        "state_key": state.state_key,
        "kind": state.kind,
        "mac_address": mac,
        "alias": alias,
        "hostname": hostname,
        "ip_address": ip_address,
        "network": first_text(metadata.get("network"), raw.get("network")),
        "connection_type": first_text(metadata.get("connection_type"), raw.get("type")),
        "access_point": first_text(metadata.get("access_point"), raw.get("uplinkDeviceName"), raw.get("uplinkDeviceId"), state.sensor_id),
        "last_seen_at": state.last_seen_at,
    }


def merge_client_record(clients: dict[str, dict], state: CurrentState) -> None:
    details = client_record_details(state)
    mac = details["mac_address"]
    if not mac:
        return
    client = clients.setdefault(
        mac,
        {
            "mac_address": mac,
            "alias": None,
            "hostname": None,
            "primary_ip": None,
            "aliases": [],
            "hostnames": [],
            "ip_addresses": [],
            "sources": [],
            "network": None,
            "connection_type": None,
            "access_point": None,
            "first_seen_at": state.first_seen_at,
            "last_seen_at": state.last_seen_at,
            "evidence": [],
        },
    )

    append_unique(client["aliases"], details["alias"])
    append_unique(client["hostnames"], details["hostname"])
    append_unique(client["ip_addresses"], details["ip_address"])
    append_unique(client["sources"], state.source)
    client["alias"] = client["alias"] or details["alias"]
    client["hostname"] = client["hostname"] or details["hostname"]
    client["primary_ip"] = client["primary_ip"] or details["ip_address"]
    client["network"] = client["network"] or details["network"]
    client["connection_type"] = client["connection_type"] or details["connection_type"]
    client["access_point"] = client["access_point"] or details["access_point"]
    if state.first_seen_at and (client["first_seen_at"] is None or state.first_seen_at < client["first_seen_at"]):
        client["first_seen_at"] = state.first_seen_at
    if state.last_seen_at and (client["last_seen_at"] is None or state.last_seen_at > client["last_seen_at"]):
        client["last_seen_at"] = state.last_seen_at
    client["evidence"].append(
        {
            "source": state.source,
            "state_key": state.state_key,
            "kind": state.kind,
            "alias": details["alias"],
            "hostname": details["hostname"],
            "ip_address": details["ip_address"],
            "network": details["network"],
            "connection_type": details["connection_type"],
            "access_point": details["access_point"],
            "last_seen_at": state.last_seen_at,
        }
    )


def connected_client_filter():
    return or_(
        (CurrentState.source == "unifi") & (CurrentState.kind == "client"),
        (CurrentState.source == "openwrt") & (CurrentState.kind == "dhcp_lease"),
    )


@router.get("/zones")
def list_zones(session: Session = Depends(get_session)) -> dict:
    zones = session.execute(select(Zone).order_by(Zone.id)).scalars().all()
    return list_response([{"id": zone.id, "name": zone.name, "created_at": zone.created_at} for zone in zones])


@router.get("/sensors")
def list_sensors(session: Session = Depends(get_session)) -> dict:
    sensors = session.execute(select(Sensor).order_by(Sensor.id)).scalars().all()
    return list_response(
        [
            {
                "id": sensor.id,
                "name": sensor.name,
                "zone_id": sensor.zone_id,
                "health": sensor.health,
                "created_at": sensor.created_at,
            }
            for sensor in sensors
        ]
    )


@router.get("/collectors")
def list_collectors(session: Session = Depends(get_session)) -> dict:
    collectors = session.execute(select(Collector).order_by(Collector.id)).scalars().all()
    return list_response(
        [
            {
                "id": collector.id,
                "name": collector.name,
                "kind": collector.kind,
                "health": collector.health,
                "created_at": collector.created_at,
            }
            for collector in collectors
        ]
    )


@router.get("/integrations")
def list_integrations(session: Session = Depends(get_session)) -> dict:
    integrations = session.execute(select(Integration).order_by(Integration.id)).scalars().all()
    return list_response(
        [
            {
                "id": integration.id,
                "name": integration.name,
                "kind": integration.kind,
                "health": integration.health,
                "created_at": integration.created_at,
            }
            for integration in integrations
        ]
    )


@router.get("/rules")
def list_rules(session: Session = Depends(get_session)) -> dict:
    rules = session.execute(select(Rule).order_by(Rule.id)).scalars().all()
    return list_response(
        [
            {
                "id": rule.id,
                "name": rule.name,
                "enabled": rule.enabled,
                "config": rule.config,
                "created_at": rule.created_at,
            }
            for rule in rules
        ]
    )


@router.get("/network/clients")
def list_network_clients(session: Session = Depends(get_session)) -> dict:
    states = session.execute(select(CurrentState).where(connected_client_filter()).order_by(CurrentState.last_seen_at.desc())).scalars().all()
    clients: dict[str, dict] = {}
    for state in states:
        merge_client_record(clients, state)

    items = sorted(clients.values(), key=lambda item: (item["alias"] or item["hostname"] or item["mac_address"]).lower())
    for item in items:
        item["sources"].sort()
        item["evidence"].sort(key=lambda evidence: evidence["source"])
        item["first_seen_at"] = iso_or_none(item["first_seen_at"])
        item["last_seen_at"] = iso_or_none(item["last_seen_at"])
        for evidence in item["evidence"]:
            evidence["last_seen_at"] = iso_or_none(evidence["last_seen_at"])
    return list_response(items)
