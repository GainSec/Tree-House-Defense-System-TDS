from typing import Any, Literal
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.orm import Session

from app.db import get_session
from app.models import Rule

router = APIRouter(prefix="/v1/lte", tags=["lte"])

LTE_SETTINGS_RULE_ID = "ltesniffer_runtime"
CONTROL_COLLECTOR_SETTINGS_RULE_ID = "control_collector_settings"
DEFAULT_UHD_ARGS = "num_recv_frames=512"
DEFAULT_WORKDIR = "/var/log/tds/ltesniffer"
RUNTIME_STATE_FILENAME = "ltesniffer_runtime.json"
DEFAULT_PROFILE = "band48_cbrs_tdd"
DEFAULT_LTESNIFFER_BINARY = "/opt/tds/ltesniffer/build/src/LTESniffer"
BAND48_MIN_HZ = 3550000000
BAND48_MAX_HZ = 3700000000
BAND48_LTESNIFFER_WARNING = "LTESniffer is FDD-only; Band 48 CBRS TDD can be tuned/scanned here but is not expected to lock or decode with this collector."
LTE_COLLECTOR_SETTINGS_FIELDS = {
    "profile",
    "mode",
    "dl_freq_hz",
    "ul_freq_hz",
    "dl_freq_min_hz",
    "dl_freq_max_hz",
    "ul_freq_min_hz",
    "ul_freq_max_hz",
    "cell_id",
    "prb",
    "api_mode",
    "antennas",
    "workers",
    "run_seconds",
    "uhd_args",
    "workdir",
    "unmask_identities",
    "suppress_stderr",
}
LTE_PROBE_COLLECTOR_SETTINGS_FIELDS = {
    "profile",
    "mode",
    "dl_freq_hz",
    "ul_freq_hz",
    "dl_freq_min_hz",
    "dl_freq_max_hz",
    "ul_freq_min_hz",
    "ul_freq_max_hz",
    "run_seconds",
    "uhd_args",
}


class LteSettingsPayload(BaseModel):
    enabled: bool = False
    profile: Literal["band48_cbrs_tdd", "custom"] = DEFAULT_PROFILE
    mode: Literal["probe", "downlink", "uplink", "both", "api"] = "probe"
    dl_freq_hz: int | None = Field(default=None, ge=1)
    ul_freq_hz: int | None = Field(default=None, ge=1)
    dl_freq_min_hz: int | None = Field(default=None, ge=1)
    dl_freq_max_hz: int | None = Field(default=None, ge=1)
    ul_freq_min_hz: int | None = Field(default=None, ge=1)
    ul_freq_max_hz: int | None = Field(default=None, ge=1)
    cell_id: int | None = Field(default=None, ge=0)
    prb: int | None = Field(default=None, ge=1)
    api_mode: int | None = Field(default=None, ge=0, le=3)
    antennas: int = Field(default=2, ge=1, le=8)
    workers: int = Field(default=4, ge=1, le=32)
    run_seconds: int = Field(default=20, ge=1, le=3600)
    uhd_args: str = DEFAULT_UHD_ARGS
    workdir: str = DEFAULT_WORKDIR
    unmask_identities: bool = False
    suppress_stderr: bool = True

    @field_validator(
        "dl_freq_hz",
        "ul_freq_hz",
        "dl_freq_min_hz",
        "dl_freq_max_hz",
        "ul_freq_min_hz",
        "ul_freq_max_hz",
        mode="before",
    )
    @classmethod
    def parse_frequency_notation(cls, value: Any) -> int | None:
        if value is None or value == "":
            return None
        if isinstance(value, int):
            return value
        try:
            return int(Decimal(str(value).strip()))
        except (InvalidOperation, ValueError) as exc:
            raise ValueError("frequency must be Hz or e notation, like 3570000000 or 3570e6") from exc

    @model_validator(mode="after")
    def validate_live_decode(self) -> "LteSettingsPayload":
        mode = normalized_mode(self.mode)
        validate_optional_frequency_range("custom DL range", self.dl_freq_min_hz, self.dl_freq_max_hz)
        validate_optional_frequency_range("custom UL range", self.ul_freq_min_hz, self.ul_freq_max_hz)
        scan_ready = payload_is_scan_ready(self)
        if self.enabled and mode in {"downlink", "uplink", "both"} and self.dl_freq_hz is None and not scan_ready:
            raise ValueError("DL frequency is required when LTE live decode is enabled, unless Custom scan ranges are configured")
        if self.enabled and mode in {"uplink", "both"} and self.ul_freq_hz is None and not scan_ready:
            raise ValueError("UL frequency is required for PUSCH/uplink mode, unless Custom scan ranges are configured")
        if self.enabled and self.profile == "band48_cbrs_tdd" and mode in {"downlink", "uplink", "both"}:
            validate_band48_frequency("DL frequency", self.dl_freq_hz)
        if self.enabled and self.profile == "band48_cbrs_tdd" and mode in {"uplink", "both"}:
            validate_band48_frequency("UL frequency", self.ul_freq_hz)
            if self.dl_freq_hz != self.ul_freq_hz:
                raise ValueError("Band 48 TDD requires DL and UL to use the same RF carrier")
        if self.enabled and self.profile == "custom":
            validate_frequency_inside_custom_range("DL frequency", self.dl_freq_hz, "custom DL range", self.dl_freq_min_hz, self.dl_freq_max_hz)
            validate_frequency_inside_custom_range("UL frequency", self.ul_freq_hz, "custom UL range", self.ul_freq_min_hz, self.ul_freq_max_hz)
        return self


