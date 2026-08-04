import json

from app.models import Event
from app.settings import Settings


def event_topic(event: Event) -> str:
    return "rf/events"


def serialize_event(event: Event) -> dict:
    return {
        "id": event.id,
        "type": event.type,
        "severity": event.severity,
        "confidence": event.confidence,
        "zone_id": event.zone_id,
        "summary": event.summary,
        "observation_refs": event.observation_refs,
        "payload": event.payload,
        "created_at": event.created_at.isoformat() if event.created_at else None,
    }


def publish_event(event: Event, settings: Settings) -> bool:
    if not settings.mqtt_enabled:
        return True

    try:
        import paho.mqtt.client as mqtt

        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=10)
        info = client.publish(event_topic(event), json.dumps(serialize_event(event)), qos=0, retain=False)
        info.wait_for_publish(timeout=2)
        client.disconnect()
        return info.rc == mqtt.MQTT_ERR_SUCCESS
    except Exception:
        return False
