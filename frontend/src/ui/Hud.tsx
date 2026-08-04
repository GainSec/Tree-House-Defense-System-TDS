import type { AirspaceLane, ChangeBriefing, RfBurstSwarm, RfMapCategory, SensorCoverageResponse, SpectrumOccupancyBucket } from "../domain/types";
import type { CSSProperties, ReactNode } from "react";
import type { DashboardDataStatus } from "../data/useDashboardData";
import type { SceneFilters, SourceId } from "./useSceneFilters";
import type { LayerLensMode } from "./useLayerLens";

export interface HudProps {
  filters: SceneFilters;
  dataStatus: DashboardDataStatus;
  lastUpdatedAt: string | null;
  error: string | null;
  onToggleSource: (source: SourceId) => void;
  onToggleCategory: (category: RfMapCategory) => void;
  onToggleAircraft: () => void;
  onToggleStale: () => void;
  layerLensMode?: LayerLensMode;
  airspaceLanes?: AirspaceLane[];
  spectrumOccupancy?: SpectrumOccupancyBucket[];
  rfBursts?: RfBurstSwarm[];
  changeBriefing?: ChangeBriefing | null;
  sensorCoverage?: SensorCoverageResponse | null;
  onLayerLensChange?: (mode: LayerLensMode) => void;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
}

export function Hud({
  dataStatus,
  lastUpdatedAt,
  error,
  airspaceLanes = [],
  spectrumOccupancy = [],
  rfBursts = [],
  changeBriefing = null,
  sensorCoverage = null,
  cardControls,
  cardStyle
}: HudProps) {
  const primaryLane = airspaceLanes[0] ?? null;
  const primaryBurst = rfBursts[0] ?? null;
  return (
    <section className="hud" aria-label="TDS 3D SIGINT HUD" style={cardStyle}>
      <div className="hud-title">
        <span className="system-label">TDS</span>
        <span>Third-person 3D SIGINT world</span>
        {cardControls}
      </div>
      <div className="hud-status-grid">
        <span>{lastUpdatedAt ? `sync ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "sync pending"}</span>
        {primaryLane ? (
          <span>
            lane {primaryLane.label} · {primaryLane.aircraft_count} {primaryLane.aircraft_count === 1 ? "aircraft" : "aircraft"}
          </span>
        ) : null}
        {spectrumOccupancy.length > 0 ? (
          <span className="spectrum-rug" aria-label="Spectrum occupancy rug">
            {spectrumOccupancy.slice(0, 8).map((bucket) => (
              <i key={bucket.id} title={`${bucket.frequency_band} ${bucket.strongest_rssi ?? "no RSSI"}`} />
            ))}
          </span>
        ) : null}
        {primaryBurst ? (
          <span className={`hud-burst is-${primaryBurst.severity}`}>
            {primaryBurst.label} · {primaryBurst.entity_count} signals · {primaryBurst.strongest_rssi ?? "no RSSI"} dBm
            {primaryBurst.sample_labels.length ? ` · ${primaryBurst.sample_labels.slice(0, 2).join(" / ")}` : ""}
          </span>
        ) : null}
        {changeBriefing ? (
          <span className={`hud-briefing is-${changeBriefing.severity}`}>
            changed · {changeBriefing.summary}
            {changeBriefing.top_sources[0] ? ` · ${changeBriefing.top_sources[0].source}` : ""}
          </span>
        ) : null}
        {sensorCoverage ? (
          <span className={sensorCoverage.blind_spots.length ? "hud-coverage has-blind-spots" : "hud-coverage"}>
            coverage · {sensorCoverage.live_sensors}/{sensorCoverage.count} live
            {sensorCoverage.blind_spots[0] ? ` · blind ${sensorCoverage.blind_spots[0].sensor_id}` : ""}
          </span>
        ) : null}
        {error ? <span className="hud-error">{error}</span> : null}
        {dataStatus === "error" && !error ? <span className="hud-error">data error</span> : null}
      </div>
    </section>
  );
}
