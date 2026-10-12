import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { DataProvenance } from "../data/provenance";
import { formatAge } from "../data/provenance";
import { rfQualitySummary } from "../data/rfQuality";
import type { SituationModel, SituationSourceHealth, SituationSourceId } from "../data/situationModel";
import type { InfrastructureAlert, InfrastructureAlertStatus } from "../data/useInfrastructureAlerts";
import type { OperatorInspectorModel } from "../data/operatorInspector";
import type { PresenceDossier } from "../domain/types";
import { requiresReview } from "./boardModel";

export type CardTone = "good" | "warn" | "hot" | "muted" | "neutral" | "replay";

export interface CardField {
  label: string;
  value: string;
  tone?: CardTone;
}

export interface SelectionCardModel {
  id: string;
  title: string;
  identity: string;
  typeLabel: string;
  primaryMetric: CardField;
  lastObserved: CardField;
  confidence: CardField;
  freshness: CardField;
  sources: string;
  posture: CardField;
  provenance: CardField;
  /** Read-only rows shown when the operator expands the card. */
  detailRows: CardField[];
  /** Where the full investigation lives on the desktop dashboard. */
  desktopPath: string;
}

export type SelectableBoardEntity =
  | RfSceneEntity
  | AircraftSceneEntity
  | { kind: "source"; source: SituationSourceId; label: string };

export function buildSelectionCardModel({
  entity,
  provenance,
  sourceHealth = [],
  inspector = null,
  now = new Date()
}: {
  entity: SelectableBoardEntity | null;
  provenance: DataProvenance;
  sourceHealth?: SituationSourceHealth[];
  inspector?: OperatorInspectorModel | null;
  now?: Date;
}): SelectionCardModel | null {
  if (!entity) {
    return null;
  }
  const provenanceField: CardField = { label: "Data", value: provenance.headline, tone: provenance.tone };
  const detailRows = inspectorDetailRows(inspector);

  if (entity.kind === "source") {
    const health = sourceHealth.find((candidate) => candidate.source === entity.source);
    const status = health?.status ?? "empty";
    return {
      id: `source:${entity.source}`,
      title: entity.label,
      identity: entity.source,
      typeLabel: "Collector / infrastructure source",
      primaryMetric: { label: "Records", value: health ? health.recordCount.toLocaleString() : "unknown" },
      lastObserved: { label: "Last record", value: health?.lastSeenAt ? ageLabel(health.lastSeenAt, now) : "never" },
      confidence: { label: "Health", value: status.toUpperCase(), tone: status === "live" ? "good" : status === "stale" ? "warn" : "muted" },
      freshness: { label: "Freshness", value: health?.ageLabel ?? "no data", tone: status === "live" ? "good" : "warn" },
      sources: entity.label,
      posture: { label: "Posture", value: status === "live" ? "REPORTING" : status === "stale" ? "DEGRADED" : "NO DATA", tone: status === "live" ? "good" : "warn" },
      provenance: provenanceField,
      detailRows,
      desktopPath: "/settings"
    };
  }

  if (entity.kind === "aircraft") {
    return {
      id: entity.id,
      title: entity.label,
      identity: entity.identity,
      typeLabel: `Aircraft${entity.icaoType ? ` · ${entity.icaoType}` : entity.model ? ` · ${entity.model}` : ""}`,
      primaryMetric: {
        label: "Altitude / speed",
        value: `${entity.altitude === null ? "alt ?" : `${entity.altitude.toLocaleString()} ft`} · ${entity.speed === null ? "spd ?" : `${Math.round(entity.speed)} kt`}`
      },
      lastObserved: { label: "Last seen", value: ageLabel(entity.lastSeenAt, now) },
      confidence: { label: "Position", value: "ADS-B reported (range compressed on board)", tone: "neutral" },
      freshness: freshnessField(entity.lastSeenAt, now),
      sources: sourceList(entity.source),
      posture: { label: "Posture", value: "TRANSIT", tone: "neutral" },
      provenance: provenanceField,
      detailRows,
      desktopPath: "/dashboard"
    };
  }

  const quality = rfQualitySummary(entity, now);
  const review = requiresReview(entity);
  return {
    id: entity.id,
    title: entity.label,
    identity: entity.identity,
    typeLabel: `${categoryLabel(entity.category)} · ${entity.protocol || entity.observedKind}`,
    primaryMetric: {
      label: "Signal",
      value: typeof entity.rssi === "number" ? `${entity.rssi} dBm` : entity.frequency ? `${entity.frequency} MHz` : "no RSSI",
      tone: typeof entity.rssi === "number" ? (entity.rssi >= -60 ? "hot" : entity.rssi >= -78 ? "neutral" : "muted") : "muted"
    },
    lastObserved: { label: "Last seen", value: ageLabel(entity.lastSeenAt, now) },
    confidence: {
      label: "Confidence",
      value: `${quality.label} (${quality.score}) · ${entity.locationAccuracy === "real" ? "real position" : entity.locationAccuracy === "receiver" ? "receiver origin" : "RSSI estimate"}`,
      tone: quality.score >= 75 ? "good" : quality.score >= 55 ? "neutral" : "warn"
    },
    freshness: {
      label: "Freshness",
      value: entity.freshness.toUpperCase(),
      tone: entity.freshness === "live" ? "good" : entity.freshness === "stale" ? "warn" : "muted"
    },
    sources: sourceList(entity.source),
    posture: review
      ? { label: "Posture", value: "REVIEW REQUIRED", tone: "hot" }
      : entity.operatorContext?.headline
        ? { label: "Posture", value: entity.operatorContext.headline, tone: "neutral" }
        : { label: "Posture", value: entity.freshness === "live" ? "OBSERVED" : "NOT CURRENT", tone: entity.freshness === "live" ? "good" : "muted" },
    provenance: provenanceField,
    detailRows,
    desktopPath: `/presence/entities/${encodeURIComponent(entity.entityKey)}`
  };
}

