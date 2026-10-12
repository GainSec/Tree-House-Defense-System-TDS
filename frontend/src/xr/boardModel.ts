import type { AircraftSceneEntity, RfSceneEntity, SceneModel } from "../data/sceneModel";
import type { LayerLensMode } from "../ui/useLayerLens";

/**
 * Board content model: entity budgets, layers and scene→board layout.
 * Board-local units are the existing scene units (meters on site); the board
 * group scales them down to a tabletop diorama.
 */

/** Scene radius that fits on the board plate. RF display radius is capped at 52 by sceneModel. */
export const BOARD_RADIUS_SCENE = 62;
/** Board plate radius in meters at scale 1. */
export const BOARD_RADIUS_METERS = 0.5;
export const BOARD_SCENE_TO_METERS = BOARD_RADIUS_METERS / BOARD_RADIUS_SCENE;

// ---------------------------------------------------------------- budgets

export type EntityBudgetId = "standalone" | "balanced" | "desktop";

export interface EntityBudget {
  id: EntityBudgetId;
  label: string;
  rf: number;
  aircraft: number;
}

export const ENTITY_BUDGETS: Record<EntityBudgetId, EntityBudget> = {
  standalone: { id: "standalone", label: "Standalone (72 FPS target)", rf: 48, aircraft: 12 },
  balanced: { id: "balanced", label: "Balanced", rf: 96, aircraft: 24 },
  desktop: { id: "desktop", label: "Desktop simulator", rf: 240, aircraft: 60 }
};

export const ENTITY_BUDGET_ORDER: EntityBudgetId[] = ["standalone", "balanced", "desktop"];

export function nextEntityBudget(id: EntityBudgetId): EntityBudgetId {
  return ENTITY_BUDGET_ORDER[(ENTITY_BUDGET_ORDER.indexOf(id) + 1) % ENTITY_BUDGET_ORDER.length];
}

export interface BudgetedEntities {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  droppedRf: number;
  droppedAircraft: number;
}

/**
 * Apply an entity budget. Input order is the scene model's priority order.
 * The selected entity and live review-required RF are always kept (review items
 * capped at half the RF budget so they cannot crowd everything else out).
 */
export function selectBudgetedEntities({
  rfEntities,
  aircraftEntities,
  budget,
  selectedId = null
}: {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  budget: Pick<EntityBudget, "rf" | "aircraft">;
  selectedId?: string | null;
}): BudgetedEntities {
  const rfLimit = Math.max(0, Math.floor(budget.rf));
  const aircraftLimit = Math.max(0, Math.floor(budget.aircraft));
  const keep = new Set<string>();
  if (selectedId && rfLimit > 0 && rfEntities.some((entity) => entity.id === selectedId)) {
    keep.add(selectedId);
  }
  const reviewCap = Math.floor(rfLimit / 2);
  let reviewKept = 0;
  for (const entity of rfEntities) {
    if (reviewKept >= reviewCap || keep.size >= rfLimit) {
      break;
    }
    if (requiresReview(entity) && !keep.has(entity.id)) {
      keep.add(entity.id);
      reviewKept += 1;
    }
  }
  for (const entity of rfEntities) {
    if (keep.size >= rfLimit) {
      break;
    }
    keep.add(entity.id);
  }
  const rf = rfEntities.filter((entity) => keep.has(entity.id));

  let aircraft = aircraftEntities.slice(0, aircraftLimit);
  if (selectedId && aircraftLimit > 0 && !aircraft.some((entity) => entity.id === selectedId)) {
    const selected = aircraftEntities.find((entity) => entity.id === selectedId);
    if (selected) {
      aircraft = [...aircraft.slice(0, aircraftLimit - 1), selected];
    }
  }

  return {
    rfEntities: rf,
    aircraftEntities: aircraft,
    droppedRf: rfEntities.length - rf.length,
    droppedAircraft: aircraftEntities.length - aircraft.length
  };
}

export function requiresReview(entity: Pick<RfSceneEntity, "category" | "freshness">): boolean {
  return entity.category === "unknown_rf" && entity.freshness !== "expired";
}

// ---------------------------------------------------------------- layers

export type XRLayerId = "rf" | "presence" | "airspace" | "alerts";

export type XRLayerState = Record<XRLayerId, boolean>;

export const DEFAULT_XR_LAYERS: XRLayerState = { rf: true, presence: true, airspace: true, alerts: true };

export const XR_LAYER_LABELS: Record<XRLayerId, string> = {
  rf: "RF",
  presence: "Presence",
  airspace: "Airspace",
  alerts: "Alerts"
};

export const XR_LAYER_ORDER: XRLayerId[] = ["rf", "presence", "airspace", "alerts"];

export function toggleXRLayer(state: XRLayerState, id: XRLayerId): XRLayerState {
  return { ...state, [id]: !state[id] };
}

