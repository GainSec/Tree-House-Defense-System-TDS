export type LocationAccuracy = "real" | "estimated" | "receiver";
export type RfFreshness = "live" | "stale" | "expired";
export type RfMapCategory = "wifi" | "ble" | "utility" | "unknown_rf" | "infrastructure" | "aircraft" | "rail" | "iot" | "cellular";

export interface SiteAnchor {
  latitude: number;
  longitude: number;
  label: string;
  floor_heading_degrees?: number;
  source?: "defaults" | "saved" | string;
}

export interface ControlUsbDevice {
  vendor_id: string;
  product_id: string;
  manufacturer: string;
  product: string;
  serial: string;
  bus_path: string;
  speed: string;
  driver: string;
  stable_id: string;
  family: string;
}

export interface ControlUsbInventory {
  devices: ControlUsbDevice[];
}

export interface ControlHealth {
  status: string;
}

export interface ControlCollectorService {
  id: string;
  label: string;
  service_name: string;
  device_families: string[];
  roles: string[];
  start_mode: "timer" | "continuous" | "one_shot" | "manual" | string;
  settings_schema: Record<string, Record<string, unknown>>;
}

export interface ControlServiceInventory {
  services: ControlCollectorService[];
}

export interface ControlCollectorSettings {
  enabled: boolean;
  values: Record<string, unknown>;
  source: "defaults" | "saved" | string;
}

export interface ControlDeviceSettings {
  alias: string | null;
  family_override: string | null;
  enabled: boolean;
  collector_ids: string[];
  source: "defaults" | "saved" | string;
}

export interface ControlSettingsResponse {
  collectors: Record<string, ControlCollectorSettings>;
  devices: Record<string, ControlDeviceSettings>;
  site: SiteAnchor;
  source: "defaults" | "saved" | string;
  apply_note: string;
}

export interface ControlReadinessCheck {
  id: string;
  label: string;
  status: "ready" | "warn" | "missing" | string;
  detail: string;
  action?: string;
}

export interface ControlReadinessResponse {
  overall: "ready" | "warn" | "missing" | string;
  generated_at: string;
  checks: ControlReadinessCheck[];
}

export type ControlCollectorSettingsUpdate = Omit<ControlCollectorSettings, "source">;
export type ControlDeviceSettingsUpdate = Omit<ControlDeviceSettings, "source">;
export type SiteSettingsUpdate = Pick<SiteAnchor, "latitude" | "longitude" | "label" | "floor_heading_degrees">;

export interface ControlServiceActionResult {
  collector_id: string;
  service_name?: string;
  action: string;
  status: "ok" | "accepted" | "error" | string;
  message: string;
}

