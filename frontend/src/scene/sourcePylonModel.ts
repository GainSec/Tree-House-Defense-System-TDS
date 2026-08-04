import type { CurrentStateItem } from "../domain/types";
import type { SituationSourceHealth, SituationSourceId, SituationStatus } from "../data/situationModel";

export type SourcePylonStatus = SituationStatus | "error";
export type SourcePylonShape = "gateway" | "access-point" | "sensor-array" | "sdr";

export interface SourcePylonMetric {
  label: string;
  value: string;
  intensity: number;
}

export interface SourcePylonModel {
  source: SituationSourceId;
  label: string;
  status: SourcePylonStatus;
  position: [number, number, number];
  color: string;
  pulse: number;
  shape: SourcePylonShape;
  metrics: SourcePylonMetric[];
}

const POSITIONS: Record<SituationSourceId, [number, number, number]> = {
  openwrt: [-32, 2.2, -28],
  unifi: [32, 2.2, -26],
  kismet: [-34, 2.2, 30],
  intercept: [34, 2.2, 28]
};

const COLORS: Record<SourcePylonStatus, string> = {
  live: "#7df2e6",
  stale: "#ffd166",
  empty: "#6b7280",
  error: "#ff5c8a"
};

const SHAPES: Record<SituationSourceId, SourcePylonShape> = {
  openwrt: "gateway",
  unifi: "access-point",
  kismet: "sensor-array",
  intercept: "sdr"
};

export function sourcePylonPosition(source: SituationSourceId): [number, number, number] {
  return POSITIONS[source];
}

export function sourcePylonColor(status: SourcePylonStatus): string {
  return COLORS[status];
}

export function sourcePylonPulse(status: SourcePylonStatus): number {
  if (status === "error") {
    return 2.8;
  }
  if (status === "live") {
    return 1.8;
  }
  if (status === "stale") {
    return 1.2;
  }
  return 0.55;
}

export function sourcePylonShape(source: SituationSourceId): SourcePylonShape {
  return SHAPES[source];
}

export function buildSourcePylonModel(source: SituationSourceHealth, states: CurrentStateItem[] = []): SourcePylonModel {
  const status = source.status;
  const packets = sumMetadataNumber(states, ["num_packets", "packets_total"]);
  const retries = sumMetadataNumber(states, ["retry_attempts", "total_retry_attempts"]);
  const devices = states.filter((state) => ["datasource", "sdr_device", "server_status", "subghz_status"].includes(state.kind)).length;

  return {
    source: source.source,
    label: source.label,
    status,
    position: sourcePylonPosition(source.source),
    color: sourcePylonColor(status),
    pulse: sourcePylonPulse(status),
    shape: sourcePylonShape(source.source),
    metrics: [
      pylonMetric("Records", source.recordCount, 10),
      pylonMetric("Packets", packets, 1_000_000),
      pylonMetric("Retries", retries, 20),
      pylonMetric("Devices", devices, 4)
    ]
  };
}

function pylonMetric(label: string, value: number, strongAt: number): SourcePylonMetric {
  return {
    label,
    value: value.toLocaleString(),
    intensity: Math.max(0.08, Math.min(1, value / strongAt))
  };
}

function sumMetadataNumber(states: CurrentStateItem[], keys: string[]): number {
  return states.reduce((sum, state) => {
    return keys.reduce((innerSum, key) => {
      const value = state.metadata[key];
      return typeof value === "number" && Number.isFinite(value) ? innerSum + value : innerSum;
    }, sum);
  }, 0);
}
