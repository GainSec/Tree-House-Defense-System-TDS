import type { PresenceCoPresenceCluster, PresenceGraphMode, PresenceSighting, PresenceSummaryItem } from "../domain/types";

export interface PresenceHourBin {
  hour: number;
  count: number;
  intensity: number;
}

export interface PresenceHeatCell {
  weekday: number;
  hour: number;
  count: number;
  intensity: number;
}

export interface PresenceRssiPoint {
  id: string;
  timestamp: string | null;
  rssi: number | null;
  strength: number;
  x: number;
  y: number;
  sensor_id: string | null;
}

export interface PresenceSourceRing {
  source: string;
  count: number;
  percent: number;
}

export interface PresenceCoPresenceNode {
  id: string;
  label: string;
  selected: boolean;
}

export interface PresenceCoPresenceEdge {
  source: string;
  target: string;
  weight: number;
}

export interface SelectedPresenceVisuals {
  hourly: PresenceHourBin[];
  weekdayHeat: PresenceHeatCell[];
  rssiTrend: PresenceRssiPoint[];
  coPresenceNodes: PresenceCoPresenceNode[];
  coPresenceEdges: PresenceCoPresenceEdge[];
  sourceRings: PresenceSourceRing[];
  peakHourLabel: string;
  strongestSensor: string | null;
  topCompanion: string | null;
  takeaway: string;
}

export function buildSelectedPresenceVisuals(
  selected: PresenceSummaryItem,
  sightings: PresenceSighting[],
  clusters: PresenceCoPresenceCluster[]
): SelectedPresenceVisuals {
  const sortedSightings = [...sightings].sort((left, right) => dateMs(left.timestamp) - dateMs(right.timestamp));
  const hourlyCounts = new Array<number>(24).fill(0);
  const heatCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  const sensorStrength = new Map<string, { total: number; count: number }>();

  for (const sighting of sortedSightings) {
    const date = parseDate(sighting.timestamp);
    if (date) {
      hourlyCounts[date.getUTCHours()] += 1;
      const heatKey = `${date.getUTCDay()}:${date.getUTCHours()}`;
      heatCounts.set(heatKey, (heatCounts.get(heatKey) ?? 0) + 1);
    }
    sourceCounts.set(sighting.source, (sourceCounts.get(sighting.source) ?? 0) + 1);
    if (sighting.sensor_id && sighting.rssi !== null) {
      const current = sensorStrength.get(sighting.sensor_id) ?? { total: 0, count: 0 };
      sensorStrength.set(sighting.sensor_id, { total: current.total + signalStrength(sighting.rssi), count: current.count + 1 });
    }
  }

  const maxHour = Math.max(1, ...hourlyCounts);
  const hourly = hourlyCounts.map((count, hour) => ({ hour, count, intensity: Math.round((count / maxHour) * 100) }));
  const maxHeat = Math.max(1, ...heatCounts.values());
  const weekdayHeat = Array.from({ length: 7 * 24 }, (_, index) => {
    const weekday = Math.floor(index / 24);
    const hour = index % 24;
    const count = heatCounts.get(`${weekday}:${hour}`) ?? 0;
    return { weekday, hour, count, intensity: Math.round((count / maxHeat) * 100) };
  });
  const rssiTrend = sortedSightings.map((sighting, index) => {
    const strength = signalStrength(sighting.rssi);
    const denominator = Math.max(1, sortedSightings.length - 1);
    return {
      id: sighting.id,
      timestamp: sighting.timestamp,
      rssi: sighting.rssi,
      strength,
      x: Math.round((index / denominator) * 100),
      y: Math.round(100 - strength),
      sensor_id: sighting.sensor_id
    };
  });
  const coPresenceClusters = clusters
    .filter((cluster) => cluster.entity_keys.includes(selected.entity_key) || cluster.labels.includes(selected.label))
    .sort((left, right) => right.shared_window_count - left.shared_window_count);
  const companions = coPresenceClusters
    .map((cluster) => ({
      label: cluster.labels.find((label) => label !== selected.label) ?? cluster.labels[0],
      key: cluster.entity_keys.find((key) => key !== selected.entity_key) ?? cluster.id,
      count: cluster.shared_window_count
    }))
    .filter((companion) => companion.label && companion.label !== selected.label);
  const coPresenceNodes = [
    { id: selected.entity_key, label: selected.label, selected: true },
    ...companions.slice(0, 4).map((companion) => ({ id: companion.key, label: companion.label, selected: false }))
  ];
  const coPresenceEdges = companions.slice(0, 4).map((companion) => ({
    source: selected.entity_key,
    target: companion.key,
    weight: companion.count
  }));
  const totalSources = Math.max(1, sortedSightings.length);
  const sourceRings = [...sourceCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([source, count]) => ({ source, count, percent: Math.round((count / totalSources) * 100) }));
  const peakHour = hourly.reduce((best, current) => (current.count > best.count ? current : best), hourly[0]);
  const strongestSensor = [...sensorStrength.entries()]
    .sort((left, right) => right[1].total / right[1].count - left[1].total / left[1].count)[0]?.[0] ?? selected.current_state?.sensor_id ?? null;
  const topCompanion = companions[0]?.label ?? null;

  return {
    hourly,
    weekdayHeat,
    rssiTrend,
    coPresenceNodes,
    coPresenceEdges,
    sourceRings,
    peakHourLabel: formatHour(peakHour?.hour ?? null),
    strongestSensor,
    topCompanion,
    takeaway: visualTakeaway(formatHour(peakHour?.hour ?? null), strongestSensor, topCompanion, sortedSightings.length)
  };
}

export function graphWatchModeForMode(mode: PresenceGraphMode, currentWatchMode: string): string {
  if (mode === "airspace") {
    return "airspace";
  }
  if (mode === "rail") {
    return "rail";
  }
  if (mode === "iot") {
    return "iot";
  }
  if (mode === "cellular") {
    return "cellular";
  }
  if (mode === "rf") {
    return "rf_anomaly";
  }
  if (mode === "presence") {
    return "home_presence";
  }
  return currentWatchMode;
}

export function signalStrength(rssi: number | null): number {
  if (rssi === null) {
    return 18;
  }
  return Math.max(8, Math.min(100, Math.round(((rssi + 100) / 65) * 100)));
}

function visualTakeaway(peakHour: string, strongestSensor: string | null, topCompanion: string | null, sampleCount: number): string {
  if (sampleCount === 0) {
    return "No sampled sightings yet. Track this entity to learn its normal rhythm.";
  }
  const parts = [`Usually seen around ${peakHour}`];
  if (strongestSensor) {
    parts.push(`strongest near ${strongestSensor}`);
  }
  if (topCompanion) {
    parts.push(`often appears with ${topCompanion}`);
  }
  return `${parts.join(", ")}.`;
}

function formatHour(hour: number | null): string {
  if (hour === null) {
    return "unknown";
  }
  if (hour === 0) {
    return "12 AM";
  }
  if (hour === 12) {
    return "12 PM";
  }
  return hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

function parseDate(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateMs(value: string | null): number {
  return parseDate(value)?.getTime() ?? 0;
}
