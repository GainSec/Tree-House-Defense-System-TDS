import type { SceneModel } from "../data/sceneModel";
import type { LayerLensMode } from "./useLayerLens";

export type OperatorPresetId = "all" | "rf" | "airspace" | "sources" | "alerts" | "investigate";

export interface OperatorPreset {
  id: OperatorPresetId;
  label: string;
  lensMode: LayerLensMode;
}

export interface ScenarioSnapshot {
  timestamp: string;
  selected: { id: string; label: string; kind: string } | null;
  counts: {
    rfVisible: number;
    aircraftVisible: number;
    rfTotal: number;
    aircraftTotal: number;
  };
  rfSample: Array<{ id: string; label: string; source: string; protocol: string; rssi: number | null; freshness: string }>;
  aircraftSample: Array<{ id: string; label: string; altitude: number | null; speed: number | null; heading: number }>;
}

export const OPERATOR_PRESETS: OperatorPreset[] = [
  { id: "all", label: "All", lensMode: "all" },
  { id: "rf", label: "RF", lensMode: "rf" },
  { id: "airspace", label: "Airspace", lensMode: "airspace" },
  { id: "sources", label: "Sources", lensMode: "hardware" },
  { id: "alerts", label: "Alerts", lensMode: "alerts" },
  { id: "investigate", label: "Investigate", lensMode: "events" }
];

export function buildScenarioSnapshot({
  sceneModel,
  selectedId,
  timestamp = new Date().toISOString()
}: {
  sceneModel: SceneModel;
  selectedId: string | null;
  timestamp?: string;
}): ScenarioSnapshot {
  const selectedEntity = [...sceneModel.rfEntities, ...sceneModel.aircraftEntities].find((entity) => entity.id === selectedId) ?? null;
  return {
    timestamp,
    selected: selectedEntity ? { id: selectedEntity.id, label: selectedEntity.label, kind: selectedEntity.kind } : null,
    counts: {
      rfVisible: sceneModel.rfEntities.length,
      aircraftVisible: sceneModel.aircraftEntities.length,
      rfTotal: sceneModel.counts.rfTotal,
      aircraftTotal: sceneModel.counts.aircraftTotal
    },
    rfSample: sceneModel.rfEntities.slice(0, 12).map((entity) => ({
      id: entity.id,
      label: entity.label,
      source: entity.source,
      protocol: entity.protocol,
      rssi: entity.rssi,
      freshness: entity.freshness
    })),
    aircraftSample: sceneModel.aircraftEntities.slice(0, 8).map((entity) => ({
      id: entity.id,
      label: entity.label,
      altitude: entity.altitude,
      speed: entity.speed,
      heading: entity.heading
    }))
  };
}

export function scenarioBundleFilename(snapshot: ScenarioSnapshot): string {
  return `tds-scenario-${snapshot.timestamp.replace(/[:.]/g, "-")}.html`;
}

export function buildScenarioBundleHtml(snapshot: ScenarioSnapshot): string {
  const selectedLabel = snapshot.selected ? escapeHtml(snapshot.selected.label) : "No selection";
  const rfRows = snapshot.rfSample.map((entity) => `<tr><td>${escapeHtml(entity.label)}</td><td>${escapeHtml(entity.source)}</td><td>${escapeHtml(entity.protocol)}</td><td>${entity.rssi ?? "unknown"}</td><td>${escapeHtml(entity.freshness)}</td></tr>`).join("");
  const aircraftRows = snapshot.aircraftSample.map((entity) => `<tr><td>${escapeHtml(entity.label)}</td><td>${entity.altitude ?? "unknown"}</td><td>${entity.speed ?? "unknown"}</td><td>${entity.heading}</td></tr>`).join("");
  const json = escapeHtml(JSON.stringify(snapshot, null, 2));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TDS Scenario Snapshot</title>
  <style>
    body{margin:0;font-family:Inter,Arial,sans-serif;background:#071216;color:#dcefff}
    main{max-width:980px;margin:0 auto;padding:24px}
    h1{font-size:24px;margin:0 0 6px}
    section{margin-top:18px;padding:14px;border:1px solid rgba(125,242,230,.22);background:rgba(3,12,15,.72)}
    dl{display:grid;grid-template-columns:160px 1fr;gap:8px 12px}
    dt{color:rgba(220,239,255,.62)}dd{margin:0;font-weight:700}
    table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:7px;border-bottom:1px solid rgba(125,242,230,.14);text-align:left}
    pre{white-space:pre-wrap;overflow:auto;color:#b9fff7}
  </style>
</head>
<body>
  <main>
    <h1>TDS Scenario Snapshot</h1>
    <span>${escapeHtml(snapshot.timestamp)}</span>
    <section>
      <dl>
        <dt>Selected</dt><dd>${selectedLabel}</dd>
        <dt>RF Visible</dt><dd>${snapshot.counts.rfVisible} / ${snapshot.counts.rfTotal}</dd>
        <dt>Aircraft Visible</dt><dd>${snapshot.counts.aircraftVisible} / ${snapshot.counts.aircraftTotal}</dd>
      </dl>
    </section>
    <section><h2>RF Sample</h2><table><thead><tr><th>Label</th><th>Source</th><th>Protocol</th><th>RSSI</th><th>Freshness</th></tr></thead><tbody>${rfRows}</tbody></table></section>
    <section><h2>Aircraft Sample</h2><table><thead><tr><th>Label</th><th>Altitude</th><th>Speed</th><th>Heading</th></tr></thead><tbody>${aircraftRows}</tbody></table></section>
    <section><h2>Embedded JSON</h2><script type="application/json" id="tds-scenario-json">${json}</script><pre>${json}</pre></section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function OperatorCommandRail({
  activePreset,
  replayFrozen,
  replayLabel,
  onPreset,
  onFreeze,
  onResume,
  onReplayPrevious,
  onReplayNext,
  onSnapshot
}: {
  activePreset: OperatorPresetId;
  replayFrozen: boolean;
  replayLabel: string;
  onPreset: (preset: OperatorPresetId) => void;
  onFreeze: () => void;
  onResume: () => void;
  onReplayPrevious: () => void;
  onReplayNext: () => void;
  onSnapshot: () => void;
}) {
  return (
    <aside className="operator-command-rail" aria-label="Operator command rail">
      <div className="operator-preset-group" aria-label="Operator presets">
        {OPERATOR_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={preset.id === activePreset ? "is-active" : ""}
            aria-label={`Preset ${preset.label}`}
            aria-pressed={preset.id === activePreset}
            onClick={() => onPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="operator-command-actions">
        <button type="button" className={replayFrozen ? "is-hot" : ""} onClick={replayFrozen ? onResume : onFreeze} aria-label={replayFrozen ? "Resume live scene" : "Freeze live scene"}>
          {replayFrozen ? "Live" : "Freeze"}
        </button>
        {replayFrozen ? (
          <>
            <button type="button" onClick={onReplayPrevious} aria-label="Replay previous frame">Prev</button>
            <span className="replay-status">{replayLabel}</span>
            <button type="button" onClick={onReplayNext} aria-label="Replay next frame">Next</button>
          </>
        ) : null}
        <button type="button" onClick={onSnapshot} aria-label="Capture scenario snapshot">
          Snapshot
        </button>
      </div>
    </aside>
  );
}