class LteSettingsResponse(LteSettingsPayload):
    id: str
    mode: Literal["probe", "downlink", "uplink", "both"]
    decode_channel: str
    warnings: list[str]
    source: Literal["defaults", "saved"]
    apply_note: str


class LteActionPayload(BaseModel):
    action: Literal["probe", "scan_ranges", "start_live", "restart_live", "stop_live"]


@router.get("/runtime")
def get_lte_runtime(session: Session = Depends(get_session)) -> dict[str, Any]:
    values = current_lte_settings_values(session)
    path = Path(str(values.get("workdir") or DEFAULT_WORKDIR)) / RUNTIME_STATE_FILENAME
    if not path.exists():
        return {
            "status": "idle",
            "active": False,
            "workdir": str(path.parent),
            "path": str(path),
            "raw_output_tail": "",
        }
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "status": "unreadable",
            "active": False,
            "workdir": str(path.parent),
            "path": str(path),
            "error": str(exc),
            "raw_output_tail": "",
        }
    if not isinstance(payload, dict):
        return {
            "status": "unreadable",
            "active": False,
            "workdir": str(path.parent),
            "path": str(path),
            "error": "runtime state was not a JSON object",
            "raw_output_tail": "",
        }
    return enrich_lte_runtime_payload(payload, path)


@router.get("/settings", response_model=LteSettingsResponse)
def get_lte_settings(session: Session = Depends(get_session)) -> LteSettingsResponse:
    rule = session.get(Rule, LTE_SETTINGS_RULE_ID)
    return response_from_rule(rule)


@router.put("/settings", response_model=LteSettingsResponse)
def put_lte_settings(payload: LteSettingsPayload, session: Session = Depends(get_session)) -> LteSettingsResponse:
    values = normalized_settings(payload.model_dump())
    rule = session.get(Rule, LTE_SETTINGS_RULE_ID)
    if rule is None:
        rule = Rule(id=LTE_SETTINGS_RULE_ID, name="LTESniffer runtime settings", enabled=bool(values["enabled"]), config=values)
        session.add(rule)
    else:
        rule.enabled = bool(values["enabled"])
        rule.config = values
    sync_lte_collector_settings(session, values)
    session.commit()
    session.refresh(rule)
    return response_from_rule(rule)


@router.post("/actions")
def post_lte_action(payload: LteActionPayload, request: Request, session: Session = Depends(get_session)):
    if payload.action in {"start_live", "restart_live"}:
        validate_live_action_readiness(session)
    collector_id, action = lte_action_target(payload.action)
    settings = request.app.state.settings
    url = f"{settings.control_url.rstrip('/')}/control/services/{collector_id}/actions"
    try:
        response = httpx.post(url, timeout=settings.control_timeout_seconds, json={"action": action})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="TDS control sidecar unavailable") from exc
    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        content = response.json()
        if isinstance(content, dict):
            content = enrich_lte_action_response(content, payload.action, session)
        return JSONResponse(status_code=response.status_code, content=content)
    return Response(status_code=response.status_code, content=response.text, media_type=content_type or None)