export function parseStoredXRLayers(raw: string | null): XRLayerState {
  if (!raw) {
    return DEFAULT_XR_LAYERS;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Record<XRLayerId, unknown>>;
    return Object.fromEntries(XR_LAYER_ORDER.map((id) => [id, typeof parsed[id] === "boolean" ? parsed[id] : DEFAULT_XR_LAYERS[id]])) as XRLayerState;
  } catch {
    return DEFAULT_XR_LAYERS;
  }
}

/** Apply XR layer toggles on top of the shared (already filtered) visible scene. */
export function applyXRLayers(
  visible: Pick<SceneModel, "rfEntities" | "aircraftEntities">,
  layers: XRLayerState,
  tracked: ReadonlySet<string> = NO_TRACKED
): Pick<SceneModel, "rfEntities" | "aircraftEntities"> {
  return {
    rfEntities: layers.rf ? visible.rfEntities : layers.presence ? visible.rfEntities.filter((entity) => isPresenceEntity(entity, tracked)) : [],
    aircraftEntities: layers.airspace ? visible.aircraftEntities : []
  };
}

const NO_TRACKED: ReadonlySet<string> = new Set();

/** Entities the presence layer highlights: on the operator's watchlist, or carrying operator context. */
export function isPresenceEntity(entity: Pick<RfSceneEntity, "operatorContext"> & Partial<Pick<RfSceneEntity, "entityKey" | "identity">>, tracked: ReadonlySet<string> = NO_TRACKED): boolean {
  if ((entity.entityKey && tracked.has(entity.entityKey)) || (entity.identity && tracked.has(entity.identity))) {
    return true;
  }
  return Boolean(entity.operatorContext?.headline || entity.operatorContext?.chips?.length);
}

/** Lens modes the XR "Filter" control cycles through (shared with desktop). */
export const XR_FILTER_LENSES: LayerLensMode[] = ["all", "wifi", "ble", "unknown", "utility"];

export function nextFilterLens(current: LayerLensMode): LayerLensMode {
  const index = XR_FILTER_LENSES.indexOf(current);
  return XR_FILTER_LENSES[(index + 1) % XR_FILTER_LENSES.length];
}

// ---------------------------------------------------------------- layout

export type BoardVec3 = [number, number, number];

const AIRCRAFT_BOARD_RADIUS = 56;
const AIRCRAFT_MIN_Y = 12;
const AIRCRAFT_Y_RANGE = 18;
const AIRCRAFT_MAX_ALTITUDE_FT = 40_000;

/** RF tokens stand on the board surface at their scene ground position. */
export function boardRfPosition(entity: Pick<RfSceneEntity, "position">): BoardVec3 {
  return [entity.position.x, 0, entity.position.z];
}

/** Aircraft are compressed into a dome above the board: bearing preserved, range and altitude squashed. */
export function boardAircraftPosition(entity: Pick<AircraftSceneEntity, "localMeters" | "altitude">): BoardVec3 {
  const { x, z } = entity.localMeters;
  const distance = Math.hypot(x, z);
  const altitude = typeof entity.altitude === "number" && Number.isFinite(entity.altitude) ? Math.max(0, entity.altitude) : 0;
  const y = AIRCRAFT_MIN_Y + AIRCRAFT_Y_RANGE * Math.min(1, altitude / AIRCRAFT_MAX_ALTITUDE_FT);
  if (distance === 0) {
    return [0, y, 0];
  }
  const radius = AIRCRAFT_BOARD_RADIUS * (1 - Math.exp(-distance / 4000));
  return [(x / distance) * radius, y, (z / distance) * radius];
}

/** Flat footprint ring radius that encodes location uncertainty without volumetric transparency. */
export function uncertaintyFootprint(uncertaintyRadiusMeters: number): number {
  if (!Number.isFinite(uncertaintyRadiusMeters) || uncertaintyRadiusMeters <= 0) {
    return 0.9;
  }
  return Math.min(4.2, Math.max(0.9, 0.6 + uncertaintyRadiusMeters * 0.045));
}

// ---------------------------------------------------------------- aim assist

/** Physical snap radius: a controller ray landing within this distance of a token selects it. */
export const AIM_ASSIST_RADIUS_METERS = 0.05;

export interface AimCandidate {
  id: string;
  x: number;
  z: number;
}

/**
 * Tokens are only millimetres wide at tabletop scale, too small to hit reliably with a
 * controller ray from a metre away. Given where the ray hit the board plate (board scene
 * units), return the nearest candidate within `maxDistance`, or null.
 */
export function nearestAimCandidate(point: { x: number; z: number }, candidates: AimCandidate[], maxDistance: number): string | null {
  let best: string | null = null;
  let bestDistance = maxDistance;
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.z - point.z);
    if (distance <= bestDistance) {
      best = candidate.id;
      bestDistance = distance;
    }
  }
  return best;
}

export function aimAssistRadiusScene(boardScale: number): number {
  return AIM_ASSIST_RADIUS_METERS / (BOARD_SCENE_TO_METERS * Math.max(0.01, boardScale));
}
