import type { CSSProperties } from "react";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { OperatorInspectorModel, OperatorInspectorTabId } from "../data/operatorInspector";
import { rfQualitySummary } from "../data/rfQuality";
import type { PresenceDossier } from "../domain/types";

export type SelectedSceneEntity = RfSceneEntity | AircraftSceneEntity | null;

export function SelectionPanel({
  selected,
  inspectorModel = null,
  activeInspectorTab = null,
  onInspectorTabChange,
  onPrevious,
  onNext,
  onClear,
  presenceDossier = null,
  onRunPresenceEnrichment,
  enrichmentRunning = false
}: {
  selected: SelectedSceneEntity;
  inspectorModel?: OperatorInspectorModel | null;
  activeInspectorTab?: OperatorInspectorTabId | null;
  onInspectorTabChange?: (tab: OperatorInspectorTabId) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onClear?: () => void;
  presenceDossier?: PresenceDossier | null;
  onRunPresenceEnrichment?: () => void;
  enrichmentRunning?: boolean;
}) {
  if (inspectorModel && inspectorModel.status !== "empty") {
    return (
      <div className="selection-panel-stack">
        <InspectorReadout model={inspectorModel} activeTab={activeInspectorTab} onTabChange={onInspectorTabChange} />
        {presenceDossier ? (
          <PresenceDossierPanel dossier={presenceDossier} onRunEnrichment={onRunPresenceEnrichment} enrichmentRunning={enrichmentRunning} />
        ) : null}
      </div>
    );
  }

  if (!selected) {
    return (
      <div className="selection-panel">
        <span className="panel-label">Selection</span>
        <strong>None</strong>
        <span>Click an RF orb or aircraft marker.</span>
      </div>
    );
  }

  if (selected.kind === "aircraft") {
    return (
      <div className="selection-panel">
        <span className="panel-label">Aircraft</span>
        <strong>{selected.label}</strong>
        <SelectionActions onPrevious={onPrevious} onNext={onNext} onClear={onClear} />
        <DetailSection
          title="Identity"
          rows={[
            ["Identity", selected.identity],
            ["Model", selected.model || "Unknown"],
            ["Owner", selected.owner || "Unknown"],
            ["Source", selected.source],
            ["Protocol", selected.protocol]
          ]}
        />
        <DetailSection
          title="Motion"
          rows={[
            ["Altitude", selected.altitude ? `${Math.round(selected.altitude).toLocaleString()} ft` : "unknown"],
            ["Speed", selected.speed ? `${Math.round(selected.speed)} kt` : "unknown"],
            ["Heading", `${Math.round(selected.heading)} deg`],
            ["Distance", `${formatDistance(selected.displayDistanceMeters)} from receiver`]
          ]}
        />
        <DetailSection title="Location" rows={[["GPS", formatCoordinate(selected.latitude, selected.longitude)]]} />
        <DetailSection
          title="Timing"
          rows={[
            ["First seen", formatTimestamp(selected.firstSeenAt)],
            ["Last seen", formatTimestamp(selected.lastSeenAt)],
            ["Seen count", selected.count.toLocaleString()]
          ]}
        />
      </div>
    );
  }

  return (
    <div className="selection-panel">
      <span className="panel-label">RF Evidence</span>
      <strong>{selected.label}</strong>
      <SelectionActions onPrevious={onPrevious} onNext={onNext} onClear={onClear} />
      <EvidenceChips selected={selected} />
      {presenceDossier ? (
        <PresenceDossierPanel dossier={presenceDossier} onRunEnrichment={onRunPresenceEnrichment} enrichmentRunning={enrichmentRunning} />
      ) : null}
      <QualityPanel selected={selected} />
      <DetailSection
        title="Classification"
        rows={[
          ["Identity", selected.identity],
          ["Source", selected.source],
          ["Protocol", selected.protocol],
          ["Kind", selected.observedKind],
          ["Category", selected.category.replace("_", " ")],
          ["Freshness", selected.freshness]
        ]}
      />
      <DetailSection
        title="Signal"
        rows={[
          ["RSSI", selected.rssi == null ? "unknown" : `${selected.rssi} dBm`],
          ["Channel", selected.channel || "unknown"],
          ["Frequency", selected.frequency ? `${selected.frequency} MHz` : "unknown"],
          ["Manufacturer", selected.manufacturer || "unknown"],
          ["Seen count", selected.count.toLocaleString()]
        ]}
      />
      <DetailSection
        title="Location"
        rows={[
          ["GPS", formatCoordinate(selected.latitude, selected.longitude)],
          ["Accuracy", selected.locationAccuracy],
          ["Distance", `${formatDistance(selected.displayDistanceMeters)} from receiver`]
        ]}
      />
      <DetailSection
        title="Timing"
        rows={[
          ["First seen", formatTimestamp(selected.firstSeenAt)],
          ["Last seen", formatTimestamp(selected.lastSeenAt)]
        ]}
      />
    </div>
  );
}

