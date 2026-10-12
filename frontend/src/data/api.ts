import type {
  AircraftMapFeature,
  AirspaceLane,
  ChangeBriefing,
  ControlHealth,
  ControlCollectorSettingsUpdate,
  ControlDeviceSettingsUpdate,
  ControlReadinessResponse,
  ControlServiceActionResult,
  ControlServiceInventory,
  ControlSettingsResponse,
  ControlUsbInventory,
  CurrentStateItem,
  InvestigationNote,
  InvestigationSearchResult,
  LteAction,
  LteActionResult,
  LteRuntimeState,
  LteSettings,
  LteSettingsUpdate,
  NetworkClient,
  PresenceCandidate,
  PresenceAlertCausalItem,
  PresenceChangeFeed,
  PresenceCoPresenceCluster,
  PresenceDossier,
  PresenceEntityDetail,
  PresenceEntityIntelligence,
  PresenceEntityInvestigation,
  PresenceEntityAnnotation,
  PresenceEnrichment,
  PresenceGraphMode,
  PresenceHistoryAudit,
  PresencePatternAnalytics,
  PresenceIdentityDecision,
  PresenceGraphTimelineItem,
  PresenceLinkGraph,
  PresencePlaybook,
  PresenceReplayFrame,
  RfBurstSwarm,
  SensorCoverageResponse,
  SensorTrustResponse,
  SiteAnchor,
  SiteSettingsUpdate,
  PresenceSighting,
  PresenceSummaryItem,
  PresenceWatchMode,
  PresenceWatchlistItem,
  RfMapFeature,
  SpectrumOccupancyBucket,
  TdsEvent
} from "../domain/types";
import { backendBaseUrl, joinBackendUrl } from "./backendConfig";

export interface CollectionResponse<T> {
  items: T[];
  count: number;
  total_count?: number;
  category_counts?: Record<string, number>;
  category_live_counts?: Record<string, number>;
  source_counts?: Record<string, number>;
  site?: SiteAnchor;
}

export interface DashboardSummary {
  counts: {
    observations: number;
    events: number;
    current_state: number;
    unknown_events?: number;
    sensors?: number;
    zones?: number;
    collectors?: number;
    integrations?: number;
    rules?: number;
  };
  recent_events: unknown[];
}

export const RF_MAP_RENDER_LIMIT = 1000;

export async function fetchDashboardSummary(): Promise<DashboardSummary> {
  return fetchJson<DashboardSummary>("/v1/dashboard/summary");
}

export async function fetchRfMap(): Promise<CollectionResponse<RfMapFeature>> {
  return fetchJson<CollectionResponse<RfMapFeature>>(`/v1/map/rf?limit=${RF_MAP_RENDER_LIMIT}`);
}

export async function fetchLteRfMap(): Promise<CollectionResponse<RfMapFeature>> {
  return fetchJson<CollectionResponse<RfMapFeature>>(`/v1/map/rf?limit=${RF_MAP_RENDER_LIMIT}`);
}

export async function fetchAircraftMap(): Promise<CollectionResponse<AircraftMapFeature>> {
  return fetchJson<CollectionResponse<AircraftMapFeature>>("/v1/map/aircraft");
}

export async function fetchAirspaceLanes(): Promise<CollectionResponse<AirspaceLane>> {
  return fetchJson<CollectionResponse<AirspaceLane>>("/v1/presence/airspace/lanes?limit=20");
}

export async function fetchSpectrumOccupancy(): Promise<CollectionResponse<SpectrumOccupancyBucket>> {
  return fetchJson<CollectionResponse<SpectrumOccupancyBucket>>("/v1/presence/spectrum/occupancy?limit=40");
}

export async function fetchRfBurstSwarms(): Promise<CollectionResponse<RfBurstSwarm>> {
  return fetchJson<CollectionResponse<RfBurstSwarm>>("/v1/presence/rf-bursts?window_seconds=120&minimum_entities=5&limit=12");
}

export async function fetchChangeBriefing(): Promise<ChangeBriefing> {
  return fetchJson<ChangeBriefing>("/v1/presence/briefing/changes?window_seconds=300");
}

export async function fetchPresenceChangeFeed(): Promise<PresenceChangeFeed> {
  return fetchJson<PresenceChangeFeed>("/v1/presence/changes/feed?window_seconds=300&limit=50");
}

export async function fetchPresenceHistoryAudit(): Promise<PresenceHistoryAudit> {
  return fetchJson<PresenceHistoryAudit>("/v1/presence/history/audit");
}

export async function fetchPresencePatternAnalytics(): Promise<PresencePatternAnalytics> {
  return fetchJson<PresencePatternAnalytics>("/v1/presence/patterns/analytics?limit=50");
}

