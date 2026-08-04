from pydantic import BaseModel, Field


class CollectorService(BaseModel):
    id: str
    label: str
    service_name: str
    device_families: list[str] = Field(default_factory=list)
    roles: list[str] = Field(default_factory=list)
    start_mode: str
    settings_schema: dict[str, dict[str, object]] = Field(default_factory=dict)


COLLECTOR_SERVICES: list[CollectorService] = [
    CollectorService(
        id="openwrt",
        label="OpenWRT Network Collector",
        service_name="tds-openwrt-collect",
        device_families=[],
        roles=["router", "client_inventory", "dhcp", "wifi_association"],
        start_mode="timer",
        settings_schema={
            "url": {"type": "string", "secret": False},
            "username": {"type": "string", "secret": False},
            "password": {"type": "string", "secret": True},
            "verify_tls": {"type": "boolean", "default": False},
        },
    ),
    CollectorService(
        id="unifi",
        label="UniFi UDM Collector",
        service_name="tds-unifi-collect",
        device_families=[],
        roles=["controller", "wifi_clients", "alerts", "network_inventory"],
        start_mode="timer",
        settings_schema={
            "url": {"type": "string", "secret": False},
            "api_key": {"type": "string", "secret": True},
            "site_id": {"type": "string", "secret": False},
            "verify_tls": {"type": "boolean", "default": True},
        },
    ),
    CollectorService(
        id="kismet",
        label="Kismet RF Collector",
        service_name="tds-kismet-collect",
        device_families=["rtl_sdr", "nrf52", "wifi_adapter"],
        roles=["wifi", "ble", "zigbee", "airspace", "rf_presence"],
        start_mode="timer",
        settings_schema={
            "url": {"type": "string", "secret": False},
            "username": {"type": "string", "secret": False},
            "password": {"type": "string", "secret": True},
            "recent_seconds": {"type": "integer", "default": 60},
        },
    ),
    CollectorService(
        id="intercept",
        label="Intercept HTTP Collector",
        service_name="tds-intercept-collect",
        device_families=[],
        roles=["http_events", "rf_events", "rules"],
        start_mode="timer",
        settings_schema={
            "url": {"type": "string", "secret": False},
            "username": {"type": "string", "secret": False},
            "password": {"type": "string", "secret": True},
            "verify_tls": {"type": "boolean", "default": False},
        },
    ),
    CollectorService(
        id="intercept_mqtt",
        label="Intercept MQTT Collector",
        service_name="tds-intercept-mqtt-collect",
        device_families=["hackrf"],
        roles=["hackrf_rotation", "mqtt_events", "rf_identity"],
        start_mode="continuous",
        settings_schema={
            "mqtt_url": {"type": "string", "secret": False},
            "topic": {"type": "string", "default": "intercept/#"},
        },
    ),
    CollectorService(
        id="rail_rf",
        label="Rail RF Collector",
        service_name="tds-rail-rf-collect",
        device_families=["rtl_sdr"],
        roles=["rail", "rf_spectrum", "transport"],
        start_mode="timer",
        settings_schema={
            "rtl_device": {"type": "string", "secret": False},
            "scan_seconds": {"type": "integer", "default": 8},
            "catalog": {"type": "string", "secret": False},
        },
    ),
    CollectorService(
        id="ble_analyzer",
        label="BLE Analyzer Collector",
        service_name="tds-ble-analyzer-collect",
        device_families=["ble_analyzer"],
        roles=["ble", "nearby_devices", "identity_presence"],
        start_mode="timer",
        settings_schema={
            "capture_seconds": {"type": "integer", "default": 8},
            "pcap_dir": {"type": "string", "secret": False},
        },
    ),
    CollectorService(
        id="ltesniffer_probe",
        label="LTESniffer Probe",
        service_name="tds-ltesniffer-collect",
        device_families=["usrp_b210"],
        roles=["lte_probe", "cellular_lab", "downlink"],
        start_mode="manual",
        settings_schema={
            "profile": {"type": "string", "required": False, "default": "band48_cbrs_tdd"},
            "mode": {"type": "string", "required": False, "default": "probe"},
            "dl_freq_hz": {"type": "integer", "required": False},
            "ul_freq_hz": {"type": "integer", "required": False},
            "dl_freq_min_hz": {"type": "integer", "required": False},
            "dl_freq_max_hz": {"type": "integer", "required": False},
            "ul_freq_min_hz": {"type": "integer", "required": False},
            "ul_freq_max_hz": {"type": "integer", "required": False},
            "run_seconds": {"type": "integer", "default": 20},
            "uhd_args": {"type": "string", "secret": False},
        },
    ),
    CollectorService(
        id="ltesniffer_scan",
        label="LTESniffer Range Scan",
        service_name="tds-ltesniffer-scan",
        device_families=["usrp_b210"],
        roles=["lte_scan", "cellular_lab", "carrier_discovery"],
        start_mode="manual",
        settings_schema={
            "profile": {"type": "string", "required": False, "default": "band48_cbrs_tdd"},
            "mode": {"type": "string", "required": False, "default": "probe"},
            "dl_freq_hz": {"type": "integer", "required": False},
            "ul_freq_hz": {"type": "integer", "required": False},
            "dl_freq_min_hz": {"type": "integer", "required": False},
            "dl_freq_max_hz": {"type": "integer", "required": False},
            "ul_freq_min_hz": {"type": "integer", "required": False},
            "ul_freq_max_hz": {"type": "integer", "required": False},
            "run_seconds": {"type": "integer", "default": 20},
            "uhd_args": {"type": "string", "secret": False},
        },
    ),
    CollectorService(
        id="ltesniffer_live",
        label="LTESniffer Live Decode",
        service_name="tds-ltesniffer-live",
        device_families=["usrp_b210"],
        roles=["lte_live", "pdsch", "pusch", "private_cellular_lab"],
        start_mode="manual",
        settings_schema={
            "profile": {"type": "string", "required": False, "default": "band48_cbrs_tdd"},
            "mode": {"type": "string", "required": True, "default": "both"},
            "dl_freq_hz": {"type": "integer", "required": True},
            "ul_freq_hz": {"type": "integer", "required": False},
            "dl_freq_min_hz": {"type": "integer", "required": False},
            "dl_freq_max_hz": {"type": "integer", "required": False},
            "ul_freq_min_hz": {"type": "integer", "required": False},
            "ul_freq_max_hz": {"type": "integer", "required": False},
            "cell_id": {"type": "integer", "required": False},
            "prb": {"type": "integer", "required": False},
            "api_mode": {"type": "integer", "required": False},
            "antennas": {"type": "integer", "default": 2},
            "workers": {"type": "integer", "default": 4},
            "run_seconds": {"type": "integer", "default": 20},
            "uhd_args": {"type": "string", "secret": False},
            "workdir": {"type": "string", "secret": False},
            "unmask_identities": {"type": "boolean", "default": False},
            "suppress_stderr": {"type": "boolean", "default": True},
        },
    ),
]


def list_collector_services() -> list[CollectorService]:
    return COLLECTOR_SERVICES
