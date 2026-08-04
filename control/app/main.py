import os
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .collectors import CollectorService, list_collector_services


class UsbDevice(BaseModel):
    vendor_id: str
    product_id: str
    manufacturer: str
    product: str
    serial: str
    bus_path: str
    speed: str
    driver: str
    stable_id: str
    family: str


class ServiceActionPayload(BaseModel):
    action: str


ALLOWED_SERVICE_ACTIONS = {"test", "restart", "start", "stop"}

app = FastAPI(title="TDS Control Sidecar", version="0.1.0")


def read_usb_devices(sys_bus_usb_path: Path = Path("/sys/bus/usb/devices")) -> list[UsbDevice]:
    records: list[dict[str, str]] = []
    if not sys_bus_usb_path.exists():
        return []

    for device_dir in sorted(path for path in sys_bus_usb_path.iterdir() if path.is_dir()):
        vendor_id = read_sysfs_text(device_dir / "idVendor")
        product_id = read_sysfs_text(device_dir / "idProduct")
        if not vendor_id or not product_id:
            continue

        records.append(
            {
                "vendor_id": vendor_id.lower(),
                "product_id": product_id.lower(),
                "manufacturer": read_sysfs_text(device_dir / "manufacturer"),
                "product": read_sysfs_text(device_dir / "product"),
                "serial": read_sysfs_text(device_dir / "serial"),
                "bus_path": device_dir.name,
                "speed": read_sysfs_text(device_dir / "speed"),
                "driver": read_driver_name(device_dir / "driver"),
            }
        )

    serial_identity_counts: dict[str, int] = {}
    for record in records:
        if record["serial"]:
            identity = serial_identity_key(record["vendor_id"], record["product_id"], record["serial"])
            serial_identity_counts[identity] = serial_identity_counts.get(identity, 0) + 1

    devices: list[UsbDevice] = []
    for record in records:
        stable_id = build_stable_id(
            record["vendor_id"],
            record["product_id"],
            record["serial"],
            record["bus_path"],
            serial_identity_counts.get(serial_identity_key(record["vendor_id"], record["product_id"], record["serial"]), 0) > 1,
        )
        devices.append(
            UsbDevice(
                vendor_id=record["vendor_id"],
                product_id=record["product_id"],
                manufacturer=record["manufacturer"],
                product=record["product"],
                serial=record["serial"],
                bus_path=record["bus_path"],
                speed=record["speed"],
                driver=record["driver"],
                stable_id=stable_id,
                family=classify_usb_device(record["vendor_id"], record["product_id"], record["product"]),
            )
        )
    return devices


def classify_usb_device(vendor_id: str, product_id: str, product: str = "") -> str:
    vid = vendor_id.lower()
    pid = product_id.lower()
    name = product.lower()

    if vid == "1d6b" or "xhci host controller" in name or "root hub" in name or name in {"usb hub", "usb2.0 hub"}:
        return "usb_topology"
    if (vid, pid) == ("2109", "2817") or (vid, pid) == ("1a86", "8091"):
        return "usb_topology"
    if (vid, pid) == ("0e8d", "7961") or ("wireless_device" in name and vid == "0e8d"):
        return "wifi_bt_adapter"
    if (vid, pid) in {("0bda", "2838"), ("0bda", "2832")} or "rtl2838" in name or "rtl-sdr" in name:
        return "rtl_sdr"
    if (vid, pid) in {("1d50", "6089"), ("1d50", "cc15")} or "hackrf" in name:
        return "hackrf"
    if vid == "2500" or "usrp b210" in name or "libresdr" in name or "b210" in name:
        return "usrp_b210"
    if vid == "1915" or "nrf52" in name or "nrf52840" in name or "nordic" in name:
        return "nrf52"
    if "ble analyzer" in name or "bluetooth analyzer" in name:
        return "ble_analyzer"
    if "gps" in name or "gnss" in name or "u-blox" in name or "ublox" in name:
        return "gps"
    return "unknown"


def read_sysfs_text(path: Path) -> str:
    try:
        return path.read_text().strip()
    except OSError:
        return ""


def read_driver_name(path: Path) -> str:
    if not path.is_symlink():
        return ""
    try:
        return Path(os.readlink(path)).name
    except OSError:
        return ""


def serial_identity_key(vendor_id: str, product_id: str, serial: str) -> str:
    return f"{vendor_id.lower()}:{product_id.lower()}:{serial}"


def build_stable_id(vendor_id: str, product_id: str, serial: str, bus_path: str, force_bus_path: bool = False) -> str:
    vid = vendor_id.lower()
    pid = product_id.lower()
    if serial:
        if force_bus_path:
            return f"usb:{vid}:{pid}:{serial}:path:{bus_path}"
        return f"usb:{vid}:{pid}:{serial}"
    return f"usb:{vid}:{pid}:path:{bus_path}"


@app.get("/control/health")
def control_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/control/usb")
def control_usb() -> dict[str, list[UsbDevice]]:
    sysfs_path = Path(os.environ.get("TDS_CONTROL_SYS_USB_PATH", "/sys/bus/usb/devices"))
    return {"devices": read_usb_devices(sysfs_path)}


@app.get("/control/services")
def control_services() -> dict[str, list[CollectorService]]:
    return {"services": list_collector_services()}


@app.post("/control/services/{collector_id}/actions")
def control_service_action(collector_id: str, payload: ServiceActionPayload) -> dict[str, str]:
    action = payload.action.strip().lower()
    if action not in ALLOWED_SERVICE_ACTIONS:
        raise HTTPException(status_code=422, detail=f"Unsupported collector action: {payload.action}")

    service = next((service for service in list_collector_services() if service.id == collector_id), None)
    if service is None:
        raise HTTPException(status_code=404, detail="Unknown collector")

    if action == "test":
        return {
            "collector_id": collector_id,
            "service_name": service.service_name,
            "action": action,
            "status": "ok",
            "message": f"{service.service_name} is known to the TDS control manifest.",
        }

    if os.environ.get("TDS_CONTROL_ENABLE_HOST_ACTIONS") != "1":
        return {
            "collector_id": collector_id,
            "service_name": service.service_name,
            "action": action,
            "status": "accepted",
            "message": f"{action} requested for {service.service_name}; host execution is disabled in this sidecar.",
        }

    result = subprocess.run(user_systemd_command(action, service.service_name), capture_output=True, text=True, timeout=30, check=False)
    status = "ok" if result.returncode == 0 else "error"
    unit_name = systemd_unit_name(service.service_name)
    message = f"{action} requested for {unit_name}" if status == "ok" else (result.stderr or result.stdout or f"systemd {action} exited {result.returncode}").strip()
    return {
        "collector_id": collector_id,
        "service_name": service.service_name,
        "action": action,
        "status": status,
        "message": message,
    }


def user_systemd_command(action: str, service_name: str) -> list[str]:
    method = {
        "start": "StartUnit",
        "restart": "RestartUnit",
        "stop": "StopUnit",
    }.get(action, "StartUnit")
    return [
        "busctl",
        "--user",
        "call",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
        method,
        "ss",
        systemd_unit_name(service_name),
        "replace",
    ]


def systemd_unit_name(service_name: str) -> str:
    return service_name if service_name.endswith(".service") else f"{service_name}.service"
