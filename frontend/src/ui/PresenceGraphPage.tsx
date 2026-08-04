import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  fetchChangeBriefing,
  createPresenceIdentityDecision,
  fetchPresenceAlertCausalGraph,
  fetchPresenceChangeFeed,
  fetchPresenceCoPresence,
  fetchPresenceGraphTimeline,
  fetchPresenceHistoryAudit,
  fetchPresencePatternAnalytics,
  fetchPresenceLinkGraph,
  fetchPresencePlaybooks,
  fetchPresenceSummary,
  fetchPresenceWatchModes,
  fetchSensorTrust,
  fetchRfBurstSwarms,
  fetchSensorCoverage,
  fetchSpectrumOccupancy,
  searchInvestigation
} from "../data/api";
import type {
  AircraftDetails,
  ChangeBriefing,
  InvestigationSearchResult,
  PresenceAlertCausalItem,
  PresenceChangeFeed,
  PresenceCoPresenceCluster,
  PresenceGraphEdge,
  PresenceGraphMode,
  PresenceGraphNode,
  PresenceGraphTimelineItem,
  PresenceHistoryAudit,
  PresenceLinkGraph,
  PresencePatternAnalytics,
  PresencePlaybook,
  PresenceSummaryItem,
  PresenceWatchMode,
  RfBurstSwarm,
  SensorCoverageResponse,
  SensorTrustResponse,
  SpectrumOccupancyBucket
} from "../domain/types";
import { AppNavigation } from "./AppNavigation";
import {
  edgeVisualRole,
  graphClusterSummaries,
  graphModeFromSearch,
  nodeVisualRole,
  rankedGraphConnections,
  resolveSearchResultNode,
  selectedGraphFocus,
  visibleGraphForMode,
  type GraphClusterSummary,
  type GraphConnectionLead
} from "./presenceGraphModel";
import { graphWatchModeForMode } from "./presenceVisualModel";

const AIRCRAFT_PHOTO_LIBRARY: Record<string, { label: string; url: string; attribution: string }> = {
  "airbus-a320": {
    label: "Airbus A320 family",
    url: "/static/aircraft/photos/airbus-a320.jpg",
    attribution: "Julian Herzog, CC BY 4.0"
  },
  "airbus-h145": {
    label: "Airbus H145 / EC145 helicopter",
    url: "/static/aircraft/photos/airbus-h145.jpg",
    attribution: "Acabashi, CC BY-SA 4.0"
  },
  "boeing-737": {
    label: "Boeing 737 family",
    url: "/static/aircraft/photos/boeing-737.jpg",
    attribution: "ZLEA, CC BY-SA 4.0"
  },
  "boeing-767": {
    label: "Boeing 767 family",
    url: "/static/aircraft/photos/boeing-767.jpg",
    attribution: "Aeroprints.com, CC BY-SA 3.0"
  },
  "boeing-777": {
    label: "Boeing 777 family",
    url: "/static/aircraft/photos/boeing-777.jpg",
    attribution: "Aero Icarus, CC BY-SA 2.0"
  },
  "boeing-787": {
    label: "Boeing 787 Dreamliner",
    url: "/static/aircraft/photos/boeing-787.jpg",
    attribution: "Julian Herzog, CC BY 4.0"
  },
  "embraer-ejet": {
    label: "Embraer regional jet family",
    url: "/static/aircraft/photos/embraer-ejet.jpg",
    attribution: "Richard Silagi, CC BY-SA 4.0"
  },
  "king-air": {
    label: "Beechcraft King Air family",
    url: "/static/aircraft/photos/king-air.jpg",
    attribution: "David Aughinbaugh II, CC BY-SA 4.0"
  },
  "small-ga": {
    label: "Small general aviation aircraft",
    url: "/static/aircraft/photos/small-ga.jpg",
    attribution: "ZLEA, CC BY-SA 4.0"
  }
};

interface IntelligenceState {
  summary: PresenceSummaryItem[];
  clusters: PresenceCoPresenceCluster[];
  briefing: ChangeBriefing | null;
  bursts: RfBurstSwarm[];
  coverage: SensorCoverageResponse | null;
  sensorTrust: SensorTrustResponse | null;
  playbooks: PresencePlaybook[];
  watchModes: PresenceWatchMode[];
  causalAlerts: PresenceAlertCausalItem[];
  spectrum: SpectrumOccupancyBucket[];
  patterns: PresencePatternAnalytics | null;
}

const GRAPH_MODES: Array<{ id: PresenceGraphMode; label: string }> = [
  { id: "all", label: "All" },
  { id: "presence", label: "Presence" },
  { id: "rf", label: "RF" },
  { id: "airspace", label: "Airspace" },
  { id: "rail", label: "Rail" },
  { id: "cellular", label: "LTE" },
  { id: "iot", label: "IoT" },
  { id: "alerts", label: "Alerts" }
];

