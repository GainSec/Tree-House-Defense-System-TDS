import type { SituationModel } from "../data/situationModel";
import type { SituationDataStatus } from "../data/useSituationData";
import type { NetworkClient } from "../domain/types";
import type { CSSProperties, ReactNode } from "react";

export function SituationRail({
  model,
  status,
  error,
  clients = [],
  onSelectClient,
  cardControls,
  cardStyle
}: {
  model: SituationModel | null;
  status: SituationDataStatus;
  error: string | null;
  clients?: NetworkClient[];
  onSelectClient?: (client: NetworkClient) => void;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
}) {
  const clientsByMac = new Map(clients.map((client) => [client.mac_address.toLowerCase(), client]));
  return (
    <aside className="situation-rail live-panel" aria-label="3D situation context" style={cardStyle}>
      <header className="situation-rail-header">
        <span className="panel-label">Phase 1 context</span>
        <h2>Situation Context</h2>
      </header>
      {cardControls}
      {error ? <span className="hud-error">{error}</span> : null}
      {model ? (
        <>
          <section className="situation-section live-panel-section">
            <h3>Connected Clients</h3>
            <div className="situation-stat-row">
              <strong>{model.clients.total} clients</strong>
              <span>{model.clients.multiSource} multi-source</span>
            </div>
            <ul className="mini-list">
              {model.clients.visible.slice(0, 4).map((client) => {
                const fullClient = clientsByMac.get(client.mac.toLowerCase());
                return (
                <li key={client.id}>
                  {fullClient && onSelectClient ? (
                    <button type="button" className="mini-list-action" aria-label={`${client.label} ${client.ip ?? client.mac}`} onClick={() => onSelectClient(fullClient)}>
                      <strong>{client.label}</strong>
                      <span>{client.ip ?? client.mac}</span>
                    </button>
                  ) : (
                    <>
                      <strong>{client.label}</strong>
                      <span>{client.ip ?? client.mac}</span>
                    </>
                  )}
                </li>
              );
              })}
            </ul>
          </section>

          <section className="situation-section live-panel-section">
            <h3>RF Hardware</h3>
            <div className="situation-stat-row">
              <strong>{model.hardware.devices} devices</strong>
              <span>{model.hardware.spectrumPeaks} spectrum peaks</span>
            </div>
            <ul className="mini-list">
              {model.hardware.examples.slice(0, 3).map((device) => (
                <li key={device.id}>
                  <strong>{device.label}</strong>
                  <span>{device.source} / {device.kind}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="situation-section live-panel-section">
            <h3>Setup Gaps</h3>
            {model.setupGaps.length > 0 ? (
              <div className="setup-gap-list">
                {model.setupGaps.map((gap) => (
                  <span key={gap}>{gap}</span>
                ))}
              </div>
            ) : (
              <span className="muted-line">Inventory configured</span>
            )}
          </section>
        </>
      ) : (
        <p className="infra-alert-empty">Loading situation context</p>
      )}
    </aside>
  );
}
