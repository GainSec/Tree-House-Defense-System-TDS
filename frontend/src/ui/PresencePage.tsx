import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  createInvestigationNote,
  fetchInvestigationNotes,
  fetchPresenceCandidates,
  fetchPresenceCoPresence,
  fetchPresencePlaybooks,
  fetchPresenceReplayFrames,
  fetchPresenceSightings,
  fetchPresenceSummary,
  fetchPresenceWatchModes,
  runPresencePlaybook,
  trackPresenceEntity,
  untrackPresenceEntity
} from "../data/api";
import type {
  InvestigationNote,
  PresenceCandidate,
  PresenceCoPresenceCluster,
  PresencePlaybook,
  PresenceReplayFrame,
  PresenceSighting,
  PresenceSummaryItem,
  PresenceWatchMode
} from "../domain/types";
import { AppNavigation } from "./AppNavigation";
import { buildSelectedPresenceVisuals, type SelectedPresenceVisuals } from "./presenceVisualModel";

interface PresenceState {
  candidates: PresenceCandidate[];
  summary: PresenceSummaryItem[];
  sightings: PresenceSighting[];
  replayFrames: PresenceReplayFrame[];
  notes: InvestigationNote[];
  clusters: PresenceCoPresenceCluster[];
  watchModes: PresenceWatchMode[];
  playbooks: PresencePlaybook[];
  categoryCounts: Record<string, number>;
  candidateTotal: number;
  loading: boolean;
  error: string | null;
}

type CandidateScope = "trackable" | "all";