function PresenceDossierPanel({
  dossier,
  onRunEnrichment,
  enrichmentRunning = false
}: {
  dossier: PresenceDossier;
  onRunEnrichment?: () => void;
  enrichmentRunning?: boolean;
}) {
  const sourceRows = dossier.source_confidence.slice(0, 3).map((source) => (
    `${source.source} · ${source.observations.toLocaleString()} observations · ${Math.round(source.confidence * 100)}%`
  ));
  const reasonChips = dossier.reason_chips?.length
    ? dossier.reason_chips.map((chip) => ({
      label: chip.weight > 0 ? `${chip.label} +${chip.weight}` : chip.label,
      tone: chip.tone
    }))
    : dossier.reasons.map((reason) => ({
      label: reasonLabel(reason),
      tone: reasonTone(reason)
    }));
  const primaryEvidence = dossier.evidence[0];
  const provenance = primaryEvidence?.provenance;
  const evidenceRows: Array<[string, string]> = [
    provenance ? ["Evidence", `${provenance.type} · ${provenance.source} · ${provenance.freshness}`] : null,
    ...(primaryEvidence?.highlights?.length
      ? primaryEvidence.highlights.slice(0, 5).map((highlight) => [highlight.label, highlight.value] as [string, string])
      : Object.entries(primaryEvidence?.fields ?? {})
        .slice(0, 5)
        .map(([label, value]) => [label, formatValue(value)] as [string, string]))
  ].filter((row): row is [string, string] => Boolean(row));

  return (
    <section className="selection-quality presence-dossier" aria-label="Presence dossier">
      <div className="selection-quality-score">
        <span className="selection-section-label">Presence Dossier</span>
        <strong>Interest {dossier.scores.interest}</strong>
        <strong>Reliability {dossier.scores.reliability}</strong>
      </div>
      {onRunEnrichment && dossier.enrichment && dossier.enrichment.status !== "empty" ? (
        <button
          type="button"
          className="presence-enrichment-action"
          onClick={onRunEnrichment}
          disabled={enrichmentRunning}
          aria-label={`Run enrichment for ${dossier.entity.label}`}
        >
          {enrichmentRunning ? "Enrichment running" : "Run enrichment"}
        </button>
      ) : null}
      {dossier.reliability ? (
        <div className="presence-reliability-card">
          <strong>
            {dossier.reliability.label} reliability · {dossier.reliability.source_count} {pluralize("source", dossier.reliability.source_count)} ·{" "}
            {dossier.reliability.sighting_count} {pluralize("sighting", dossier.reliability.sighting_count)}
          </strong>
          <span>{dossier.reliability.gaps[0] ?? dossier.reliability.strengths[0] ?? dossier.reliability.freshness}</span>
        </div>
      ) : null}
      {dossier.identity_resolution ? (
        <div className="presence-reliability-card">
          <strong>
            {dossier.identity_resolution.label} · {dossier.identity_resolution.confidence}%
          </strong>
          <span>{dossier.identity_resolution.signals[0] ?? dossier.identity_resolution.mac ?? "No resolver signals yet"}</span>
        </div>
      ) : null}
      {dossier.rf_fingerprint ? (
        <div className="presence-reliability-card">
          <strong>
            {dossier.rf_fingerprint.label} · {dossier.rf_fingerprint.confidence}%
          </strong>
          <span>{dossier.rf_fingerprint.anchors.slice(0, 3).join(" · ")}</span>
        </div>
      ) : null}
      {dossier.ble_profile && dossier.ble_profile.status !== "empty" ? (
        <div className="presence-reliability-card">
          <strong>{dossier.ble_profile.label}</strong>
          <span>{dossier.ble_profile.services.slice(0, 4).join(" · ") || dossier.ble_profile.signals[0] || "No BLE services decoded"}</span>
        </div>
      ) : null}
      {dossier.wifi_roaming && dossier.wifi_roaming.status !== "empty" ? (
        <div className="presence-reliability-card">
          <strong>
            {dossier.wifi_roaming.label} · {dossier.wifi_roaming.hop_count} {pluralize("hop", dossier.wifi_roaming.hop_count)}
          </strong>
          <span>{[...dossier.wifi_roaming.network_names, ...dossier.wifi_roaming.access_points].slice(0, 4).join(" · ")}</span>
        </div>
      ) : null}
      {dossier.rail_context ? <RailContextCard context={dossier.rail_context} /> : null}
      {dossier.iot_context ? <IotContextCard context={dossier.iot_context} /> : null}
      {dossier.enrichment && dossier.enrichment.status !== "empty" ? (
        <div className="presence-reliability-card">
          <strong>
            Enrichment {dossier.enrichment.status} · {dossier.enrichment.mode}
          </strong>
          <span>
            {dossier.enrichment.findings?.length
              ? dossier.enrichment.findings.slice(0, 3).map((finding) => `${finding.label}: ${finding.value}`).join(" · ")
              : dossier.enrichment.targets.slice(0, 3).map((target) => target.label).join(" · ")}
          </span>
        </div>
      ) : null}
      <div className="evidence-chip-grid compact">
        {reasonChips.slice(0, 6).map((chip) => (
          <span key={chip.label} className={`evidence-chip tone-${chip.tone}`}>
            {chip.label}
          </span>
        ))}
      </div>
      {dossier.anomalies?.length ? (
        <div className="evidence-chip-grid compact" aria-label="Behavior anomaly chips">
          {dossier.anomalies.slice(0, 5).map((anomaly) => (
            <span key={anomaly.id} className={`evidence-chip tone-${anomaly.tone}`}>
              {anomaly.label}
            </span>
          ))}
        </div>
      ) : null}
      {dossier.rhythm && dossier.rhythm.sample_count > 0 ? (
        <div className="presence-rhythm-strip" aria-label="Presence rhythm">
          <span className="selection-section-label">Rhythm</span>
          <strong>
            Peak {formatHour(dossier.rhythm.peak_hours[0]?.hour)} · {dossier.rhythm.sample_count}{" "}
            {pluralize("sample", dossier.rhythm.sample_count)}
          </strong>
          {dossier.commute_clock ? <small>{dossier.commute_clock.label}</small> : null}
          {dossier.next_seen ? <small>{dossier.next_seen.label}</small> : null}
        </div>
      ) : null}
      {dossier.sample_summary && dossier.sample_summary.sample_count > 0 ? <PresenceSampleStrip summary={dossier.sample_summary} /> : null}
      {dossier.presence_rules ? (
        <div className="presence-rhythm-strip" aria-label="Presence rules">
          <span className="selection-section-label">Presence Rules</span>
          <small>{dossier.presence_rules.freshness}</small>
          <div className="evidence-chip-grid compact">
            {dossier.presence_rules.chips.slice(0, 4).map((chip) => (
              <span key={chip.id} className={`evidence-chip tone-${chip.tone}`}>
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <DetailSection title="Source Confidence" rows={sourceRows.map((row) => ["Source", row])} />
      {evidenceRows.length > 0 ? <DetailSection title="Operator Evidence" rows={evidenceRows} /> : null}
    </section>
  );
}


function RailContextCard({ context }: { context: NonNullable<PresenceDossier["rail_context"]> }) {
  return (
    <div className="presence-reliability-card presence-domain-context is-rail">
      <span className="selection-section-label">Rail RF Context</span>
      <strong>{context.confidence}% confidence</strong>
      <span>{context.operator_read}</span>
      <div className="evidence-chip-grid compact">
        {[
          context.channel_label,
          context.operator_hint,
          context.route_hint,
          context.usage_hint
        ].filter(Boolean).map((value) => (
          <span key={value} className="evidence-chip tone-rail">{value}</span>
        ))}
      </div>
      <small>{context.limits}</small>
    </div>
  );
}

function IotContextCard({ context }: { context: NonNullable<PresenceDossier["iot_context"]> }) {
  const panLabel = context.network_pan_id ? `PAN ${context.network_pan_id}` : null;
  return (
    <div className="presence-reliability-card presence-domain-context is-iot">
      <span className="selection-section-label">IoT Mesh Context</span>
      <strong>{context.confidence}% confidence</strong>
      <span>{context.operator_read}</span>
      <div className="evidence-chip-grid compact">
        {[
          context.protocol_label,
          context.channel_label,
          panLabel,
          context.packet_direction,
          context.device_role_hint,
          context.vendor_hint
        ].filter(Boolean).map((value) => (
          <span key={value} className="evidence-chip tone-iot">{value}</span>
        ))}
      </div>
      <small>{context.limits}</small>
    </div>
  );
}

function PresenceSampleStrip({ summary }: { summary: NonNullable<PresenceDossier["sample_summary"]> }) {
  return (
    <div className="presence-sample-strip" aria-label="Recent state samples">
      <span className="selection-section-label">Recent samples</span>
      <strong>{summary.cadence_label}</strong>
      <small>{sampleSummaryLine(summary)}</small>
      <div className="presence-sample-spark" aria-hidden="true">
        {summary.samples.slice(-12).map((sample, index) => (
          <i key={`${sample.timestamp ?? "sample"}:${index}`} style={sampleBarStyle(sample.rssi, summary)} />
        ))}
      </div>
    </div>
  );
}

function sampleSummaryLine(summary: NonNullable<PresenceDossier["sample_summary"]>): string {
  const sampleCount = summary.recent_sample_count || summary.sample_count;
  const latest = typeof summary.latest_rssi === "number" ? `${summary.latest_rssi} dBm` : "unknown RSSI";
  const range = typeof summary.weakest_rssi === "number" && typeof summary.strongest_rssi === "number"
    ? `range ${summary.weakest_rssi} to ${summary.strongest_rssi} dBm`
    : "range unknown";
  return `${sampleCount.toLocaleString()} ${pluralize("sample", sampleCount)} · last ${latest} · ${range}`;
}

function sampleBarStyle(rssi: number | null, summary: NonNullable<PresenceDossier["sample_summary"]>): CSSProperties {
  if (typeof rssi !== "number" || typeof summary.weakest_rssi !== "number" || typeof summary.strongest_rssi !== "number") {
    return { "--sample-height": "20%" } as CSSProperties;
  }
  const spread = Math.max(1, summary.strongest_rssi - summary.weakest_rssi);
  const normalized = (rssi - summary.weakest_rssi) / spread;
  return { "--sample-height": `${Math.round(24 + normalized * 76)}%` } as CSSProperties;
}

export function InspectorReadout({
  model,
  activeTab,
  onTabChange
}: {
  model: OperatorInspectorModel;
  activeTab: OperatorInspectorTabId | null;
  onTabChange?: (tab: OperatorInspectorTabId) => void;
}) {
  const active = model.tabs.find((tab) => tab.id === activeTab) ?? model.tabs[0];
  const investigationPath = model.investigationPath ?? [];
  return (
    <div className="selection-panel inspector-readout" aria-label="Operator inspector readout">
      <span className="panel-label">Operator Inspector</span>
      <strong>{model.title}</strong>
      <span>{model.subtitle}</span>
      {investigationPath.length > 0 ? (
        <div className="investigation-path" aria-label="Investigation path">
          {investigationPath.map((step) => (
            <button
              key={`${step.label}:${step.tabId}`}
              type="button"
              className={`investigation-step tone-${step.tone} ${active.id === step.tabId ? "is-active" : ""}`}
              onClick={() => onTabChange?.(step.tabId)}
            >
              <span>{step.label}</span>
              <strong>{step.value}</strong>
            </button>
          ))}
        </div>
      ) : null}
      <div className="inspector-tab-row" aria-label="Inspector tabs">
        {model.tabs.map((tab) => (
          <button key={tab.id} type="button" className={active.id === tab.id ? "is-active" : ""} onClick={() => onTabChange?.(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="evidence-chip-grid compact">
        {model.tags.slice(0, 6).map((tag) => (
          <span key={`${tag.tone}:${tag.label}`} className={`evidence-chip tone-${tag.tone}`}>
            {tag.label}
          </span>
        ))}
      </div>
      <DetailSection
        key={active.id}
        title={active.label}
        rows={[
          ...active.metrics.map((metric) => [metric.label, metric.value] as [string, string]),
          ...active.rows.slice(0, 8).map((row) => [row.label, row.value] as [string, string])
        ]}
      />
    </div>
  );
}

function SelectionActions({ onPrevious, onNext, onClear }: { onPrevious?: () => void; onNext?: () => void; onClear?: () => void }) {
  if (!onPrevious && !onNext && !onClear) {
    return null;
  }
  return (
    <div className="selection-actions" aria-label="Selection navigation">
      <button type="button" onClick={onPrevious} disabled={!onPrevious}>Prev</button>
      <button type="button" onClick={onNext} disabled={!onNext}>Next</button>
      <button type="button" onClick={onClear} disabled={!onClear}>Clear</button>
    </div>
  );
}

function QualityPanel({ selected }: { selected: RfSceneEntity }) {
  const quality = rfQualitySummary(selected);
  return (
    <section className="selection-quality" aria-label="RF data quality">
      <div className="selection-quality-score">
        <span className="selection-section-label">Data Quality</span>
        <strong>{quality.label} · {quality.score}%</strong>
      </div>
      <div className="evidence-chip-grid compact">
        {quality.chips.map((chip) => (
          <span key={chip} className="evidence-chip tone-quality">{chip}</span>
        ))}
      </div>
      <span>{quality.reasons[0]}</span>
    </section>
  );
}

function EvidenceChips({ selected }: { selected: RfSceneEntity }) {
  const chips = [
    {
      label: selected.rssi == null ? "signal unknown" : `signal ${selected.rssi} dBm`,
      tone: selected.rssi == null ? "muted" : signalTone(selected.rssi)
    },
    {
      label: selected.rssi == null ? "unknown signal" : signalLabel(selected.rssi),
      tone: selected.rssi == null ? "muted" : signalTone(selected.rssi)
    },
    { label: selected.category.replace("_", " "), tone: selected.category },
    { label: selected.source, tone: `source-${selected.source}` },
    { label: selected.freshness, tone: `freshness-${selected.freshness}` },
    selected.channel ? { label: `ch ${selected.channel}`, tone: "channel" } : null,
    selected.frequency ? { label: `${selected.frequency} MHz`, tone: "frequency" } : null,
    selected.manufacturer ? { label: selected.manufacturer, tone: "manufacturer" } : null,
    { label: `${selected.count.toLocaleString()} sightings`, tone: selected.count > 1 ? "count-hot" : "count" }
  ].filter((chip): chip is { label: string; tone: string } => Boolean(chip));

  return (
    <div className="evidence-chip-grid" aria-label="Operator RF highlights">
      {chips.map((chip) => (
        <span key={`${chip.tone}:${chip.label}`} className={`evidence-chip tone-${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function signalLabel(rssi: number): string {
  if (rssi >= -45) {
    return "very strong signal";
  }
  if (rssi >= -60) {
    return "good signal";
  }
  if (rssi >= -75) {
    return "weak signal";
  }
  return "distant signal";
}

function signalTone(rssi: number): string {
  if (rssi >= -45) {
    return "signal-very-strong";
  }
  if (rssi >= -60) {
    return "signal-good";
  }
  if (rssi >= -75) {
    return "signal-weak";
  }
  return "signal-distant";
}

function reasonLabel(reason: string): string {
  return reason.replaceAll("_", " ");
}

function reasonTone(reason: string): string {
  if (reason === "tracked" || reason === "repeat_presence") {
    return "good";
  }
  if (reason === "strong_signal") {
    return "signal-good";
  }
  if (reason === "unknown_rf" || reason === "new_or_rare") {
    return "hot";
  }
  if (reason === "aircraft" || reason === "utility") {
    return "warn";
  }
  return "neutral";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "unknown";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function pluralize(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}

function formatHour(hour: number | undefined): string {
  if (hour === undefined) {
    return "unknown";
  }
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const display = normalized % 12 || 12;
  return `${display} ${suffix}`;
}

function DetailSection({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="selection-detail-section">
      <span className="selection-section-label">{title}</span>
      <dl className="selection-detail-grid">
        {rows.map(([label, value], index) => (
          <div className="selection-detail-row" key={`${label}:${value}:${index}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatDistance(distanceMeters: number): string {
  if (distanceMeters >= 1000) {
    return `${(distanceMeters / 1000).toFixed(1)} km`;
  }

  return `${Math.round(distanceMeters)} m`;
}

function formatCoordinate(latitude: number, longitude: number): string {
  return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "unknown";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toISOString().replace(".000Z", "Z");
}