def lte_action_target(action: str) -> tuple[str, str]:
    if action == "probe":
        return "ltesniffer_probe", "start"
    if action == "scan_ranges":
        return "ltesniffer_scan", "start"
    if action == "start_live":
        return "ltesniffer_live", "start"
    if action == "restart_live":
        return "ltesniffer_live", "restart"
    if action == "stop_live":
        return "ltesniffer_live", "stop"
    raise HTTPException(status_code=422, detail="Unsupported LTE action")


def enrich_lte_runtime_payload(payload: dict[str, Any], path: Path) -> dict[str, Any]:
    enriched = dict(payload)
    enriched["workdir"] = str(path.parent)
    enriched["path"] = str(path)
    updated_at = parse_iso_timestamp(enriched.get("updated_at"))
    if updated_at is not None:
        enriched["age_seconds"] = max(0.0, round((datetime.now(UTC) - updated_at).total_seconds(), 2))
    enriched.setdefault("status", "unknown")
    enriched.setdefault("active", False)
    enriched.setdefault("raw_output_tail", "")
    return enriched


def parse_iso_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def enrich_lte_action_response(content: dict[str, Any], action: str, session: Session) -> dict[str, Any]:
    if action not in {"start_live", "restart_live"}:
        return content
    commands = live_ltesniffer_commands(current_lte_settings_values(session))
    if not commands:
        return content
    enriched = dict(content)
    enriched["commands"] = [{"mode": mode, "command": command} for mode, command in commands]
    command_lines = [f"LTESniffer {mode} command: {command}" for mode, command in commands]
    message = str(enriched.get("message") or "").strip()
    enriched["message"] = "\n".join([message, *command_lines] if message else command_lines)
    return enriched


def current_lte_settings_values(session: Session) -> dict[str, Any]:
    values = default_settings()
    rule = session.get(Rule, LTE_SETTINGS_RULE_ID)
    if rule:
        values.update(rule.config or {})
        values["enabled"] = bool(rule.enabled)
    return normalized_settings(values)


def live_ltesniffer_commands(values: dict[str, Any]) -> list[tuple[str, str]]:
    mode = normalized_mode(str(values.get("mode") or "probe"))
    if mode == "probe":
        return []
    modes = ["downlink", "uplink"] if mode == "both" else [mode]
    return [(mode, " ".join(live_ltesniffer_command_parts(values, mode))) for mode in modes]


def live_ltesniffer_command_parts(values: dict[str, Any], mode: str) -> list[str]:
    dl_freq_hz = values.get("dl_freq_hz")
    ul_freq_hz = values.get("ul_freq_hz")
    if dl_freq_hz is None:
        return []
    command = [
        DEFAULT_LTESNIFFER_BINARY,
        "-A",
        str(values.get("antennas") or 2),
        "-W",
        str(values.get("workers") or 4),
        "-f",
        ltesniffer_frequency_arg(int(dl_freq_hz)),
    ]
    if mode == "uplink":
        if ul_freq_hz is None:
            return []
        command.extend(["-u", ltesniffer_frequency_arg(int(ul_freq_hz))])
    if values.get("cell_id") is None:
        command.append("-C")
    command.extend(["-m", "1" if mode == "uplink" else "0"])
    if values.get("api_mode") is not None:
        command.extend(["-z", str(values["api_mode"])])
    if values.get("cell_id") is not None:
        command.extend(["-I", str(values["cell_id"])])
    if values.get("prb") is not None:
        command.extend(["-p", str(values["prb"])])
    if values.get("uhd_args"):
        command.extend(["-a", str(values["uhd_args"])])
    return command


def ltesniffer_frequency_arg(freq_hz: int) -> str:
    whole_mhz, hz_remainder = divmod(freq_hz, 1000000)
    if hz_remainder == 0:
        return f"{whole_mhz}e6"
    fractional = f"{hz_remainder:06d}".rstrip("0")
    return f"{whole_mhz}.{fractional}e6"