export function PresencePage() {
  const [state, setState] = useState<PresenceState>({
    candidates: [],
    summary: [],
    sightings: [],
    replayFrames: [],
    notes: [],
    clusters: [],
    watchModes: [],
    playbooks: [],
    categoryCounts: {},
    candidateTotal: 0,
    loading: true,
    error: null
  });
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<CandidateScope>("trackable");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedWatchId, setSelectedWatchId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState("home_presence");
  const [noteDraft, setNoteDraft] = useState("");

  const loadPresence = async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const [candidates, summary, clusters, watchModes, playbooks] = await Promise.all([
        fetchPresenceCandidates(500, scope, activeMode),
        fetchPresenceSummary(),
        fetchPresenceCoPresence(),
        fetchPresenceWatchModes(),
        fetchPresencePlaybooks()
      ]);
      setState((current) => ({
        ...current,
        candidates: candidates.items,
        summary: summary.items,
        clusters: clusters.items,
        watchModes: watchModes.items,
        playbooks: playbooks.items,
        categoryCounts: candidates.category_counts ?? categoryCountsFromCandidates(candidates.items),
        candidateTotal: candidates.total_count ?? candidates.count,
        loading: false
      }));
      if (!selectedWatchId && summary.items[0]) {
        setSelectedWatchId(summary.items[0].id);
      }
    } catch (error) {
      setState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Unable to load presence data" }));
    }
  };

  useEffect(() => {
    void loadPresence();
    const interval = window.setInterval(() => void loadPresence(), 15_000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, activeMode]);

  useEffect(() => {
    const selectedItem = state.summary.find((item) => item.id === selectedWatchId) ?? null;
    if (!selectedWatchId || !selectedItem) {
      setState((current) => ({ ...current, sightings: [], replayFrames: [], notes: [] }));
      return;
    }
    let cancelled = false;
    Promise.all([fetchPresenceSightings(selectedWatchId), fetchPresenceReplayFrames(selectedItem.entity_key), fetchInvestigationNotes(selectedItem.entity_key)])
      .then(([sightings, replay, notes]) => {
        if (!cancelled) {
          setState((current) => ({ ...current, sightings: sightings.items, replayFrames: replay.items, notes: notes.items }));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({ ...current, error: error instanceof Error ? error.message : "Unable to load sightings" }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedWatchId, state.summary]);

  const trackedKeys = useMemo(() => new Set(state.summary.map((item) => item.entity_key)), [state.summary]);
  const filteredCandidates = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return categoryFilter === "all" ? state.candidates : state.candidates.filter((item) => item.category === categoryFilter);
    }
    return state.candidates
      .filter((item) => categoryFilter === "all" || item.category === categoryFilter)
      .filter((item) =>
        [item.label, item.entity_key, item.identity_hint, item.source, item.protocol, item.kind]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle))
      );
  }, [categoryFilter, query, state.candidates]);
  const selectedSummary = state.summary.find((item) => item.id === selectedWatchId) ?? state.summary[0] ?? null;
  const categories = useMemo(() => orderedCategories(state.categoryCounts), [state.categoryCounts]);

  const trackCandidate = async (candidate: PresenceCandidate) => {
    const created = await trackPresenceEntity(candidate.entity_key);
    setSelectedWatchId(created.id);
    await loadPresence();
  };

  const stopTracking = async (item: PresenceSummaryItem) => {
    await untrackPresenceEntity(item.id);
    if (selectedWatchId === item.id) {
      setSelectedWatchId(null);
    }
    await loadPresence();
  };

  const addNote = async () => {
    if (!selectedSummary || !noteDraft.trim()) {
      return;
    }
    const note = await createInvestigationNote(selectedSummary.entity_key, noteDraft.trim());
    setNoteDraft("");
    setState((current) => ({ ...current, notes: [note, ...current.notes] }));
  };

  const runPlaybook = async (playbook: PresencePlaybook) => {
    if (!selectedSummary) {
      return;
    }
    await runPresencePlaybook(playbook.id, { entity_key: selectedSummary.entity_key, note: `queued from presence dashboard for ${selectedSummary.label}` });
    await loadPresence();
  };

  return (
    <main className="presence-page">
      <header className="presence-header">
        <div>
          <p className="presence-eyebrow">TDS selected entity history</p>
          <h1>Presence Tracking</h1>
        </div>
        <AppNavigation />
      </header>

      {state.error ? <div className="presence-alert">{state.error}</div> : null}
      <div className="presence-mode-strip" aria-label="Operator watch modes">
        {state.watchModes.map((mode) => (
          <button key={mode.id} className={activeMode === mode.id ? "is-active" : ""} onClick={() => setActiveMode(mode.id)} title={mode.description}>
            {mode.label}
          </button>
        ))}
      </div>

      <section className="presence-grid" aria-busy={state.loading}>
        <div className="presence-panel presence-candidates">
          <div className="presence-panel-header">
            <div>
              <h2>{scope === "trackable" ? "Trackable entities" : "All entities"}</h2>
              <p>{filteredCandidates.length} selectable</p>
            </div>
            <div className="presence-scope" aria-label="Presence candidate scope">
              <button className={scope === "trackable" ? "is-active" : ""} onClick={() => setScope("trackable")}>Trackable</button>
              <button className={scope === "all" ? "is-active" : ""} onClick={() => setScope("all")}>All</button>
            </div>
            <input
              aria-label="Search presence entities"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search MAC, name, source"
            />
          </div>
          <div className="presence-category-strip" aria-label="Presence candidate categories">
            <button
              className={categoryFilter === "all" ? "is-active" : ""}
              onClick={() => setCategoryFilter("all")}
              aria-label="Show all presence candidate categories"
            >
              All <span>{state.candidateTotal}</span>
            </button>
            {categories.map((category) => (
              <button
                key={category}
                className={categoryFilter === category ? "is-active" : ""}
                onClick={() => setCategoryFilter(category)}
                aria-label={`Filter presence candidates to ${categoryLabel(category, true)}`}
              >
                {categoryLabel(category)} <span>{state.categoryCounts[category] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="presence-list">
            {filteredCandidates.map((candidate) => {
              const tracked = trackedKeys.has(candidate.entity_key) || candidate.tracked;
              return (
                <article className="presence-row" key={candidate.entity_key}>
                  <div>
                    <strong>{candidate.label}</strong>
                    <span>{candidate.source} / {candidate.protocol}</span>
                  </div>
                  <div className="presence-row-meta">
                    <PresencePill value={candidate.entity_type} />
                    <SignalMeter rssi={candidate.rssi} />
                    <span>{formatSignal(candidate.rssi)}</span>
                    <span>{candidate.seen_count} seen</span>
                  </div>
                  <button
                    disabled={tracked}
                    onClick={() => void trackCandidate(candidate)}
                    aria-label={tracked ? `${candidate.label} is already tracked` : `Track ${candidate.label}`}
                  >
                    {tracked ? "Tracking" : "Track"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>

        <div className="presence-panel presence-tracked">
          <div className="presence-panel-header">
            <div>
              <h2>Tracked</h2>
              <p>{state.summary.length} selected</p>
            </div>
          </div>
          <div className="presence-list">
            {state.summary.map((item) => (
              <article className={`presence-row is-summary ${selectedSummary?.id === item.id ? "is-selected" : ""}`} key={item.id}>
                <button className="presence-row-main" onClick={() => setSelectedWatchId(item.id)} aria-label={`Open history for ${item.label}`}>
                  <strong>{item.label}</strong>
                  <span>{item.source} / {item.protocol}</span>
                </button>
                <div className="presence-row-meta">
                  <PresencePill value={item.entity_type} />
                  <span>{item.sighting_count} sightings</span>
                  <span>{formatSignal(item.last_rssi)}</span>
                </div>
                <button onClick={() => void stopTracking(item)} aria-label={`Stop tracking ${item.label}`}>Stop</button>
              </article>
            ))}
            {state.summary.length === 0 ? <p className="presence-empty">No selected entities yet.</p> : null}
          </div>
          <PresenceClusterStrip clusters={state.clusters} />
        </div>

        <div className="presence-panel presence-detail">
          <div className="presence-panel-header">
            <div>
              <h2>{selectedSummary?.label ?? "History"}</h2>
              <p>{selectedSummary ? `${selectedSummary.sighting_count} sightings` : "Select a tracked entity"}</p>
            </div>
            {selectedSummary ? (
              <a href={`/presence/entities/${encodeURIComponent(selectedSummary.entity_key)}`} aria-label={`Open full identity detail for ${selectedSummary.label}`}>
                Detail
              </a>
            ) : null}
          </div>
          {selectedSummary ? (
            <>
              <SelectedEntityIntelligence selected={selectedSummary} sightings={state.sightings} clusters={state.clusters} />
              <div className="presence-facts">
                <PresenceFact label="Identity" value={selectedSummary.identity_hint ?? selectedSummary.entity_key} />
                <PresenceFact label="First seen" value={formatTime(selectedSummary.first_seen_at)} />
                <PresenceFact label="Last seen" value={formatTime(selectedSummary.last_seen_at)} />
                <PresenceFact label="Sensor" value={selectedSummary.current_state?.sensor_id ?? "unknown"} />
              </div>
              <div className="presence-evidence">
                <div>
                  <span>operator evidence</span>
                  <strong>{selectedSummary.current_state?.source ?? selectedSummary.source} / {selectedSummary.current_state?.protocol ?? selectedSummary.protocol}</strong>
                </div>
                <div>
                  <span>last signal</span>
                  <strong>{formatSignal(selectedSummary.last_rssi ?? selectedSummary.current_state?.rssi ?? null)}</strong>
                </div>
                <div>
                  <span>current zone</span>
                  <strong>{selectedSummary.current_state?.zone_id ?? "unknown"}</strong>
                </div>
              </div>
              <PresenceTimeline sightings={state.sightings} />
              <PresenceReplayStrip frames={state.replayFrames} />
              <PresencePlaybookStrip playbooks={state.playbooks} onRun={(playbook) => void runPlaybook(playbook)} />
              <CaseNotebook notes={state.notes} draft={noteDraft} onDraftChange={setNoteDraft} onAddNote={() => void addNote()} />
              <div className="presence-timeline">
                {state.sightings.map((sighting) => (
                  <div className="presence-sighting" key={sighting.id}>
                    <time>{formatTime(sighting.timestamp)}</time>
                    <strong>{formatSignal(sighting.rssi)}</strong>
                    <span>{sighting.sensor_id ?? sighting.source} / {sighting.zone_id ?? "unknown zone"}</span>
                  </div>
                ))}
                {state.sightings.length === 0 ? <p className="presence-empty">No sampled sightings recorded yet.</p> : null}
              </div>
            </>
          ) : (
            <p className="presence-empty">Choose devices or aircraft from the entity list to begin sampling history.</p>
          )}
        </div>
      </section>
    </main>
  );
}

function PresenceClusterStrip({ clusters }: { clusters: PresenceCoPresenceCluster[] }) {
  if (clusters.length === 0) {
    return null;
  }
  return (
    <section className="presence-clusters" aria-label="Co-presence clusters">
      <div className="presence-panel-header">
        <div>
          <h2>Co-presence</h2>
          <p>{clusters.length} active patterns</p>
        </div>
      </div>
      {clusters.slice(0, 4).map((cluster) => (
        <article className="presence-cluster" key={cluster.id}>
          <div className="presence-cluster-link" aria-hidden="true">
            <span />
            <i />
            <span />
          </div>
          <div>
            <strong>{cluster.labels.join(" + ")}</strong>
            <span>{cluster.shared_window_count} shared {pluralize("window", cluster.shared_window_count)}</span>
            <span>{formatTime(cluster.latest_seen_at)}</span>
          </div>
        </article>
      ))}
    </section>
  );
}

function SelectedEntityIntelligence({
  selected,
  sightings,
  clusters
}: {
  selected: PresenceSummaryItem;
  sightings: PresenceSighting[];
  clusters: PresenceCoPresenceCluster[];
}) {
  const visuals = buildSelectedPresenceVisuals(selected, sightings, clusters);
  return (
    <section className="presence-entity-visuals" aria-label="Selected entity intelligence visuals">
      <div className="presence-entity-takeaway">
        <span>Operator takeaway</span>
        <strong>{visuals.takeaway}</strong>
      </div>
      <div className="presence-visual-grid">
        <HourPattern visuals={visuals} />
        <WeekHeatStrip visuals={visuals} />
        <RssiTrend visuals={visuals} />
        <CoPresenceMiniGraph visuals={visuals} />
        <SourceConfidenceRings visuals={visuals} />
      </div>
    </section>
  );
}

function HourPattern({ visuals }: { visuals: SelectedPresenceVisuals }) {
  return (
    <div className="presence-chart-card" aria-label="24 hour presence pattern" title="Shows which hours this identity is usually seen. Taller bars mean more sightings during that hour.">
      <span>24h pattern</span>
      <strong>Peak {visuals.peakHourLabel}</strong>
      <div className="presence-hour-bars">
        {visuals.hourly.map((hour) => (
          <i
            key={hour.hour}
            style={{ "--presence-intensity": `${hour.intensity}%` } as CSSProperties}
            title={`${hour.hour}:00 · ${hour.count} ${pluralize("sighting", hour.count)}`}
            className={hour.count > 0 ? "is-active" : ""}
          />
        ))}
      </div>
    </div>
  );
}

function WeekHeatStrip({ visuals }: { visuals: SelectedPresenceVisuals }) {
  return (
    <div className="presence-chart-card" aria-label="7 day presence heat strip" title="Shows weekday and hour rhythm for this identity. Brighter cells mean repeated sightings in that time slot.">
      <span>7 day rhythm</span>
      <strong>{visuals.weekdayHeat.filter((cell) => cell.count > 0).length} active cells</strong>
      <div className="presence-week-heat">
        {visuals.weekdayHeat.map((cell) => (
          <i
            key={`${cell.weekday}:${cell.hour}`}
            style={{ "--presence-intensity": `${cell.intensity}%` } as CSSProperties}
            title={`${weekdayLabel(cell.weekday)} ${cell.hour}:00 · ${cell.count} ${pluralize("sighting", cell.count)}`}
            className={cell.count > 0 ? "is-active" : ""}
          />
        ))}
      </div>
    </div>
  );
}

function RssiTrend({ visuals }: { visuals: SelectedPresenceVisuals }) {
  const points = visuals.rssiTrend.length > 0 ? visuals.rssiTrend : [{ id: "empty", x: 0, y: 100, rssi: null, timestamp: null, strength: 0, sensor_id: null }];
  const path = points.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <div className="presence-chart-card is-wide is-rssi-trend" aria-label="RSSI proximity trend chart" title="RSSI estimates proximity. A less negative dBm is stronger and usually closer; higher points mean stronger signal.">
      <span>RSSI proximity</span>
      <strong>{points[points.length - 1]?.rssi == null ? "No RSSI" : `${points[points.length - 1].rssi} dBm latest`}</strong>
      <svg viewBox="0 0 100 100" role="img" aria-label="RSSI trend line">
        <polyline points={path} />
        {points.map((point) => (
          <circle key={point.id} cx={point.x} cy={point.y} r="4">
            <title>{`${formatTime(point.timestamp)} ${formatSignal(point.rssi)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function CoPresenceMiniGraph({ visuals }: { visuals: SelectedPresenceVisuals }) {
  return (
    <div className="presence-chart-card" aria-label="Co-presence mini graph" title="Shows identities seen in the same time window as this one. Strong repeated co-presence can indicate devices that move together.">
      <span>Co-presence</span>
      <strong>{visuals.topCompanion ? `With ${visuals.topCompanion}` : "Learning companions"}</strong>
      <div className="presence-mini-graph">
        {visuals.coPresenceEdges.slice(0, 3).map((edge, index) => (
          <i key={`${edge.target}:${index}`} style={{ "--edge-weight": `${Math.min(100, 22 + edge.weight * 8)}%`, "--edge-y": `${28 + index * 24}%` } as CSSProperties} />
        ))}
        {visuals.coPresenceNodes.slice(0, 4).map((node, index) => (
          <b key={node.id} className={node.selected ? "is-selected" : ""} style={{ "--node-x": `${node.selected ? 18 : 72}%`, "--node-y": `${28 + index * 20}%` } as CSSProperties}>
            {node.label.slice(0, 2).toUpperCase()}
          </b>
        ))}
      </div>
    </div>
  );
}

function SourceConfidenceRings({ visuals }: { visuals: SelectedPresenceVisuals }) {
  return (
    <div className="presence-chart-card" aria-label="Source confidence rings" title="Shows how much collector/source evidence supports this identity. Larger percentages mean more sightings came from that source.">
      <span>Source confidence</span>
      <strong>{visuals.sourceRings.length} {pluralize("source", visuals.sourceRings.length)}</strong>
      <div className="presence-source-rings">
        {visuals.sourceRings.slice(0, 3).map((ring) => (
          <div key={ring.source}>
            <i style={{ "--ring-percent": `${ring.percent}%` } as CSSProperties} />
            <span>{ring.source}</span>
            <strong>{ring.percent}%</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function PresencePill({ value }: { value: string }) {
  return <span className={`presence-pill is-${value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>{value}</span>;
}

function PresenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="presence-fact">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SignalMeter({ rssi }: { rssi: number | null }) {
  if (rssi === null) {
    return null;
  }
  return (
    <span
      className="presence-signal-meter"
      style={{ "--signal": `${signalPercent(rssi)}%` } as CSSProperties}
      aria-label="Presence signal strength"
    />
  );
}

function PresenceTimeline({ sightings }: { sightings: PresenceSighting[] }) {
  const points = sightings.slice(0, 24).reverse();
  return (
    <div className="presence-visual-timeline" aria-label="Presence sighting timeline">
      {points.length === 0 ? <span className="is-empty" /> : null}
      {points.map((sighting) => (
        <span
          key={sighting.id}
          style={{ "--signal": `${signalPercent(sighting.rssi)}%` } as CSSProperties}
          title={`${formatTime(sighting.timestamp)} ${formatSignal(sighting.rssi)}`}
        />
      ))}
    </div>
  );
}

function PresenceReplayStrip({ frames }: { frames: PresenceReplayFrame[] }) {
  if (frames.length === 0) {
    return null;
  }
  return (
    <div className="presence-replay-strip" aria-label="Entity replay theater">
      <div>
        <span>Replay theater</span>
        <strong>{frames.length} {pluralize("frame", frames.length)}</strong>
      </div>
      <div className="presence-replay-frames">
        {frames.slice(-12).map((frame) => (
          <span key={`${frame.frame}:${frame.timestamp}`} style={{ "--signal": `${signalPercent(frame.rssi)}%` } as CSSProperties} title={`${formatTime(frame.timestamp)} ${formatSignal(frame.rssi)}`} />
        ))}
      </div>
    </div>
  );
}

function PresencePlaybookStrip({ playbooks, onRun }: { playbooks: PresencePlaybook[]; onRun: (playbook: PresencePlaybook) => void }) {
  if (playbooks.length === 0) {
    return null;
  }
  return (
    <section className="presence-playbook-strip" aria-label="Operator playbooks">
      <div>
        <span>Playbooks</span>
        <strong>{playbooks.length} hooks</strong>
      </div>
      <div>
        {playbooks.slice(0, 4).map((playbook) => (
          <button key={playbook.id} className={`is-${playbook.severity}`} title={playbook.description} onClick={() => onRun(playbook)}>
            {playbook.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function CaseNotebook({
  notes,
  draft,
  onDraftChange,
  onAddNote
}: {
  notes: InvestigationNote[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAddNote: () => void;
}) {
  return (
    <section className="presence-case-notebook" aria-label="Case notebook">
      <div>
        <span>Case notebook</span>
        <strong>{notes.length} {pluralize("note", notes.length)}</strong>
      </div>
      <div className="presence-note-form">
        <input aria-label="Add investigation note" value={draft} onChange={(event) => onDraftChange(event.target.value)} placeholder="Add operator note" />
        <button onClick={onAddNote} disabled={!draft.trim()}>Add</button>
      </div>
      {notes.slice(0, 3).map((note) => (
        <article key={note.id}>
          <strong>{note.disposition}</strong>
          <span>{note.note}</span>
        </article>
      ))}
    </section>
  );
}

function signalPercent(rssi: number | null): number {
  if (rssi === null) {
    return 18;
  }
  return Math.max(8, Math.min(100, Math.round(((rssi + 100) / 65) * 100)));
}

function formatSignal(value: number | null): string {
  return value === null ? "no RSSI" : `${value} dBm`;
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function categoryCountsFromCandidates(candidates: PresenceCandidate[]): Record<string, number> {
  return candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.category] = (counts[candidate.category] ?? 0) + 1;
    return counts;
  }, {});
}

function orderedCategories(counts: Record<string, number>): string[] {
  const priority = ["client", "wifi", "ble", "aircraft", "rail", "iot", "utility", "unknown_rf", "infrastructure", "unknown"];
  return Object.keys(counts).sort((a, b) => {
    const left = priority.indexOf(a);
    const right = priority.indexOf(b);
    return (left === -1 ? priority.length : left) - (right === -1 ? priority.length : right) || a.localeCompare(b);
  });
}

function categoryLabel(category: string, plural = false): string {
  const labels: Record<string, [string, string]> = {
    aircraft: ["Aircraft", "aircraft"],
    ble: ["BLE", "BLE"],
    client: ["Clients", "clients"],
    infrastructure: ["Infra", "infrastructure"],
    iot: ["Zigbee/Thread", "Zigbee/Thread"],
    rail: ["Rail RF", "rail RF"],
    unknown: ["Unknown", "unknown"],
    unknown_rf: ["Unknown RF", "unknown RF"],
    utility: ["Utility", "utility"],
    wifi: ["Wi-Fi", "Wi-Fi"]
  };
  const label = labels[category];
  return label ? label[plural ? 1 : 0] : category;
}

function weekdayLabel(weekday: number): string {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? "Day";
}

function formatTime(value: string | null): string {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}