function inspectorDetailRows(inspector: OperatorInspectorModel | null): CardField[] {
  if (!inspector) {
    return [];
  }
  return inspector.tabs
    .filter((tab) => tab.id !== "raw")
    .flatMap((tab) => tab.rows.map((row) => ({ label: row.label, value: row.value })))
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.label === row.label) === index)
    .slice(0, 8);
}

// ---------------------------------------------------------------- alerts

export type AlertItemKind = "unknown-rf" | "collector" | "alert" | "feed";

export interface AlertCardItem {
  id: string;
  kind: AlertItemKind;
  severity: "critical" | "high" | "warning";
  title: string;
  detail: string;
  /** Entity id to select when the item is activated, if any. */
  entityId?: string;
  source?: SituationSourceId;
}

export interface AlertCardModel {
  items: AlertCardItem[];
  totalExceptions: number;
  statusLine: string;
  tone: CardTone;
  posture: SituationModel["posture"]["label"] | "UNKNOWN";
}

const HIGH_PRIORITY_SEVERITIES = new Set(["critical", "high", "major", "error", "emergency", "alert"]);
const MAX_ALERT_ITEMS = 6;

/** Only important exceptions: unknown RF to review, degraded collectors, high-priority alerts. */
export function buildAlertCardModel({
  alerts,
  alertsStatus,
  rfEntities,
  sourceHealth,
  situationStatus,
  posture = null
}: {
  alerts: InfrastructureAlert[];
  alertsStatus: InfrastructureAlertStatus;
  rfEntities: RfSceneEntity[];
  sourceHealth: SituationSourceHealth[];
  situationStatus: "loading" | "live" | "error";
  posture?: SituationModel["posture"] | null;
}): AlertCardModel {
  const items: AlertCardItem[] = [];

  for (const alert of alerts) {
    const severity = alert.severity.toLowerCase();
    if (!HIGH_PRIORITY_SEVERITIES.has(severity)) {
      continue;
    }
    items.push({
      id: `alert:${alert.id}`,
      kind: "alert",
      severity: severity === "critical" || severity === "emergency" ? "critical" : "high",
      title: `${alert.source === "unifi" ? "UniFi" : "OpenWrt"}: ${alert.summary || alert.type}`,
      detail: alert.details.slice(0, 2).join(" · ") || alert.type
    });
  }

  if (alertsStatus === "error") {
    items.push({ id: "feed:alerts", kind: "feed", severity: "high", title: "Alert feed unreachable", detail: "Infrastructure alerts are not updating." });
  }
  if (situationStatus === "error") {
    items.push({ id: "feed:situation", kind: "feed", severity: "high", title: "Collector health unreachable", detail: "Source health is not updating." });
  }

  for (const source of sourceHealth) {
    if (source.status === "stale") {
      items.push({
        id: `collector:${source.source}`,
        kind: "collector",
        severity: "warning",
        title: `${source.label} collector degraded`,
        detail: `Last record ${source.ageLabel}`,
        source: source.source
      });
    }
  }

  const reviewEntities = rfEntities.filter(requiresReview);
  for (const entity of reviewEntities.slice(0, 3)) {
    items.push({
      id: `review:${entity.id}`,
      kind: "unknown-rf",
      severity: entity.freshness === "live" ? "high" : "warning",
      title: `Unknown RF · ${entity.label}`,
      detail: `${typeof entity.rssi === "number" ? `${entity.rssi} dBm` : entity.frequency ? `${entity.frequency} MHz` : "no RSSI"} · ${entity.freshness} · review required`,
      entityId: entity.id
    });
  }

  const rank = { critical: 0, high: 1, warning: 2 } as const;
  items.sort((left, right) => rank[left.severity] - rank[right.severity]);
  const totalExceptions = items.length + Math.max(0, reviewEntities.length - 3);
  const tone: CardTone = items.some((item) => item.severity === "critical") ? "hot" : items.some((item) => item.severity === "high") ? "warn" : items.length > 0 ? "neutral" : "good";

  return {
    items: items.slice(0, MAX_ALERT_ITEMS),
    totalExceptions,
    statusLine:
      items.length === 0
        ? alertsStatus === "loading"
          ? "Checking alert feeds…"
          : "No exceptions"
        : `${totalExceptions} exception${totalExceptions === 1 ? "" : "s"}${reviewEntities.length > 3 ? ` (${reviewEntities.length} unknown RF)` : ""}`,
    tone,
    posture: posture?.label ?? "UNKNOWN"
  };
}