def default_settings() -> dict[str, Any]:
    return {
        "enabled": False,
        "profile": DEFAULT_PROFILE,
        "mode": "probe",
        "dl_freq_hz": None,
        "ul_freq_hz": None,
        "dl_freq_min_hz": None,
        "dl_freq_max_hz": None,
        "ul_freq_min_hz": None,
        "ul_freq_max_hz": None,
        "cell_id": None,
        "prb": None,
        "api_mode": None,
        "antennas": 2,
        "workers": 4,
        "run_seconds": 20,
        "uhd_args": DEFAULT_UHD_ARGS,
        "workdir": DEFAULT_WORKDIR,
        "unmask_identities": False,
        "suppress_stderr": True,
    }


def response_from_rule(rule: Rule | None) -> LteSettingsResponse:
    source: Literal["defaults", "saved"] = "saved" if rule else "defaults"
    values = default_settings()
    if rule:
        values.update(rule.config or {})
        values["enabled"] = bool(rule.enabled)
    values = normalized_settings(values)
    return LteSettingsResponse(
        id=LTE_SETTINGS_RULE_ID,
        decode_channel=decode_channel(values["mode"]),
        warnings=settings_warnings(values),
        source=source,
        apply_note=settings_apply_note(values),
        **values,
    )


def normalized_settings(values: dict[str, Any]) -> dict[str, Any]:
    normalized = default_settings()
    normalized.update(values)
    profile = str(normalized.get("profile") or DEFAULT_PROFILE).strip().lower()
    normalized["profile"] = profile if profile in {"band48_cbrs_tdd", "custom"} else DEFAULT_PROFILE
    normalized["mode"] = normalized_mode(str(normalized.get("mode") or "probe"))
    normalized["uhd_args"] = str(normalized.get("uhd_args") or "").strip() or DEFAULT_UHD_ARGS
    normalized["workdir"] = str(normalized.get("workdir") or "").strip() or DEFAULT_WORKDIR
    return normalized


def settings_warnings(values: dict[str, Any]) -> list[str]:
    if values.get("enabled") and values.get("profile") == "band48_cbrs_tdd":
        return [BAND48_LTESNIFFER_WARNING]
    if values.get("profile") != "custom":
        return []
    warnings = ["Custom LTE profile: verify legal RF authorization and matching cell parameters before live decode."]
    dl_freq_hz = values.get("dl_freq_hz")
    ul_freq_hz = values.get("ul_freq_hz")
    if is_outside_band48(dl_freq_hz) or is_outside_band48(ul_freq_hz):
        warnings.append("One or more frequencies are outside Band 48 / CBRS 3550000000-3700000000 Hz.")
    if dl_freq_hz and ul_freq_hz and dl_freq_hz != ul_freq_hz:
        warnings.append("DL and UL are different; this is allowed in Custom but is not valid for Band 48 TDD.")
    return warnings


def settings_apply_note(values: dict[str, Any]) -> str:
    if settings_are_scan_ready(values):
        return "Saved scan-ready LTE ranges. Scan ranges first, then select a detected carrier for live decode."
    if settings_are_live_decode_ready(values):
        return "Saved live-decode LTE settings. Restart or run the LTESniffer live collector to pick them up."
    return "Saved desired collector settings. Run the LTESniffer probe or add tuned carrier settings for live decode."


def validate_optional_frequency_range(label: str, min_value: int | None, max_value: int | None) -> None:
    if min_value is not None and max_value is not None and min_value > max_value:
        raise ValueError(f"{label} minimum cannot be greater than maximum")


def validate_frequency_inside_custom_range(label: str, value: int | None, range_label: str, min_value: int | None, max_value: int | None) -> None:
    if value is None:
        return
    if min_value is not None and value < min_value:
        raise ValueError(f"{label} must be inside {range_label}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{label} must be inside {range_label}")


def is_outside_band48(value: Any) -> bool:
    return isinstance(value, int) and (value < BAND48_MIN_HZ or value > BAND48_MAX_HZ)


def validate_band48_frequency(label: str, value: int | None) -> None:
    if value is None:
        return
    if value < BAND48_MIN_HZ or value > BAND48_MAX_HZ:
        raise ValueError(f"{label} must be within LTE Band 48 / CBRS range 3550000000-3700000000 Hz")


