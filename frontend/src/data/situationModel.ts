import type { CurrentStateItem, NetworkClient } from "../domain/types";
import type { InfrastructureAlert } from "./useInfrastructureAlerts";

export type SituationStatus = "live" | "stale" | "empty";
export type SituationSourceId = "openwrt" | "unifi" | "kismet" | "intercept";
export type PostureLabel = "ALERT" | "WATCH" | "CLEAR";

export interface DashboardSummaryLike {
  counts?: Record<string, number>;
  recent_events?: unknown[];
}

export interface SituationSourceHealth {
  source: SituationSourceId;
  label: string;
  status: SituationStatus;
  recordCount: number;
  lastSeenAt: string | null;
  ageLabel: string;
  kindCounts: Record<string, number>;
  examples: Array<{
    id: string;
    label: string;
    kind: string;
  }>;
}

export interface SituationClientSummary {
  total: number;
  multiSource: number;
  visible: Array<{
    id: string;
    label: string;
    mac: string;
    ip: string | null;
    sources: string[];
    lastSeenAt: string | null;
  }>;
}

export interface SituationHardwareSummary {
  devices: number;
  liveDevices: number;
  spectrumPeaks: number;
  examples: Array<{
    id: string;
    label: string;
    source: string;
    kind: string;
    lastSeenAt: string | null;
  }>;
}

export interface SituationPosture {
  label: PostureLabel;
  confidence: number;
  reasons: string[];
}

export interface SituationModel {
  posture: SituationPosture;
  sources: SituationSourceHealth[];
  clients: SituationClientSummary;
  hardware: SituationHardwareSummary;
  setupGaps: string[];
}

export interface SituationModelInput {
  summary: DashboardSummaryLike;
  sourceStates: Record<SituationSourceId, CurrentStateItem[]>;
  clients: NetworkClient[];
  alerts: InfrastructureAlert[];
  inventoryCounts: Record<string, number | undefined>;
  now?: Date;
}

const SOURCES: Array<{ id: SituationSourceId; label: string }> = [
  { id: "openwrt", label: "OpenWrt" },
  { id: "unifi", label: "UniFi" },
  { id: "kismet", label: "Kismet" },
  { id: "intercept", label: "Intercept" }
];

const LIVE_WINDOW_MS = 15 * 60 * 1000;
const STALE_WINDOW_MS = 3 * 60 * 60 * 1000;
const INVENTORY_KEYS = ["zones", "sensors", "collectors", "integrations", "rules"];

export function buildSituationModel({ summary, sourceStates, clients, alerts, inventoryCounts, now = new Date() }: SituationModelInput): SituationModel {
  const sources = SOURCES.map(({ id, label }) => sourceHealth(id, label, sourceStates[id] ?? [], now));

  return {
    posture: postureFrom(summary, alerts),
    sources,
    clients: clientsFrom(clients),
    hardware: hardwareFrom([...sourceStates.kismet, ...sourceStates.intercept], now),
    setupGaps: INVENTORY_KEYS.filter((key) => (inventoryCounts[key] ?? 0) === 0)
  };
}

function postureFrom(summary: DashboardSummaryLike, alerts: InfrastructureAlert[]): SituationPosture {
  const counts = summary.counts ?? {};
  const highAlerts = alerts.filter((alert) => ["high", "critical"].includes(alert.severity)).length;
  const unknownEvents = counts.unknown_events ?? 0;
  const totalEvents = counts.events ?? 0;
  const reasons: string[] = [];

  if (highAlerts > 0) {
    reasons.push(`${highAlerts} high UniFi/OpenWrt alert${highAlerts === 1 ? "" : "s"}`);
  }
  if (unknownEvents > 0) {
    reasons.push(`${unknownEvents} unknown-device events`);
  }
  if (totalEvents > 0) {
    reasons.push(`${totalEvents} total events`);
  }
  if (reasons.length === 0) {
    reasons.push("No active posture drivers");
  }

  return {
    label: highAlerts > 0 || unknownEvents > 0 ? "ALERT" : totalEvents > 0 ? "WATCH" : "CLEAR",
    confidence: highAlerts > 0 || unknownEvents > 0 ? 96 : totalEvents > 0 ? 82 : 70,
    reasons: reasons.slice(0, 3)
  };
}

function sourceHealth(source: SituationSourceId, label: string, items: CurrentStateItem[], now: Date): SituationSourceHealth {
  const lastSeenAt = latestTimestamp(items.map((item) => item.last_seen_at));
  const ageMs = lastSeenAt ? now.getTime() - new Date(lastSeenAt).getTime() : Number.POSITIVE_INFINITY;

  return {
    source,
    label,
    status: items.length === 0 ? "empty" : ageMs <= LIVE_WINDOW_MS ? "live" : ageMs <= STALE_WINDOW_MS ? "stale" : "stale",
    recordCount: items.length,
    lastSeenAt,
    ageLabel: lastSeenAt ? formatAge(ageMs) : "no records",
    kindCounts: countBy(items, (item) => item.kind),
    examples: items.slice(0, 5).map((item) => ({
      id: item.state_key,
      label: item.identity_hint || item.state_key,
      kind: item.kind
    }))
  };
}

function clientsFrom(clients: NetworkClient[]): SituationClientSummary {
  return {
    total: clients.length,
    multiSource: clients.filter((client) => client.sources.length > 1).length,
    visible: clients.slice(0, 8).map((client) => ({
      id: client.mac_address,
      label: client.alias || client.hostname || client.mac_address,
      mac: client.mac_address,
      ip: client.primary_ip,
      sources: client.sources,
      lastSeenAt: client.last_seen_at
    }))
  };
}

function hardwareFrom(items: CurrentStateItem[], now: Date): SituationHardwareSummary {
  const hardwareItems = items.filter((item) => ["datasource", "server_status", "sdr_device", "subghz_status"].includes(item.kind));
  return {
    devices: hardwareItems.length,
    liveDevices: hardwareItems.filter((item) => item.last_seen_at && now.getTime() - new Date(item.last_seen_at).getTime() <= LIVE_WINDOW_MS).length,
    spectrumPeaks: items.filter((item) => item.kind === "spectrum_peak").length,
    examples: hardwareItems.slice(0, 5).map((item) => ({
      id: item.state_key,
      label: item.identity_hint || item.state_key,
      source: item.source,
      kind: item.kind,
      lastSeenAt: item.last_seen_at
    }))
  };
}

function latestTimestamp(values: Array<string | null>): string | null {
  const sorted = values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return sorted[0] ?? null;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  return items.reduce<Record<string, number>>((counts, item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function formatAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) {
    return "no records";
  }
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  return `${Math.round(minutes / 60)}h ago`;
}