export async function fetchSensorCoverage(): Promise<SensorCoverageResponse> {
  return fetchJson<SensorCoverageResponse>("/v1/presence/sensor-coverage?limit=100");
}

export async function fetchSensorTrust(): Promise<SensorTrustResponse> {
  return fetchJson<SensorTrustResponse>("/v1/presence/sensor-trust?limit=100");
}

export async function fetchEvents(limit = 100): Promise<CollectionResponse<TdsEvent>> {
  return fetchJson<CollectionResponse<TdsEvent>>(`/v1/events?limit=${limit}`);
}

export async function fetchControlUsb(): Promise<ControlUsbInventory> {
  return fetchJson<ControlUsbInventory>("/v1/control/usb");
}

export async function fetchControlHealth(): Promise<ControlHealth> {
  return fetchJson<ControlHealth>("/v1/control/health");
}

export async function fetchControlServices(): Promise<ControlServiceInventory> {
  return fetchJson<ControlServiceInventory>("/v1/control/services");
}

export async function fetchControlSettings(): Promise<ControlSettingsResponse> {
  return fetchJson<ControlSettingsResponse>("/v1/control/settings");
}

export async function fetchControlReadiness(): Promise<ControlReadinessResponse> {
  return fetchJson<ControlReadinessResponse>("/v1/control/readiness");
}

export async function fetchControlSite(): Promise<SiteAnchor> {
  return fetchJson<SiteAnchor>("/v1/control/site");
}

