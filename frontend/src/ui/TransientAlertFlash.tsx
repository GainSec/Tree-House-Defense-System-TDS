import { useEffect, useRef, useState } from "react";
import type { InfrastructureAlert } from "../data/useInfrastructureAlerts";

interface AlertFlash {
  id: string;
  alert: InfrastructureAlert;
}

export function TransientAlertFlash({ alerts, durationMs = 3_000 }: { alerts: InfrastructureAlert[]; durationMs?: number }) {
  const initialized = useRef(false);
  const knownIds = useRef(new Set<string>());
  const timeoutIds = useRef<number[]>([]);
  const [flashes, setFlashes] = useState<AlertFlash[]>([]);

  useEffect(() => {
    if (!initialized.current) {
      knownIds.current = new Set(alerts.map((alert) => alert.id));
      initialized.current = true;
      return;
    }

    const incoming = alerts.filter((alert) => !knownIds.current.has(alert.id));
    alerts.forEach((alert) => knownIds.current.add(alert.id));

    if (incoming.length === 0) {
      return;
    }

    setFlashes((current) => [...incoming.map((alert) => ({ id: alert.id, alert })), ...current].slice(0, 4));
    incoming.forEach((alert) => {
      const timeoutId = window.setTimeout(() => {
        setFlashes((current) => current.filter((flash) => flash.id !== alert.id));
      }, durationMs);
      timeoutIds.current.push(timeoutId);
    });
  }, [alerts, durationMs]);

  useEffect(() => {
    return () => {
      timeoutIds.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  if (flashes.length === 0) {
    return null;
  }

  return (
    <section className="transient-alert-stack" aria-label="New realtime alerts">
      {flashes.map(({ id, alert }) => (
        <article key={id} className={`transient-alert severity-${alert.severity}`}>
          <div className="transient-alert-row">
            <span>New alert</span>
            <strong>{alert.source}</strong>
            <em>{alert.severity}</em>
          </div>
          <p>{alert.summary}</p>
          {alert.details.length > 0 ? <small>{alert.details.slice(0, 4).join(" · ")}</small> : null}
        </article>
      ))}
    </section>
  );
}
