import { SITE_ANCHOR, accuracyRadiusMeters, altitudeFeetToSceneY, latLonToLocalMeters } from "../domain/geo";
import type { AircraftMapFeature, LocalMeters, LocationAccuracy, RfFreshness, RfMapCategory, RfMapFeature, SiteAnchor } from "../domain/types";

export type SceneEntityKind = "rf" | "aircraft";

export interface ScenePosition {
  x: number;
  y: number;
  z: number;
}

export interface SceneVisual {
  color: string;
  radius: number;
  opacity: number;
  pulseRate: number;
  distanceBand?: RfSignalDistanceBand;
  freshnessClass?: RfVisualFreshnessClass;
}

export type RfSignalDistanceBand = "near" | "mid" | "far" | "unknown";
export type RfVisualFreshnessClass = "live" | "ghost" | "expired";
export type RfCorrelationStrength = "single-source" | "multi-source";

export interface RfCorrelationArc {
  source: string;
  label: string;
  color: string;
}

export interface RfCorrelation {
  strength: RfCorrelationStrength;
  arcs: RfCorrelationArc[];
}

export interface RfSceneEntity {
  id: string;
  kind: "rf";
  identity: string;
  label: string;
  source: string;
  protocol: string;
  observedKind: string;
  category: RfMapCategory;
  latitude: number;
  longitude: number;
  freshness: RfFreshness;
  locationAccuracy: LocationAccuracy;
  uncertaintyRadius: number;
  localMeters: LocalMeters;
  displayDistanceMeters: number;
  position: ScenePosition;
  visual: SceneVisual;
  correlation?: RfCorrelation;
  rssi: number | null;
  channel: string | null;
  frequency: string | null;
  manufacturer: string | null;
  count: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  operatorContext?: RfMapFeature["operator_context"];
  /** Key for presence dossier/enrichment/entity pages (falls back to identity for older backends). */
  entityKey: string;
}