export interface CoordinateInput {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface LocalMeters {
  x: number;
  z: number;
}

export interface RfMapFeature {
  identity: string;
  label: string;
  protocol: string;
  kind: string;
  source: string;
  category: RfMapCategory;
  latitude: number;
  longitude: number;
  location_accuracy: LocationAccuracy;
  estimated: boolean;
  rssi: number | null;
  channel: string | null;
  frequency: string | null;
  manufacturer: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  count: number;
  freshness: RfFreshness;
  operator_context?: {
    headline?: string | null;
    chips?: Array<{ label: string; tone: string }>;
  } | null;
  /** Current-state key; presence dossier/enrichment routes are keyed by this (identity may be an identity_hint). */
  state_key?: string | null;
}

export interface AircraftMapFeature {
  identity: string;
  callsign: string;
  model: string;
  owner: string;
  icao_type: string;
  registration: string;
  country: string;
  squawk: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  heading: number;
  source: string;
  protocol: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
  count: number;
}

export interface AirspaceLane {
  id: string;
  label: string;
  heading_bucket: number;
  altitude_band: string;
  aircraft_count: number;
  seen_count: number;
  latest_seen_at: string | null;
  callsigns: string[];
}

export interface SpectrumOccupancyBucket {
  id: string;
  frequency_band: string;
  frequency_start: number;
  frequency_end: number;
  peak_count: number;
  seen_count: number;
  strongest_rssi: number | null;
  latest_seen_at: string | null;
}

export interface RfBurstSwarm {
  id: string;
  label: string;
  source: string;
  protocol: string;
  category: RfMapCategory;
  entity_count: number;
  seen_count: number;
  strongest_rssi: number | null;
  latest_seen_at: string | null;
  sample_labels: string[];
  severity: "info" | "warning" | "critical" | string;
  window_seconds: number;
}

export interface ChangeBriefing {
  window_seconds: number;
  severity: "info" | "warning" | "critical" | string;
  summary: string;
  new_entities: number;
  recent_events: number;
  departed_tracked: number;
  top_sources: Array<{
    source: string;
    count: number;
  }>;
  items: Array<{
    type: string;
    label: string;
    severity: string;
  }>;
}

export interface SensorCoverageItem {
  id: string;
  label: string;
  sensor_id: string;
  zone_id: string;
  source: string;
  status: "live" | "stale" | "historical" | string;
  entity_count: number;
  live_entities: number;
  latest_seen_at: string | null;
  category_counts: Record<string, number>;
  coverage_score: number;
}

export interface SensorCoverageResponse {
  items: SensorCoverageItem[];
  count: number;
  live_sensors: number;
  blind_spots: Array<{
    sensor_id: string;
    zone_id: string;
    source: string;
    status: string;
  }>;
}

export interface SensorTrustItem {
  id: string;
  label: string;
  sensor_id: string;
  zone_id: string | null;
  source: string;
  entity_count: number;
  observation_count: number;
  sample_count: number;
  alert_count: number;
  latest_seen_at: string | null;
  freshness: string;
  trust_score: number;
  status: "trusted" | "degraded" | "weak" | string;
  signals: string[];
}

export interface SensorTrustResponse {
  items: SensorTrustItem[];
  count: number;
  trusted_sensors: number;
  weak_sensors: number;
  operator_read: string;
}

export interface TdsEvent {
  id: string;
  type: string;
  severity: string;
  confidence: number;
  zone_id: string | null;
  summary: string;
  observation_refs: string[];
  payload: Record<string, unknown>;
  created_at: string | null;
}

export interface CurrentStateItem {
  state_key: string;
  source: string;
  kind: string;
  protocol: string;
  identity_hint: string | null;
  sensor_id: string | null;
  zone_id: string | null;
  seen_count: number;
  metadata: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface LteSettings {
  id: string;
  enabled: boolean;
  profile: "band48_cbrs_tdd" | "custom";
  mode: "probe" | "downlink" | "uplink" | "both";
  decode_channel: string;
  dl_freq_hz: number | null;
  ul_freq_hz: number | null;
  dl_freq_min_hz: number | null;
  dl_freq_max_hz: number | null;
  ul_freq_min_hz: number | null;
  ul_freq_max_hz: number | null;
  cell_id: number | null;
  prb: number | null;
  api_mode: number | null;
  antennas: number;
  workers: number;
  run_seconds: number;
  uhd_args: string;
  workdir: string;
  unmask_identities: boolean;
  suppress_stderr: boolean;
  warnings: string[];
  source: "defaults" | "saved";
  apply_note: string;
}

export type LteSettingsUpdate = Omit<LteSettings, "id" | "decode_channel" | "warnings" | "source" | "apply_note">;

export type LteAction = "probe" | "scan_ranges" | "start_live" | "restart_live" | "stop_live";

export interface LteActionResult {
  collector_id: string;
  service_name?: string;
  action: string;
  status: "ok" | "accepted" | "error" | string;
  message: string;
}

export interface LteRuntimeState {
  status: "idle" | "starting" | "running" | "timeout" | "complete" | "error" | "unreadable" | string;
  active: boolean;
  mode?: string;
  command?: string[];
  command_text?: string;
  started_at?: string;
  updated_at?: string;
  run_seconds?: number;
  elapsed_seconds?: number;
  age_seconds?: number;
  return_code?: number | null;
  workdir?: string;
  path?: string;
  error?: string;
  summary?: Record<string, unknown>;
  raw_output_tail?: string;
}

export interface NetworkClientEvidence {
  source: string;
  state_key: string;
  kind: string;
  alias: string | null;
  hostname: string | null;
  ip_address: string | null;
  network: string | null;
  connection_type: string | null;
  access_point: string | null;
  last_seen_at: string | null;
}

export interface NetworkClient {
  mac_address: string;
  alias: string | null;
  hostname: string | null;
  primary_ip: string | null;
  aliases: string[];
  hostnames: string[];
  ip_addresses: string[];
  sources: string[];
  network: string | null;
  connection_type: string | null;
  access_point: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  evidence: NetworkClientEvidence[];
}

export interface PresenceCandidate {
  entity_key: string;
  entity_type: string;
  category: string;
  trackable: boolean;
  source: string;
  protocol: string;
  kind: string;
  identity_hint: string | null;
  label: string;
  rssi: number | null;
  sensor_id: string | null;
  zone_id: string | null;
  seen_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  tracked: boolean;
  metadata: Record<string, unknown>;
}

export interface PresenceWatchlistItem {
  id: string;
  entity_key: string;
  entity_type: string;
  source: string;
  protocol: string;
  kind: string;
  identity_hint: string | null;
  label: string;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface PresenceWatchMode {
  id: string;
  label: string;
  description: string;
  categories: string[];
  severity_floor: string;
}

export interface PresencePlaybook {
  id: string;
  label: string;
  description: string;
  trigger: string;
  severity: string;
  inputs: string[];
}

export interface PresenceSighting {
  id: string;
  watchlist_id: string;
  entity_key: string;
  timestamp: string | null;
  source: string;
  protocol: string;
  kind: string;
  identity_hint: string | null;
  sensor_id: string | null;
  zone_id: string | null;
  rssi: number | null;
  evidence: Record<string, unknown>;
  raw_payload: Record<string, unknown>;
  created_at: string | null;
}

export interface PresenceReplayFrame {
  frame: number;
  timestamp: string | null;
  source: string;
  protocol: string;
  kind: string;
  sensor_id: string | null;
  zone_id: string | null;
  rssi: number | null;
  label: string;
}

export interface InvestigationNote {
  id: string;
  entity_key: string;
  note: string;
  disposition: string;
  created_at: string | null;
}


export interface PresenceIdentityDecision {
  id: string;
  entity_key: string;
  target_entity_key: string | null;
  action: string;
  decision_state: string;
  canonical_key: string | null;
  label: string | null;
  reason: string | null;
  created_at: string | null;
}

export interface PresenceDecisionSummary {
  confirmed: number;
  rejected: number;
  split: number;
  labeled: number;
  ignored: number;
  watching: number;
  total: number;
  labels: string[];
  latest: PresenceIdentityDecision | null;
}

export type PresenceGraphMode = "presence" | "rf" | "airspace" | "rail" | "iot" | "cellular" | "alerts" | "all";

export interface PresenceGraphNode {
  id: string;
  type: string;
  label: string;
  entity_key?: string;
  source?: string | null;
  protocol?: string | null;
  kind?: string | null;
  severity?: string;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  seen_count?: number;
  rssi?: number | null;
  confidence?: number | null;
  badges?: string[];
  position_hint?: {
    lane?: string;
    rank?: number;
  };
  summary?: string;
  aircraft_details?: AircraftDetails | null;
  rail_context?: {
    status: string;
    channel_label: string | null;
    frequency_mhz: number | null;
    operator_hint: string | null;
    route_hint: string | null;
    usage_hint: string | null;
    activity_type: string | null;
    confidence: number;
    operator_read: string;
    limits: string;
  } | null;
  rail_visuals?: {
    frequency_ladder: Array<{
      channel: string;
      frequency_mhz: number | null;
      role: "selected" | "nearby" | string;
    }>;
    confidence_strip: Array<{
      label: string;
      value: string;
      confidence: number;
      tone: string;
    }>;
    recent_activity: Array<{
      timestamp: string;
      rssi?: number | null;
      label: string;
      frequency_mhz: number | null;
      sensor_id?: string | null;
    }>;
    rhythm: {
      sample_count: number;
      recent_sample_count: number;
      cadence_label: string;
      peak_hour?: number | null;
      peak_hour_label?: string | null;
      operator_read: string;
    };
  } | null;
  iot_context?: {
    status: string;
    protocol_label: string;
    stack_hint: string | null;
    channel_label: string | null;
    channel_mhz: number | null;
    packet_direction: string | null;
    network_pan_id: string | null;
    short_address: string | null;
    device_role_hint: string | null;
    vendor_hint: string | null;
    confidence: number;
    operator_read: string;
    limits: string;
  } | null;
  cellular_context?: {
    status: string;
    decode_channel: string;
    dl_freq_hz: number | null;
    ul_freq_hz: number | null;
    dl_frequency_mhz: number | null;
    ul_frequency_mhz: number | null;
    cell_id: string | null;
    prb: number | null;
    api_mode?: number | null;
    api_output?: string | null;
    processed_subframes: number | null;
    rnti_count: number | null;
    snr_db: number | null;
    confidence: number;
    operator_read: string;
    limits: string;
  } | null;
  resolved_identity?: PresenceResolvedIdentity | null;
  operator_decisions?: PresenceDecisionSummary | null;
  operator_labels?: string[];
}

export interface AircraftDetails {
  hex?: string | null;
  flight?: string | null;
  registration?: string | null;
  aircraft_type?: string | null;
  operator?: string | null;
  callsign?: string | null;
  callsign_prefix?: string | null;
  flight_number?: string | null;
  airline?: string | null;
  aircraft_model?: string | null;
  aircraft_visual_class?: string | null;
  aircraft_photo_key?: string | null;
  aircraft_photo_label?: string | null;
  altitude_ft?: number | null;
  ground_speed_kt?: number | null;
  track_deg?: number | null;
  track_label?: string | null;
  vertical_rate_fpm?: number | null;
  squawk?: string | null;
  emergency?: string | null;
  lat?: number | null;
  lon?: number | null;
  category?: string | null;
  messages?: number | null;
  seen_pos_seconds?: number | null;
  metadata_matched?: boolean | null;
  metadata_source?: string | null;
  metadata_confidence?: number | null;
  metadata_provenance?: string | null;
  route_summary?: AircraftRouteSummary | null;
}

export interface AircraftRouteSummary {
  label?: string | null;
  heading_label?: string | null;
  altitude_band?: string | null;
  pass_direction?: string | null;
  altitude_trend?: string | null;
  confidence?: number | null;
}

export interface PresenceGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  weight: number;
  confidence?: number;
  latest_seen_at?: string | null;
  evidence_count?: number;
  explanation?: string;
  evidence?: Array<{
    label: string;
    timestamp?: string | null;
    source?: string | null;
    sensor_id?: string | null;
    rssi?: number | null;
  }>;
}


export interface PresencePatternAnalytics {
  summary: {
    tracked_entities: number;
    visible_tracked: number;
    learned_entities: number;
    alert_rules: number;
    sample_count: number;
  };
  rhythm: {
    sample_count: number;
    peak_hours: Array<{ hour: number; count: number }>;
    hotspots: Array<{ weekday: number; hour: number; count: number }>;
    hour_bins: Array<{ hour: number; count: number }>;
  };
  entities: Array<{
    entity_key: string;
    label: string;
    category: string | null;
    source: string;
    protocol: string;
    kind: string;
    rssi: number | null;
    last_seen_at: string | null;
    sample_count: number;
    pattern_status: string;
    typical_hour: number | null;
    peak_hours: Array<{ hour: number; count: number }>;
    hotspots: Array<{ weekday: number; hour: number; count: number }>;
    rule_state: { status: string; label: string; tone: string; freshness: string; chips?: Array<{ id: string; label: string; tone: string }> };
    operator_read: string;
  }>;
  alert_rules: Array<{
    id: string;
    type: string;
    severity: string;
    entity_key: string;
    label: string;
    timestamp: string | null;
    summary: string;
    operator_action: string;
  }>;
}

export interface PresenceHistoryAudit {
  status: string;
  stores: Record<string, { count: number; latest_at: string | null; append_only: boolean }>;
  sample_coverage: { state_count: number; sampled_state_keys: number; coverage_percent: number };
  gaps: string[];
}

export interface PresenceChangeFeedItem {
  id: string;
  type: string;
  severity: string;
  timestamp: string | null;
  entity_key: string | null;
  label: string;
  summary: string;
  source: string | null;
  sensor_id: string | null;
  rssi: number | null;
}

export interface PresenceChangeFeed {
  items: PresenceChangeFeedItem[];
  count: number;
  window_seconds: number;
  poll_after_seconds: number;
}

export interface PresenceGraphInsights {
  map_read: string;
  top_relationships: Array<{
    edge_id: string;
    label: string;
    relationship: string;
    tone: string;
    summary: string;
    evidence_count: number;
    confidence?: number | null;
  }>;
  clusters: Array<{
    id: string;
    label: string;
    count: number;
    summary: string;
  }>;
}

export interface PresenceLinkGraph {
  nodes: PresenceGraphNode[];
  edges: PresenceGraphEdge[];
  insights?: PresenceGraphInsights;
}


export interface PresenceEntityIntelligence {
  entity_key: string;
  summary: Partial<PresenceCandidate>;
  timeline: {
    items: PresenceGraphTimelineItem[];
    count: number;
    order: string;
  };
  confidence_drift?: {
    items: Array<{ timestamp: string | null; confidence: number; reason: string; rssi: number | null; source: string | null }>;
    count: number;
    latest: { timestamp: string | null; confidence: number; reason: string; rssi: number | null; source: string | null } | null;
  };
  identity_confidence_radar?: {
    overall_score: number;
    operator_read: string;
    axes: Array<{ id: string; label: string; score: number; evidence: string; tone: string }>;
  };
  presence_habit_calendar?: {
    sample_count: number;
    operator_read: string;
    cells: Array<{ weekday: number; weekday_label: string; hour: number; hour_label: string; count: number; intensity: number; label: string }>;
    peak_windows: Array<{ hour: number; label: string; count: number; share: number }>;
    deviations: Array<{ timestamp: string | null; weekday: number; hour: number; label: string; source: string | null; sensor_id: string | null; rssi: number | null }>;
  };
  life_story_timeline?: {
    items: Array<PresenceGraphTimelineItem & { lane: string; lane_label: string; tone: string }>;
    count: number;
    order: string;
    lanes: Array<{ id: string; label: string; tone: string; count: number }>;
    operator_read: string;
  };
  evidence_provenance_ribbon?: {
    stages: Array<{ id: string; label: string; count: number; status: string; tone: string; order: number; description: string }>;
    complete_count: number;
    total_count: number;
    weakest_stage: { id: string; label: string; count: number; status: string; tone: string; order: number; description: string };
    operator_read: string;
  };
}

export interface PresenceOperatorSection {
  id: string;
  label: string;
  tone: string;
  value: string;
  summary: string;
  count: number;
}

export interface PresenceEntityInvestigation {
  entity_key: string;
  summary: PresenceEntityDetail["summary"];
  operator_sections: PresenceOperatorSection[];
  detail: PresenceEntityDetail;
  intelligence: PresenceEntityIntelligence;
}

export interface PresenceEntityAnnotation {
  entity_key: string;
  note: InvestigationNote | null;
  label_decision: PresenceIdentityDecision | null;
  notes: { items: InvestigationNote[]; count: number };
  decision_state: PresenceDecisionSummary;
}


export interface PresenceGraphTimelineItem {
  id: string;
  type: string;
  label: string;
  timestamp: string | null;
  severity: string;
  source: string | null;
  sensor_id: string | null;
  rssi: number | null;
  summary: string;
}

export interface InvestigationSearchResult {
  type: string;
  label: string;
  entity_key?: string;
  event_id?: string;
  subtitle?: string;
  source?: string | null;
  severity?: string | null;
  timestamp?: string | null;
  score?: number;
  matches?: Array<{
    field: string;
    value: string;
  }>;
}

export interface PresenceAlertCausalItem {
  id: string;
  relationship: string;
  confidence: number;
  explanation: string;
  matched_fields: Array<{
    field: string;
    value: string;
  }>;
  event: {
    id: string;
    type: string;
    severity: string;
    summary: string;
    created_at: string | null;
  };
  entity: {
    entity_key: string;
    label: string;
    source: string;
    protocol: string;
    kind: string;
    identity_hint: string | null;
    last_seen_at: string | null;
    rssi: number | null;
  };
  timeline: {
    window_seconds: number;
    before_count: number;
    after_count: number;
    nearest_before: PresenceAlertCausalSighting | null;
    nearest_after: PresenceAlertCausalSighting | null;
  };
}

export interface PresenceAlertCausalSighting {
  id: string;
  timestamp: string | null;
  source: string;
  sensor_id: string | null;
  rssi: number | null;
}

export interface PresenceSummaryItem extends PresenceWatchlistItem {
  sighting_count: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_rssi: number | null;
  current_state: PresenceCandidate | null;
}

export interface PresenceCoPresenceCluster {
  id: string;
  entity_keys: string[];
  labels: string[];
  shared_window_count: number;
  latest_seen_at: string | null;
  window_minutes: number;
  shared_windows: Array<{
    bucket: number;
    seen_at: string | null;
    entity_keys: string[];
  }>;
}

export interface PresenceEvidenceRow {
  source: string;
  sensor_id: string | null;
  timestamp: string | null;
  type: string;
  freshness: string;
  fields: Record<string, unknown>;
  highlights?: Array<{
    key: string;
    label: string;
    value: string;
    tone: string;
  }>;
  provenance?: {
    source: string;
    sensor_id: string | null;
    type: string;
    freshness: string;
  };
  raw_payload: Record<string, unknown>;
}

export interface PresenceSourceConfidence {
  source: string;
  observations: number;
  latest_seen_at: string | null;
  freshness: string;
  confidence: number;
}

export interface PresenceResolvedIdentity {
  canonical_key: string;
  label: string;
  confidence: number;
  tier?: string;
  relationship_label?: string;
  sources: string[];
  entity_keys: string[];
  source_count: number;
  entity_count: number;
  operator_feedback?: PresenceDecisionSummary;
  identifiers: {
    macs: string[];
    ip_addresses: string[];
    hostnames: string[];
    aliases: string[];
    networks: string[];
  };
  evidence: Array<{
    type: string;
    value: string;
    sources: string[];
    entity_keys?: string[];
    confidence: number;
    explanation: string;
  }>;
}

export interface PresenceDossier {
  entity: PresenceCandidate;
  watchlist: PresenceWatchlistItem | null;
  identity: {
    primary: string;
    label: string;
    aliases: string[];
    confidence: number;
  };
  identity_resolution?: {
    status: string;
    label: string;
    confidence: number;
    mac: string | null;
    signals: string[];
  };
  resolved_identity?: PresenceResolvedIdentity;
  rf_fingerprint?: {
    confidence: number;
    label: string;
    anchors: string[];
    sample_count: number;
  };
  ble_profile?: {
    status: string;
    label: string;
    name: string | null;
    services: string[];
    manufacturer: string | null;
    model: string | null;
    manufacturer_data: string | null;
    signals: string[];
  } | null;
  wifi_roaming?: {
    status: string;
    label: string;
    network_names: string[];
    access_points: string[];
    hop_count: number;
    hops: Array<{
      timestamp: string | null;
      network: string | null;
      access_point: string | null;
      rssi: number | null;
    }>;
  } | null;
  rail_context?: {
    status: string;
    channel_label: string | null;
    frequency_mhz: number | null;
    operator_hint: string | null;
    route_hint: string | null;
    usage_hint: string | null;
    activity_type: string | null;
    confidence: number;
    operator_read: string;
    limits: string;
  } | null;
  iot_context?: {
    status: string;
    protocol_label: string;
    stack_hint: string | null;
    channel_label: string | null;
    channel_mhz: number | null;
    packet_direction: string | null;
    network_pan_id: string | null;
    short_address: string | null;
    device_role_hint: string | null;
    vendor_hint: string | null;
    confidence: number;
    operator_read: string;
    limits: string;
  } | null;
  enrichment?: {
    status: string;
    mode: string;
    targets: Array<{
      id: string;
      label: string;
      status: string;
    }>;
    findings?: PresenceEnrichmentFinding[];
    latest_run?: PresenceEnrichment | null;
  };
  scores: {
    interest: number;
    reliability: number;
  };
  reliability?: {
    score: number;
    label: string;
    freshness: string;
    sighting_count: number;
    current_seen_count: number;
    source_count: number;
    strengths: string[];
    gaps: string[];
  };
  reasons: string[];
  reason_chips?: Array<{
    id: string;
    label: string;
    tone: string;
    weight: number;
  }>;
  anomalies?: Array<{
    id: string;
    label: string;
    severity: string;
    tone: string;
  }>;
  rhythm?: {
    sample_count: number;
    peak_hours: Array<{ hour: number; count: number }>;
    hotspots: Array<{ weekday: number; hour: number; count: number }>;
  };
  commute_clock?: {
    status: string;
    typical_hour: number | null;
    sample_count: number;
    label: string;
  };
  next_seen?: {
    status: string;
    expected_hour: number | null;
    label: string;
  };
  sample_summary?: {
    sample_count: number;
    recent_sample_count: number;
    first_sample_at: string | null;
    last_sample_at: string | null;
    average_interval_seconds: number | null;
    cadence_label: string;
    latest_rssi: number | null;
    strongest_rssi: number | null;
    weakest_rssi: number | null;
    samples: Array<{
      timestamp: string | null;
      source: string;
      sensor_id: string | null;
      rssi: number | null;
    }>;
  };
  presence_rules?: {
    status: string;
    label: string;
    tone: string;
    freshness: string;
    last_seen_at: string | null;
    chips: Array<{
      id: string;
      label: string;
      tone: string;
    }>;
  };
  source_confidence: PresenceSourceConfidence[];
  evidence: PresenceEvidenceRow[];
  timeline: {
    first_seen_at: string | null;
    last_seen_at: string | null;
    sighting_count: number;
    current_seen_count: number;
  };
}

export interface PresenceEntityDetail {
  summary: {
    entity_key: string;
    label: string;
    category: string;
    source: string;
    protocol: string;
    kind: string;
    identity_hint: string | null;
    seen_count: number;
    first_seen_at: string | null;
    last_seen_at: string | null;
    rssi: number | null;
  };
  dossier: PresenceDossier;
  sightings: {
    items: PresenceSighting[];
    count: number;
  };
  notes: {
    items: InvestigationNote[];
    count: number;
  };
  timeline: {
    items: PresenceGraphTimelineItem[];
    count: number;
    order: string;
  };
  related_entities: Array<{
    entity_key: string;
    label: string;
    relationship: string;
    shared_window_count: number;
    latest_seen_at: string | null;
  }>;
  raw_payload_preview: Array<{
    field: string;
    value: string;
  }>;
}

export interface PresenceEnrichmentFinding {
  target_id: string;
  type: string;
  label: string;
  value: string;
  confidence: number;
  source: string;
  summary: string;
}

export interface PresenceEnrichment {
  id: string;
  entity_key: string;
  status: string;
  mode: string;
  summary: string;
  targets: Array<{
    id: string;
    label: string;
    status: string;
  }>;
  findings: PresenceEnrichmentFinding[];
  created_at: string;
}
