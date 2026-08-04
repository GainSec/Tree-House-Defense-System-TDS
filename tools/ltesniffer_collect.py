from __future__ import annotations

import argparse
from dataclasses import dataclass
from dataclasses import replace
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
import queue
import re
import subprocess
import threading
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

import httpx


COLLECTOR_VERSION = "tds.ltesniffer.v1"
DEFAULT_BINARY = "/opt/tds/ltesniffer/build/src/LTESniffer"
DEFAULT_WORKDIR = str(Path(__file__).resolve().parents[1] / "var" / "log" / "ltesniffer")
DEFAULT_UHD_ARGS = "num_recv_frames=512"
DEFAULT_PROFILE = "band48_cbrs_tdd"
BAND48_LTESNIFFER_WARNING = "LTESniffer is FDD-only; Band 48 CBRS TDD can be tuned/scanned here but is not expected to lock or decode with this collector."
BAND48_MIN_HZ = 3_550_000_000
BAND48_MAX_HZ = 3_700_000_000
DEFAULT_SCAN_STEP_HZ = 10_000_000
MAX_SCAN_CARRIERS = 32
CELL_SEARCH_SCAN_RUN_SECONDS = 5
KNOWN_CELL_SCAN_RUN_SECONDS = 15
KNOWN_CELL_PRIMARY_SCAN_RUN_SECONDS = 60
RAW_OUTPUT_TAIL_LIMIT = 8000
RUNTIME_STATE_FILENAME = "ltesniffer_runtime.json"
RUNTIME_UPDATE_INTERVAL_SECONDS = 1.0
PRB_BANDWIDTH_HZ = {
    6: 1_400_000,
    15: 3_000_000,
    25: 5_000_000,
    50: 10_000_000,
    75: 15_000_000,
    100: 20_000_000,
}
SINGLE_LIVE_MODES = {"downlink", "uplink"}
LIVE_MODES = {"downlink", "uplink", "both"}
DASHBOARD_SETTING_FIELDS = {
    "enabled",
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
    "antennas",
    "workers",
    "api_mode",
    "uhd_args",
    "workdir",
    "run_seconds",
    "unmask_identities",
    "suppress_stderr",
}


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class LteSnifferConfig:
    enabled: bool = False
    profile: str = DEFAULT_PROFILE
    mode: str = "probe"
    binary: str = DEFAULT_BINARY
    workdir: str = DEFAULT_WORKDIR
    base_url: str = "http://127.0.0.1:8080"
    api_key: str = "change-me"
    sensor_id: str = "libresdr_b210"
    zone_id: str = "cellular-lab"
    dl_freq_hz: int | None = None
    ul_freq_hz: int | None = None
    dl_freq_min_hz: int | None = None
    dl_freq_max_hz: int | None = None
    ul_freq_min_hz: int | None = None
    ul_freq_max_hz: int | None = None
    cell_id: int | None = None
    prb: int | None = None
    antennas: int = 2
    workers: int = 4
    api_mode: int | None = None
    uhd_args: str = DEFAULT_UHD_ARGS
    run_seconds: int = 20
    unmask_identities: bool = False
    suppress_stderr: bool = True
    force_scan_ranges: bool = False

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "LteSnifferConfig":
        env = os.environ if environ is None else environ
        mode = env.get("TDS_LTESNIFFER_MODE", "probe").strip().lower() or "probe"
        api_mode = env_int(env.get("TDS_LTESNIFFER_API_MODE"))
        if mode not in {"probe", "downlink", "uplink", "both", "api"}:
            raise ConfigError(f"unsupported LTESniffer mode: {mode}")
        if mode == "api":
            mode = "uplink"
            api_mode = 3 if api_mode is None else api_mode
        if api_mode is not None and api_mode not in {0, 1, 2, 3}:
            raise ConfigError("LTESniffer API mode must be 0, 1, 2, or 3")
        config = cls(
            enabled=env_bool(env.get("TDS_LTESNIFFER_ENABLED"), default=False),
            profile=env.get("TDS_LTESNIFFER_PROFILE", DEFAULT_PROFILE),
            mode=mode,
            binary=env.get("TDS_LTESNIFFER_BINARY", DEFAULT_BINARY),
            workdir=env.get("TDS_LTESNIFFER_WORKDIR", DEFAULT_WORKDIR),
            base_url=env.get("TDS_BASE_URL", "http://127.0.0.1:8080"),
            api_key=env.get("TDS_INGEST_API_KEY", "change-me"),
            sensor_id=env.get("TDS_LTESNIFFER_SENSOR_ID", "libresdr_b210"),
            zone_id=env.get("TDS_LTESNIFFER_ZONE", "cellular-lab"),
            dl_freq_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_DL_FREQ_HZ")),
            ul_freq_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_UL_FREQ_HZ")),
            dl_freq_min_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_DL_FREQ_MIN_HZ")),
            dl_freq_max_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_DL_FREQ_MAX_HZ")),
            ul_freq_min_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_UL_FREQ_MIN_HZ")),
            ul_freq_max_hz=env_frequency_hz(env.get("TDS_LTESNIFFER_UL_FREQ_MAX_HZ")),
            cell_id=env_int(env.get("TDS_LTESNIFFER_CELL_ID")),
            prb=env_int(env.get("TDS_LTESNIFFER_PRB")),
            antennas=env_int(env.get("TDS_LTESNIFFER_ANTENNAS")) or 2,
            workers=env_int(env.get("TDS_LTESNIFFER_WORKERS")) or 4,
            api_mode=api_mode,
            uhd_args=env.get("TDS_LTESNIFFER_UHD_ARGS", DEFAULT_UHD_ARGS),
            run_seconds=env_int(env.get("TDS_LTESNIFFER_RUN_SECONDS")) or 20,
            unmask_identities=env_bool(env.get("TDS_LTESNIFFER_UNMASK_IDENTITIES"), default=False),
            suppress_stderr=env_bool(env.get("TDS_LTESNIFFER_SUPPRESS_STDERR"), default=True),
            force_scan_ranges=env_bool(env.get("TDS_LTESNIFFER_FORCE_SCAN_RANGES"), default=False),
        )
        if env_bool(env.get("TDS_LTESNIFFER_USE_DASHBOARD_SETTINGS"), default=False):
            dashboard_settings = fetch_dashboard_lte_settings(
                config.base_url,
                timeout=env_float(env.get("TDS_LTESNIFFER_SETTINGS_TIMEOUT")) or 3.0,
            )
            if dashboard_settings:
                config = apply_dashboard_lte_settings(config, dashboard_settings)
        return config


def env_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(value: str | None) -> int | None:
    if value is None or value.strip() == "":
        return None
    return int(value)