export interface AircraftSceneEntity {
  id: string;
  kind: "aircraft";
  identity: string;
  label: string;
  source: string;
  protocol: string;
  latitude: number;
  longitude: number;
  localMeters: LocalMeters;
  displayDistanceMeters: number;
  position: ScenePosition;
  visual: SceneVisual;
  altitude: number | null;
  speed: number | null;
  heading: number;
  model: string;
  owner: string;
  icaoType: string;
  registration: string;
  country: string;
  squawk: string;
  count: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface SceneModel {
  site: SiteAnchor;
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  counts: {
    rfTotal: number;
    aircraftTotal: number;
  };
}

export interface SceneModelInput {
  rf: RfMapFeature[];
  aircraft: AircraftMapFeature[];
  site?: SiteAnchor;
  maxRfEntities?: number;
  maxAircraftEntities?: number;
  now?: Date;
  aircraftVisibleSeconds?: number;
}

const CATEGORY_COLORS: Record<RfMapCategory, string> = {
  wifi: "#a78bfa",
  ble: "#38bdf8",
  utility: "#ffd166",
  unknown_rf: "#ff5c8a",
  infrastructure: "#e6f1ff",
  aircraft: "#ffb86b",
  rail: "#7dd3fc",
  iot: "#34d399",
  cellular: "#86efac"
};

const SOURCE_COLORS: Record<string, { label: string; color: string }> = {
  unifi: { label: "UniFi", color: "#22c55e" },
  openwrt: { label: "OpenWrt", color: "#f97316" },
  kismet: { label: "Kismet", color: "#22d3ee" },
  intercept: { label: "Intercept", color: "#f59e0b" },
  rail_rf: { label: "Rail", color: "#7dd3fc" },
  gps: { label: "GPS", color: "#a3e635" },
  adsb: { label: "ADS-B", color: "#ffb86b" }
};

const UNCOMPRESSED_DISPLAY_RADIUS = 52;
const MAX_DISPLAY_RADIUS = 52;
const DEFAULT_AIRCRAFT_VISIBLE_SECONDS = 10 * 60;
const DEFAULT_RF_RENDER_LIMIT = 320;

export function rfFeatureToSceneEntity(feature: RfMapFeature, site: SiteAnchor = SITE_ANCHOR): RfSceneEntity {
  const local = latLonToLocalMeters(feature, site);
  const displayDistanceMeters = Math.hypot(local.x, local.z);
  const display = rfDisplayPosition(feature, local, displayDistanceMeters);
  const signalVolume = signalVolumeOffset(feature, displayDistanceMeters);
  const horizontalPosition = limitHorizontalRadius({
    x: display.x + signalVolume.x,
    z: display.z + signalVolume.z
  });
  return {
    id: `rf:${feature.identity}`,
    kind: "rf",
    identity: feature.identity,
    label: feature.label || feature.identity,
    source: feature.source,
    protocol: feature.protocol,
    observedKind: feature.kind,
    category: feature.category,
    latitude: feature.latitude,
    longitude: feature.longitude,
    freshness: feature.freshness,
    locationAccuracy: feature.location_accuracy,
    uncertaintyRadius: accuracyRadiusMeters(feature.location_accuracy),
    localMeters: local,
    displayDistanceMeters,
    position: {
      x: horizontalPosition.x,
      y: roundSceneMeters(rfEntityHeight(feature.category) + signalVolume.y),
      z: horizontalPosition.z
    },
    visual: {
      color: CATEGORY_COLORS[feature.category],
      radius: rfRadius(feature.rssi, feature.category),
      opacity: visualOpacity(feature),
      pulseRate: freshnessPulseRate(feature.freshness),
      distanceBand: rfSignalDistanceBand(feature.rssi),
      freshnessClass: rfVisualFreshnessClass(feature.freshness)
    },
    correlation: {
      strength: rfCorrelationArcs(feature).length >= 3 ? "multi-source" : "single-source",
      arcs: rfCorrelationArcs(feature)
    },
    rssi: feature.rssi,
    channel: feature.channel,
    frequency: feature.frequency,
    manufacturer: feature.manufacturer,
    count: feature.count,
    firstSeenAt: feature.first_seen_at,
    lastSeenAt: feature.last_seen_at,
    operatorContext: feature.operator_context,
    entityKey: feature.state_key || feature.identity
  };
}

export function aircraftFeatureToSceneEntity(feature: AircraftMapFeature, site: SiteAnchor = SITE_ANCHOR): AircraftSceneEntity {
  const local = latLonToLocalMeters(feature, site);
  const display = displayLocalPosition(local, 170);
  return {
    id: `aircraft:${feature.identity}`,
    kind: "aircraft",
    identity: feature.identity,
    label: feature.callsign || feature.identity,
    source: feature.source,
    protocol: feature.protocol,
    latitude: feature.latitude,
    longitude: feature.longitude,
    localMeters: local,
    displayDistanceMeters: Math.hypot(local.x, local.z),
    position: {
      x: display.x,
      y: altitudeFeetToSceneY(feature.altitude),
      z: display.z
    },
    visual: {
      color: "#ffb86b",
      radius: 2.6,
      opacity: 0.9,
      pulseRate: 0.7
    },
    altitude: feature.altitude,
    speed: feature.speed,
    heading: feature.heading,
    model: feature.model,
    owner: feature.owner,
    icaoType: feature.icao_type,
    registration: feature.registration,
    country: feature.country,
    squawk: feature.squawk,
    count: feature.count,
    firstSeenAt: feature.first_seen_at,
    lastSeenAt: feature.last_seen_at
  };
}

export function displayLocalPosition(local: LocalMeters, maxRadius = MAX_DISPLAY_RADIUS): LocalMeters {
  const distance = Math.hypot(local.x, local.z);
  if (distance <= UNCOMPRESSED_DISPLAY_RADIUS || distance === 0) {
    return local;
  }

  const displayDistance = maxRadius * (1 - Math.exp(-distance / maxRadius));
  const scale = Math.min(maxRadius, displayDistance) / distance;

  return {
    x: roundSceneMeters(local.x * scale),
    z: roundSceneMeters(local.z * scale)
  };
}

function rfDisplayPosition(feature: RfMapFeature, local: LocalMeters, displayDistanceMeters: number): LocalMeters {
  if (feature.category === "infrastructure") {
    return displayLocalPosition(local);
  }

  if (isUnknownSignal(feature.rssi)) {
    return unknownSignalScatterPosition(feature);
  }

  if (feature.location_accuracy === "real" && displayDistanceMeters <= UNCOMPRESSED_DISPLAY_RADIUS) {
    return local;
  }

  const bearing = displayDistanceMeters > 0.5 ? Math.atan2(local.x, local.z) : hashedBearing(feature.identity);
  const radius = rssiDisplayRadius(feature.rssi);
  return {
    x: roundSceneMeters(Math.sin(bearing) * radius),
    z: roundSceneMeters(Math.cos(bearing) * radius)
  };
}

function rssiDisplayRadius(rssi: number | null): number {
  if (isUnknownSignal(rssi)) {
    return 34;
  }

  const knownRssi = rssi as number;
  const normalizedStrength = Math.max(0, Math.min(1, (knownRssi + 95) / 75));
  const weakness = 1 - normalizedStrength;
  return roundSceneMeters(4 + Math.pow(weakness, 1.35) * 48);
}

function unknownSignalScatterPosition(feature: RfMapFeature): LocalMeters {
  const seed = hashString(`${feature.category}:${feature.source}:${feature.identity}`);
  const angle = ((seed % 360) * Math.PI) / 180;
  const categoryOffset = feature.category === "ble" ? -3 : feature.category === "utility" ? 4 : feature.category === "unknown_rf" ? 8 : 0;
  const radius = Math.max(9, Math.min(44, 14 + categoryOffset + ((seed >>> 8) % 2200) / 100));
  return {
    x: roundSceneMeters(Math.sin(angle) * radius),
    z: roundSceneMeters(Math.cos(angle) * radius)
  };
}

function isUnknownSignal(rssi: number | null): boolean {
  return typeof rssi !== "number" || !Number.isFinite(rssi) || rssi === 0;
}

export function rfSignalDistanceBand(rssi: number | null): RfSignalDistanceBand {
  if (isUnknownSignal(rssi)) {
    return "unknown";
  }
  const knownRssi = rssi as number;
  if (knownRssi >= -55) {
    return "near";
  }
  if (knownRssi >= -76) {
    return "mid";
  }
  return "far";
}

export function rfCorrelationArcs(feature: Pick<RfMapFeature, "category" | "protocol" | "source">): RfCorrelationArc[] {
  const arcs = [categoryCorrelationArc(feature.category, feature.protocol)];
  for (const source of sourceTokens(feature.source)) {
    const sourceTone = SOURCE_COLORS[source] ?? { label: source.toUpperCase(), color: "#e6f1ff" };
    arcs.push({ source, label: sourceTone.label, color: sourceTone.color });
  }
  return uniqueCorrelationArcs(arcs);
}

export function prioritizeRfEntities(entities: RfSceneEntity[], limit: number): RfSceneEntity[] {
  return [...entities]
    .sort((left, right) => rfPriority(right) - rfPriority(left))
    .slice(0, limit);
}

export function buildSceneModel({
  rf,
  aircraft,
  site = SITE_ANCHOR,
  maxRfEntities = DEFAULT_RF_RENDER_LIMIT,
  maxAircraftEntities = 100,
  now = new Date(),
  aircraftVisibleSeconds = DEFAULT_AIRCRAFT_VISIBLE_SECONDS
}: SceneModelInput): SceneModel {
  const rfEntities = prioritizeRfEntities(rf.map((feature) => rfFeatureToSceneEntity(feature, site)), maxRfEntities);
  const aircraftEntities = aircraft
    .filter((feature) => isRecentlySeenAircraft(feature, now, aircraftVisibleSeconds))
    .map((feature) => aircraftFeatureToSceneEntity(feature, site))
    .slice(0, maxAircraftEntities);

  return {
    site,
    rfEntities,
    aircraftEntities,
    counts: {
      rfTotal: rf.length,
      aircraftTotal: aircraft.length
    }
  };
}

export function isRecentlySeenAircraft(feature: AircraftMapFeature, now: Date, visibleSeconds = DEFAULT_AIRCRAFT_VISIBLE_SECONDS): boolean {
  if (!feature.last_seen_at) {
    return false;
  }

  const lastSeenAt = new Date(feature.last_seen_at);
  if (Number.isNaN(lastSeenAt.getTime())) {
    return false;
  }

  const ageMilliseconds = now.getTime() - lastSeenAt.getTime();
  return ageMilliseconds >= 0 && ageMilliseconds <= visibleSeconds * 1000;
}

function rfEntityHeight(category: RfMapCategory): number {
  if (category === "infrastructure") {
    return 2.8;
  }
  if (category === "unknown_rf" || category === "utility") {
    return 2.2;
  }
  return 1.8;
}

function rfRadius(rssi: number | null, category: RfMapCategory): number {
  const categoryBoost = category === "unknown_rf" ? 0.22 : category === "ble" ? -0.08 : 0;
  if (isUnknownSignal(rssi)) {
    return Math.max(0.28, 0.36 + categoryBoost * 0.5);
  }
  const knownRssi = rssi as number;
  const normalizedStrength = Math.max(0, Math.min(80, knownRssi + 100)) / 80;
  return 0.38 + normalizedStrength * 0.54 + categoryBoost;
}

function freshnessOpacity(freshness: RfFreshness): number {
  if (freshness === "live") {
    return 0.94;
  }
  if (freshness === "stale") {
    return 0.42;
  }
  return 0.18;
}

function visualOpacity(feature: RfMapFeature): number {
  const baseOpacity = freshnessOpacity(feature.freshness);
  if (isUnknownSignal(feature.rssi) && feature.category !== "unknown_rf") {
    return Math.round(baseOpacity * 0.58 * 100) / 100;
  }
  return baseOpacity;
}

function freshnessPulseRate(freshness: RfFreshness): number {
  if (freshness === "live") {
    return 1.25;
  }
  if (freshness === "stale") {
    return 0.45;
  }
  return 0.12;
}

function rfVisualFreshnessClass(freshness: RfFreshness): RfVisualFreshnessClass {
  if (freshness === "live") {
    return "live";
  }
  if (freshness === "stale") {
    return "ghost";
  }
  return "expired";
}

function categoryCorrelationArc(category: RfMapCategory, protocol: string): RfCorrelationArc {
  switch (category) {
    case "wifi":
      return { source: "wifi", label: "Wi-Fi/client", color: CATEGORY_COLORS.wifi };
    case "ble":
      return { source: "ble", label: "BLE", color: CATEGORY_COLORS.ble };
    case "utility":
      return { source: "utility", label: "Utility", color: CATEGORY_COLORS.utility };
    case "unknown_rf":
      return { source: protocol || "unknown_rf", label: "Unknown RF", color: CATEGORY_COLORS.unknown_rf };
    case "infrastructure":
      return { source: "infrastructure", label: "Infrastructure", color: CATEGORY_COLORS.infrastructure };
    case "aircraft":
      return { source: "adsb", label: "ADS-B", color: CATEGORY_COLORS.aircraft };
    case "rail":
      return { source: "rail", label: "Rail RF", color: CATEGORY_COLORS.rail };
    case "iot":
      return { source: "iot", label: "Zigbee/Thread", color: CATEGORY_COLORS.iot };
    case "cellular":
      return { source: "cellular", label: "LTE/cellular", color: CATEGORY_COLORS.cellular };
  }
}

function sourceTokens(source: string): string[] {
  return source
    .split(/[,+|/]/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueCorrelationArcs(arcs: RfCorrelationArc[]): RfCorrelationArc[] {
  const seen = new Set<string>();
  return arcs.filter((arc) => {
    const key = arc.source.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function rfPriority(entity: RfSceneEntity): number {
  const freshnessScore = entity.freshness === "live" ? 1000 : entity.freshness === "stale" ? 250 : 0;
  const categoryScore =
    entity.category === "ble" ? 720 : entity.category === "rail" ? 620 : entity.category === "iot" ? 560 : entity.category === "unknown_rf" ? 500 : entity.category === "wifi" ? 180 : 100;
  const signalScore = typeof entity.rssi === "number" ? Math.max(0, entity.rssi + 100) : 0;
  return freshnessScore + categoryScore + signalScore + Math.min(entity.count, 50);
}

function signalVolumeOffset(feature: Pick<RfMapFeature, "identity" | "location_accuracy" | "rssi">, displayDistanceMeters: number): ScenePosition {
  if (isUnknownSignal(feature.rssi)) {
    return { x: 0, y: 0, z: 0 };
  }

  if (displayDistanceMeters <= 1.5) {
    return nearHouseSignalOffset(feature.identity, feature.location_accuracy);
  }

  if (displayDistanceMeters <= UNCOMPRESSED_DISPLAY_RADIUS) {
    return { x: 0, y: 0, z: 0 };
  }

  const seed = hashString(feature.identity);
  const angle = ((seed % 360) * Math.PI) / 180;
  const orbit = 1.8 + ((seed >>> 8) % 100) / 100;
  const uncertaintyScale = feature.location_accuracy === "real" ? 0.55 : feature.location_accuracy === "estimated" ? 1 : 1.35;
  const lateral = orbit * uncertaintyScale;

  return {
    x: Math.cos(angle) * lateral,
    y: 1.4 + ((seed >>> 16) % 42) / 10,
    z: Math.sin(angle) * lateral
  };
}

function nearHouseSignalOffset(identity: string, accuracy: LocationAccuracy): ScenePosition {
  const seed = hashString(identity);
  const angle = ((seed % 360) * Math.PI) / 180;
  const accuracyScale = accuracy === "real" ? 1 : accuracy === "estimated" ? 1.2 : 1.4;
  const radius = (2.8 + ((seed >>> 8) % 420) / 100) * accuracyScale;
  return {
    x: Math.cos(angle) * radius,
    y: 0.15 + ((seed >>> 16) % 14) / 10,
    z: Math.sin(angle) * radius
  };
}

function hashedBearing(identity: string): number {
  return ((hashString(identity) % 360) * Math.PI) / 180;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function limitHorizontalRadius(local: LocalMeters, maxRadius = MAX_DISPLAY_RADIUS): LocalMeters {
  const distance = Math.hypot(local.x, local.z);
  if (distance <= maxRadius || distance === 0) {
    return {
      x: roundSceneMeters(local.x),
      z: roundSceneMeters(local.z)
    };
  }

  const scale = maxRadius / distance;
  return {
    x: roundSceneMeters(local.x * scale),
    z: roundSceneMeters(local.z * scale)
  };
}

function roundSceneMeters(value: number): number {
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}