// ---------------------------------------------------------------- helpers

function ageLabel(value: string | null, now: Date): string {
  if (!value) {
    return "unknown";
  }
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    return "unknown";
  }
  return `${formatAge(Math.max(0, Math.round((now.getTime() - time) / 1000)))} ago`;
}

function freshnessField(lastSeenAt: string | null, now: Date): CardField {
  if (!lastSeenAt) {
    return { label: "Freshness", value: "UNKNOWN", tone: "muted" };
  }
  const ageSeconds = (now.getTime() - new Date(lastSeenAt).getTime()) / 1000;
  if (!Number.isFinite(ageSeconds)) {
    return { label: "Freshness", value: "UNKNOWN", tone: "muted" };
  }
  return ageSeconds <= 120 ? { label: "Freshness", value: "LIVE", tone: "good" } : { label: "Freshness", value: "STALE", tone: "warn" };
}

function sourceList(source: string): string {
  return (
    source
      .split(/[,+|/]/)
      .map((token) => token.trim())
      .filter(Boolean)
      .join(", ") || "unknown"
  );
}

const CATEGORY_LABELS: Record<string, string> = {
  wifi: "Wi-Fi",
  ble: "BLE",
  utility: "Utility",
  unknown_rf: "Unknown RF",
  infrastructure: "Infrastructure",
  aircraft: "Aircraft",
  rail: "Rail RF",
  iot: "IoT mesh",
  cellular: "Cellular"
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

// ---------------------------------------------------------------- detail tabs

export type DetailTabId = "summary" | "signal" | "evidence" | "history";

/** Rows for a selection-card tab, built from the shared desktop inspector model. */
export function inspectorTabRows(inspector: OperatorInspectorModel | null, tab: "signal" | "evidence"): CardField[] {
  const source = inspector?.tabs.find((candidate) => candidate.id === tab);
  if (!source) {
    return [];
  }
  return [
    ...source.metrics.map((metric) => ({ label: metric.label, value: metric.value, tone: inspectorTone(metric.tone) })),
    ...source.rows.map((row) => ({ label: row.label, value: row.value }))
  ].slice(0, 9);
}

function inspectorTone(tone: string): CardTone {
  return tone === "good" || tone === "warn" || tone === "hot" || tone === "muted" ? tone : "neutral";
}

/** History tab: presence dossier summary (identity, reliability, sightings, reasons, anomalies). */
export function dossierRows(dossier: PresenceDossier | null, now = new Date()): CardField[] {
  if (!dossier) {
    return [];
  }
  const rows: CardField[] = [
    { label: "Identity", value: `${dossier.identity.label} (${Math.round(dossier.identity.confidence * 100)}%)` },
    { label: "Tracked", value: dossier.watchlist ? `yes: ${dossier.watchlist.label || dossier.entity.label}` : "no", tone: dossier.watchlist ? "good" : "muted" },
    { label: "Seen", value: `${dossier.entity.seen_count.toLocaleString()} times` },
    { label: "First seen", value: ageLabel(dossier.entity.first_seen_at, now) },
    { label: "Last seen", value: ageLabel(dossier.entity.last_seen_at, now) }
  ];
  if (dossier.reliability) {
    rows.push({
      label: "Reliability",
      value: `${dossier.reliability.label} (${dossier.reliability.score}) | ${dossier.reliability.sighting_count} sightings, ${dossier.reliability.source_count} sources`
    });
  }
  rows.push({ label: "Interest", value: String(Math.round(dossier.scores.interest)) });
  if (dossier.rhythm && dossier.rhythm.peak_hours.length > 0) {
    rows.push({ label: "Peak hours", value: dossier.rhythm.peak_hours.slice(0, 3).map((peak) => `${String(peak.hour).padStart(2, "0")}:00`).join(", ") });
  }
  for (const anomaly of (dossier.anomalies ?? []).slice(0, 2)) {
    rows.push({ label: "Anomaly", value: anomaly.label, tone: anomaly.severity === "high" || anomaly.severity === "critical" ? "hot" : "warn" });
  }
  for (const reason of dossier.reasons.slice(0, 2)) {
    rows.push({ label: "Reason", value: reason });
  }
  return rows;
}