def env_frequency_hz(value: str | None) -> int | None:
    if value is None or value.strip() == "":
        return None
    try:
        return int(Decimal(value.strip()))
    except (InvalidOperation, ValueError) as exc:
        raise ConfigError(f"invalid LTESniffer frequency: {value}") from exc


def env_float(value: str | None) -> float | None:
    if value is None or value.strip() == "":
        return None
    return float(value)


def fetch_dashboard_lte_settings(base_url: str, *, timeout: float) -> dict[str, Any] | None:
    try:
        response = httpx.get(f"{base_url.rstrip('/')}/v1/lte/settings", timeout=timeout)
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, dict) else None
    except Exception:
        return None


def apply_dashboard_lte_settings(config: LteSnifferConfig, settings: Mapping[str, Any]) -> LteSnifferConfig:
    overrides = {key: settings[key] for key in DASHBOARD_SETTING_FIELDS if key in settings}
    if "mode" in overrides:
        mode = str(overrides["mode"]).strip().lower()
        overrides["mode"] = "uplink" if mode == "api" else mode
    if "profile" in overrides:
        profile = str(overrides["profile"]).strip().lower()
        overrides["profile"] = profile or DEFAULT_PROFILE
    for key in [
        "dl_freq_hz",
        "ul_freq_hz",
        "dl_freq_min_hz",
        "dl_freq_max_hz",
        "ul_freq_min_hz",
        "ul_freq_max_hz",
    ]:
        if key in overrides and overrides[key] is not None:
            overrides[key] = parse_frequency_hz(overrides[key])
    for key in [
        "cell_id",
        "prb",
        "antennas",
        "workers",
        "api_mode",
        "run_seconds",
    ]:
        if key in overrides and overrides[key] is not None:
            overrides[key] = int(overrides[key])
    if "enabled" in overrides:
        overrides["enabled"] = bool(overrides["enabled"])
    for key in ["unmask_identities", "suppress_stderr"]:
        if key in overrides:
            overrides[key] = bool(overrides[key])
    return replace(config, **overrides)


def load_env_file(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def build_ltesniffer_command(config: LteSnifferConfig) -> list[str]:
    validate_live_config(config)
    if config.mode not in SINGLE_LIVE_MODES:
        raise ConfigError("both mode must be expanded with build_ltesniffer_commands")

    command = [
        config.binary,
        "-A",
        str(config.antennas),
        "-W",
        str(config.workers),
        "-f",
        ltesniffer_frequency_arg(config.dl_freq_hz),
    ]
    if config.mode == "uplink":
        command.extend(["-u", ltesniffer_frequency_arg(config.ul_freq_hz)])
    if config.cell_id is None:
        command.append("-C")
    command.extend(["-m", "1" if config.mode == "uplink" else "0"])
    if config.api_mode is not None:
        command.extend(["-z", str(config.api_mode)])
    if config.cell_id is not None:
        command.extend(["-I", str(config.cell_id)])
    if config.prb is not None:
        command.extend(["-p", str(config.prb)])
    if config.uhd_args:
        command.extend(["-a", config.uhd_args])
    return command


def ltesniffer_frequency_arg(freq_hz: int | None) -> str:
    if freq_hz is None:
        raise ConfigError("frequency is required")
    whole_mhz, hz_remainder = divmod(freq_hz, 1_000_000)
    if hz_remainder == 0:
        return f"{whole_mhz}e6"
    fractional = f"{hz_remainder:06d}".rstrip("0")
    return f"{whole_mhz}.{fractional}e6"


def parse_frequency_hz(value: Any) -> int:
    if isinstance(value, int):
        return value
    try:
        return int(Decimal(str(value).strip()))
    except (InvalidOperation, ValueError) as exc:
        raise ConfigError(f"invalid LTESniffer frequency: {value}") from exc


def build_ltesniffer_commands(config: LteSnifferConfig) -> list[tuple[str, list[str]]]:
    validate_live_config(config)
    modes = ["downlink", "uplink"] if config.mode == "both" else [config.mode]
    return [(mode, build_ltesniffer_command(replace(config, mode=mode))) for mode in modes]


def validate_live_config(config: LteSnifferConfig) -> None:
    if config.mode not in LIVE_MODES:
        raise ConfigError("probe mode does not start LTESniffer")
    if not config.enabled:
        raise ConfigError("LTESniffer live execution is disabled")
    if config.dl_freq_hz is None:
        raise ConfigError("DL frequency is required for LTESniffer live execution")
    if config.mode in {"uplink", "both"} and config.ul_freq_hz is None:
        raise ConfigError("UL frequency is required for PUSCH mode")


def parse_ltesniffer_output(output: str, *, unmask_identities: bool = False) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "rnti_activity": [],
        "identity_events": [],
        "pcap_files": [],
    }
    cell_search_results = parse_cell_search_results(output)
    if cell_search_results:
        summary["cell_search_results"] = cell_search_results
    carrier_candidates = parse_carrier_candidates(output)
    if carrier_candidates:
        summary["carrier_candidates"] = carrier_candidates
    processed = re.search(r"Processed\s+(\d+)\s*/\s*(\d+)\s+subframes", output, re.IGNORECASE)
    if processed:
        summary["processed_subframes"] = int(processed.group(1))
        summary["expected_subframes"] = int(processed.group(2))
    snr = re.search(r"\bSNR\s*:?\s*(-?\d+(?:\.\d+)?)\s*dB", output, re.IGNORECASE)
    if snr:
        summary["snr_db"] = float(snr.group(1))
    pss_matches = [
        {
            "peak": float(match.group("peak")),
            "frame_count": int(match.group("frame")),
            "state": int(match.group("state")),
        }
        for match in re.finditer(
            r"Finding\s+PSS\.\.\.\s+Peak:\s*(?P<peak>\d+(?:\.\d+)?),\s*FrameCnt:\s*(?P<frame>\d+)\s+State:\s*(?P<state>\d+)",
            output,
            re.IGNORECASE,
        )
    ]
    if pss_matches:
        summary["pss_search_count"] = len(pss_matches)
        summary["pss_peak_max"] = max(match["peak"] for match in pss_matches)
        summary["pss_frame_count_max"] = max(match["frame_count"] for match in pss_matches)
        summary["pss_state_last"] = pss_matches[-1]["state"]

    dci_activity = []
    for match in re.finditer(
        r"\[DCI\]\s+SF:\s*(?P<sf>\d+[:\-]\d+)\s*-?\s*RNTI:\s*(?P<rnti>[0-9a-fxA-F]+)\s+-Format:\s*(?P<format>[A-Za-z0-9]+)(?:\s+-MCS:\s*(?P<mcs>-?\d+))?(?:\s+-RV:\s*(?P<rv>-?\d+))?",
        output,
        re.IGNORECASE,
    ):
        event = {
            "subframe": match.group("sf"),
            "rnti": match.group("rnti"),
            "format": match.group("format"),
        }
        if match.group("mcs") is not None:
            event["mcs"] = int(match.group("mcs"))
        if match.group("rv") is not None:
            event["rv"] = int(match.group("rv"))
        dci_activity.append(event)
    dci_formats = sorted({event["format"] for event in dci_activity})
    dci_count = len(dci_activity)
    for match in re.finditer(r"\bNof_DCI\s*=\s*(\d+)", output, re.IGNORECASE):
        dci_count = max(dci_count, int(match.group(1)))
    pdsch_success_count = len(re.findall(r"\bPDSCH\b.*?\bSUCCESS\b|\bResult:\s*SUCCESS\b", output, re.IGNORECASE))
    if dci_activity:
        summary["dci_activity"] = dci_activity
    if dci_count:
        summary["dci_count"] = dci_count
    if dci_formats:
        summary["dci_formats"] = dci_formats
    if pdsch_success_count:
        summary["pdsch_success_count"] = pdsch_success_count
    if dci_count or dci_activity or "PDCCH" in output.upper():
        summary["pdcch_observed"] = True

    for match in re.finditer(
        r"RNTI\s+([0-9a-fxA-F]+).*?Table\s+([A-Za-z0-9]+).*?Active\s+(\d+).*?Success\s+([0-9/]+)(?:.*?New TX\s+(\d+))?(?:.*?ReTX\s+(\d+))?",
        output,
        re.IGNORECASE,
    ):
        summary["rnti_activity"].append(
            {
                "rnti": match.group(1),
                "table": match.group(2),
                "active": int(match.group(3)),
                "success": match.group(4),
                "new_tx": int(match.group(5) or 0),
                "retx": int(match.group(6) or 0),
            }
        )
    summary["rnti_activity"].extend(parse_rnti_table_rows(output))

    identity_pattern = re.compile(
        r"Detected Identity:\s*(?P<type>[^\n]+)\s+Value:\s*(?P<value>[^\n]+)\s+From Message:\s*(?P<message>[^\n]+)",
        re.IGNORECASE,
    )
    for match in identity_pattern.finditer(output):
        raw_value = match.group("value").strip()
        summary["identity_events"].append(
            {
                "type": match.group("type").strip(),
                "value": raw_value if unmask_identities else mask_identity(raw_value),
                "from_message": match.group("message").strip(),
                "masked": not unmask_identities,
            }
        )

    pcaps = []
    for match in re.finditer(r"(?<![\w./-])([\w./-]+\.pcap)\b", output):
        pcap = match.group(1)
        if pcap not in pcaps:
            pcaps.append(pcap)
    summary["pcap_files"] = pcaps
    return {key: value for key, value in summary.items() if value not in (None, [], {})}