export async function saveControlCollectorSettings(collectorId: string, settings: ControlCollectorSettingsUpdate): Promise<ControlSettingsResponse> {
  return fetchJson<ControlSettingsResponse>(`/v1/control/settings/collectors/${encodeURIComponent(collectorId)}`, {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function saveControlDeviceSettings(stableId: string, settings: ControlDeviceSettingsUpdate): Promise<ControlSettingsResponse> {
  return fetchJson<ControlSettingsResponse>(`/v1/control/settings/devices/${encodeURIComponent(stableId)}`, {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function saveControlSite(settings: SiteSettingsUpdate): Promise<SiteAnchor> {
  return fetchJson<SiteAnchor>("/v1/control/site", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function runControlServiceAction(collectorId: string, action: string): Promise<ControlServiceActionResult> {
  return fetchJson<ControlServiceActionResult>(`/v1/control/services/${encodeURIComponent(collectorId)}/actions`, {
    method: "POST",
    body: JSON.stringify({ action })
  });
}

export async function fetchUnifiAlarmEvents(): Promise<CollectionResponse<TdsEvent>> {
  return fetchJson<CollectionResponse<TdsEvent>>("/v1/events?type=unifi_alarm&limit=50");
}

export async function fetchOpenWrtAlarmEvents(): Promise<CollectionResponse<TdsEvent>> {
  return fetchJson<CollectionResponse<TdsEvent>>("/v1/events?type=openwrt_alarm&limit=50");
}

export async function fetchCurrentState(source: string | null = null, limit = 100): Promise<CollectionResponse<CurrentStateItem>> {
  const sourceQuery = source ? `source=${encodeURIComponent(source)}&` : "";
  return fetchJson<CollectionResponse<CurrentStateItem>>(`/v1/state?${sourceQuery}limit=${limit}`);
}

export async function fetchLteState(): Promise<CollectionResponse<CurrentStateItem>> {
  return fetchJson<CollectionResponse<CurrentStateItem>>("/v1/state?source=ltesniffer&limit=20");
}

export async function fetchLteSettings(): Promise<LteSettings> {
  return fetchJson<LteSettings>("/v1/lte/settings");
}

export async function fetchLteRuntime(): Promise<LteRuntimeState> {
  return fetchJson<LteRuntimeState>("/v1/lte/runtime");
}

export async function saveLteSettings(settings: LteSettingsUpdate): Promise<LteSettings> {
  return fetchJson<LteSettings>("/v1/lte/settings", {
    method: "PUT",
    body: JSON.stringify(settings)
  });
}

export async function runLteAction(action: LteAction): Promise<LteActionResult> {
  return fetchJson<LteActionResult>("/v1/lte/actions", {
    method: "POST",
    body: JSON.stringify({ action })
  });
}

export async function fetchNetworkClients(): Promise<CollectionResponse<NetworkClient>> {
  return fetchJson<CollectionResponse<NetworkClient>>("/v1/network/clients");
}

export async function fetchCollectors(): Promise<CollectionResponse<unknown>> {
  return fetchJson<CollectionResponse<unknown>>("/v1/collectors");
}

export async function fetchZones(): Promise<CollectionResponse<unknown>> {
  return fetchJson<CollectionResponse<unknown>>("/v1/zones");
}

export async function fetchSensors(): Promise<CollectionResponse<unknown>> {
  return fetchJson<CollectionResponse<unknown>>("/v1/sensors");
}

export async function fetchIntegrations(): Promise<CollectionResponse<unknown>> {
  return fetchJson<CollectionResponse<unknown>>("/v1/integrations");
}

export async function fetchRules(): Promise<CollectionResponse<unknown>> {
  return fetchJson<CollectionResponse<unknown>>("/v1/rules");
}

export type PresenceCandidateScope = "trackable" | "all";

export async function fetchPresenceCandidates(
  limit = 500,
  scope: PresenceCandidateScope = "trackable",
  watchMode: string | null = null
): Promise<CollectionResponse<PresenceCandidate>> {
  const watchModeQuery = watchMode ? `&watch_mode=${encodeURIComponent(watchMode)}` : "";
  return fetchJson<CollectionResponse<PresenceCandidate>>(`/v1/presence/candidates?scope=${scope}&limit=${limit}${watchModeQuery}`);
}

export async function fetchPresenceWatchlist(): Promise<CollectionResponse<PresenceWatchlistItem>> {
  return fetchJson<CollectionResponse<PresenceWatchlistItem>>("/v1/presence/watchlist");
}

export async function fetchPresenceWatchModes(): Promise<CollectionResponse<PresenceWatchMode>> {
  return fetchJson<CollectionResponse<PresenceWatchMode>>("/v1/presence/watch-modes");
}

export async function fetchPresencePlaybooks(): Promise<CollectionResponse<PresencePlaybook>> {
  return fetchJson<CollectionResponse<PresencePlaybook>>("/v1/presence/playbooks");
}

export async function runPresencePlaybook(playbookId: string, payload: { entity_key?: string; sensor_id?: string; note?: string }): Promise<TdsEvent> {
  return fetchJson<TdsEvent>(`/v1/presence/playbooks/${encodeURIComponent(playbookId)}/runs`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchPresenceSummary(): Promise<CollectionResponse<PresenceSummaryItem>> {
  return fetchJson<CollectionResponse<PresenceSummaryItem>>("/v1/presence/summary");
}


export async function createPresenceIdentityDecision(payload: {
  entity_key: string;
  target_entity_key?: string | null;
  action: "confirm" | "reject" | "split" | "label" | "ignore" | "watch";
  canonical_key?: string | null;
  label?: string | null;
  reason?: string | null;
}): Promise<PresenceIdentityDecision> {
  return fetchJson<PresenceIdentityDecision>("/v1/presence/identity-decisions", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function fetchPresenceLinkGraph(mode: PresenceGraphMode = "all", watchMode: string | null = null): Promise<PresenceLinkGraph> {
  const watchModeQuery = watchMode ? `&watch_mode=${encodeURIComponent(watchMode)}` : "";
  return fetchJson<PresenceLinkGraph>(`/v1/presence/graph?mode=${encodeURIComponent(mode)}&limit=200${watchModeQuery}`);
}

export async function fetchLteGraph(): Promise<PresenceLinkGraph> {
  return fetchJson<PresenceLinkGraph>("/v1/presence/graph?mode=cellular&limit=200&watch_mode=cellular");
}

export async function fetchPresenceGraphTimeline(entityKey: string, limit = 100): Promise<CollectionResponse<PresenceGraphTimelineItem>> {
  return fetchJson<CollectionResponse<PresenceGraphTimelineItem>>(
    `/v1/presence/graph/timeline?entity_key=${encodeURIComponent(entityKey)}&limit=${limit}`
  );
}

export async function fetchPresenceAlertCausalGraph(): Promise<CollectionResponse<PresenceAlertCausalItem>> {
  return fetchJson<CollectionResponse<PresenceAlertCausalItem>>("/v1/presence/graph/causal-alerts?window_seconds=300&limit=50");
}

export async function searchInvestigation(query: string): Promise<CollectionResponse<InvestigationSearchResult>> {
  return fetchJson<CollectionResponse<InvestigationSearchResult>>(`/v1/presence/search?q=${encodeURIComponent(query)}&limit=25`);
}

export async function fetchPresenceCoPresence(): Promise<CollectionResponse<PresenceCoPresenceCluster>> {
  return fetchJson<CollectionResponse<PresenceCoPresenceCluster>>("/v1/presence/co-presence?window_minutes=5&limit=20");
}

export async function fetchPresenceSightings(watchlistId: string, limit = 200): Promise<CollectionResponse<PresenceSighting>> {
  return fetchJson<CollectionResponse<PresenceSighting>>(
    `/v1/presence/sightings?watchlist_id=${encodeURIComponent(watchlistId)}&limit=${limit}`
  );
}

export async function fetchPresenceReplayFrames(entityKey: string, limit = 200): Promise<CollectionResponse<PresenceReplayFrame>> {
  return fetchJson<CollectionResponse<PresenceReplayFrame>>(
    `/v1/presence/entities/${encodeURIComponent(entityKey)}/replay?limit=${limit}`
  );
}

export async function fetchInvestigationNotes(entityKey: string, limit = 100): Promise<CollectionResponse<InvestigationNote>> {
  return fetchJson<CollectionResponse<InvestigationNote>>(
    `/v1/presence/cases/notes?entity_key=${encodeURIComponent(entityKey)}&limit=${limit}`
  );
}

export async function createInvestigationNote(entityKey: string, note: string, disposition = "note"): Promise<InvestigationNote> {
  return fetchJson<InvestigationNote>("/v1/presence/cases/notes", {
    method: "POST",
    body: JSON.stringify({ entity_key: entityKey, note, disposition })
  });
}

export async function fetchPresenceDossier(entityKey: string): Promise<PresenceDossier> {
  return fetchJson<PresenceDossier>(`/v1/presence/entities/${encodeURIComponent(entityKey)}/dossier`);
}


export async function fetchPresenceEntityIntelligence(entityKey: string): Promise<PresenceEntityIntelligence> {
  return fetchJson<PresenceEntityIntelligence>(`/v1/presence/entities/${encodeURIComponent(entityKey)}/intelligence`);
}

export async function fetchPresenceEntityInvestigation(entityKey: string): Promise<PresenceEntityInvestigation> {
  return fetchJson<PresenceEntityInvestigation>(`/v1/presence/entities/${encodeURIComponent(entityKey)}/investigation`);
}


export async function createPresenceEntityAnnotation(entityKey: string, payload: { note?: string; label?: string; disposition?: string }): Promise<PresenceEntityAnnotation> {
  return fetchJson<PresenceEntityAnnotation>(`/v1/presence/entities/${encodeURIComponent(entityKey)}/annotations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}


export async function fetchPresenceEntityDetail(entityKey: string): Promise<PresenceEntityDetail> {
  return fetchJson<PresenceEntityDetail>(`/v1/presence/entities/${encodeURIComponent(entityKey)}`);
}

export async function runPresenceEnrichment(entityKey: string): Promise<PresenceEnrichment> {
  return fetchJson<PresenceEnrichment>(`/v1/presence/entities/${encodeURIComponent(entityKey)}/enrichment`, {
    method: "POST"
  });
}

export async function trackPresenceEntity(entityKey: string): Promise<PresenceWatchlistItem> {
  return fetchJson<PresenceWatchlistItem>("/v1/presence/watchlist", {
    method: "POST",
    body: JSON.stringify({ entity_key: entityKey })
  });
}

export async function untrackPresenceEntity(watchlistId: string): Promise<void> {
  const response = await fetch(apiUrl(`/v1/presence/watchlist/${encodeURIComponent(watchlistId)}`), {
    method: "DELETE",
    headers: {
      accept: "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`TDS API request failed: /v1/presence/watchlist/${watchlistId} returned ${response.status}`);
  }
}

async function fetchJson<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(endpoint), {
    ...init,
    headers: {
      accept: "application/json",
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers
    }
  });

  if (!response.ok) {
    const detail = await readApiErrorDetail(response);
    throw new Error(`TDS API request failed: ${endpoint} returned ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return (await response.json()) as T;
}

function formatApiErrorDetail(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const detail = "detail" in payload ? (payload as { detail?: unknown }).detail : undefined;
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (item && typeof item === "object" && "msg" in item) {
          const msg = (item as { msg?: unknown }).msg;
          return typeof msg === "string" ? msg.replace(/^Value error,\s*/i, "") : null;
        }
        return typeof item === "string" ? item : null;
      })
      .filter((message): message is string => Boolean(message));
    return messages.length > 0 ? messages.join("; ") : null;
  }

  if (detail && typeof detail === "object" && "msg" in detail) {
    const msg = (detail as { msg?: unknown }).msg;
    return typeof msg === "string" ? msg.replace(/^Value error,\s*/i, "") : null;
  }

  for (const key of ["message", "error"]) {
    const value = key in payload ? (payload as Record<string, unknown>)[key] : undefined;
    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

async function readApiErrorDetail(response: Response): Promise<string | null> {
  try {
    return formatApiErrorDetail(await response.json());
  } catch {
    return null;
  }
}

export function apiUrl(endpoint: string): string {
  return joinBackendUrl(backendBaseUrl().baseUrl, endpoint);
}
