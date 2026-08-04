import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPresenceEntityAnnotation, fetchPresenceEntityDetail, fetchPresenceEntityIntelligence, fetchPresenceEntityInvestigation } from "../data/api";
import type { PresenceDossier, PresenceEntityAnnotation, PresenceEntityDetail, PresenceEntityIntelligence, PresenceEntityInvestigation, PresenceSighting } from "../domain/types";
import { AppNavigation } from "./AppNavigation";

export function PresenceInvestigationPage({ entityKey }: { entityKey: string }) {
  const [investigation, setInvestigation] = useState<PresenceEntityInvestigation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [annotationStatus, setAnnotationStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setInvestigation(null);
    fetchPresenceEntityInvestigation(entityKey)
      .then((payload) => {
        if (!cancelled) {
          setInvestigation(payload);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load investigation workspace");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entityKey]);

  const detail = investigation?.detail;
  const intelligence = investigation?.intelligence;
  return (
    <main className="presence-page presence-investigation-page">
      <header className="presence-header">
        <div>
          <p className="presence-eyebrow">TDS entity investigation</p>
          <h1>Investigation Workspace</h1>
        </div>
        <div className="presence-header-actions">
          <AppNavigation />
          <a href={`/presence/entities/${encodeURIComponent(entityKey)}`}>Full dossier</a>
        </div>
      </header>

      {error ? <div className="presence-alert">{error}</div> : null}
      {!investigation && !error ? <section className="presence-panel"><p className="presence-empty">Loading investigation workspace...</p></section> : null}
      {investigation && detail && intelligence ? (
        <>
          <section className="presence-investigation-hero">
            <div>
              <span>{investigation.summary.source} / {investigation.summary.protocol} / {investigation.summary.kind}</span>
              <h2>{investigation.summary.label}</h2>
              <p>{detail.dossier.identity?.aliases?.slice(0, 4).join(" / ") || investigation.entity_key}</p>
            </div>
            <div className="presence-investigation-kpis" aria-label="Investigation operator sections">
              {investigation.operator_sections.map((section) => (
                <article key={section.id} className={`presence-investigation-kpi is-${section.tone}`}>
                  <span>{section.label}</span>
                  <strong>{section.value}</strong>
                  <p>{section.summary}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="presence-investigation-grid">
            <article className="presence-panel presence-investigation-card">
              <div className="presence-panel-header">
                <div>
                  <h2>Source Evidence</h2>
                  <p>{detail.dossier.evidence?.length ?? 0} prioritized source rows</p>
                </div>
              </div>
              <div className="presence-evidence-highlights">
                {(detail.dossier.evidence ?? []).flatMap((row) => row.highlights ?? []).slice(0, 8).map((highlight) => (
                  <div key={`${highlight.key}:${highlight.value}`}>
                    <span>{highlight.label}</span>
                    <strong>{highlight.value}</strong>
                  </div>
                ))}
              </div>
            </article>

            <article className="presence-panel presence-investigation-card">
              <div className="presence-panel-header">
                <div>
                  <h2>Timeline Trail</h2>
                  <p>{intelligence.timeline.count} correlated observations</p>
                </div>
              </div>
              <div className="presence-timeline">
                {intelligence.timeline.items.slice(0, 6).map((item) => (
                  <div key={`${item.type}:${item.id}`} className="presence-sighting">
                    <time>{formatTime(item.timestamp)}</time>
                    <strong>{item.label}</strong>
                    <span>{item.summary}</span>
                  </div>
                ))}
              </div>
            </article>

            {intelligence.confidence_drift ? <ConfidenceDriftCard intelligence={intelligence} /> : null}
            {intelligence.identity_confidence_radar ? <IdentityConfidenceRadarCard intelligence={intelligence} /> : null}
            {intelligence.presence_habit_calendar ? <PresenceHabitCalendarCard intelligence={intelligence} /> : null}
            {intelligence.evidence_provenance_ribbon ? <EvidenceProvenanceRibbonCard intelligence={intelligence} /> : null}
            {intelligence.life_story_timeline ? <LifeStoryTimelineCard intelligence={intelligence} /> : null}
            <OperatorAnnotationCard entityKey={entityKey} status={annotationStatus} onSaved={(annotation) => {
              setAnnotationStatus(`Saved annotation: ${annotation.notes.count} ${annotationLabel("note", annotation.notes.count)} / ${annotation.decision_state.labeled} ${annotationLabel("label", annotation.decision_state.labeled)}`);
            }} />

            <article className="presence-panel presence-investigation-card">
              <div className="presence-panel-header">
                <div>
                  <h2>Related Entities</h2>
                  <p>{detail.related_entities.length} co-seen links</p>
                </div>
              </div>
              <div className="presence-entity-related-list">
                {detail.related_entities.slice(0, 6).map((entity) => (
                  <a key={entity.entity_key} href={`/presence/investigate/${encodeURIComponent(entity.entity_key)}`}>
                    <span>{entity.relationship}</span>
                    <strong>{entity.label}</strong>
                    <small>{entity.shared_window_count} shared windows</small>
                  </a>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}


function annotationLabel(label: string, count: number): string {
  return count === 1 ? label : `${label}s`;
}


function OperatorAnnotationCard({
  entityKey,
  status,
  onSaved
}: {
  entityKey: string;
  status: string | null;
  onSaved: (annotation: PresenceEntityAnnotation) => void;
}) {
  const [note, setNote] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!note.trim() && !label.trim()) {
      return;
    }
    setSaving(true);
    try {
      const annotation = await createPresenceEntityAnnotation(entityKey, {
        note: note.trim() || undefined,
        label: label.trim() || undefined,
        disposition: "important"
      });
      setNote("");
      setLabel("");
      onSaved(annotation);
    } finally {
      setSaving(false);
    }
  };
  return (
    <article className="presence-panel presence-investigation-card presence-annotation-card">
      <div className="presence-panel-header">
        <div>
          <h2>Operator Notes / Labels</h2>
          <p>Attach operator context directly to this identity.</p>
        </div>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          <span>Operator note</span>
          <textarea aria-label="Operator note" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <label>
          <span>Operator label</span>
          <input aria-label="Operator label" value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <button type="submit" disabled={saving || (!note.trim() && !label.trim())}>Save annotation</button>
      </form>
      {status ? <strong className="presence-annotation-status">{status}</strong> : null}
    </article>
  );
}


export function PresenceEntityPage({ entityKey }: { entityKey: string }) {
  const [detail, setDetail] = useState<PresenceEntityDetail | null>(null);
  const [intelligence, setIntelligence] = useState<PresenceEntityIntelligence | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([fetchPresenceEntityDetail(entityKey), fetchPresenceEntityIntelligence(entityKey)])
      .then(([payload, intel]) => {
        if (!cancelled) {
          setDetail(payload);
          setIntelligence(intel);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load identity detail");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [entityKey]);

  const rssiTrend = useMemo(() => buildRssiTrend(detail?.sightings.items ?? []), [detail]);
  const operatorRead = detail ? buildOperatorRead(detail) : "";

  return (
    <main className="presence-page presence-entity-page">
      <header className="presence-header">
        <div>
          <p className="presence-eyebrow">TDS identity dossier</p>
          <h1>Presence Identity</h1>
        </div>
        <AppNavigation />
      </header>

      {error ? <div className="presence-alert">{error}</div> : null}
      {!detail && !error ? <section className="presence-panel"><p className="presence-empty">Loading identity detail...</p></section> : null}
      {detail ? (
        <>
          <section className="presence-entity-hero">
            <div>
              <span>{detail.summary.source} / {detail.summary.protocol} / {detail.summary.kind}</span>
              <h2>{detail.summary.label}</h2>
              <p>{detail.dossier.identity.aliases.slice(0, 4).join(" / ")}</p>
              <div className="presence-operator-read">
                <span>Operator Read</span>
                <strong>{operatorRead}</strong>
              </div>
              <div className="presence-chip-row" aria-label="Interesting Signals">
                <b>Interesting Signals</b>
                {detail.dossier.reason_chips?.slice(0, 5).map((chip) => (
                  <span key={chip.id} className={`presence-identity-chip is-${chip.tone}`}>{chip.label}</span>
                ))}
                {detail.dossier.anomalies?.slice(0, 3).map((anomaly) => (
                  <span key={anomaly.id} className={`presence-identity-chip is-${anomaly.tone}`}>{anomaly.label}</span>
                ))}
              </div>
            </div>
            <div className="presence-entity-score-grid">
              <Metric label="Seen" value={`${detail.summary.seen_count} total sightings`} />
              <Metric label="Interest" value={`${detail.dossier.scores.interest}%`} />
              <Metric label="Reliability" value={`${detail.dossier.scores.reliability}%`} />
              <Metric label="Last RSSI" value={formatSignal(detail.summary.rssi)} />
            </div>
          </section>

          <section className="presence-entity-visual-grid" aria-label="Identity operator visuals">
            <article className="presence-chart-card presence-behavior-card">
              <span>Behavior Status</span>
              <strong>{detail.dossier.presence_rules?.label ?? detail.dossier.reliability?.label ?? "Learning baseline"}</strong>
              <p>{detail.dossier.reliability?.gaps[0] ?? detail.dossier.reliability?.strengths[0] ?? detail.dossier.sample_summary?.cadence_label ?? "TDS is still collecting enough evidence to explain the normal pattern."}</p>
            </article>
            <article className="presence-chart-card is-rssi-trend">
              <span>RSSI Proximity</span>
              <strong>{formatSignal(detail.summary.rssi)} latest</strong>
              <svg viewBox="0 0 100 100" role="img" aria-label="Identity RSSI trend">
                <polyline points={rssiTrend.path} />
                {rssiTrend.points.map((point) => (
                  <circle key={point.id} cx={point.x} cy={point.y} r="5">
                    <title>{`${formatTime(point.timestamp)} ${formatSignal(point.rssi)}`}</title>
                  </circle>
                ))}
              </svg>
            </article>
            <article className="presence-chart-card">
              <span>Source Confidence</span>
              <strong>{detail.dossier.source_confidence.length} sources</strong>
              <div className="presence-source-rings">
                {detail.dossier.source_confidence.slice(0, 3).map((source) => (
                  <div key={source.source}>
                    <i style={{ "--ring-percent": `${formatConfidence(source.confidence)}%` } as CSSProperties} />
                    <span>{source.source}</span>
                    <strong>{formatConfidence(source.confidence)}%</strong>
                  </div>
                ))}
              </div>
            </article>
            <article className="presence-chart-card">
              <span>Identifying Evidence</span>
              <strong>{detail.dossier.evidence.length ? `${detail.dossier.evidence.length} evidence rows` : "No highlighted fields yet"}</strong>
              <div className="presence-evidence-highlights">
                {detail.dossier.evidence.flatMap((row) => row.highlights ?? []).slice(0, 5).map((highlight) => (
                  <div key={`${highlight.key}:${highlight.value}`}>
                    <span>{highlight.label}</span>
                    <strong>{highlight.value}</strong>
                  </div>
                ))}
              </div>
            </article>
            {detail.dossier.resolved_identity ? <ResolvedIdentityCard dossier={detail.dossier} /> : null}
            {detail.dossier.rf_fingerprint ? <RfFingerprintCard dossier={detail.dossier} /> : null}
            {detail.dossier.ble_profile && detail.dossier.ble_profile.status !== "empty" ? <BleProfileCard dossier={detail.dossier} /> : null}
            {detail.dossier.wifi_roaming && detail.dossier.wifi_roaming.status !== "empty" ? <WifiRoamingCard dossier={detail.dossier} /> : null}
            {detail.dossier.rail_context ? <DomainContextVisualCard title="Rail RF Context" confidence={detail.dossier.rail_context.confidence} read={detail.dossier.rail_context.operator_read} facts={[detail.dossier.rail_context.channel_label, detail.dossier.rail_context.operator_hint, detail.dossier.rail_context.route_hint].filter(Boolean) as string[]} /> : null}
            {detail.dossier.iot_context ? <DomainContextVisualCard title="IoT Mesh Context" confidence={detail.dossier.iot_context.confidence} read={detail.dossier.iot_context.operator_read} facts={[detail.dossier.iot_context.protocol_label, detail.dossier.iot_context.channel_label, detail.dossier.iot_context.network_pan_id ? `PAN ${detail.dossier.iot_context.network_pan_id}` : null, detail.dossier.iot_context.vendor_hint].filter(Boolean) as string[]} /> : null}
            {(detail.dossier.rhythm?.sample_count ?? 0) > 0 || detail.dossier.commute_clock || detail.dossier.next_seen ? <RhythmExpectationCard dossier={detail.dossier} /> : null}
            {detail.dossier.sample_summary && detail.dossier.sample_summary.sample_count > 0 ? <RecentSamplesCard dossier={detail.dossier} /> : null}
            {detail.dossier.enrichment && detail.dossier.enrichment.status !== "empty" ? <EnrichmentCard dossier={detail.dossier} /> : null}
            {intelligence?.confidence_drift ? <ConfidenceDriftCard intelligence={intelligence} /> : null}
            {intelligence?.identity_confidence_radar ? <IdentityConfidenceRadarCard intelligence={intelligence} /> : null}
            {intelligence?.presence_habit_calendar ? <PresenceHabitCalendarCard intelligence={intelligence} /> : null}
            {intelligence?.evidence_provenance_ribbon ? <EvidenceProvenanceRibbonCard intelligence={intelligence} /> : null}
            {intelligence?.life_story_timeline ? <LifeStoryTimelineCard intelligence={intelligence} /> : null}
            {intelligence ? <IdentityTimelineCard intelligence={intelligence} /> : null}
            <article className="presence-chart-card">
              <span>Related Entities</span>
              <strong>{detail.related_entities.length} links</strong>
              <div className="presence-entity-related-list">
                {detail.related_entities.slice(0, 5).map((entity) => (
                  <a key={entity.entity_key} href={`/presence/entities/${encodeURIComponent(entity.entity_key)}`}>
                    <span>{entity.relationship}</span>
                    <strong>{entity.label}</strong>
                    <small>{entity.shared_window_count} shared windows</small>
                  </a>
                ))}
              </div>
            </article>
          </section>

          <section className="presence-grid presence-entity-detail-grid">
            <article className="presence-panel">
              <div className="presence-panel-header">
                <div>
                  <h2>Latest Sightings</h2>
                  <p>{detail.sightings.count} recent source observations</p>
                </div>
              </div>
              <div className="presence-timeline">
                {detail.sightings.items.slice(0, 8).map((item) => (
                  <div key={item.id} className="presence-sighting">
                    <time>{formatTime(item.timestamp)}</time>
                    <strong>{item.source}</strong>
                    <span className="presence-sighting-meta">
                      {item.sensor_id ? <b>{item.sensor_id}</b> : null}
                      <em>{formatSignal(item.rssi)}</em>
                      <em>{item.kind}</em>
                    </span>
                  </div>
                ))}
              </div>
            </article>
            <article className="presence-panel">
              <div className="presence-panel-header">
                <div>
                  <h2>Timeline</h2>
                  <p>{detail.timeline.count} events and sightings</p>
                </div>
              </div>
              <div className="presence-timeline">
                {detail.timeline.items.slice(0, 12).map((item) => (
                  <div key={`${item.type}:${item.id}`} className="presence-sighting">
                    <time>{formatTime(item.timestamp)}</time>
                    <strong>{item.label}</strong>
                    <span>{item.summary}</span>
                  </div>
                ))}
              </div>
            </article>
            <article className="presence-panel">
              <div className="presence-panel-header">
                <div>
                  <h2>Notes</h2>
                  <p>{detail.notes.count} operator notes</p>
                </div>
              </div>
              <div className="presence-case-notebook">
                {detail.notes.items.map((note) => (
                  <article key={note.id}>
                    <strong>{note.disposition}</strong>
                    <span>{note.note}</span>
                  </article>
                ))}
              </div>
            </article>
            <article className="presence-panel">
              <div className="presence-panel-header">
                <div>
                  <h2>Raw Evidence</h2>
                  <p>{detail.raw_payload_preview.length} source fields</p>
                </div>
              </div>
              <div className="presence-raw-preview">
                {detail.raw_payload_preview.slice(0, 18).map((field) => (
                  <div key={`${field.field}:${field.value}`}>
                    <span>{field.field}</span>
                    <strong>{field.value}</strong>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : null}
    </main>
  );
}







function EvidenceProvenanceRibbonCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  const ribbon = intelligence.evidence_provenance_ribbon;
  if (!ribbon) {
    return null;
  }
  return (
    <article className="presence-chart-card presence-provenance-ribbon-card is-wide">
      <span>Evidence Provenance Ribbon</span>
      <strong>{ribbon.complete_count}/{ribbon.total_count} complete</strong>
      <p>{ribbon.operator_read}</p>
      <div className="presence-provenance-ribbon" aria-label="Evidence provenance stages">
        {ribbon.stages.map((stage) => (
          <div key={stage.id} className={`is-${stage.status} is-${stage.tone}`} title={stage.description}>
            <i />
            <span>{stage.label}</span>
            <strong>{stage.count}</strong>
          </div>
        ))}
      </div>
      <small>Weakest link: {ribbon.weakest_stage.label}</small>
    </article>
  );
}

function LifeStoryTimelineCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  const story = intelligence.life_story_timeline;
  if (!story) {
    return null;
  }
  return (
    <article className="presence-chart-card presence-life-story-card is-wide">
      <span>Life Story Timeline</span>
      <strong>{story.count} story events</strong>
      <p>{story.operator_read}</p>
      <div className="presence-life-story-lanes" aria-label="Life story lanes">
        {story.lanes.map((lane) => (
          <div key={lane.id} className={`is-${lane.tone}`}>
            <span>{lane.label}</span>
            <strong>{lane.count}</strong>
          </div>
        ))}
      </div>
      <div className="presence-life-story-events" aria-label="Life story timeline">
        {story.items.slice(0, 7).map((item) => (
          <div key={`${item.lane}:${item.type}:${item.id}`} className={`is-${item.tone}`}>
            <i />
            <span>{item.lane_label}</span>
            <strong>{item.label}</strong>
            <small>{formatTime(item.timestamp)} · {item.summary}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function PresenceHabitCalendarCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  const calendar = intelligence.presence_habit_calendar;
  if (!calendar) {
    return null;
  }
  const cells = calendar.cells ?? [];
  const activeCells = cells.filter((cell) => cell.count > 0).sort((a, b) => b.count - a.count || a.weekday - b.weekday || a.hour - b.hour).slice(0, 5);
  return (
    <article className="presence-chart-card presence-habit-calendar-card is-wide">
      <span>Presence Habit Calendar</span>
      <strong>{calendar.sample_count} rhythm samples</strong>
      <p>{calendar.operator_read}</p>
      <div className="presence-habit-layout">
        <div className="presence-habit-grid" aria-label="Presence habit calendar">
          {cells.map((cell) => (
            <i
              key={`${cell.weekday}:${cell.hour}`}
              className={cell.count > 0 ? "has-presence" : undefined}
              style={{ "--habit-intensity": `${Math.max(8, cell.intensity)}%` } as CSSProperties}
              title={`${cell.label} ${cell.count} hits`}
            />
          ))}
        </div>
        <div className="presence-habit-readout">
          <div>
            <span>Peak Windows</span>
            {calendar.peak_windows.slice(0, 3).map((peak) => (
              <strong key={peak.hour}>{peak.label}<small>{peak.count} hits</small></strong>
            ))}
          </div>
          <div>
            <span>Hot Cells</span>
            {activeCells.map((cell) => (
              <strong key={`${cell.weekday}:${cell.hour}`}>{cell.label}<small>{cell.count} hits</small></strong>
            ))}
          </div>
        </div>
      </div>
      {calendar.deviations.length ? (
        <div className="presence-habit-deviations">
          {calendar.deviations.slice(0, 3).map((deviation) => (
            <span key={`${deviation.timestamp}:${deviation.hour}`}>{deviation.label}</span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function IdentityConfidenceRadarCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  const radar = intelligence.identity_confidence_radar;
  if (!radar) {
    return null;
  }
  const axes = radar.axes ?? [];
  return (
    <article className="presence-chart-card presence-identity-radar-card is-wide">
      <span>Identity Confidence Radar</span>
      <strong>{radar.overall_score}% overall confidence</strong>
      <p>{radar.operator_read}</p>
      <div className="presence-radar-spokes" aria-label="Identity confidence radar axes">
        {axes.map((axis) => (
          <div key={axis.id} className={`is-${axis.tone}`}>
            <label>{axis.label}</label>
            <span><i style={{ "--radar-score": `${axis.score}%` } as CSSProperties} /></span>
            <strong>{axis.score}%</strong>
            <small>{axis.evidence}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function ConfidenceDriftCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  const drift = intelligence.confidence_drift;
  if (!drift?.latest) {
    return null;
  }
  const points = drift.items.slice().reverse();
  const polyline = points.length > 1
    ? points.map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 100 - point.confidence;
      return `${x},${y}`;
    }).join(" ")
    : "0,55 100,55";
  return (
    <article className="presence-chart-card presence-confidence-drift-card is-wide">
      <span>Confidence Drift</span>
      <strong>{drift.latest.confidence}% latest confidence</strong>
      <p>{drift.latest.reason}</p>
      <svg viewBox="0 0 100 100" role="img" aria-label="Presence confidence drift">
        <polyline points={polyline} />
        {points.map((point, index) => (
          <circle key={`${point.timestamp}:${point.source}:${index}`} cx={points.length === 1 ? 50 : (index / (points.length - 1)) * 100} cy={100 - point.confidence} r="4">
            <title>{`${formatTime(point.timestamp)} ${point.confidence}% ${point.reason}`}</title>
          </circle>
        ))}
      </svg>
    </article>
  );
}

function IdentityTimelineCard({ intelligence }: { intelligence: PresenceEntityIntelligence }) {
  return (
    <article className="presence-chart-card presence-identity-timeline-card is-wide">
      <span>Identity Timeline</span>
      <strong>{intelligence.timeline.count} timeline events</strong>
      <div className="presence-identity-timeline" aria-label="Identity timeline">
        {intelligence.timeline.items.slice(0, 6).map((item) => (
          <div key={item.id} className={`is-${item.type}`}>
            <i />
            <span>{formatTime(item.timestamp)}</span>
            <strong>{item.label}</strong>
            <small>{item.summary}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function ResolvedIdentityCard({ dossier }: { dossier: PresenceDossier }) {
  const identity = dossier.resolved_identity;
  if (!identity) {
    return null;
  }
  const identifiers = [
    ...identity.identifiers.macs.slice(0, 1),
    ...identity.identifiers.ip_addresses.slice(0, 1),
    ...identity.identifiers.hostnames.slice(0, 1),
    ...identity.identifiers.networks.slice(0, 1)
  ];
  const tier = identity.relationship_label ?? titleizeTier(identity.tier ?? "single_source");
  return (
    <article className={`presence-chart-card presence-signal-detail-card presence-resolved-identity-card is-${identity.tier ?? "single_source"} is-wide`}>
      <span>Resolved Identity</span>
      <strong>{identity.label}</strong>
      <div className="presence-resolution-tier">
        <span>Resolution Tier</span>
        <b>{tier}</b>
        <em>{formatConfidence(identity.confidence)}% confidence</em>
      </div>
      <p>{identity.source_count} sources / {identity.entity_count} rows</p>
      <div className="presence-resolved-id-summary">
        <b>{identity.canonical_key}</b>
        <span>{identity.sources.slice(0, 5).join(" / ")}</span>
      </div>
      {identity.operator_feedback ? (
        <div className="presence-resolver-feedback">
          <span>Operator feedback</span>
          <strong>{identity.operator_feedback.confirmed} confirmed / {identity.operator_feedback.rejected} rejected / {identity.operator_feedback.split} split</strong>
        </div>
      ) : null}
      <div className="presence-resolved-id-chips" aria-label="Resolved identity identifiers">
        {identifiers.map((value) => (
          <i key={value}>{value}</i>
        ))}
      </div>
      <div className="presence-resolved-id-evidence" aria-label="Resolved identity evidence ladder">
        {identity.evidence.slice(0, 3).map((row) => (
          <div key={`${row.type}:${row.value}`}>
            <span>{row.type.replace(/_/g, " ")}</span>
            <strong>{row.explanation}</strong>
            <small>{formatConfidence(row.confidence)}% · {row.sources.slice(0, 3).join(" / ")}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function EnrichmentCard({ dossier }: { dossier: PresenceDossier }) {
  const enrichment = dossier.enrichment;
  if (!enrichment || enrichment.status === "empty") {
    return null;
  }
  const findings = enrichment.findings?.slice(0, 4) ?? [];
  return (
    <article className="presence-chart-card presence-signal-detail-card is-wide">
      <span>External Enrichment</span>
      <strong>{enrichment.status} · {enrichment.mode}</strong>
      <div className="presence-enrichment-list">
        {findings.length > 0
          ? findings.map((finding) => (
            <div key={`${finding.target_id}:${finding.label}:${finding.value}`}>
              <strong>{finding.label}: {finding.value}</strong>
              <span>{finding.source} · {formatConfidence(finding.confidence)}% confidence</span>
            </div>
          ))
          : enrichment.targets.slice(0, 4).map((target) => (
            <div key={target.id}>
              <strong>{target.label}</strong>
              <span>{target.status}</span>
            </div>
          ))}
      </div>
    </article>
  );
}

function RfFingerprintCard({ dossier }: { dossier: PresenceDossier }) {
  const fingerprint = dossier.rf_fingerprint;
  if (!fingerprint) {
    return null;
  }
  return (
    <article className="presence-chart-card presence-signal-detail-card">
      <span>RF Fingerprint</span>
      <strong>{fingerprint.label}</strong>
      <div className="presence-fingerprint-gauge" aria-label="RF fingerprint confidence">
        <i style={{ "--fingerprint-confidence": `${fingerprint.confidence}%` } as CSSProperties} />
        <b>{fingerprint.confidence}%</b>
      </div>
      <p>{fingerprint.anchors.slice(0, 4).join(" · ") || `${fingerprint.sample_count} RF samples`}</p>
    </article>
  );
}

function BleProfileCard({ dossier }: { dossier: PresenceDossier }) {
  const profile = dossier.ble_profile;
  if (!profile || profile.status === "empty") {
    return null;
  }
  const services = profile.services.slice(0, 4);
  return (
    <article className="presence-chart-card presence-signal-detail-card">
      <span>BLE Profile</span>
      <strong>{services.join(" · ") || profile.label}</strong>
      <div className="presence-ble-chip-grid">
        {[profile.name, profile.manufacturer, profile.model].filter(Boolean).slice(0, 4).map((value) => (
          <b key={value}>{value}</b>
        ))}
      </div>
      <p>{profile.signals.slice(0, 2).join(" · ") || profile.manufacturer_data || "BLE advertisements decoded"}</p>
    </article>
  );
}

function WifiRoamingCard({ dossier }: { dossier: PresenceDossier }) {
  const roaming = dossier.wifi_roaming;
  if (!roaming || roaming.status === "empty") {
    return null;
  }
  const apPath = roaming.access_points.slice(0, 4).join(" -> ");
  return (
    <article className="presence-chart-card presence-signal-detail-card is-wide">
      <span>Wi-Fi Roaming</span>
      <strong>{roaming.network_names.slice(0, 2).join(" · ") || roaming.label}</strong>
      <p>{apPath || roaming.label}</p>
      <div className="presence-roaming-path" aria-label="Wi-Fi roaming path">
        {roaming.hops.slice(0, 5).map((hop, index) => (
          <i
            key={`${hop.timestamp ?? "hop"}:${index}`}
            style={{ "--hop-signal": `${signalPercent(hop.rssi)}%` } as CSSProperties}
            title={`${formatTime(hop.timestamp)} ${hop.access_point ?? "unknown AP"} ${formatSignal(hop.rssi)}`}
          />
        ))}
      </div>
    </article>
  );
}

function RhythmExpectationCard({ dossier }: { dossier: PresenceDossier }) {
  const peakHour = dossier.rhythm?.peak_hours[0]?.hour;
  return (
    <article className="presence-chart-card presence-signal-detail-card">
      <span>Rhythm / Expected</span>
      <strong>{dossier.commute_clock?.label ?? (peakHour == null ? "Learning rhythm" : `Peak ${formatHour(peakHour)}`)}</strong>
      <p>{dossier.next_seen?.label ?? `${dossier.rhythm?.sample_count ?? 0} rhythm samples`}</p>
      <div className="presence-rhythm-dots" aria-label="Identity rhythm hotspots">
        {(dossier.rhythm?.hotspots ?? []).slice(0, 7).map((hotspot, index) => (
          <i
            key={`${hotspot.weekday}:${hotspot.hour}:${index}`}
            style={{ "--rhythm-intensity": `${Math.min(100, 26 + hotspot.count * 14)}%` } as CSSProperties}
            title={`${weekdayLabel(hotspot.weekday)} ${formatHour(hotspot.hour)} · ${hotspot.count} sightings`}
          />
        ))}
      </div>
    </article>
  );
}


function DomainContextVisualCard({ title, confidence, read, facts }: { title: string; confidence: number; read: string; facts: string[] }) {
  return (
    <article className="presence-chart-card presence-domain-visual-card">
      <span>{title}</span>
      <strong>{confidence}% confidence</strong>
      <p>{read}</p>
      <div className="presence-evidence-highlights">
        {facts.slice(0, 4).map((fact) => (
          <div key={fact}>
            <span>Context</span>
            <strong>{fact}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function RecentSamplesCard({ dossier }: { dossier: PresenceDossier }) {
  const summary = dossier.sample_summary;
  if (!summary) {
    return null;
  }
  return (
    <article className="presence-chart-card presence-signal-detail-card is-wide">
      <span>Recent Samples</span>
      <strong>{summary.cadence_label}</strong>
      <p>{summary.recent_sample_count || summary.sample_count} samples · last {formatSignal(summary.latest_rssi)} · range {formatSignal(summary.weakest_rssi)} to {formatSignal(summary.strongest_rssi)}</p>
      <div className="presence-sample-bars" aria-label="Recent sample RSSI bars">
        {summary.samples.slice(-16).map((sample, index) => (
          <i
            key={`${sample.timestamp ?? "sample"}:${index}`}
            style={{ "--sample-strength": `${signalPercent(sample.rssi)}%` } as CSSProperties}
            title={`${formatTime(sample.timestamp)} ${sample.source} ${formatSignal(sample.rssi)}`}
          />
        ))}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="presence-intel-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function titleizeTier(tier: string): string {
  return tier
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildOperatorRead(detail: PresenceEntityDetail): string {
  return [
    detail.dossier.identity_resolution?.label,
    detail.dossier.reliability ? `${detail.dossier.reliability.label} reliability` : null,
    detail.dossier.presence_rules?.label
  ].filter(Boolean).join(" · ") || `${detail.summary.category} identity observed by ${detail.summary.source}`;
}

function buildRssiTrend(sightings: PresenceSighting[]) {
  const points = sightings
    .slice(0, 16)
    .reverse()
    .map((sighting, index, list) => {
      const rssi = sighting.rssi;
      const strength = typeof rssi === "number" ? Math.max(0, Math.min(100, ((rssi + 100) / 70) * 100)) : 0;
      return {
        id: sighting.id,
        x: list.length <= 1 ? 50 : (index / (list.length - 1)) * 100,
        y: 96 - strength * 0.88,
        rssi,
        timestamp: sighting.timestamp
      };
    });
  const fallback = points.length > 0 ? points : [{ id: "empty", x: 0, y: 95, rssi: null, timestamp: null }];
  return { points: fallback, path: fallback.map((point) => `${point.x},${point.y}`).join(" ") };
}

function formatSignal(rssi: number | null | undefined): string {
  return typeof rssi === "number" ? `${rssi} dBm` : "unknown";
}

function signalPercent(rssi: number | null | undefined): number {
  if (typeof rssi !== "number") {
    return 16;
  }
  return Math.max(8, Math.min(100, Math.round(((rssi + 100) / 65) * 100)));
}

function formatConfidence(confidence: number): number {
  return Math.round(confidence <= 1 ? confidence * 100 : confidence);
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatHour(hour: number | null | undefined): string {
  if (hour == null || Number.isNaN(hour)) {
    return "unknown";
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display} ${suffix}`;
}

function weekdayLabel(weekday: number): string {
  return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][weekday] ?? "day";
}
