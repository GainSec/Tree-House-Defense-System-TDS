import type { InvestigationSearchResult, PresenceGraphEdge, PresenceGraphMode, PresenceGraphNode, PresenceLinkGraph } from "../domain/types";

export interface GraphNeighborFocus {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
}

export interface SelectedGraphFocus {
  selectedNodeId: string | null;
  highlightedNodeIds: Set<string>;
  highlightedEdgeIds: Set<string>;
}

export interface GraphVisualRole {
  className: string;
  tone: string;
  label: string;
}

export interface GraphConnectionLead {
  id: string;
  label: string;
  summary: string;
  tone: string;
}

export interface GraphClusterSummary {
  id: string;
  label: string;
  count: number;
  summary: string;
}

const GRAPH_MODES = new Set<PresenceGraphMode>(["presence", "rf", "airspace", "rail", "iot", "cellular", "alerts", "all"]);
const CLUSTER_ORDER = ["Tracked entity", "RF entity", "Sensor", "Source", "Alert/event", "Aircraft", "Rail activity", "IoT mesh", "Cellular"];

export function graphModeFromSearch(search: string): PresenceGraphMode {
  const mode = new URLSearchParams(search).get("mode");
  return mode && GRAPH_MODES.has(mode as PresenceGraphMode) ? (mode as PresenceGraphMode) : "all";
}

export function visibleGraphForMode(graph: PresenceLinkGraph, mode: PresenceGraphMode): PresenceLinkGraph {
  if (mode === "all") {
    return graph;
  }
  const primaryIds = new Set(graph.nodes.filter((node) => primaryNodeMatchesMode(node, mode)).map((node) => node.id));
  const visibleIds = new Set(primaryIds);

  if (mode === "presence" || mode === "rf") {
    let changed = true;
    while (changed) {
      changed = false;
      for (const edge of graph.edges) {
        if (!visibleIds.has(edge.source) && !visibleIds.has(edge.target)) {
          continue;
        }
        const source = nodeById(graph, edge.source);
        const target = nodeById(graph, edge.target);
        if (source && contextNodeForMode(source, mode) && !visibleIds.has(source.id)) {
          visibleIds.add(source.id);
          changed = true;
        }
        if (target && contextNodeForMode(target, mode) && !visibleIds.has(target.id)) {
          visibleIds.add(target.id);
          changed = true;
        }
      }
    }
  }

  if (mode === "alerts") {
    for (const edge of graph.edges) {
      if (edge.type === "mentions_entity" && (visibleIds.has(edge.source) || visibleIds.has(edge.target))) {
        visibleIds.add(edge.source);
        visibleIds.add(edge.target);
      }
    }
  }

  const nodes = graph.nodes.filter((node) => visibleIds.has(node.id));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }
    if (mode === "presence" || mode === "rf") {
      return edge.type === "observed_by" || edge.type === "feeds_source";
    }
    if (mode === "alerts") {
      return edge.type === "mentions_entity";
    }
    if (mode === "airspace") {
      return edge.type === "airspace_lane";
    }
    return true;
  });
  return { nodes, edges };
}

export function neighborsForNode(graph: PresenceLinkGraph, nodeId: string): GraphNeighborFocus {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.source !== nodeId && edge.target !== nodeId) {
      continue;
    }
    edgeIds.add(edge.id);
    nodeIds.add(edge.source === nodeId ? edge.target : edge.source);
  }
  return { nodeIds, edgeIds };
}

export function selectedGraphFocus(graph: PresenceLinkGraph, selectedNodeId: string | null): SelectedGraphFocus {
  if (!selectedNodeId || !nodeById(graph, selectedNodeId)) {
    return { selectedNodeId: null, highlightedNodeIds: new Set(), highlightedEdgeIds: new Set() };
  }
  const neighbors = neighborsForNode(graph, selectedNodeId);
  return {
    selectedNodeId,
    highlightedNodeIds: new Set([selectedNodeId, ...neighbors.nodeIds]),
    highlightedEdgeIds: neighbors.edgeIds
  };
}

export function nodeVisualRole(node: PresenceGraphNode): GraphVisualRole {
  if (node.type === "aircraft") {
    return { className: "is-aircraft", tone: "airspace", label: "Aircraft" };
  }
  if (node.type === "rail") {
    return { className: "is-rail", tone: "rail", label: "Rail activity" };
  }
  if (node.type === "iot") {
    return { className: "is-iot", tone: "iot", label: "IoT mesh" };
  }
  if (node.type === "cellular") {
    return { className: "is-cellular", tone: "cellular", label: "Cellular" };
  }
  if (node.type === "event") {
    const severity = node.severity ? normalizedToken(node.severity) : "info";
    return { className: `is-event is-${severity}`, tone: eventTone(node.severity), label: "Alert/event" };
  }
  if (node.type === "sensor") {
    return { className: "is-sensor", tone: node.severity ? "warning" : "source", label: "Sensor" };
  }
  if (node.type === "source") {
    return { className: "is-source", tone: "source", label: "Source" };
  }
  if (nodeMatchesRf(node)) {
    return { className: "is-entity is-rf", tone: "warning", label: "RF entity" };
  }
  return { className: "is-entity is-presence", tone: "signal", label: "Tracked entity" };
}