def payload_is_scan_ready(payload: LteSettingsPayload) -> bool:
    return settings_are_scan_ready(
        {
            "enabled": payload.enabled,
            "profile": payload.profile,
            "mode": normalized_mode(payload.mode),
            "dl_freq_hz": payload.dl_freq_hz,
            "ul_freq_hz": payload.ul_freq_hz,
            "dl_freq_min_hz": payload.dl_freq_min_hz,
            "dl_freq_max_hz": payload.dl_freq_max_hz,
            "ul_freq_min_hz": payload.ul_freq_min_hz,
            "ul_freq_max_hz": payload.ul_freq_max_hz,
        }
    )


def settings_are_scan_ready(values: dict[str, Any]) -> bool:
    if not values.get("enabled") or values.get("profile") != "custom":
        return False
    mode = normalized_mode(str(values.get("mode") or "probe"))
    if mode == "probe" or settings_are_live_decode_ready(values):
        return False
    if mode == "downlink":
        return has_frequency_or_range(values, "dl")
    if mode in {"uplink", "both"}:
        return has_frequency_or_range(values, "dl") and has_frequency_or_range(values, "ul")
    return False


def settings_are_live_decode_ready(values: dict[str, Any]) -> bool:
    if not values.get("enabled"):
        return False
    mode = normalized_mode(str(values.get("mode") or "probe"))
    if mode == "downlink":
        return values.get("dl_freq_hz") is not None
    if mode in {"uplink", "both"}:
        return values.get("dl_freq_hz") is not None and values.get("ul_freq_hz") is not None
    return False


def has_frequency_or_range(values: dict[str, Any], prefix: str) -> bool:
    return (
        values.get(f"{prefix}_freq_hz") is not None
        or values.get(f"{prefix}_freq_min_hz") is not None
        or values.get(f"{prefix}_freq_max_hz") is not None
    )


def validate_live_action_readiness(session: Session) -> None:
    values = default_settings()
    rule = session.get(Rule, LTE_SETTINGS_RULE_ID)
    if rule:
        values.update(rule.config or {})
        values["enabled"] = bool(rule.enabled)
    values = normalized_settings(values)
    if settings_are_live_decode_ready(values):
        return
    if settings_are_scan_ready(values):
        raise HTTPException(status_code=422, detail="LTE live decode needs a tuned carrier; scan ranges first, then select a detected carrier.")
    raise HTTPException(status_code=422, detail="LTE live decode needs saved DL/UL frequency settings before it can start.")


def sync_lte_collector_settings(session: Session, values: dict[str, Any]) -> None:
    rule = session.get(Rule, CONTROL_COLLECTOR_SETTINGS_RULE_ID)
    if rule is None:
        rule = Rule(id=CONTROL_COLLECTOR_SETTINGS_RULE_ID, name="Control collector settings", enabled=True, config={})
        session.add(rule)
    config = dict(rule.config or {})
    config["ltesniffer_probe"] = {
        "enabled": bool(values["enabled"]) and (settings_are_scan_ready(values) or normalized_mode(str(values.get("mode") or "probe")) == "probe"),
        "values": {key: values[key] for key in LTE_PROBE_COLLECTOR_SETTINGS_FIELDS if key in values},
        "source": "saved",
    }
    config["ltesniffer_scan"] = {
        "enabled": bool(values["enabled"]),
        "values": {key: values[key] for key in LTE_PROBE_COLLECTOR_SETTINGS_FIELDS if key in values},
        "source": "saved",
    }
    config["ltesniffer_live"] = {
        "enabled": settings_are_live_decode_ready(values),
        "values": {key: values[key] for key in LTE_COLLECTOR_SETTINGS_FIELDS if key in values},
        "source": "saved",
    }
    rule.enabled = True
    rule.config = config


def normalized_mode(mode: str) -> Literal["probe", "downlink", "uplink", "both"]:
    cleaned = mode.strip().lower()
    if cleaned == "api":
        return "uplink"
    if cleaned in {"probe", "downlink", "uplink", "both"}:
        return cleaned
    return "probe"


def decode_channel(mode: str) -> str:
    if mode == "both":
        return "PDSCH/PUSCH"
    if mode == "uplink":
        return "PUSCH"
    if mode == "downlink":
        return "PDSCH"
    return "probe"