def parse_cell_search_results(output: str) -> list[dict[str, Any]]:
    results = []
    pattern = re.compile(
        r"(?P<star>\*)?\s*Found\s+Cell_id:\s*(?P<cell_id>\d+)\s+"
        r"(?P<duplex>FDD|TDD),\s*CP:\s*(?P<cp>[^,]+),\s*"
        r"DetectRatio=\s*(?P<ratio>\d+)%\s*PSR=(?P<psr>-?\d+(?:\.\d+)?)"
        r",\s*Power=(?P<power>-?(?:inf|\d+(?:\.\d+)?))\s*dBm",
        re.IGNORECASE,
    )
    for match in pattern.finditer(output):
        power = parse_optional_float(match.group("power"))
        detect_ratio = int(match.group("ratio"))
        cell_id = int(match.group("cell_id"))
        results.append(
            {
                "cell_id": cell_id,
                "duplex": match.group("duplex").upper(),
                "cyclic_prefix": match.group("cp").strip(),
                "detect_ratio_pct": detect_ratio,
                "psr": float(match.group("psr")),
                "power_dbm": power,
                "detected": bool(match.group("star")) or (cell_id > 0 and detect_ratio > 0 and power is not None),
            }
        )
    return results


def parse_optional_float(value: str) -> float | None:
    if value.strip().lower() in {"inf", "+inf", "-inf"}:
        return None
    return float(value)


def parse_rnti_table_rows(output: str) -> list[dict[str, Any]]:
    rows = []
    row_pattern = re.compile(
        r"^\s*(?P<num>\d+)\s+(?P<rnti>[0-9a-fxA-F]+)\s+(?P<table>\S+)\s+"
        r"(?P<active>\d+)\s+(?P<new_tx>\d+)\s+(?P<retx>\d+)\s+"
        r"(?P<success>\d+\(\d+%\)|\d+/\d+)\s+(?P<harq>\d+)\s+(?P<normal>\d+)\s+"
        r"(?P<w_mimo>\d+)\s+(?P<w_pinfor>\d+)\s+(?P<other>\d+)\s*$",
        re.MULTILINE,
    )
    for match in row_pattern.finditer(output):
        success = match.group("success")
        row = {
            "num": int(match.group("num")),
            "rnti": match.group("rnti"),
            "table": match.group("table"),
            "active": int(match.group("active")),
            "new_tx": int(match.group("new_tx")),
            "retx": int(match.group("retx")),
            "success": success,
            "harq": int(match.group("harq")),
            "normal": int(match.group("normal")),
            "w_mimo": int(match.group("w_mimo")),
            "w_pinfor": int(match.group("w_pinfor")),
            "other": int(match.group("other")),
        }
        parsed_success = re.match(r"(?P<count>\d+)\((?P<rate>\d+)%\)", success)
        if parsed_success:
            row["success_count"] = int(parsed_success.group("count"))
            row["success_rate_pct"] = int(parsed_success.group("rate"))
        rows.append(row)
    return rows