export function edgeVisualRole(edge: PresenceGraphEdge): GraphVisualRole {
  if (edge.type === "observed_by") {
    return { className: "is-observed-by", tone: "observed", label: "Observed by sensor" };
  }
  if (edge.type === "feeds_source") {
    return { className: "is-feeds-source", tone: "source", label: "Sensor feeds source" };
  }
  if (edge.type === "mentions_entity") {
    return { className: "is-mentions-entity", tone: "alert", label: "Alert mentions entity" };
  }
  if (edge.type === "co_present") {
    return { className: "is-co-present", tone: "copresence", label: "Seen together" };
  }
  if (edge.type === "airspace_lane") {
    return { className: "is-airspace-lane", tone: "airspace", label: "Airspace lane" };
  }
  return { className: `is-${normalizedToken(edge.type)}`, tone: "neutral", label: edge.type };
}

export function resolveSearchResultNode(graph: PresenceLinkGraph, result: InvestigationSearchResult): PresenceGraphNode | null {
  if (result.entity_key) {
    const byEntity = graph.nodes.find((node) => node.entity_key === result.entity_key || node.id === result.entity_key || node.id === `entity:${result.entity_key}`);
    if (byEntity) {
      return byEntity;
    }
  }
  if (result.event_id) {
    const byEvent = graph.nodes.find((node) => node.id === result.event_id || node.id === `event:${result.event_id}`);
    if (byEvent) {
      return byEvent;
    }
  }
  const label = result.label.trim().toLowerCase();
  return graph.nodes.find((node) => node.label.trim().toLowerCase() === label) ?? null;
}

export function rankedGraphConnections(graph: PresenceLinkGraph, limit = 6): GraphConnectionLead[] {
  return [...graph.edges]
    .map((edge) => {
      const source = nodeById(graph, edge.source);
      const target = nodeById(graph, edge.target);
      const visual = edgeVisualRole(edge);
      const evidenceCount = edge.evidence_count ?? edge.weight;
      const confidence = typeof edge.confidence === "number" ? Math.round(edge.confidence * 100) : null;
      const summaryParts = [
        visual.label,
        `${evidenceCount.toLocaleString()} evidence`,
        confidence !== null ? `${confidence}% confidence` : null
      ];
      return {
        id: edge.id,
        label: `${source?.label ?? edge.source} -> ${target?.label ?? edge.target}`,
        summary: summaryParts.filter(Boolean).join(" · "),
        tone: visual.tone,
        score: connectionScore(edge)
      };
    })
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .slice(0, limit)
    .map(({ score: _score, ...lead }) => lead);
}

export function graphClusterSummaries(graph: PresenceLinkGraph): GraphClusterSummary[] {
  const groups = new Map<string, PresenceGraphNode[]>();
  for (const node of graph.nodes) {
    const label = nodeVisualRole(node).label;
    groups.set(label, [...(groups.get(label) ?? []), node]);
  }
  return CLUSTER_ORDER
    .filter((label) => groups.has(label))
    .map((label) => {
      const nodes = groups.get(label) ?? [];
      return {
        id: normalizedToken(label).replace(/_/g, "-"),
        label,
        count: nodes.length,
        summary: nodes.slice(0, 3).map((node) => node.label).join(", ")
      };
    });
}

function primaryNodeMatchesMode(node: PresenceGraphNode, mode: PresenceGraphMode): boolean {
  if (mode === "presence") {
    return node.type === "entity" && nodeMatchesPresence(node);
  }
  if (mode === "rf") {
    return node.type === "entity" && nodeMatchesRf(node);
  }
  if (mode === "airspace") {
    return node.type === "aircraft";
  }
  if (mode === "rail") {
    return node.type === "rail";
  }
  if (mode === "iot") {
    return node.type === "iot";
  }
  if (mode === "cellular") {
    return node.type === "cellular";
  }
  if (mode === "alerts") {
    return node.type === "event";
  }
  return true;
}

function contextNodeForMode(node: PresenceGraphNode, mode: PresenceGraphMode): boolean {
  if (mode === "presence" || mode === "rf") {
    return node.type === "sensor" || node.type === "source";
  }
  return false;
}

function nodeMatchesPresence(node: PresenceGraphNode): boolean {
  const tokens = nodeTokens(node);
  return tokens.some((token) => ["client", "wifi", "ble", "bluetooth", "station", "host_hint"].includes(token));
}

function nodeMatchesRf(node: PresenceGraphNode): boolean {
  const tokens = nodeTokens(node);
  return tokens.some((token) => ["spectrum_peak", "unknown_rf", "utility", "rtl433", "subghz", "sdr", "rail", "rail_activity", "zigbee", "thread", "802154", "iot", "iot_device"].includes(token));
}

function nodeTokens(node: PresenceGraphNode): string[] {
  return [node.type, node.source, node.protocol, node.kind, ...(node.badges ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizedToken(value));
}

function eventTone(severity: string | undefined): string {
  const token = normalizedToken(severity);
  if (["critical", "error", "warning"].includes(token)) {
    return "warning";
  }
  return "neutral";
}

function nodeById(graph: PresenceLinkGraph, nodeId: string): PresenceGraphNode | null {
  return graph.nodes.find((node) => node.id === nodeId) ?? null;
}

function connectionScore(edge: PresenceGraphEdge): number {
  const evidence = edge.evidence_count ?? edge.weight;
  const confidence = typeof edge.confidence === "number" ? edge.confidence * 20 : 0;
  const typeBonus = edge.type === "mentions_entity" ? 12 : edge.type === "co_present" ? 10 : edge.type === "observed_by" ? 6 : 0;
  return evidence * 10 + confidence + typeBonus;
}

function normalizedToken(value: string | undefined | null): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