export function PresenceGraphPage() {
  const [graph, setGraph] = useState<PresenceLinkGraph>({ nodes: [], edges: [] });
  const [changeFeed, setChangeFeed] = useState<PresenceChangeFeed>({ items: [], count: 0, window_seconds: 300, poll_after_seconds: 3 });
  const [historyAudit, setHistoryAudit] = useState<PresenceHistoryAudit | null>(null);
  const [intelligence, setIntelligence] = useState<IntelligenceState>({
    summary: [],
    clusters: [],
    briefing: null,
    bursts: [],
    coverage: null,
    sensorTrust: null,
    playbooks: [],
    watchModes: [],
    causalAlerts: [],
    spectrum: [],
    patterns: null
  });
  const [activeMode, setActiveMode] = useState<PresenceGraphMode>(() => graphModeFromSearch(window.location.search));
  const [activeWatchMode, setActiveWatchMode] = useState(() => graphWatchModeForMode(graphModeFromSearch(window.location.search), "home_presence"));
  const [loadedGraphMode, setLoadedGraphMode] = useState<PresenceGraphMode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [timelineItems, setTimelineItems] = useState<PresenceGraphTimelineItem[]>([]);
  const [timelineStatus, setTimelineStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<InvestigationSearchResult[]>([]);
  const [pendingSearchResult, setPendingSearchResult] = useState<InvestigationSearchResult | null>(null);
  const [externalResult, setExternalResult] = useState<InvestigationSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAircraftNodes, setLastAircraftNodes] = useState<PresenceGraphNode[]>([]);
  const [lastRailNodes, setLastRailNodes] = useState<PresenceGraphNode[]>([]);
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const requestedMode = activeMode;
    setLoadedGraphMode(null);
    Promise.all([
      fetchPresenceLinkGraph(activeMode, activeWatchMode),
      fetchPresenceSummary(),
      fetchPresenceCoPresence(),
      fetchChangeBriefing(),
      fetchRfBurstSwarms(),
      fetchSensorCoverage(),
      fetchSensorTrust(),
      fetchPresencePlaybooks(),
      fetchPresenceWatchModes(),
      fetchPresenceAlertCausalGraph(),
      fetchSpectrumOccupancy(),
      fetchPresenceChangeFeed(),
      fetchPresenceHistoryAudit(),
      fetchPresencePatternAnalytics()
    ])
      .then(([graphResponse, summaryResponse, clustersResponse, briefingResponse, burstsResponse, coverageResponse, sensorTrustResponse, playbooksResponse, watchModesResponse, causalResponse, spectrumResponse, changeFeedResponse, historyAuditResponse, patternsResponse]) => {
        if (!cancelled) {
          setGraph(graphResponse);
          setLoadedGraphMode(requestedMode);
          const aircraftNodes = graphResponse.nodes.filter((node) => node.type === "aircraft");
          if (aircraftNodes.length > 0) {
            setLastAircraftNodes(aircraftNodes.slice(0, 8));
          }
          const railNodes = graphResponse.nodes.filter((node) => node.type === "rail");
          if (railNodes.length > 0) {
            setLastRailNodes(railNodes.slice(0, 8));
          }
          setChangeFeed(changeFeedResponse);
          setHistoryAudit(historyAuditResponse);
          setIntelligence({
            summary: summaryResponse.items,
            clusters: clustersResponse.items,
            briefing: briefingResponse,
            bursts: burstsResponse.items,
            coverage: coverageResponse,
            sensorTrust: sensorTrustResponse,
            playbooks: playbooksResponse.items,
            watchModes: watchModesResponse.items,
            causalAlerts: causalResponse.items,
            spectrum: spectrumResponse.items,
            patterns: safePatternAnalytics(patternsResponse)
          });
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load graph");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeMode, activeWatchMode]);

  useEffect(() => {
    let cancelled = false;
    const intervalMs = Math.max(3, changeFeed.poll_after_seconds || 3) * 1000;
    const timer = window.setInterval(() => {
      fetchPresenceChangeFeed()
        .then((payload) => {
          if (!cancelled) {
            setChangeFeed(payload);
          }
        })
        .catch(() => {
          // Keep the last good feed visible during transient polling failures.
        });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [changeFeed.poll_after_seconds]);

  const runSearch = async () => {
    if (!query.trim()) {
      setResults([]);
      setPendingSearchResult(null);
      setExternalResult(null);
      return;
    }
    const response = await searchInvestigation(query.trim());
    setResults(response.items);
    setExternalResult(null);
  };

  const openSearchResult = (result: InvestigationSearchResult) => {
    const node = resolveSearchResultNode(graph, result);
    if (node && visibleGraph.nodes.some((visibleNode) => visibleNode.id === node.id)) {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setPendingSearchResult(null);
      setExternalResult(null);
      return;
    }
    if (activeMode !== "all") {
      setPendingSearchResult(result);
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setExternalResult(null);
      setActiveMode("all");
      return;
    }
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingSearchResult(null);
    setExternalResult(result);
  };

  const visibleGraph = useMemo(() => visibleGraphForMode(graph, activeMode), [activeMode, graph]);
  const focus = useMemo(() => selectedGraphFocus(visibleGraph, selectedNodeId), [selectedNodeId, visibleGraph]);
  const selectedNode = visibleGraph.nodes.find((node) => node.id === focus.selectedNodeId) ?? null;
  const selectedEdge = visibleGraph.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  const recordIdentityDecision = async (node: PresenceGraphNode, action: "confirm" | "reject" | "split") => {
    if (!node.entity_key) {
      return;
    }
    const target = node.resolved_identity?.entity_keys?.find((key) => key !== node.entity_key) ?? null;
    await createPresenceIdentityDecision({
      entity_key: node.entity_key,
      target_entity_key: target,
      action,
      canonical_key: node.resolved_identity?.canonical_key ?? null,
      label: node.label,
      reason: `operator ${action} from graph dossier`
    });
    setDecisionStatus(`Decision saved: ${action}`);
  };
  const connectionLeads = useMemo(() => rankedGraphConnections(visibleGraph, 6), [visibleGraph]);
  const clusterSummaries = useMemo(() => graphClusterSummaries(visibleGraph), [visibleGraph]);
  const visibleAircraftNodes = useMemo(() => visibleGraph.nodes.filter((node) => node.type === "aircraft"), [visibleGraph.nodes]);
  const visibleRailNodes = useMemo(() => visibleGraph.nodes.filter((node) => node.type === "rail"), [visibleGraph.nodes]);

  useEffect(() => {
    if (!pendingSearchResult || activeMode !== "all" || loadedGraphMode !== "all") {
      return;
    }
    const node = resolveSearchResultNode(graph, pendingSearchResult);
    if (node) {
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
      setExternalResult(null);
    } else {
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setExternalResult(pendingSearchResult);
    }
    setPendingSearchResult(null);
  }, [activeMode, graph, loadedGraphMode, pendingSearchResult]);

  useEffect(() => {
    const entityKey = selectedNode?.entity_key;
    if (!entityKey) {
      setTimelineItems([]);
      setTimelineStatus("idle");
      return;
    }
    let cancelled = false;
    setTimelineStatus("loading");
    fetchPresenceGraphTimeline(entityKey)
      .then((response) => {
        if (!cancelled) {
          setTimelineItems(response.items);
          setTimelineStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTimelineItems([]);
          setTimelineStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedNode?.entity_key]);

  function changeGraphMode(mode: PresenceGraphMode) {
    setActiveMode(mode);
    setActiveWatchMode((current) => graphWatchModeForMode(mode, current));
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingSearchResult(null);
    setExternalResult(null);
  }

  function changeWatchMode(watchMode: string) {
    setActiveWatchMode(watchMode);
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setPendingSearchResult(null);
    setExternalResult(null);
  }

  return (
    <main className="presence-page presence-graph-page">
      <header className="presence-header">
        <div>
          <p className="presence-eyebrow">TDS relationship workspace</p>
          <h1>Link Analysis</h1>
        </div>
        <AppNavigation />
      </header>
      {error ? <div className="presence-alert">{error}</div> : null}
      {decisionStatus ? <div className="presence-alert presence-decision-toast">{decisionStatus}</div> : null}
      <OperatorIntelligencePanel graph={graph} intelligence={intelligence} />
      <section className="presence-live-status-row">
        <RealtimeChangeFeed feed={changeFeed} />
        <HistoryAuditCard audit={historyAudit} />
      </section>
      <PatternAnalyticsCard analytics={intelligence.patterns} />
      <section className="presence-graph-search" aria-label="Investigation search">
        <input aria-label="Search investigation graph" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search entities, alerts, notes" />
        <button onClick={() => void runSearch()}>Search</button>
        {results.map((result) => (
          <button
            key={`${result.type}:${result.label}`}
            type="button"
            className="presence-graph-search-result"
            aria-label={`Open graph search result ${result.label}`}
            onClick={() => openSearchResult(result)}
          >
            <span>{result.type}</span>
            <strong>{result.label}</strong>
            {result.subtitle ? <small>{result.subtitle}</small> : null}
            {result.matches?.length ? <em>{result.matches.slice(0, 2).map((match) => `${match.field}: ${match.value}`).join(" · ")}</em> : null}
          </button>
        ))}
        {externalResult ? <ExternalSearchEvidence result={externalResult} /> : null}
      </section>
      <section className="presence-graph-panel" aria-label="Presence link graph">
        <div className="presence-graph-header">
          <div>
            <span>Relationship map</span>
            <strong>{visibleGraph.nodes.length} nodes · {visibleGraph.edges.length} links</strong>
          </div>
          <div className="presence-graph-legend" aria-label="Relationship legend">
            <span>observed_by means a tracked entity was seen by a sensor</span>
            <span>feeds_source means that sensor is fed by a collector/source</span>
            <span>mentions_entity means an alert or note references the identity</span>
          </div>
          <GraphNodeLegend />
        </div>
        <RelationshipLedger edges={visibleGraph.edges} selectedEdgeId={selectedEdge?.id ?? null} onSelectEdge={setSelectedEdgeId} />
        <div className="presence-graph-mobile-controls" aria-label="Compact graph controls">
          <label>
            <span>View</span>
            <select aria-label="Mobile graph mode" value={activeMode} onChange={(event) => changeGraphMode(event.target.value as PresenceGraphMode)}>
              {GRAPH_MODES.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Watch</span>
            <select aria-label="Mobile graph watch mode" value={activeWatchMode} onChange={(event) => changeWatchMode(event.target.value)}>
              {intelligence.watchModes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="presence-graph-mode-strip" aria-label="Graph mode">
          {GRAPH_MODES.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-label={`Graph mode ${mode.label}`}
              aria-pressed={activeMode === mode.id}
              className={activeMode === mode.id ? "is-active" : ""}
              onClick={() => changeGraphMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <div className="presence-graph-mode-strip is-watch-mode" aria-label="Graph watch mode">
          {intelligence.watchModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              aria-label={`Graph watch mode ${mode.label}`}
              aria-pressed={activeWatchMode === mode.id}
              className={activeWatchMode === mode.id ? "is-active" : ""}
              title={mode.description}
              onClick={() => changeWatchMode(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>
        <GraphModeBrief mode={activeMode} nodeCount={visibleGraph.nodes.length} edgeCount={visibleGraph.edges.length} />
        <BackendGraphInsights insights={graph.insights} selectedEdgeId={selectedEdge?.id ?? null} onSelectEdge={setSelectedEdgeId} />
        <AirspaceActivityStrip mode={activeMode} currentAircraft={visibleAircraftNodes} lastAircraft={lastAircraftNodes} />
        <RailActivityStrip mode={activeMode} currentRail={visibleRailNodes} lastRail={lastRailNodes} />
        <GraphUsefulnessPanel
          leads={connectionLeads}
          clusters={clusterSummaries}
          selectedEdgeId={selectedEdge?.id ?? null}
          onSelectLead={(edgeId) => {
            setSelectedEdgeId(edgeId);
            setSelectedNodeId(null);
          }}
        />
        <RelationshipCanvas
          graph={visibleGraph}
          mode={activeMode}
          focus={focus}
          onSelectNode={(nodeId) => {
            setSelectedNodeId(nodeId);
            setSelectedEdgeId(null);
          }}
          onSelectEdge={setSelectedEdgeId}
          selectedEdge={selectedEdge}
          selectedNode={selectedNode}
          onIdentityDecision={recordIdentityDecision}
        />
        <CausalAlertRail items={intelligence.causalAlerts} onOpenEntity={(item) => openSearchResult({ type: "entity", label: item.entity.label, entity_key: item.entity.entity_key })} />
        <GraphTimelineRail items={timelineItems} selectedNode={selectedNode} status={timelineStatus} />
      </section>
    </main>
  );
}

function GraphUsefulnessPanel({
  leads,
  clusters,
  selectedEdgeId,
  onSelectLead
}: {
  leads: GraphConnectionLead[];
  clusters: GraphClusterSummary[];
  selectedEdgeId: string | null;
  onSelectLead: (edgeId: string) => void;
}) {
  return (
    <aside className="presence-graph-usefulness" aria-label="Graph operator leads">
      <section className="presence-graph-leads">
        <div>
          <span>Most Interesting Links</span>
          <strong>{leads.length ? "Ranked by evidence, confidence, and operator relevance" : "No ranked links yet"}</strong>
        </div>
        <div>
          {leads.map((lead) => (
            <button
              key={lead.id}
              type="button"
              className={`is-${normalizedClassToken(lead.tone)} ${selectedEdgeId === lead.id ? "is-selected" : ""}`}
              aria-label={`Inspect interesting link ${lead.label}`}
              aria-pressed={selectedEdgeId === lead.id}
              title={lead.summary}
              onClick={() => onSelectLead(lead.id)}
            >
              <strong>{lead.label}</strong>
              <span>{lead.summary}</span>
            </button>
          ))}
          {leads.length === 0 ? <p>Evidence links will appear here once the graph has relationships to score.</p> : null}
        </div>
      </section>
      <section className="presence-graph-clusters">
        <div>
          <span>Graph Clusters</span>
          <strong>{clusters.length ? "What roles are currently visible" : "No clusters visible"}</strong>
        </div>
        <div>
          {clusters.map((cluster) => (
            <article key={cluster.id}>
              <span>{cluster.count} {clusterCountLabel(cluster)}</span>
              <strong>{cluster.summary}</strong>
            </article>
          ))}
        </div>
      </section>
    </aside>
  );
}

function BackendGraphInsights({
  insights,
  selectedEdgeId,
  onSelectEdge
}: {
  insights: PresenceLinkGraph["insights"];
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
}) {
  if (!insights) {
    return null;
  }
  return (
    <aside className="presence-backend-graph-insights" aria-label="Backend relationship insight">
      <section>
        <span>Operator Map Read</span>
        <strong>{insights.map_read}</strong>
      </section>
      <section>
        <span>Backend-ranked relationships</span>
        <div>
          {insights.top_relationships.slice(0, 4).map((lead) => (
            <button
              key={lead.edge_id}
              type="button"
              className={`is-${normalizedClassToken(lead.tone)} ${selectedEdgeId === lead.edge_id ? "is-selected" : ""}`}
              aria-label={`Inspect backend-ranked relationship ${lead.label}`}
              aria-pressed={selectedEdgeId === lead.edge_id}
              onClick={() => onSelectEdge(lead.edge_id)}
            >
              <strong>{lead.label}</strong>
              <span>{lead.summary}</span>
            </button>
          ))}
        </div>
      </section>
      <section>
        <span>Role mix</span>
        <div className="presence-backend-cluster-pills">
          {insights.clusters.slice(0, 5).map((cluster) => (
            <i key={cluster.id} title={cluster.summary}>
              {cluster.count} {cluster.label}
            </i>
          ))}
        </div>
      </section>
    </aside>
  );
}

function AirspaceActivityStrip({
  mode,
  currentAircraft,
  lastAircraft
}: {
  mode: PresenceGraphMode;
  currentAircraft: PresenceGraphNode[];
  lastAircraft: PresenceGraphNode[];
}) {
  if (mode !== "airspace" && mode !== "all") {
    return null;
  }
  const aircraft = currentAircraft.length > 0 ? currentAircraft : lastAircraft;
  const label = currentAircraft.length > 0
    ? "Current ADS-B aircraft"
    : lastAircraft.length > 0
      ? "Last aircraft seen this session"
      : "No recent aircraft this session";
  const summary = currentAircraft.length > 0
    ? "Live current-state feed"
    : lastAircraft.length > 0
      ? "ADS-B currently quiet"
      : "Aircraft will appear here when ADS-B reports current state";

  return (
    <aside className="presence-airspace-strip" aria-label="Airspace activity strip">
      <div>
        <span>Airspace activity</span>
        <strong>{label}</strong>
        <small>{summary}</small>
      </div>
      <div>
        {aircraft.slice(0, 6).map((node) => (
          <article key={node.id}>
            <strong>{node.label}</strong>
            <span>{node.last_seen_at ? formatGraphTime(node.last_seen_at) : "time unknown"}</span>
          </article>
        ))}
        {aircraft.length === 0 ? <p>No aircraft held in this page session.</p> : null}
      </div>
    </aside>
  );
}

function RailActivityStrip({
  mode,
  currentRail,
  lastRail
}: {
  mode: PresenceGraphMode;
  currentRail: PresenceGraphNode[];
  lastRail: PresenceGraphNode[];
}) {
  if (mode !== "rail" && mode !== "all") {
    return null;
  }
  const rail = currentRail.length > 0 ? currentRail : lastRail;
  const label = currentRail.length > 0
    ? "Current rail RF activity"
    : lastRail.length > 0
      ? "Last rail activity this session"
      : "No recent rail activity this session";
  const summary = currentRail.length > 0
    ? "Live passive AAR/channel feed"
    : lastRail.length > 0
      ? "Rail collector currently quiet"
      : "Rail activity will appear when the rail SDR collector reports current state";

  return (
    <aside className="presence-airspace-strip presence-rail-strip" aria-label="Rail activity strip">
      <div>
        <span>Rail activity</span>
        <strong>{label}</strong>
        <small>{summary}</small>
      </div>
      <div>
        {rail.slice(0, 6).map((node) => (
          <article key={node.id}>
            <strong>{node.rail_context?.channel_label ?? node.label}</strong>
            <span>{[node.rail_context?.operator_hint, node.rail_context?.route_hint].filter(Boolean).join(" / ") || "operator unknown"}</span>
            <small>{node.last_seen_at ? formatGraphTime(node.last_seen_at) : "time unknown"}</small>
          </article>
        ))}
        {rail.length === 0 ? <p>No rail RF held in this page session.</p> : null}
      </div>
    </aside>
  );
}

function clusterCountLabel(cluster: GraphClusterSummary): string {
  if (cluster.count === 1) {
    return cluster.label.toLowerCase();
  }
  if (cluster.label === "Tracked entity") {
    return "tracked entities";
  }
  if (cluster.label === "RF entity") {
    return "RF entities";
  }
  if (cluster.label === "Aircraft") {
    return "aircraft";
  }
  if (cluster.label === "Rail activity") {
    return "rail activity";
  }
  return `${cluster.label.toLowerCase()}s`;
}

function GraphModeBrief({ mode, nodeCount, edgeCount }: { mode: PresenceGraphMode; nodeCount: number; edgeCount: number }) {
  return (
    <aside className={`presence-graph-mode-brief presence-graph-mobile-brief is-${mode}`} aria-label="Graph mode explanation">
      <span>{modeLabel(mode)} mode</span>
      <strong>{modeGuidance(mode)}</strong>
      <small>{nodeCount} visible {pluralize("node", nodeCount)} / {edgeCount} evidence {pluralize("link", edgeCount)}</small>
    </aside>
  );
}

function ExternalSearchEvidence({ result }: { result: InvestigationSearchResult }) {
  return (
    <aside className="presence-external-evidence" aria-label="External search evidence">
      <span>External Evidence</span>
      <strong>{result.label}</strong>
      <p>
        {result.type}
        {result.event_id ? ` / ${result.event_id}` : ""}
        {result.entity_key ? ` / ${result.entity_key}` : ""}
      </p>
    </aside>
  );
}


function PatternAnalyticsCard({ analytics }: { analytics: PresencePatternAnalytics | null }) {
  if (!analytics) {
    return null;
  }
  const maxCount = Math.max(1, ...analytics.rhythm.hour_bins.map((bin) => bin.count));
  const primaryEntity = analytics.entities[0] ?? null;
  const primaryHour = analytics.rhythm.peak_hours[0] ?? null;
  return (
    <aside className="presence-pattern-analytics" aria-label="Pattern analytics">
      <div className="presence-pattern-header">
        <div>
          <span>Pattern Analytics</span>
          <strong>{analytics.summary.tracked_entities} tracked / {analytics.summary.learned_entities} learned / {analytics.summary.alert_rules} rule {pluralize("alert", analytics.summary.alert_rules)}</strong>
        </div>
        <small>{primaryHour ? `Peak activity around ${hourLabel(primaryHour.hour)} (${primaryHour.count})` : "Learning normal rhythm"}</small>
      </div>
      <div className="presence-pattern-bars" aria-label="Pattern rhythm hour bars">
        {analytics.rhythm.hour_bins.map((bin) => (
          <span
            key={bin.hour}
            title={`${hourLabel(bin.hour)}: ${bin.count} ${pluralize("sighting", bin.count)}`}
            style={{ "--bar-height": `${Math.max(8, Math.round((bin.count / maxCount) * 100))}%` } as CSSProperties}
            className={bin.count > 0 ? "has-signal" : ""}
          />
        ))}
      </div>
      <div className="presence-pattern-body">
        {primaryEntity ? (
          <article>
            <span>{primaryEntity.pattern_status}</span>
            <strong>{primaryEntity.label}</strong>
            <small>{primaryEntity.operator_read}</small>
          </article>
        ) : <p>No tracked rhythm data yet.</p>}
        <div>
          {analytics.alert_rules.slice(0, 3).map((rule) => (
            <a key={rule.id} href={`/presence/investigate/${encodeURIComponent(rule.entity_key)}`} className={`is-${normalizedClassToken(rule.severity)}`}>
              <span>{ruleTypeLabel(rule.type)}</span>
              <strong>{rule.label}</strong>
              <small>{rule.operator_action}</small>
            </a>
          ))}
        </div>
      </div>
    </aside>
  );
}

function safePatternAnalytics(value: unknown): PresencePatternAnalytics | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<PresencePatternAnalytics>;
  if (!candidate.summary || !candidate.rhythm || !Array.isArray(candidate.rhythm.hour_bins) || !Array.isArray(candidate.entities) || !Array.isArray(candidate.alert_rules)) {
    return null;
  }
  return candidate as PresencePatternAnalytics;
}

function ruleTypeLabel(type: string): string {
  return type.replace(/^left_behind/, "left-behind").replace(/_/g, " ");
}

function hourLabel(hour: number): string {
  const normalized = ((hour % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const display = normalized % 12 || 12;
  return `${display} ${suffix}`;
}

function HistoryAuditCard({ audit }: { audit: PresenceHistoryAudit | null }) {
  const sampleCoverage = audit?.sample_coverage?.coverage_percent ?? 0;
  const sampleCount = audit?.stores?.current_state_samples?.count ?? 0;
  const eventCount = audit?.stores?.events?.count ?? 0;
  const decisionCount = audit?.stores?.identity_decisions?.count ?? 0;
  return (
    <aside className={`presence-history-audit ${audit?.status === "healthy" ? "is-healthy" : "is-attention"}`} aria-label="Presence history audit">
      <span>History Audit</span>
      <strong>{audit ? `${audit.status} / ${sampleCoverage}% sampled` : "loading history audit"}</strong>
      <div>
        <small>{sampleCount} compact {pluralize("sample", sampleCount)}</small>
        <small>{eventCount} persisted {pluralize("event", eventCount)}</small>
        <small>{decisionCount} identity {pluralize("decision", decisionCount)}</small>
      </div>
      {audit?.gaps?.length ? <p>{audit.gaps[0]}</p> : <p>Append-only evidence stores are reporting normally.</p>}
    </aside>
  );
}

function RealtimeChangeFeed({ feed }: { feed: PresenceChangeFeed }) {
  const items = Array.isArray(feed.items) ? feed.items : [];
  const count = typeof feed.count === "number" ? feed.count : items.length;
  const pollAfterSeconds = typeof feed.poll_after_seconds === "number" ? feed.poll_after_seconds : 3;
  return (
    <aside className="presence-change-feed" aria-label="Live presence change feed">
      <div>
        <span>Live Change Feed</span>
        <strong>{count} {pluralize("change", count)} / polling every {pollAfterSeconds}s</strong>
      </div>
      <div>
        {items.slice(0, 5).map((item) => (
          <article key={item.id} className={`is-${normalizedClassToken(item.severity || item.type)}`}>
            <time>{formatGraphTime(item.timestamp)}</time>
            <span>{item.type}</span>
            <strong>{item.summary}</strong>
            <small>{[item.source, item.sensor_id, item.rssi !== null && item.rssi !== undefined ? `${item.rssi} dBm` : null].filter(Boolean).join(" / ")}</small>
          </article>
        ))}
        {items.length === 0 ? <p>No live changes in the current feed window.</p> : null}
      </div>
    </aside>
  );
}

function OperatorIntelligencePanel({ graph, intelligence }: { graph: PresenceLinkGraph; intelligence: IntelligenceState }) {
  const primaryBurst = intelligence.bursts[0] ?? null;
  const primaryCluster = intelligence.clusters[0] ?? null;
  const primaryCausalAlert = intelligence.causalAlerts[0] ?? null;
  const strongestSpectrum = [...intelligence.spectrum].sort((left, right) => (right.strongest_rssi ?? -999) - (left.strongest_rssi ?? -999))[0] ?? null;
  const eventLinks = graph.edges.filter((edge) => edge.type === "mentions_entity").length;
  return (
    <section className="presence-intel-panel" aria-label="Operator intelligence">
      <div className="presence-panel-header">
        <div>
          <h2>Operator Intelligence</h2>
          <p>What the relationship graph is telling you right now</p>
        </div>
      </div>
      <div className="presence-intel-metrics">
        <Metric label="Tracked" value={`${intelligence.summary.length} tracked`} />
        <Metric label="Graph links" value={`${graph.edges.length} ${pluralize("link", graph.edges.length)}`} />
        <Metric label="Alert links" value={`${eventLinks} ${pluralize("alert link", eventLinks)}`} />
        <Metric label="Sensors" value={`${intelligence.coverage?.count ?? 0} ${pluralize("sensor", intelligence.coverage?.count ?? 0)}`} />
        <Metric label="Blind spots" value={`${intelligence.coverage?.blind_spots.length ?? 0} ${pluralize("blind spot", intelligence.coverage?.blind_spots.length ?? 0)}`} />
      </div>
      <div className="presence-intel-grid">
        <IntelCard title="Change briefing" tone={intelligence.briefing?.severity ?? "info"}>
          <strong>{intelligence.briefing?.summary ?? "No change briefing yet"}</strong>
          <span>{intelligence.briefing?.items[0]?.label ?? "Waiting for recent activity"}</span>
        </IntelCard>
        <IntelCard title="RF burst / swarm" tone={primaryBurst?.severity ?? "info"}>
          <strong>{primaryBurst?.label ?? "No burst detected"}</strong>
          <span>{primaryBurst ? `${primaryBurst.entity_count} signals · ${primaryBurst.strongest_rssi ?? "no RSSI"} dBm` : "Quiet in the current window"}</span>
        </IntelCard>
        <IntelCard title="Alert causality" tone={primaryCausalAlert?.event.severity ?? "neutral"}>
          <strong>{primaryCausalAlert ? `${primaryCausalAlert.event.summary} -> ${primaryCausalAlert.entity.label}` : "No alert/entity link yet"}</strong>
          <span>{primaryCausalAlert ? `${Math.round(primaryCausalAlert.confidence * 100)}% confidence · ${primaryCausalAlert.matched_fields[0]?.field ?? "payload match"}` : "Waiting for matching alert payloads"}</span>
        </IntelCard>
        <IntelCard title="Spectrum occupancy" tone={strongestSpectrum ? "signal" : "neutral"}>
          <strong>{strongestSpectrum ? `${strongestSpectrum.frequency_band} strongest` : "No spectrum peaks"}</strong>
          <span>{strongestSpectrum ? `${strongestSpectrum.peak_count} peaks · ${strongestSpectrum.strongest_rssi ?? "no RSSI"} dBm` : "HackRF/intercept peaks will appear here"}</span>
          <SpectrumRug buckets={intelligence.spectrum} />
        </IntelCard>
        <IntelCard title="Co-presence" tone={primaryCluster ? "signal" : "neutral"}>
          <strong>{primaryCluster?.labels.join(" + ") ?? "No paired pattern yet"}</strong>
          <span>{primaryCluster ? `${primaryCluster.shared_window_count} shared ${pluralize("window", primaryCluster.shared_window_count)}` : "Track more entities to correlate"}</span>
        </IntelCard>
        <IntelCard title="Sensor coverage" tone={intelligence.coverage?.blind_spots.length ? "warning" : "good"}>
          <strong>{intelligence.coverage ? `${intelligence.coverage.live_sensors}/${intelligence.coverage.count} live` : "Coverage loading"}</strong>
          <span>{intelligence.coverage?.blind_spots[0] ? `Blind spot: ${intelligence.coverage.blind_spots[0].sensor_id}` : "No blind spots reported"}</span>
        </IntelCard>
        <SensorTrustHeatmap trust={intelligence.sensorTrust} />
        <IntelCard title="Playbook hooks" tone="neutral">
          <strong>{intelligence.playbooks.length} {pluralize("hook", intelligence.playbooks.length)}</strong>
          <span>{intelligence.playbooks.slice(0, 3).map((playbook) => playbook.label).join(" · ") || "No hooks available"}</span>
        </IntelCard>
      </div>
    </section>
  );
}


function SensorTrustHeatmap({ trust }: { trust: SensorTrustResponse | null }) {
  const items = trust?.items ?? [];
  return (
    <IntelCard title="Sensor Trust Heatmap" tone={(trust?.weak_sensors ?? 0) > 0 ? "warning" : "good"}>
      <strong>{trust?.operator_read ?? "Sensor trust loading"}</strong>
      <div className="presence-sensor-trust-grid" aria-label="Sensor trust heatmap">
        {items.slice(0, 6).map((item) => (
          <article key={item.id} className={`is-${normalizedClassToken(item.status)}`} style={{ "--trust-score": `${item.trust_score}%` } as CSSProperties}>
            <span>{item.label}</span>
            <strong>{item.trust_score}% trust</strong>
            <small>{item.entity_count} entities / {item.sample_count} samples / {item.alert_count} alerts</small>
          </article>
        ))}
        {items.length === 0 ? <span>No sensor trust rows yet</span> : null}
      </div>
    </IntelCard>
  );
}

function SpectrumRug({ buckets }: { buckets: SpectrumOccupancyBucket[] }) {
  const maxSeen = Math.max(1, ...buckets.map((bucket) => bucket.seen_count));
  return (
    <span className="spectrum-rug presence-spectrum-rug" aria-label="Graph spectrum occupancy rug">
      {buckets.slice(0, 16).map((bucket) => (
        <i
          key={bucket.id}
          title={`${bucket.frequency_band} · ${bucket.seen_count} seen`}
          style={{ height: `${Math.max(5, Math.round((bucket.seen_count / maxSeen) * 22))}px` }}
        />
      ))}
    </span>
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

function IntelCard({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <article className={`presence-intel-card is-${tone}`}>
      <span>{title}</span>
      {children}
    </article>
  );
}

function RelationshipCanvas({
  graph,
  mode,
  focus,
  selectedEdge,
  selectedNode,
  onSelectEdge,
  onSelectNode,
  onIdentityDecision
}: {
  graph: PresenceLinkGraph;
  mode: PresenceGraphMode;
  focus: ReturnType<typeof selectedGraphFocus>;
  selectedEdge: PresenceGraphEdge | null;
  selectedNode: PresenceGraphNode | null;
  onSelectEdge: (edgeId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onIdentityDecision?: (node: PresenceGraphNode, action: "confirm" | "reject" | "split") => void;
}) {
  const denseNodeMode = graph.edges.length === 0 && graph.nodes.length > 36;
  const compactViewport = useCompactGraphViewport();
  const selectedNodeRef = useRef<HTMLButtonElement | null>(null);
  const layout = useMemo(() => layoutGraphNodes(graph.nodes, denseNodeMode, Boolean(selectedNode) && !compactViewport), [compactViewport, denseNodeMode, graph.nodes, selectedNode]);
  const hasFocus = focus.highlightedNodeIds.size > 0;

  useEffect(() => {
    if (!compactViewport || !selectedNode) {
      return;
    }
    selectedNodeRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [compactViewport, selectedNode?.id]);

  return (
    <div className="presence-graph-canvas presence-graph-mobile-canvas" aria-label="Interactive relationship canvas">
      <svg className="presence-graph-edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden={false}>
        {graph.edges.map((edge) => {
          const source = layout[edge.source];
          const target = layout[edge.target];
          if (!source || !target) {
            return null;
          }
          const role = edgeVisualRole(edge);
          const selected = selectedEdge?.id === edge.id;
          const dimmed = selectedEdge ? !selected : hasFocus && !focus.highlightedEdgeIds.has(edge.id);
          return (
            <line
              key={edge.id}
              className={`presence-graph-edge ${role.className} ${selected ? "is-selected" : ""} ${dimmed ? "is-dimmed" : ""}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              strokeWidth={edgeWidth(edge)}
              role="button"
              tabIndex={0}
              aria-label={`${edge.type} edge ${edge.source} to ${edge.target} weight ${edge.weight}`}
              onClick={() => onSelectEdge(edge.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectEdge(edge.id);
                }
              }}
            />
          );
        })}
      </svg>
      {graph.nodes.map((node) => {
        const position = layout[node.id];
        const role = nodeVisualRole(node);
        const selected = focus.selectedNodeId === node.id;
        const dimmed = hasFocus && !focus.highlightedNodeIds.has(node.id);
        return (
          <button
            key={node.id}
            ref={selected ? selectedNodeRef : undefined}
            type="button"
            className={`presence-graph-node ${role.className} ${denseNodeMode ? "is-dense" : ""} ${selected ? "is-selected" : ""} ${dimmed ? "is-dimmed" : ""}`}
            style={{ "--node-x": `${position?.x ?? 50}%`, "--node-y": `${position?.y ?? 50}%` } as CSSProperties}
            aria-label={`Select graph node ${node.label}`}
            aria-pressed={selected}
            title={nodeHoverExplanation(node)}
            onClick={() => onSelectNode(node.id)}
          >
            <span>{role.label}</span>
            <strong>{node.label}</strong>
            <small>{node.rssi !== undefined && node.rssi !== null ? `${node.rssi} dBm` : node.severity ?? node.source ?? role.tone}</small>
          </button>
        );
      })}
      {selectedNode ? (
        <GraphNodeDossier node={selectedNode} onIdentityDecision={onIdentityDecision} />
      ) : null}
      {selectedEdge ? (
        <GraphEdgeInspector edge={selectedEdge} />
      ) : null}
      {graph.nodes.length === 0 ? <p className="presence-graph-empty">{modeEmptyState(mode)}</p> : null}
    </div>
  );
}

function useCompactGraphViewport(): boolean {
  const [compact, setCompact] = useState(() => (typeof window === "undefined" ? false : window.innerWidth <= 620));

  useEffect(() => {
    const update = () => setCompact(window.innerWidth <= 620);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return compact;
}

function CausalAlertRail({ items, onOpenEntity }: { items: PresenceAlertCausalItem[]; onOpenEntity: (item: PresenceAlertCausalItem) => void }) {
  return (
    <aside className="presence-causal-rail" aria-label="Alert to entity causal graph">
      <div>
        <span>Causal Alerts</span>
        <strong>{items.length ? `${items.length} alert/entity ${pluralize("link", items.length)}` : "No causal links yet"}</strong>
      </div>
      <div>
        {items.slice(0, 6).map((item) => (
          <button key={item.id} type="button" onClick={() => onOpenEntity(item)} aria-label={`Open causal alert entity ${item.entity.label}`}>
            <span className={`presence-causal-severity is-${normalizedClassToken(item.event.severity)}`}>{item.event.severity}</span>
            <strong>{item.event.summary}</strong>
            <span>{item.entity.label}</span>
            <small>
              {Math.round(item.confidence * 100)}% · {item.matched_fields[0]?.field ?? "payload"} · {item.timeline.before_count}/{item.timeline.after_count} before/after
            </small>
          </button>
        ))}
      </div>
    </aside>
  );
}

function GraphNodeLegend() {
  return (
    <div className="presence-node-legend" aria-label="Graph node legend">
      <span><i className="is-presence" /> Tracked entity</span>
      <span><i className="is-rf" /> RF entity</span>
      <span><i className="is-aircraft" /> Aircraft</span>
      <span><i className="is-rail" /> Rail</span>
      <span><i className="is-iot" /> IoT mesh</span>
      <span><i className="is-sensor" /> Sensor</span>
      <span><i className="is-event" /> Alert/event</span>
    </div>
  );
}

function GraphNodeDossier({ node, onIdentityDecision }: { node: PresenceGraphNode; onIdentityDecision?: (node: PresenceGraphNode, action: "confirm" | "reject" | "split") => void }) {
  const sourcePath = [node.source, node.protocol, node.kind].filter(Boolean).join(" / ");
  const facts = [
    ["Type", nodeVisualRole(node).label],
    sourcePath ? ["Source", sourcePath] : null,
    typeof node.seen_count === "number" ? ["Seen", `${node.seen_count.toLocaleString()} seen`] : null,
    typeof node.rssi === "number" ? ["RSSI", `${node.rssi} dBm`] : null,
    node.first_seen_at ? ["First seen", formatGraphTime(node.first_seen_at)] : null,
    node.last_seen_at ? ["Last seen", formatGraphTime(node.last_seen_at)] : null
  ].filter((row): row is [string, string] => Boolean(row));
  return (
    <aside className="presence-graph-dossier presence-graph-mobile-sheet" aria-label="Graph node dossier">
      <span>Node Dossier</span>
      <strong>{node.label}</strong>
      {node.entity_key ? (
        <a href={`/presence/entities/${encodeURIComponent(node.entity_key)}`} aria-label={`Open full identity detail for ${node.label}`} className="presence-detail-link">
          Full identity detail
        </a>
      ) : null}
      {node.aircraft_details ? <AircraftDetailsPanel details={node.aircraft_details} /> : null}
      {node.rail_context ? <RailDetailsPanel context={node.rail_context} visuals={node.rail_visuals ?? null} /> : null}
      {node.iot_context ? <IotDetailsPanel context={node.iot_context} /> : null}
      <div className="presence-graph-operator-read">
        <span>Operator Read</span>
        <strong>{nodeOperatorRead(node)}</strong>
      </div>
      {node.resolved_identity ? <GraphResolverPanel node={node} /> : null}
      {node.entity_key ? <GraphOperatorDecisionPanel node={node} onIdentityDecision={onIdentityDecision} /> : null}
      <p>{node.summary ?? "No extended dossier fields yet. Select another node or switch modes for more relationship context."}</p>
      <div className="presence-graph-dossier-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {node.badges?.length ? (
        <div className="presence-graph-dossier-badges">
          {node.badges.slice(0, 6).map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      ) : null}
    </aside>
  );
}


function IotDetailsPanel({ context }: { context: NonNullable<PresenceGraphNode["iot_context"]> }) {
  const facts = [
    ["Stack", context.stack_hint],
    ["Channel", context.channel_label],
    ["PAN", context.network_pan_id],
    ["Short", context.short_address],
    ["Role", context.device_role_hint],
    ["Direction", context.packet_direction],
    ["Vendor", context.vendor_hint],
    ["Confidence", `${context.confidence}%`]
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <section className="presence-graph-domain-details is-iot" aria-label="IoT mesh details">
      <span>IoT Mesh Context</span>
      <strong>{context.operator_read}</strong>
      <div>
        {facts.map(([label, value]) => (
          <i key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </i>
        ))}
      </div>
      <p>{context.limits}</p>
    </section>
  );
}


function RailDetailsPanel({
  context,
  visuals
}: {
  context: NonNullable<PresenceGraphNode["rail_context"]>;
  visuals: PresenceGraphNode["rail_visuals"] | null;
}) {
  const facts = [
    ["Channel", context.channel_label],
    ["Frequency", context.frequency_mhz !== null && context.frequency_mhz !== undefined ? `${context.frequency_mhz.toFixed(3)} MHz` : null],
    ["Operator", context.operator_hint],
    ["Route", context.route_hint],
    ["Usage", context.usage_hint],
    ["Confidence", `${context.confidence}%`]
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <section className="presence-graph-domain-details is-rail" aria-label="Rail RF details">
      <span>Rail RF Context</span>
      <strong>{context.operator_read}</strong>
      <div>
        {facts.map(([label, value]) => (
          <i key={label}>
            <small>{label}</small>
            <b>{value}</b>
          </i>
        ))}
      </div>
      <p>{context.limits}</p>
      {visuals ? (
        <div className="presence-rail-visuals" aria-label="Rail operator visuals">
          <div className="presence-rail-confidence" aria-label="Rail confidence strip">
            {visuals.confidence_strip.map((item) => (
              <span key={`${item.label}-${item.value}`} className={`is-${item.tone}`}>
                <small>{item.label}</small>
                <b>{item.value}</b>
                <em>{item.confidence}%</em>
              </span>
            ))}
          </div>
          {visuals.frequency_ladder.length ? (
            <div className="presence-rail-ladder" aria-label="AAR channel frequency ladder">
              {visuals.frequency_ladder.map((item) => (
                <span key={`${item.channel}-${item.frequency_mhz}`} className={item.role === "selected" ? "is-selected" : ""}>
                  <b>{item.channel}</b>
                  <small>{item.frequency_mhz !== null && item.frequency_mhz !== undefined ? `${item.frequency_mhz.toFixed(3)} MHz` : "MHz unknown"}</small>
                </span>
              ))}
            </div>
          ) : null}
          {visuals.recent_activity.length ? (
            <div className="presence-rail-pulses" aria-label="Rail recent sample pulses">
              {visuals.recent_activity.map((sample, index) => (
                <span key={`${sample.timestamp}-${index}`} title={`${sample.label} ${sample.rssi ?? "no RSSI"} dBm ${formatGraphTime(sample.timestamp)}`}>
                  <i style={{ height: `${Math.max(18, Math.min(64, 84 + (sample.rssi ?? -75)))}px` }} />
                  <small>{sample.rssi !== null && sample.rssi !== undefined ? `${sample.rssi}` : "n/a"}</small>
                </span>
              ))}
            </div>
          ) : null}
          <div className="presence-rail-rhythm" aria-label="Rail activity rhythm">
            <span>{visuals.rhythm.sample_count.toLocaleString()} samples</span>
            <strong>{visuals.rhythm.peak_hour_label ?? "learning rhythm"}</strong>
            <small>{visuals.rhythm.operator_read}</small>
          </div>
        </div>
      ) : null}
    </section>
  );
}


function GraphOperatorDecisionPanel({ node, onIdentityDecision }: { node: PresenceGraphNode; onIdentityDecision?: (node: PresenceGraphNode, action: "confirm" | "reject" | "split") => void }) {
  const summary = node.operator_decisions;
  return (
    <section className="presence-graph-decision-panel" aria-label="Operator identity decisions">
      <span>Operator Decisions</span>
      <strong>{summary ? `${summary.confirmed} confirmed / ${summary.rejected} rejected / ${summary.split} split` : "No operator decision yet"}</strong>
      {summary?.latest ? <small>{summary.latest.decision_state}: {summary.latest.label ?? summary.latest.reason ?? summary.latest.target_entity_key}</small> : null}
      <div>
        <button type="button" onClick={() => onIdentityDecision?.(node, "confirm")} aria-label={`Confirm identity relationship for ${node.label}`}>Confirm</button>
        <button type="button" onClick={() => onIdentityDecision?.(node, "reject")} aria-label={`Reject identity relationship for ${node.label}`}>Reject</button>
        <button type="button" onClick={() => onIdentityDecision?.(node, "split")} aria-label={`Split identity relationship for ${node.label}`}>Split</button>
      </div>
    </section>
  );
}

function GraphResolverPanel({ node }: { node: PresenceGraphNode }) {
  const identity = node.resolved_identity;
  if (!identity) {
    return null;
  }
  const relationship = identity.relationship_label ?? titleizeGraphTier(identity.tier ?? "single_source");
  return (
    <section className={`presence-graph-resolver is-${identity.tier ?? "single_source"}`} aria-label="Graph resolver evidence">
      <span>Resolver Tier</span>
      <strong>{relationship}</strong>
      <small>{formatGraphConfidence(identity.confidence)}% confidence</small>
      <div>
        <b>{identity.source_count} sources / {identity.entity_count} rows</b>
        <em>{identity.sources.slice(0, 4).join(" / ") || identity.canonical_key}</em>
      </div>
      {identity.operator_feedback ? (
        <small>Operator feedback: {identity.operator_feedback.confirmed} confirmed / {identity.operator_feedback.rejected} rejected / {identity.operator_feedback.split} split</small>
      ) : null}
    </section>
  );
}

function AircraftDetailsPanel({ details }: { details: AircraftDetails }) {
  const callsign = details.callsign || details.flight;
  const aircraftModel = details.aircraft_model || details.aircraft_type;
  const identity = [callsign, details.registration, aircraftModel].filter(Boolean).join(" / ");
  const motion = [
    typeof details.altitude_ft === "number" ? `${details.altitude_ft.toLocaleString()} ft` : null,
    typeof details.ground_speed_kt === "number" ? `${Math.round(details.ground_speed_kt).toLocaleString()} kt` : null,
    typeof details.track_deg === "number" ? `${Math.round(details.track_deg)}°${details.track_label ? ` ${details.track_label}` : ""}` : details.track_label
  ].filter(Boolean).join(" / ");
  const transponder = [
    details.hex,
    details.squawk ? `squawk ${details.squawk}` : null,
    details.category
  ].filter(Boolean).join(" / ");
  const position = typeof details.lat === "number" && typeof details.lon === "number"
    ? `${details.lat.toFixed(4)}, ${details.lon.toFixed(4)}`
    : "";
  const feed = [
    typeof details.messages === "number" ? `${details.messages.toLocaleString()} msg` : null,
    typeof details.seen_pos_seconds === "number" ? `pos ${formatCompactNumber(details.seen_pos_seconds)}s` : null
  ].filter(Boolean).join(" / ");
  const metadata = details.metadata_source
    ? `${details.metadata_matched ? "aircraft_db / " : ""}${details.metadata_source}`
    : "";
  const confidence = typeof details.metadata_confidence === "number"
    ? `${Math.round(details.metadata_confidence * 100)}%${details.metadata_provenance ? ` · ${details.metadata_provenance}` : ""}`
    : details.metadata_provenance || "";
  const route = details.route_summary;
  const routeDetails = route
    ? [
        route.pass_direction,
        route.altitude_trend,
        typeof route.confidence === "number" ? `confidence ${Math.round(route.confidence * 100)}%` : null
      ].filter(Boolean).join(" · ")
    : "";
  const photo = details.aircraft_photo_key ? AIRCRAFT_PHOTO_LIBRARY[details.aircraft_photo_key] : null;
  const photoLabel = details.aircraft_photo_label || photo?.label || aircraftModel || details.aircraft_visual_class || "aircraft";
  const airspaceOperatorRead = [
    [details.airline, callsign].filter(Boolean).join(" "),
    photoLabel,
    route?.pass_direction,
    route?.altitude_trend
  ].filter(Boolean).join(" · ");
  const trustRead = typeof details.metadata_confidence === "number"
    ? `${Math.round(details.metadata_confidence * 100)}% confidence from ${details.metadata_provenance || details.metadata_source || "airspace evidence"}`
    : details.metadata_provenance || "Collector payload is available for review";
  const pills = [
    details.airline ? ["Carrier", details.airline] : null,
    callsign ? ["Callsign", callsign] : null,
    aircraftModel ? ["Aircraft Type", aircraftModel] : null,
    details.registration ? ["Registration", details.registration] : null,
    details.operator ? ["Owner / Operator", details.operator] : null
  ].filter((pill): pill is [string, string] => Boolean(pill));
  const rows = [
    identity ? ["Identity", identity] : null,
    details.operator ? ["Operator", details.operator] : null,
    motion ? ["Motion", motion] : null,
    typeof details.vertical_rate_fpm === "number" ? ["Vertical", `${details.vertical_rate_fpm.toLocaleString()} fpm`] : null,
    transponder ? ["Transponder", transponder] : null,
    metadata ? ["Metadata", metadata] : null,
    confidence ? ["Confidence", confidence] : null,
    details.emergency ? ["Emergency", details.emergency] : null,
    position ? ["Position", position] : null,
    feed ? ["Feed", feed] : null
  ].filter((row): row is [string, string] => Boolean(row));
  if (!rows.length) {
    return null;
  }
  return (
    <section className="presence-aircraft-details" aria-label="Aircraft ADS-B details">
      <span>Aircraft ADS-B Details</span>
      <article className="presence-aircraft-operator-read">
        <span>Airspace Operator Read</span>
        <strong>{airspaceOperatorRead || identity || "Aircraft identity is still resolving"}</strong>
      </article>
      <div className="presence-aircraft-hero">
        {photo ? (
          <AircraftPhoto photo={photo} label={photoLabel} />
        ) : (
          <AircraftVisual visualClass={details.aircraft_visual_class || "unknown"} />
        )}
        <div className="presence-aircraft-pills">
          {pills.map(([label, value]) => (
            <article key={label} className={isCompactAircraftField(label) ? "is-compact-aircraft-field" : undefined} title={`${label}: ${value}`}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </div>
      <div className="presence-aircraft-motion-grid" aria-label="Live Motion">
        <span>Live Motion</span>
        <article>
          <span>Altitude</span>
          <strong>{typeof details.altitude_ft === "number" ? `${details.altitude_ft.toLocaleString()} ft` : "unknown"}</strong>
        </article>
        <article>
          <span>Speed</span>
          <strong>{typeof details.ground_speed_kt === "number" ? `${Math.round(details.ground_speed_kt).toLocaleString()} kt` : "unknown"}</strong>
        </article>
        <article>
          <span>Heading</span>
          <strong>{typeof details.track_deg === "number" ? `${Math.round(details.track_deg)}°${details.track_label ? ` ${details.track_label}` : ""}` : details.track_label || "unknown"}</strong>
        </article>
      </div>
      <article className="presence-aircraft-trust">
        <span>Why TDS trusts this</span>
        <strong>{trustRead}</strong>
      </article>
      <div>
        {route?.label ? (
          <article className="presence-aircraft-route">
            <span>Route / Lane</span>
            <strong>{route.label}</strong>
            {routeDetails ? <em>{routeDetails}</em> : null}
          </article>
        ) : null}
        {rows.map(([label, value]) => (
          <article key={label} title={`${label}: ${value}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function isCompactAircraftField(label: string): boolean {
  return ["Callsign", "Aircraft Type", "Registration"].includes(label);
}

function AircraftPhoto({ photo, label }: { photo: { url: string; attribution: string }; label: string }) {
  return (
    <figure className="presence-aircraft-photo">
      <img src={photo.url} alt={`Representative aircraft photo: ${label}`} loading="lazy" />
      <figcaption>
        <span>Representative photo</span>
        <strong>{photo.attribution}</strong>
      </figcaption>
    </figure>
  );
}

function AircraftVisual({ visualClass }: { visualClass: string }) {
  const normalized = ["jet", "widebody", "helicopter", "turboprop", "small-ga"].includes(visualClass)
    ? visualClass
    : "unknown";
  return (
    <div className={`presence-aircraft-visual is-${normalized}`} aria-label={`Aircraft silhouette: ${normalized}`}>
      <svg viewBox="0 0 96 56" role="img" focusable="false" aria-hidden="true">
        {normalized === "helicopter" ? (
          <>
            <path d="M18 25h35l12 7h15l4 5H60l-10 8H28l-7-7H11l-3-5h11l-7-5z" />
            <path d="M18 15h58v4H18zM45 9h4v13h-4zM34 47h36v4H34z" />
          </>
        ) : normalized === "turboprop" ? (
          <>
            <path d="M10 31h50l20-11h7l-9 14 9 14h-7L60 37H10z" />
            <path d="M36 13h8l9 18H27zM36 55h8l9-18H27zM8 22h6v28H8z" />
          </>
        ) : normalized === "small-ga" ? (
          <>
            <path d="M13 31h45l17-9h8l-8 13 8 13h-8l-17-9H13z" />
            <path d="M34 18h7l8 13H27zM34 52h7l8-13H27z" />
          </>
        ) : (
          <>
            <path d="M8 31h55l21-13h6L78 34l12 16h-6L63 38H8z" />
            <path d="M39 9h9l14 22H28zM39 56h9l14-18H28z" />
            <path d="M7 24h8v28H7z" />
          </>
        )}
      </svg>
      <span>{normalized === "widebody" ? "Widebody" : normalized === "small-ga" ? "Small GA" : normalized}</span>
    </div>
  );
}

function titleizeGraphTier(tier: string): string {
  return tier
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatGraphConfidence(confidence: number | null | undefined): number {
  if (typeof confidence !== "number") {
    return 0;
  }
  return Math.round(confidence <= 1 ? confidence * 100 : confidence);
}

function nodeHoverExplanation(node: PresenceGraphNode): string {
  const role = nodeVisualRole(node).label;
  const sourcePath = [node.source, node.protocol, node.kind].filter(Boolean).join(" / ");
  if (node.type === "aircraft") {
    return `${role}: ADS-B aircraft currently or recently visible in airspace. Click to inspect callsign/track evidence and timestamps.`;
  }
  if (node.type === "rail") {
    return `${role}: passive AAR/channel activity from the rail SDR collector. Click to inspect channel, operator/route hints, RSSI, and caveats.`;
  }
  if (node.type === "event") {
    return `${role}: alert or rule output that references an identity. Click to inspect severity, summary, and linked evidence.`;
  }
  if (node.type === "sensor") {
    return `${role}: collection sensor that observed identities. Click to inspect source, coverage, and recent observations.`;
  }
  if (node.type === "source") {
    return `${role}: upstream collector/source feeding TDS. Click to inspect which sensors or events depend on it.`;
  }
  if (nodeVisualRole(node).label === "RF entity") {
    return `${role}: RF/sub-GHz or utility identity inferred from signal evidence${sourcePath ? ` from ${sourcePath}` : ""}. Click to inspect RSSI, source, and sightings.`;
  }
  return `${role}: tracked presence identity${sourcePath ? ` from ${sourcePath}` : ""}. Click to inspect when, where, and by which sensor it was observed.`;
}

function nodeOperatorRead(node: PresenceGraphNode): string {
  if (node.type === "aircraft") {
    return "Aircraft visible through ADS-B/airspace collection. Use this node to inspect flight identity, recency, and whether it has supporting airspace-lane evidence.";
  }
  if (node.type === "rail") {
    return node.rail_context?.operator_read ?? "Passive rail RF activity. Use this node to inspect AAR channel, operator/route hints, RSSI, and recency.";
  }
  if (node.type === "event") {
    return "Alert or rule output connected to graph evidence. Use this node to see what triggered, which entity it mentions, and whether it needs operator action.";
  }
  if (node.type === "sensor") {
    return "Collection point that saw one or more identities. Use this node to judge coverage, stale sensors, and which source is feeding the observations.";
  }
  if (node.type === "source") {
    return "Collector/source feeding TDS. Use this node to understand which subsystem produced the evidence and whether it is part of the current signal picture.";
  }
  if (nodeVisualRole(node).label === "RF entity") {
    return "RF identity or signal source inferred from spectrum/sub-GHz evidence. Use this node to inspect RSSI, frequency context, and repeated sightings.";
  }
  return "Trackable device identity seen around the property. Use this node to inspect when, where, and by which sensor it was observed.";
}

function GraphEdgeInspector({ edge }: { edge: PresenceGraphEdge }) {
  const confidence = typeof edge.confidence === "number" ? Math.round(edge.confidence * 100) : null;
  const evidenceCount = edge.evidence_count ?? edge.weight;
  return (
    <aside className="presence-edge-inspector" aria-label="Graph edge evidence">
      <span>Edge Evidence</span>
      <strong>{edge.type}</strong>
      <p>{edge.explanation ?? `${edge.source} is linked to ${edge.target} by ${evidenceCount} ${pluralize("piece", evidenceCount)} of evidence.`}</p>
      <div className="presence-edge-inspector-facts">
        <span>{evidenceCount} evidence</span>
        {confidence !== null ? <span>Confidence {confidence}%</span> : null}
        <span>Latest {formatGraphTime(edge.latest_seen_at)}</span>
      </div>
      {edge.evidence?.length ? (
        <div className="presence-edge-evidence-list">
          {edge.evidence.slice(0, 4).map((item, index) => (
            <article key={`${item.label}:${item.timestamp ?? index}`}>
              <strong>{item.label}</strong>
              <span>{[item.source, item.sensor_id, item.rssi !== undefined && item.rssi !== null ? `${item.rssi} dBm` : null].filter(Boolean).join(" / ")}</span>
              <time>{formatGraphTime(item.timestamp)}</time>
            </article>
          ))}
        </div>
      ) : (
        <p>No sample rows were attached to this link.</p>
      )}
    </aside>
  );
}

function GraphTimelineRail({
  items,
  selectedNode,
  status
}: {
  items: PresenceGraphTimelineItem[];
  selectedNode: PresenceGraphNode | null;
  status: "idle" | "loading" | "ready" | "error";
}) {
  if (!selectedNode) {
    return null;
  }
  return (
    <aside className="presence-graph-timeline presence-graph-mobile-rail" aria-label="Selected entity evidence timeline">
      <div>
        <span>Evidence Timeline</span>
        <strong>{selectedNode.label}</strong>
      </div>
      {status === "loading" ? <p>Loading selected entity timeline.</p> : null}
      {status === "error" ? <p>Timeline data could not be loaded for this entity.</p> : null}
      {status === "idle" ? <p>Select a tracked entity to review sightings, notes, alerts, and playbook runs.</p> : null}
      {status === "ready" && items.length === 0 ? <p>No timeline evidence has been recorded for this entity yet.</p> : null}
      {items.length ? (
        <div className="presence-graph-timeline-items">
          {items.slice(0, 8).map((item) => (
            <article key={item.id} className={`is-${normalizedClassToken(item.severity || item.type)}`}>
              <time>{formatGraphTime(item.timestamp)}</time>
              <span>{item.type}</span>
              <strong>{item.label}</strong>
              <p>{item.summary}</p>
              <small>{[item.source, item.sensor_id, item.rssi !== null && item.rssi !== undefined ? `${item.rssi} dBm` : null].filter(Boolean).join(" / ")}</small>
            </article>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function RelationshipLedger({
  edges,
  selectedEdgeId,
  onSelectEdge
}: {
  edges: PresenceGraphEdge[];
  selectedEdgeId: string | null;
  onSelectEdge: (edgeId: string) => void;
}) {
  return (
    <aside className="presence-relationship-ledger" aria-label="Relationship evidence ledger">
      <span>Evidence links</span>
      {edges.slice(0, 10).map((edge) => (
        <button
          key={edge.id}
          type="button"
          className={selectedEdgeId === edge.id ? "is-selected" : ""}
          aria-label={`Inspect graph edge ${edge.type} ${edge.source} to ${edge.target}`}
          aria-pressed={selectedEdgeId === edge.id}
          onClick={() => onSelectEdge(edge.id)}
        >
          <strong>{edge.type}</strong>
          <span>{edge.evidence_count ?? edge.weight} evidence</span>
        </button>
      ))}
      {edges.length === 0 ? <p>No relationship evidence yet.</p> : null}
    </aside>
  );
}

function modeLabel(mode: PresenceGraphMode): string {
  const match = GRAPH_MODES.find((item) => item.id === mode);
  return match?.label ?? mode;
}

function modeGuidance(mode: PresenceGraphMode): string {
  if (mode === "presence") {
    return "Presence mode focuses on Wi-Fi, BLE, and client identities, then keeps the sensors and sources that explain where each identity was observed.";
  }
  if (mode === "rf") {
    return "RF mode isolates unknown RF, utility, SDR, and sub-GHz entities so bursts, frequency clues, and weak identifiers are easier to inspect.";
  }
  if (mode === "airspace") {
    return "Airspace mode shows ADS-B aircraft only while current-state collection still reports them. Click an aircraft for callsign, motion, recency, and lane context.";
  }
  if (mode === "rail") {
    return "Rail mode shows passive AAR/channel activity from the rail SDR collector. Click a rail node for channel, likely operator/route context, signal strength, and collection limits.";
  }
  if (mode === "iot") {
    return "IoT mode shows Zigbee, Thread, and 802.15.4 mesh activity. Click a node for stack, channel, PAN, short-address, role, vendor, and capture limits.";
  }
  if (mode === "alerts") {
    return "Alerts mode keeps alarm and rule-output nodes with the identities they mention, so the cause and evidence path are visible.";
  }
  return "All mode combines tracked devices, sensors, sources, alerts, RF, and aircraft into one investigation map.";
}

function modeEmptyState(mode: PresenceGraphMode): string {
  if (mode === "presence") {
    return "No presence nodes in this mode yet. Track Wi-Fi, BLE, or client identities to build home presence relationships.";
  }
  if (mode === "rf") {
    return "No RF nodes in this mode yet. Unknown RF, utility, SDR, and sub-GHz observations appear here when collectors report them.";
  }
  if (mode === "airspace") {
    return "No aircraft currently visible. TDS hides aircraft when ADS-B stops reporting them; the activity strip keeps the most recent in-session aircraft context.";
  }
  if (mode === "rail") {
    return "No rail RF currently visible. Rail nodes appear when the rail SDR collector reports passive AAR/channel activity.";
  }
  if (mode === "iot") {
    return "No IoT mesh activity visible yet. Zigbee, Thread, and 802.15.4 nodes appear here when the nRF collector reports packets.";
  }
  if (mode === "alerts") {
    return "No alert links in this mode yet. Alerts appear when source payloads mention a tracked MAC, identity, sensor, or aircraft.";
  }
  return "No graph nodes in this mode yet. Track entities or wait for collectors to report observations.";
}

export function layoutGraphNodes(nodes: PresenceGraphNode[], dense = false, reserveDossier = false): Record<string, { x: number; y: number }> {
  if (dense) {
    return layoutDenseGroup(nodes, reserveDossier);
  }
  const groups = {
    aircraft: nodes.filter((node) => node.type === "aircraft"),
    rail: nodes.filter((node) => node.type === "rail"),
    event: nodes.filter((node) => node.type === "event"),
    entity: nodes.filter((node) => node.type === "entity"),
    sensor: nodes.filter((node) => node.type === "sensor"),
    source: nodes.filter((node) => node.type === "source"),
    other: nodes.filter((node) => !["aircraft", "rail", "event", "entity", "sensor", "source"].includes(node.type))
  };
  return {
    ...layoutGroup(groups.aircraft, 12),
    ...layoutGroup(groups.rail, 22),
    ...layoutGroup(groups.event, 32),
    ...layoutGroup(groups.entity, 50),
    ...layoutGroup(groups.sensor, 70),
    ...layoutGroup(groups.source, 86),
    ...layoutGroup(groups.other, 54)
  };
}

function layoutGroup(nodes: PresenceGraphNode[], y: number): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const count = Math.max(nodes.length, 1);
  nodes.forEach((node, index) => {
    layout[node.id] = {
      x: count === 1 ? 50 : 12 + (76 * index) / (count - 1),
      y
    };
  });
  return layout;
}

function layoutDenseGroup(nodes: PresenceGraphNode[], reserveDossier = false): Record<string, { x: number; y: number }> {
  const layout: Record<string, { x: number; y: number }> = {};
  const count = Math.max(nodes.length, 1);
  const columns = Math.min(18, Math.max(1, Math.ceil(Math.sqrt(count * 1.4))));
  const rows = Math.max(1, Math.ceil(count / columns));
  const minX = 8;
  const maxX = reserveDossier ? 60 : 78;
  const minY = 12;
  const maxY = 88;

  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    layout[node.id] = {
      x: columns === 1 ? 50 : minX + ((maxX - minX) * column) / (columns - 1),
      y: rows === 1 ? 50 : minY + ((maxY - minY) * row) / (rows - 1)
    };
  });
  return layout;
}

function edgeWidth(edge: PresenceGraphEdge): number {
  return Math.max(0.35, Math.min(2.8, 0.35 + Math.log10(Math.max(edge.weight, 1)) * 1.1));
}

function formatGraphTime(value: string | null | undefined): string {
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

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}

function normalizedClassToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "neutral";
}