def parse_carrier_candidates(output: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for cell in parse_cell_search_results(output):
        if not cell.get("detected"):
            continue
        candidate = {
            "cell_id": cell["cell_id"],
            "pci": cell["cell_id"],
            "duplex": cell["duplex"],
            "cyclic_prefix": cell["cyclic_prefix"],
            "detect_ratio_pct": cell["detect_ratio_pct"],
            "psr": cell["psr"],
            "power_dbm": cell["power_dbm"],
        }
        fingerprint = (None, None, None, candidate["pci"], candidate["cell_id"])
        seen.add(fingerprint)
        candidates.append(candidate)
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or not is_candidate_line(line):
            continue
        candidate = compact_dict(
            {
                "dl_freq_hz": extract_frequency_hz(line, r"(?:dl|downlink)(?:[\s_-]*(?:freq(?:uency)?|carrier|center|freq_hz))?"),
                "ul_freq_hz": extract_frequency_hz(line, r"(?:ul|uplink)(?:[\s_-]*(?:freq(?:uency)?|carrier|center|freq_hz))?"),
                "earfcn": extract_int_field(line, [r"earfcn", r"dl[\s_-]*earfcn"]),
                "pci": extract_int_field(line, [r"pci", r"phy[\s_-]*cell[\s_-]*id"]),
                "cell_id": extract_int_field(line, [r"cell[\s_-]*id", r"cellid", r"cid"]),
                "prb": extract_int_field(line, [r"prb", r"nof[\s_-]*prb"]),
                "snr_db": extract_float_field(line, [r"snr(?:[\s_-]*db)?"]),
            }
        )
        if not candidate or not any(key in candidate for key in ["dl_freq_hz", "ul_freq_hz", "earfcn", "pci", "cell_id"]):
            continue
        fingerprint = (
            candidate.get("dl_freq_hz"),
            candidate.get("ul_freq_hz"),
            candidate.get("earfcn"),
            candidate.get("pci"),
            candidate.get("cell_id"),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        candidates.append(candidate)
    return candidates


def is_candidate_line(line: str) -> bool:
    lowered = line.lower()
    return any(
        marker in lowered
        for marker in [
            "carrier candidate",
            "found lte cell",
            "lte cell",
            "earfcn",
            "pci",
            "dl_freq",
            "downlink",
        ]
    )


def extract_frequency_hz(line: str, label_pattern: str) -> int | None:
    match = re.search(
        rf"\b{label_pattern}\b\s*[:=]?\s*(?P<value>\d[\d,]*(?:\.\d+)?(?:e[+-]?\d+)?)\s*(?P<unit>ghz|mhz|khz|hz)?\b",
        line,
        re.IGNORECASE,
    )
    if not match:
        return None
    value = float(match.group("value").replace(",", ""))
    unit = (match.group("unit") or "hz").lower()
    multiplier = {"ghz": 1_000_000_000, "mhz": 1_000_000, "khz": 1_000, "hz": 1}[unit]
    return int(round(value * multiplier))


def extract_int_field(line: str, label_patterns: list[str]) -> int | None:
    for label_pattern in label_patterns:
        match = re.search(rf"\b{label_pattern}\b\s*[:=]?\s*(\d[\d,]*)\b", line, re.IGNORECASE)
        if match:
            return int(match.group(1).replace(",", ""))
    return None


def extract_float_field(line: str, label_patterns: list[str]) -> float | None:
    for label_pattern in label_patterns:
        match = re.search(rf"\b{label_pattern}\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:db)?\b", line, re.IGNORECASE)
        if match:
            return float(match.group(1))
    return None


def mask_identity(value: str) -> str:
    text = value.strip()
    if len(text) <= 6:
        return "*" * len(text)
    prefix = text[:6]
    suffix = text[-3:] if len(text) > 9 else ""
    middle = max(1, len(text) - len(prefix) - len(suffix))
    return f"{prefix}{'*' * middle}{suffix}"


def collect_observations(config: LteSnifferConfig, *, summary: dict[str, Any], observed_at: datetime) -> list[dict[str, Any]]:
    return [
        lte_sensor_observation(config, summary=summary, observed_at=observed_at),
        lte_decode_observation(config, summary=summary, observed_at=observed_at),
    ]


def lte_sensor_observation(config: LteSnifferConfig, *, summary: dict[str, Any], observed_at: datetime) -> dict[str, Any]:
    metadata = compact_dict(
        {
            "collector": COLLECTOR_VERSION,
            "kind": "lte_sensor",
            "mode": config.mode,
            "sdr": "LibreSDR B220mini / B210",
            "uhd_args": config.uhd_args,
            "enabled": config.enabled,
            "profile": config.profile,
            "capability_warnings": capability_warnings(config),
            "api_mode": config.api_mode,
            "api_output": api_mode_label(config.api_mode),
            "probe_mode": summary.get("probe_mode"),
            "scan_attempt_count": summary.get("scan_attempt_count"),
            "state_only": summary_is_state_only(summary),
            "dl_freq_min_hz": config.dl_freq_min_hz,
            "dl_freq_max_hz": config.dl_freq_max_hz,
            "ul_freq_min_hz": config.ul_freq_min_hz,
            "ul_freq_max_hz": config.ul_freq_max_hz,
            "state_key": f"ltesniffer:lte_sensor:{config.sensor_id}",
        }
    )
    metadata["state_fingerprint"] = stable_hash(
        {"kind": "lte_sensor", "sensor_id": config.sensor_id, "mode": config.mode, "api_mode": config.api_mode, "enabled": config.enabled}
    )
    return {
        "timestamp": observed_at.isoformat(timespec="seconds"),
        "source": "ltesniffer",
        "sensor_id": config.sensor_id,
        "zone_id": config.zone_id,
        "protocol": "lte",
        "identity_hint": config.sensor_id,
        "rssi": rssi_from_summary(summary),
        "known": True,
        "metadata": metadata,
        "raw_payload": {"config": safe_config_payload(config), "summary": summary},
    }


def lte_decode_observation(config: LteSnifferConfig, *, summary: dict[str, Any], observed_at: datetime) -> dict[str, Any]:
    identity = decode_identity(config)
    best_cell = best_detected_cell(summary)
    carrier_candidates = enriched_carrier_candidates(summary, config)
    metadata = compact_dict(
        {
            "collector": COLLECTOR_VERSION,
            "kind": "lte_decode_status",
            "mode": config.mode,
            "channel_direction": config.mode,
            "decode_channel": decode_channel(config.mode),
            "dl_freq_hz": config.dl_freq_hz,
            "ul_freq_hz": config.ul_freq_hz,
            "dl_freq_min_hz": config.dl_freq_min_hz,
            "dl_freq_max_hz": config.dl_freq_max_hz,
            "ul_freq_min_hz": config.ul_freq_min_hz,
            "ul_freq_max_hz": config.ul_freq_max_hz,
            "cell_id": config.cell_id if config.cell_id is not None else (best_cell or {}).get("cell_id"),
            "prb": config.prb,
            "antennas": config.antennas,
            "workers": config.workers,
            "api_mode": config.api_mode,
            "api_output": api_mode_label(config.api_mode),
            "capability_warnings": capability_warnings(config),
            "processed_subframes": summary.get("processed_subframes"),
            "expected_subframes": summary.get("expected_subframes"),
            "snr_db": summary.get("snr_db"),
            "pdcch_observed": summary.get("pdcch_observed"),
            "dci_count": summary.get("dci_count"),
            "dci_formats": summary.get("dci_formats"),
            "pdsch_success_count": summary.get("pdsch_success_count"),
            "probe_mode": summary.get("probe_mode"),
            "scan_attempt_count": summary.get("scan_attempt_count"),
            "state_only": summary_is_state_only(summary),
            "cell_search_result_count": len(summary.get("cell_search_results") or []),
            "cell_search_detected_count": len([cell for cell in summary.get("cell_search_results") or [] if cell.get("detected")]),
            "best_cell": best_cell,
            "carrier_candidates": carrier_candidates,
            "carrier_candidate_count": len(carrier_candidates),
            "rnti_count": len(summary.get("rnti_activity") or []),
            "rnti_activity": summary.get("rnti_activity"),
            "identity_event_count": len(summary.get("identity_events") or []),
            "pcap_files": summary.get("pcap_files"),
            "component_modes": list((summary.get("components") or {}).keys()) or None,
            "component_decode_channels": [decode_channel(mode) for mode in (summary.get("components") or {}).keys()] or None,
            "decode_pipeline": decode_pipeline(config.mode),
            "state_key": f"ltesniffer:lte_decode_status:{identity.removeprefix('lte:')}",
        }
    )
    metadata["state_fingerprint"] = stable_hash({"kind": "lte_decode_status", "identity": identity, "summary": summary})
    return {
        "timestamp": observed_at.isoformat(timespec="seconds"),
        "source": "ltesniffer",
        "sensor_id": config.sensor_id,
        "zone_id": config.zone_id,
        "protocol": "lte",
        "identity_hint": identity,
        "rssi": rssi_from_summary(summary),
        "known": True,
        "metadata": metadata,
        "raw_payload": summary,
    }


def best_detected_cell(summary: dict[str, Any]) -> dict[str, Any] | None:
    cells = [cell for cell in summary.get("cell_search_results") or [] if cell.get("detected")]
    if not cells:
        return None
    return max(cells, key=lambda cell: (float(cell.get("detect_ratio_pct") or 0), float(cell.get("psr") or 0), float(cell.get("power_dbm") or -999)))


def enriched_carrier_candidates(summary: dict[str, Any], config: LteSnifferConfig) -> list[dict[str, Any]]:
    candidates = []
    for candidate in summary.get("carrier_candidates") or []:
        enriched = dict(candidate)
        if enriched.get("dl_freq_hz") is None and config.dl_freq_hz is not None:
            enriched["dl_freq_hz"] = config.dl_freq_hz
        if enriched.get("ul_freq_hz") is None and config.ul_freq_hz is not None:
            enriched["ul_freq_hz"] = config.ul_freq_hz
        candidates.append(compact_dict(enriched))
    return candidates


def decode_identity(config: LteSnifferConfig) -> str:
    if config.mode == "both":
        suffix = f"{config.dl_freq_hz or 'unset'}:{config.ul_freq_hz or 'unset'}"
        return f"lte:both-api:{suffix}" if config.api_mode is not None else f"lte:both:{suffix}"
    if config.mode == "uplink":
        suffix = f"{config.dl_freq_hz or 'unset'}:{config.ul_freq_hz or 'unset'}"
        return f"lte:uplink-api:{suffix}" if config.api_mode is not None else f"lte:uplink:{suffix}"
    if config.mode == "downlink":
        suffix = f"{config.dl_freq_hz or 'unset'}"
        return f"lte:downlink-api:{suffix}" if config.api_mode is not None else f"lte:downlink:{suffix}"
    return "lte:probe"


def summary_is_state_only(summary: dict[str, Any]) -> bool:
    return summary.get("probe_mode") == "range_scan"


def decode_channel(mode: str) -> str:
    if mode == "both":
        return "PDSCH/PUSCH"
    if mode == "downlink":
        return "PDSCH"
    if mode == "uplink":
        return "PUSCH"
    return "probe"


def decode_pipeline(mode: str) -> list[str]:
    channel = decode_channel(mode)
    if channel == "probe":
        return ["PDCCH", "DCI", "RNTI"]
    return ["PDCCH", "DCI", "RNTI", channel]


def api_mode_label(api_mode: int | None) -> str | None:
    labels = {
        0: "identity mapping",
        1: "IMSI collecting",
        2: "UECapability profiling",
        3: "identity mapping, IMSI collecting, and UECapability profiling",
    }
    return labels.get(api_mode)


def rssi_from_summary(summary: dict[str, Any]) -> int:
    if "snr_db" in summary:
        return max(-127, min(40, int(round(float(summary["snr_db"])))))
    processed = summary.get("processed_subframes")
    expected = summary.get("expected_subframes")
    if processed is not None and expected:
        return max(-127, min(0, int(round((float(processed) / float(expected) * 40) - 40))))
    return 0


def safe_config_payload(config: LteSnifferConfig) -> dict[str, Any]:
    return {
        "mode": config.mode,
        "enabled": config.enabled,
        "profile": config.profile,
        "binary": config.binary,
        "workdir": config.workdir,
        "sensor_id": config.sensor_id,
        "zone_id": config.zone_id,
        "dl_freq_hz": config.dl_freq_hz,
        "ul_freq_hz": config.ul_freq_hz,
        "dl_freq_min_hz": config.dl_freq_min_hz,
        "dl_freq_max_hz": config.dl_freq_max_hz,
        "ul_freq_min_hz": config.ul_freq_min_hz,
        "ul_freq_max_hz": config.ul_freq_max_hz,
        "cell_id": config.cell_id,
        "prb": config.prb,
        "antennas": config.antennas,
        "workers": config.workers,
        "api_mode": config.api_mode,
        "api_output": api_mode_label(config.api_mode),
        "uhd_args": config.uhd_args,
        "run_seconds": config.run_seconds,
        "unmask_identities": config.unmask_identities,
        "suppress_stderr": config.suppress_stderr,
        "force_scan_ranges": config.force_scan_ranges,
        "capability_warnings": capability_warnings(config),
    }


def capability_warnings(config: LteSnifferConfig) -> list[str]:
    if config.enabled and config.profile == "band48_cbrs_tdd":
        return [BAND48_LTESNIFFER_WARNING]
    return []


def compact_dict(value: dict[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item not in (None, "", [])}


def stable_hash(value: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()


def run_probe() -> str:
    result = subprocess.run(["uhd_find_devices"], check=False, capture_output=True, text=True, timeout=15)
    return "\n".join(part for part in [result.stdout, result.stderr] if part)


def run_ltesniffer(config: LteSnifferConfig) -> str:
    outputs = [output for _mode, output in run_ltesniffer_passes(config)]
    return "\n".join(outputs)


def run_ltesniffer_passes(config: LteSnifferConfig) -> list[tuple[str, str]]:
    workdir = Path(config.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for mode, command in build_ltesniffer_commands(config):
        output = run_ltesniffer_command(config, mode=mode, command=command, workdir=workdir)
        outputs.append((mode, output))
    return outputs


def run_ltesniffer_command(config: LteSnifferConfig, *, mode: str, command: list[str], workdir: Path) -> str:
    started_at = datetime.now(UTC)
    output_chunks: list[str] = []
    process: subprocess.Popen[str] | None = None
    write_runtime_state(
        config,
        {
            "status": "starting",
            "active": True,
            "mode": mode,
            "command": command,
            "command_text": " ".join(command),
            "started_at": started_at.isoformat(),
            "updated_at": started_at.isoformat(),
            "run_seconds": config.run_seconds,
            "elapsed_seconds": 0,
            "raw_output_tail": "",
        },
    )
    try:
        stderr = subprocess.DEVNULL if config.suppress_stderr else subprocess.PIPE
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=stderr,
            text=True,
            cwd=workdir,
            bufsize=1,
        )
        stream_queue: queue.Queue[tuple[str, str]] = queue.Queue()
        readers = start_stream_readers(process, stream_queue, capture_stderr=not config.suppress_stderr)
        deadline = time.monotonic() + max(1, config.run_seconds)
        last_write = 0.0
        timed_out = False
        while True:
            now = time.monotonic()
            timeout = max(0.0, min(0.25, deadline - now))
            try:
                _stream_name, line = stream_queue.get(timeout=timeout)
                output_chunks.append(line)
                if now - last_write >= RUNTIME_UPDATE_INTERVAL_SECONDS:
                    write_ltesniffer_runtime_progress(config, mode, command, started_at, output_chunks, status="running", active=True)
                    last_write = now
            except queue.Empty:
                pass
            if process.poll() is not None:
                drain_stream_queue(stream_queue, output_chunks)
                break
            if time.monotonic() >= deadline:
                timed_out = True
                process.kill()
                drain_process_after_kill(process, output_chunks)
                drain_stream_queue(stream_queue, output_chunks)
                break
        for reader in readers:
            reader.join(timeout=0.5)
        drain_stream_queue(stream_queue, output_chunks)
        output = "".join(output_chunks)
        write_ltesniffer_runtime_progress(
            config,
            mode,
            command,
            started_at,
            output_chunks,
            status="timeout" if timed_out else "complete",
            active=False,
            return_code=process.returncode,
        )
        return output
    except Exception as exc:
        write_runtime_state(
            config,
            {
                "status": "error",
                "active": False,
                "mode": mode,
                "command": command,
                "command_text": " ".join(command),
                "started_at": started_at.isoformat(),
                "updated_at": datetime.now(UTC).isoformat(),
                "run_seconds": config.run_seconds,
                "elapsed_seconds": round((datetime.now(UTC) - started_at).total_seconds(), 2),
                "error": str(exc),
                "raw_output_tail": tail_text("".join(output_chunks)),
            },
        )
        if process and process.poll() is None:
            process.kill()
        raise


def start_stream_readers(process: subprocess.Popen[str], stream_queue: queue.Queue[tuple[str, str]], *, capture_stderr: bool) -> list[threading.Thread]:
    readers = []
    if process.stdout is not None:
        readers.append(start_stream_reader("stdout", process.stdout, stream_queue))
    if capture_stderr and process.stderr is not None:
        readers.append(start_stream_reader("stderr", process.stderr, stream_queue))
    return readers


def start_stream_reader(name: str, stream: Any, stream_queue: queue.Queue[tuple[str, str]]) -> threading.Thread:
    def read_stream() -> None:
        try:
            for line in stream:
                stream_queue.put((name, line))
        finally:
            try:
                stream.close()
            except Exception:
                pass

    reader = threading.Thread(target=read_stream, name=f"ltesniffer-{name}-reader", daemon=True)
    reader.start()
    return reader


def drain_stream_queue(stream_queue: queue.Queue[tuple[str, str]], output_chunks: list[str]) -> None:
    while True:
        try:
            _stream_name, line = stream_queue.get_nowait()
            output_chunks.append(line)
        except queue.Empty:
            return


def drain_process_after_kill(process: subprocess.Popen[str], output_chunks: list[str]) -> None:
    try:
        stdout, stderr = process.communicate(timeout=1)
    except Exception:
        return
    output = process_output(stdout, stderr)
    if output:
        output_chunks.append(output if output.endswith("\n") else f"{output}\n")


def write_ltesniffer_runtime_progress(
    config: LteSnifferConfig,
    mode: str,
    command: list[str],
    started_at: datetime,
    output_chunks: list[str],
    *,
    status: str,
    active: bool,
    return_code: int | None = None,
) -> None:
    now = datetime.now(UTC)
    output = "".join(output_chunks)
    parsed = parse_ltesniffer_output(output, unmask_identities=config.unmask_identities)
    write_runtime_state(
        config,
        compact_dict(
            {
                "status": status,
                "active": active,
                "mode": mode,
                "command": command,
                "command_text": " ".join(command),
                "started_at": started_at.isoformat(),
                "updated_at": now.isoformat(),
                "run_seconds": config.run_seconds,
                "elapsed_seconds": round((now - started_at).total_seconds(), 2),
                "return_code": return_code,
                "summary": parsed,
                "raw_output_tail": tail_text(output),
            }
        ),
    )


def write_runtime_state(config: LteSnifferConfig, payload: dict[str, Any]) -> None:
    path = runtime_state_path(config.workdir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    tmp_path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp_path.replace(path)


def runtime_state_path(workdir: str) -> Path:
    return Path(workdir) / RUNTIME_STATE_FILENAME


def process_output(stdout: str | bytes | None, stderr: str | bytes | None) -> str:
    return "\n".join(part for part in [output_text(stdout), output_text(stderr)] if part)


def output_text(value: str | bytes | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        return value.decode(errors="replace")
    return value


def collect_probe_summary(config: LteSnifferConfig) -> dict[str, Any]:
    if config.enabled and has_downlink_scan_range(config):
        return run_ltesniffer_range_scan(config)
    output = run_probe()
    summary = parse_ltesniffer_output(output, unmask_identities=config.unmask_identities)
    return {**summary, "probe_mode": "hardware_probe", "probe_output": output[-2000:]}


def has_downlink_scan_range(config: LteSnifferConfig) -> bool:
    return config.force_scan_ranges or config.dl_freq_min_hz is not None or config.dl_freq_max_hz is not None


def scan_frequencies_hz(config: LteSnifferConfig) -> list[int]:
    if config.dl_freq_hz is not None and not config.force_scan_ranges:
        return [config.dl_freq_hz]
    lower = config.dl_freq_min_hz
    upper = config.dl_freq_max_hz
    if config.force_scan_ranges and lower is None and upper is None and config.profile == "band48_cbrs_tdd":
        lower = BAND48_MIN_HZ
        upper = BAND48_MAX_HZ
    if lower is None and upper is None:
        return []
    if lower is None:
        return [upper] if upper is not None else []
    if upper is None or upper <= lower:
        return [lower]
    step = PRB_BANDWIDTH_HZ.get(config.prb or 0, DEFAULT_SCAN_STEP_HZ)
    frequencies = list(range(lower, upper + 1, step))
    if frequencies[-1] != upper:
        frequencies.append(upper)
    if len(frequencies) <= MAX_SCAN_CARRIERS:
        return prioritize_configured_frequency(frequencies, config)
    indexes = sorted({round(index * (len(frequencies) - 1) / (MAX_SCAN_CARRIERS - 1)) for index in range(MAX_SCAN_CARRIERS)})
    return prioritize_configured_frequency([frequencies[index] for index in indexes], config)


def prioritize_configured_frequency(frequencies: list[int], config: LteSnifferConfig) -> list[int]:
    if config.dl_freq_hz is None:
        return frequencies
    lower = config.dl_freq_min_hz
    upper = config.dl_freq_max_hz
    if config.force_scan_ranges and lower is None and upper is None and config.profile == "band48_cbrs_tdd":
        lower = BAND48_MIN_HZ
        upper = BAND48_MAX_HZ
    if lower is not None and config.dl_freq_hz < lower:
        return frequencies
    if upper is not None and config.dl_freq_hz > upper:
        return frequencies
    return [config.dl_freq_hz, *[frequency for frequency in frequencies if frequency != config.dl_freq_hz]]


def range_scan_run_seconds(config: LteSnifferConfig, dl_freq_hz: int) -> int:
    if config.cell_id is not None:
        if config.dl_freq_hz == dl_freq_hz:
            return max(1, min(config.run_seconds, KNOWN_CELL_PRIMARY_SCAN_RUN_SECONDS))
        return max(1, min(config.run_seconds, KNOWN_CELL_SCAN_RUN_SECONDS))
    return max(1, min(config.run_seconds, CELL_SEARCH_SCAN_RUN_SECONDS))


def run_ltesniffer_range_scan(config: LteSnifferConfig) -> dict[str, Any]:
    attempts = []
    candidates = []
    for dl_freq_hz in scan_frequencies_hz(config):
        ul_freq_hz = scan_uplink_frequency_hz(config, dl_freq_hz)
        candidate_config = replace(
            config,
            enabled=True,
            mode="downlink",
            dl_freq_hz=dl_freq_hz,
            ul_freq_hz=ul_freq_hz,
            run_seconds=range_scan_run_seconds(config, dl_freq_hz),
        )
        scan_config = replace(
            candidate_config,
            prb=candidate_config.prb if candidate_config.cell_id is not None else None,
        )
        output = "\n".join(output for _mode, output in run_ltesniffer_passes(scan_config))
        parsed = parse_ltesniffer_output(output, unmask_identities=config.unmask_identities)
        detected_candidates = carrier_candidates_from_scan_result(candidate_config, parsed)
        attempts.append(
            compact_dict(
                {
                    "dl_freq_hz": dl_freq_hz,
                    "ul_freq_hz": ul_freq_hz,
                    "detected": bool(detected_candidates),
                    "command_mode": "known_cell" if scan_config.cell_id is not None else "cell_search",
                    "output_hints": output_hints(output, parsed),
                    "snr_db": parsed.get("snr_db"),
                    "pdcch_observed": parsed.get("pdcch_observed"),
                    "dci_count": parsed.get("dci_count"),
                    "pss_search_count": parsed.get("pss_search_count"),
                    "pss_peak_max": parsed.get("pss_peak_max"),
                    "pss_frame_count_max": parsed.get("pss_frame_count_max"),
                    "pss_state_last": parsed.get("pss_state_last"),
                    "output_tail": tail_text(output),
                    "artifacts": scan_artifacts(config.workdir),
                }
            )
        )
        candidates.extend(detected_candidates)
    summary = compact_dict(
        {
            "probe_mode": "range_scan",
            "scan_attempt_count": len(attempts),
            "scan_attempts": attempts,
            "carrier_candidates": dedupe_carrier_candidates(candidates),
        }
    )
    return summary


def output_hints(output: str, parsed: dict[str, Any]) -> list[str]:
    lowered = output.lower()
    hints = []
    if "uhd" in lowered and any(token in lowered for token in ["warn", "error", "late", "overflow", "timeout"]):
        hints.append("uhd_warning")
    if "search" in lowered and "cell" in lowered:
        hints.append("cell_search")
    if "no lte cell" in lowered or "cell not found" in lowered or "not found" in lowered:
        hints.append("no_lte_cell")
    if parsed.get("pdcch_observed"):
        hints.append("pdcch_observed")
    if parsed.get("dci_count"):
        hints.append("dci_observed")
    if parsed.get("snr_db") is not None:
        hints.append("snr_reported")
    if parsed.get("carrier_candidates"):
        hints.append("carrier_candidate")
    if parsed.get("pss_search_count"):
        hints.append("pss_search")
    if parsed.get("pss_search_count") and not parsed.get("pss_frame_count_max"):
        hints.append("pss_search_no_lock")
    if "actually got clock rate" in lowered or "set times next pps" in lowered:
        hints.append("receiver_initialized")
    if output.strip() and not any(hint in hints for hint in ["pdcch_observed", "dci_observed", "snr_reported", "carrier_candidate"]):
        hints.append("no_decode_summary")
    if not output.strip():
        hints.append("empty_output")
    return hints


def tail_text(output: str, *, limit: int = RAW_OUTPUT_TAIL_LIMIT) -> str:
    return output[-limit:] if len(output) > limit else output


def scan_artifacts(workdir: str) -> dict[str, int]:
    directory = Path(workdir)
    artifacts = {}
    for name in ["api_collector.pcap", "ltesniffer_dl_mode.pcap", "ltesniffer_ul_mode.pcap", "mcs_statistic.csv", "ul_sample.raw"]:
        path = directory / name
        if path.exists() and path.is_file():
            artifacts[name] = path.stat().st_size
    return artifacts


def scan_uplink_frequency_hz(config: LteSnifferConfig, dl_freq_hz: int) -> int | None:
    if config.ul_freq_hz is not None:
        return config.ul_freq_hz
    if config.ul_freq_min_hz is None and config.ul_freq_max_hz is None:
        return None
    if config.ul_freq_min_hz is not None and config.ul_freq_max_hz is not None:
        if config.dl_freq_min_hz is not None and config.dl_freq_max_hz is not None and config.dl_freq_max_hz > config.dl_freq_min_hz:
            ratio = (dl_freq_hz - config.dl_freq_min_hz) / (config.dl_freq_max_hz - config.dl_freq_min_hz)
            return int(round(config.ul_freq_min_hz + ratio * (config.ul_freq_max_hz - config.ul_freq_min_hz)))
        return config.ul_freq_min_hz
    return config.ul_freq_min_hz if config.ul_freq_min_hz is not None else config.ul_freq_max_hz


def carrier_candidates_from_scan_result(config: LteSnifferConfig, parsed: dict[str, Any]) -> list[dict[str, Any]]:
    parsed_candidates = parsed.get("carrier_candidates") or []
    if parsed_candidates:
        return [
            compact_dict(
                {
                    "dl_freq_hz": candidate.get("dl_freq_hz") or config.dl_freq_hz,
                    "ul_freq_hz": candidate.get("ul_freq_hz") or config.ul_freq_hz,
                    "earfcn": candidate.get("earfcn"),
                    "pci": candidate.get("pci"),
                    "cell_id": candidate.get("cell_id") or config.cell_id,
                    "prb": candidate.get("prb") or config.prb,
                    "snr_db": candidate.get("snr_db") or parsed.get("snr_db"),
                    "confidence": scan_candidate_confidence(candidate, parsed),
                }
            )
            for candidate in parsed_candidates
        ]
    if not scan_result_has_activity(parsed):
        return []
    return [
        compact_dict(
            {
                "dl_freq_hz": config.dl_freq_hz,
                "ul_freq_hz": config.ul_freq_hz,
                "cell_id": config.cell_id,
                "prb": config.prb,
                "snr_db": parsed.get("snr_db"),
                "confidence": scan_candidate_confidence({}, parsed),
            }
        )
    ]


def scan_result_has_activity(parsed: dict[str, Any]) -> bool:
    return bool(
        parsed.get("pdcch_observed")
        or parsed.get("dci_count")
        or parsed.get("rnti_activity")
        or parsed.get("identity_events")
        or parsed.get("snr_db") is not None
    )


def scan_candidate_confidence(candidate: dict[str, Any], parsed: dict[str, Any]) -> str:
    evidence_count = sum(
        value is not None
        for value in [
            candidate.get("cell_id"),
            candidate.get("pci"),
            candidate.get("prb"),
            candidate.get("earfcn"),
            candidate.get("snr_db") or parsed.get("snr_db"),
        ]
    )
    if evidence_count >= 4:
        return "high"
    if evidence_count >= 2 or parsed.get("pdcch_observed") or parsed.get("dci_count"):
        return "medium"
    return "low"


def dedupe_carrier_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped = []
    seen: set[tuple[Any, ...]] = set()
    for candidate in candidates:
        fingerprint = (
            candidate.get("dl_freq_hz"),
            candidate.get("ul_freq_hz"),
            candidate.get("earfcn"),
            candidate.get("pci"),
            candidate.get("cell_id"),
        )
        if fingerprint in seen:
            continue
        seen.add(fingerprint)
        deduped.append(candidate)
    return deduped


def collect_ltesniffer_summary(config: LteSnifferConfig) -> dict[str, Any]:
    if config.mode != "both":
        output = run_ltesniffer(config)
        return compact_dict({**parse_ltesniffer_output(output, unmask_identities=config.unmask_identities), "raw_output_tail": tail_text(output)})
    components = {
        mode: compact_dict({**parse_ltesniffer_output(output, unmask_identities=config.unmask_identities), "raw_output_tail": tail_text(output)})
        for mode, output in run_ltesniffer_passes(config)
    }
    return combine_ltesniffer_summaries(components)


def combine_ltesniffer_summaries(components: dict[str, dict[str, Any]]) -> dict[str, Any]:
    summary: dict[str, Any] = {"mode": "both", "components": components}
    for key in ["processed_subframes", "expected_subframes"]:
        values = [component.get(key) for component in components.values()]
        if values and all(isinstance(value, int) for value in values):
            summary[key] = sum(values)
    rnti_activity = []
    dci_activity = []
    identity_events = []
    pcap_files = []
    snr_values = []
    for component in components.values():
        rnti_activity.extend(component.get("rnti_activity") or [])
        dci_activity.extend(component.get("dci_activity") or [])
        identity_events.extend(component.get("identity_events") or [])
        for pcap in component.get("pcap_files") or []:
            if pcap not in pcap_files:
                pcap_files.append(pcap)
        if isinstance(component.get("snr_db"), int | float):
            snr_values.append(float(component["snr_db"]))
    if rnti_activity:
        summary["rnti_activity"] = rnti_activity
    if dci_activity:
        summary["dci_activity"] = dci_activity
    dci_count = sum(int(component.get("dci_count") or 0) for component in components.values())
    if dci_count:
        summary["dci_count"] = dci_count
    dci_formats = sorted({item for component in components.values() for item in (component.get("dci_formats") or [])})
    if dci_formats:
        summary["dci_formats"] = dci_formats
    pdsch_success_count = sum(int(component.get("pdsch_success_count") or 0) for component in components.values())
    if pdsch_success_count:
        summary["pdsch_success_count"] = pdsch_success_count
    if any(component.get("pdcch_observed") for component in components.values()):
        summary["pdcch_observed"] = True
    if identity_events:
        summary["identity_events"] = identity_events
    if pcap_files:
        summary["pcap_files"] = pcap_files
    if snr_values:
        summary["snr_db"] = round(sum(snr_values) / len(snr_values), 2)
    return summary


def submit_observations(observations: list[dict[str, Any]], *, base_url: str, api_key: str, timeout: float) -> list[dict[str, Any]]:
    results = []
    with httpx.Client(timeout=timeout) as client:
        for observation in observations:
            response = client.post(
                f"{base_url.rstrip('/')}/v1/observations",
                json=observation,
                headers={"x-tds-api-key": api_key},
            )
            response.raise_for_status()
            results.append(response.json())
    return results


def parse_args() -> argparse.Namespace:
    load_env_file()
    parser = argparse.ArgumentParser(description="Collect LTESniffer/LibreSDR LTE testbed state and submit TDS observations.")
    parser.add_argument("--mode", choices=["probe", "downlink", "uplink", "both", "api"], default=os.getenv("TDS_LTESNIFFER_MODE", "probe"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--http-timeout", type=float, default=10.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    env = dict(os.environ)
    env["TDS_LTESNIFFER_MODE"] = args.mode
    config = LteSnifferConfig.from_env(env)
    if config.mode == "probe":
        summary = collect_probe_summary(replace(config, mode="probe"))
    else:
        summary = collect_ltesniffer_summary(config)
    observations = collect_observations(config, summary=summary, observed_at=datetime.now(UTC))
    if args.dry_run:
        print(json.dumps({"observations": observations, "count": len(observations)}, indent=2))
        return
    results = submit_observations(observations, base_url=config.base_url, api_key=config.api_key, timeout=args.http_timeout)
    print(json.dumps({"submitted": len(results), "results": results}))


if __name__ == "__main__":
    main()
