import type { InfrastructureAlert, InfrastructureAlertStatus } from "../data/useInfrastructureAlerts";
import type { CSSProperties, ReactNode } from "react";

export interface InfrastructureAlertCardProps {
  alerts: InfrastructureAlert[];
  status: InfrastructureAlertStatus;
  totalCount: number;
  error: string | null;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
}

export function InfrastructureAlertCard({ alerts, status, totalCount, error, cardControls, cardStyle }: InfrastructureAlertCardProps) {
  const isActive = alerts.length > 0 && status !== "error";

  const className = ["infra-alert-card", "posture-stack-card", isActive ? "is-active" : ""].filter(Boolean).join(" ");

  return (
    <section className={className} aria-label="Live UniFi and OpenWrt alerts" style={cardStyle}>
      <div className="infra-alert-bleed" />
      <div className="infra-alert-lightning" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <header className="infra-alert-header">
        <div>
          <span className="panel-label">Realtime alarms</span>
          <h2>UniFi / OpenWrt Alerts</h2>
        </div>
        <span className={`infra-alert-state is-${status}`}>{status}</span>
      </header>
      {cardControls}
      <div className="infra-alert-meta">
        <span>{totalCount} infrastructure events</span>
        {error ? <span className="hud-error">{error}</span> : null}
      </div>
      {alerts.length > 0 ? (
        <ol className="infra-alert-list">
          {alerts.map((alert) => (
            <li key={alert.id} className={`infra-alert-item severity-${alert.severity}`}>
              <div className="infra-alert-row">
                <span className="infra-alert-source">{alert.source}</span>
                <span className="infra-alert-severity">{alert.severity}</span>
                <time dateTime={alert.createdAt ?? undefined}>{formatAlertTime(alert.createdAt)}</time>
              </div>
              <strong>{alert.summary}</strong>
              {alert.details.length > 0 ? <span className="infra-alert-details">{alert.details.join(" · ")}</span> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="infra-alert-empty">No live UniFi/OpenWrt alarms</p>
      )}
    </section>
  );
}

function formatAlertTime(value: string | null): string {
  if (!value) {
    return "time unknown";
  }
  return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}
