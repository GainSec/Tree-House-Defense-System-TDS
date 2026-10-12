/**
 * Pure interaction logic for the XR board: comfort presets, panel layout,
 * focus zoom, two-handed manipulation and thumbstick mapping. Everything here
 * is unit-tested; components only apply the results.
 */
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import { BOARD_RADIUS_SCENE, requiresReview, isPresenceEntity } from "./boardModel";
import type { BoardTransform, HeadPose, Vec3Tuple } from "./boardTransform";
import { BOARD_LIMITS, clampBoardTransform, normalizeYaw } from "./boardTransform";

// ---------------------------------------------------------------- comfort

export type ComfortMode = "standing" | "seated";

export interface ComfortPreset {
  mode: ComfortMode;
  /** Board surface height above the floor, metres. */
  height: number;
  /** Horizontal distance from the head to the board centre, metres. */
  distance: number;
}

export const COMFORT_PRESETS: Record<ComfortMode, ComfortPreset> = {
  // Waist height, a step away: walk around it.
  standing: { mode: "standing", height: 0.9, distance: 1.25 },
  // Coffee-table height, far enough that the palette is not in the lap.
  seated: { mode: "seated", height: 0.62, distance: 1.1 }
};

/** Place the board in front of the head using a comfort preset, keeping the current scale and lock. */
export function summonBoard(current: BoardTransform, head: HeadPose, mode: ComfortMode): BoardTransform {
  const preset = COMFORT_PRESETS[mode];
  const forwardX = -Math.sin(head.yaw);
  const forwardZ = -Math.cos(head.yaw);
  const extra = Math.max(0, (current.scale - 1) * 0.5) * 0.6;
  return clampBoardTransform({
    position: [head.position[0] + forwardX * (preset.distance + extra), preset.height, head.position[2] + forwardZ * (preset.distance + extra)],
    yaw: head.yaw,
    scale: current.scale,
    locked: current.locked
  });
}

/** Room-scale preset: a large board sitting just above the floor, centred where the user stands. */
export function roomScaleBoard(current: BoardTransform, head: HeadPose): BoardTransform {
  return clampBoardTransform({
    position: [head.position[0], 0.08, head.position[2]],
    yaw: head.yaw,
    scale: ROOM_SCALE,
    locked: current.locked
  });
}

export const ROOM_SCALE = 6;

// ---------------------------------------------------------------- panel layout

export type BoardPanelId = "palette" | "selection" | "alerts" | "diagnostics" | "secondary";
/** Life-size panels are anchored to the operator's play space (the XR origin), so they travel with teleports. */
export type LifePanelId = "life-palette" | "life-selection" | "life-alerts" | "life-diagnostics" | "life-secondary";
export type PanelId = BoardPanelId | LifePanelId;
export const ALL_PANEL_IDS: PanelId[] = ["palette", "selection", "alerts", "diagnostics", "secondary", "life-palette", "life-selection", "life-alerts", "life-diagnostics", "life-secondary"];

export type PanelOffsets = Partial<Record<PanelId, Vec3Tuple>>;

/** Hands zone: panels closer than this to the operator's head (horizontally) are pushed away. */
export const MIN_PANEL_DISTANCE = 0.7;

/**
 * Default panel anchors in board-local metres. The palette sits beside the board
 * (front-left), never on the near edge, so it is out of the lap when seated.
 */
/** Seated eyes are ~0.45 m lower than standing: panels sit proportionally lower above the board. */
export const SEATED_PANEL_HEIGHT_FACTOR = 0.7;

export function defaultPanelAnchor(id: PanelId, radius: number, mode: ComfortMode = "standing"): Vec3Tuple {
  const [x, y, z] = standingPanelAnchor(id, radius);
  return [x, mode === "seated" ? y * SEATED_PANEL_HEIGHT_FACTOR : y, z];
}

function standingPanelAnchor(id: PanelId, radius: number): Vec3Tuple {
  switch (id) {
    // Life-size: origin-local positions around a standing operator (top edges), out of the hands zone.
    case "life-palette":
      return [-0.62, 1.42, -0.82];
    case "life-selection":
      return [0.66, 1.62, -0.9];
    case "life-alerts":
      return [-1.05, 1.75, -0.35];
    case "life-secondary":
      return [0, 1.95, -1.25];
    case "life-diagnostics":
      return [1.1, 1.8, -0.3];
    // Anchors are the TOP edge of each panel.
    case "palette":
      return [-(radius + 0.36), 0.42, radius * 0.45];
    case "alerts":
      return [-(radius + 0.36), 0.82, -0.15];
    case "selection":
      return [radius + 0.34, 0.82, -0.02];
    case "secondary":
      // Centred behind the board, above it: where the operator is already looking.
      return [0, 1.05, -(radius + 0.08)];
    case "diagnostics":
      return [radius + 0.62, 0.9, -(radius * 0.4)];
  }
}

export function panelAnchor(id: PanelId, radius: number, offsets: PanelOffsets, mode: ComfortMode = "standing"): Vec3Tuple {
  const base = defaultPanelAnchor(id, radius, mode);
  const offset = offsets[id];
  return offset ? [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]] : base;
}

export function parsePanelOffsets(raw: string | null): PanelOffsets {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: PanelOffsets = {};
    for (const id of ALL_PANEL_IDS) {
      const value = parsed[id];
      if (Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) < 10)) {
        result[id] = value as Vec3Tuple;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Keep a panel out of the hands zone: if its world position is within
 * MIN_PANEL_DISTANCE (horizontally) of the head, push it outward along the
 * head->panel direction. Returns the corrected world position.
 */
export function keepOutOfHandsZone(panelWorld: Vec3Tuple, head: Vec3Tuple, minDistance = MIN_PANEL_DISTANCE): Vec3Tuple {
  const dx = panelWorld[0] - head[0];
  const dz = panelWorld[2] - head[2];
  const distance = Math.hypot(dx, dz);
  if (distance >= minDistance) {
    return panelWorld;
  }
  if (distance < 1e-4) {
    return [panelWorld[0], panelWorld[1], panelWorld[2] - minDistance];
  }
  const factor = minDistance / distance;
  return [head[0] + dx * factor, panelWorld[1], head[2] + dz * factor];
}

// ---------------------------------------------------------------- text size

export type TextSize = "s" | "m" | "l" | "xl";
export const TEXT_SCALE: Record<TextSize, number> = { s: 0.85, m: 1, l: 1.2, xl: 1.45 };
export const TEXT_SIZE_ORDER: TextSize[] = ["s", "m", "l", "xl"];
export function nextTextSize(size: TextSize): TextSize {
  return TEXT_SIZE_ORDER[(TEXT_SIZE_ORDER.indexOf(size) + 1) % TEXT_SIZE_ORDER.length];
}

// ---------------------------------------------------------------- focus zoom

export interface FocusState {
  /** Scene (board) coordinates of the focus centre, after the north-up mirror. */
  centerX: number;
  centerZ: number;
  zoom: number;
}

export const FOCUS_ZOOM_STEPS = [1, 2, 4, 8];

export function nextFocusZoom(zoom: number): number {
  const index = FOCUS_ZOOM_STEPS.findIndex((step) => step > zoom + 1e-6);
  return index === -1 ? FOCUS_ZOOM_STEPS[0] : FOCUS_ZOOM_STEPS[index];
}

/** Board-scene position of a point under a focus transform. */
export function applyFocus(x: number, z: number, focus: FocusState | null): { x: number; z: number } {
  if (!focus || focus.zoom === 1) {
    return { x, z };
  }
  return { x: (x - focus.centerX) * focus.zoom, z: (z - focus.centerZ) * focus.zoom };
}

/** True when a point is still on the plate after focusing (small margin so edge tokens don't flicker). */
export function insidePlate(x: number, z: number, focus: FocusState | null, radius = BOARD_RADIUS_SCENE): boolean {
  const point = applyFocus(x, z, focus);
  return Math.hypot(point.x, point.z) <= radius * 0.97;
}

// ---------------------------------------------------------------- two-handed manipulation

export interface HandPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * Two-handed grab: the board follows the midpoint of the hands, scales with the
 * distance between them, and yaws with the angle of the line between them.
 */
export function twoHandTransform(start: BoardTransform, startA: HandPoint, startB: HandPoint, nowA: HandPoint, nowB: HandPoint): BoardTransform {
  const startDistance = Math.max(0.05, Math.hypot(startB.x - startA.x, startB.z - startA.z, startB.y - startA.y));
  const nowDistance = Math.max(0.05, Math.hypot(nowB.x - nowA.x, nowB.z - nowA.z, nowB.y - nowA.y));
  const startAngle = Math.atan2(startB.x - startA.x, startB.z - startA.z);
  const nowAngle = Math.atan2(nowB.x - nowA.x, nowB.z - nowA.z);
  const startMid = { x: (startA.x + startB.x) / 2, y: (startA.y + startB.y) / 2, z: (startA.z + startB.z) / 2 };
  const nowMid = { x: (nowA.x + nowB.x) / 2, y: (nowA.y + nowB.y) / 2, z: (nowA.z + nowB.z) / 2 };
  return clampBoardTransform({
    position: [start.position[0] + nowMid.x - startMid.x, start.position[1] + nowMid.y - startMid.y, start.position[2] + nowMid.z - startMid.z],
    yaw: normalizeYaw(start.yaw + (nowAngle - startAngle)),
    scale: start.scale * (nowDistance / startDistance),
    locked: start.locked
  });
}

// ---------------------------------------------------------------- thumbstick

export const STICK_DEADZONE = 0.2;

export interface StickRates {
  /** Per second at full deflection. */
  scale: number;
  yaw: number;
  move: number;
}

export const STICK_RATES: StickRates = { scale: 1.2, yaw: Math.PI / 2, move: 0.6 };

export function deadzone(value: number, zone = STICK_DEADZONE): number {
  if (!Number.isFinite(value) || Math.abs(value) < zone) {
    return 0;
  }
  return (Math.sign(value) * (Math.abs(value) - zone)) / (1 - zone);
}

/**
 * Thumbstick while the board is held: Y scales (push = larger), X yaws.
 * Thumbstick in Place mode without holding: nudge (X right/left, Y away/closer).
 */
export function stickAdjust(
  board: BoardTransform,
  stick: { x: number; y: number },
  dt: number,
  mode: "held" | "nudge",
  viewerYaw: number
): BoardTransform {
  const x = deadzone(stick.x);
  const y = deadzone(stick.y);
  if (x === 0 && y === 0) {
    return board;
  }
  if (mode === "held") {
    // WebXR thumbstick Y is negative when pushed forward.
    const scale = board.scale * Math.exp(-y * STICK_RATES.scale * dt);
    return clampBoardTransform({ ...board, scale, yaw: board.yaw - x * STICK_RATES.yaw * dt });
  }
  const right = x * STICK_RATES.move * dt;
  const forward = -y * STICK_RATES.move * dt;
  const sin = Math.sin(viewerYaw);
  const cos = Math.cos(viewerYaw);
  const [px, py, pz] = board.position;
  return clampBoardTransform({ ...board, position: [px + cos * right - sin * forward, py, pz - sin * right - cos * forward] });
}

export { BOARD_LIMITS };

// ---------------------------------------------------------------- find / jump

export type FindGroup = "review" | "tracked" | "strongest" | "aircraft";

export interface FindItem {
  id: string;
  label: string;
  detail: string;
  group: FindGroup;
}

export const FIND_GROUP_LABELS: Record<FindGroup, string> = {
  review: "Needs review",
  tracked: "Tracked",
  strongest: "Strongest",
  aircraft: "Aircraft"
};

export function buildFindList(rfEntities: RfSceneEntity[], aircraftEntities: AircraftSceneEntity[], group: FindGroup, tracked: ReadonlySet<string> = new Set()): FindItem[] {
  const rssi = (entity: RfSceneEntity) => (typeof entity.rssi === "number" ? `${entity.rssi} dBm` : "no RSSI");
  switch (group) {
    case "review":
      return rfEntities.filter(requiresReview).map((entity) => ({ id: entity.id, label: entity.label, detail: `${rssi(entity)} | ${entity.freshness}`, group }));
    case "tracked":
      return rfEntities
        .filter((entity) => isPresenceEntity(entity, tracked))
        .map((entity) => ({ id: entity.id, label: entity.label, detail: entity.operatorContext?.headline ?? `tracked | ${rssi(entity)}`, group }));
    case "strongest":
      return [...rfEntities]
        .filter((entity) => typeof entity.rssi === "number")
        .sort((a, b) => (b.rssi as number) - (a.rssi as number))
        .map((entity) => ({ id: entity.id, label: entity.label, detail: `${rssi(entity)} | ${entity.category}`, group }));
    case "aircraft":
      return aircraftEntities.map((entity) => ({
        id: entity.id,
        label: entity.label,
        detail: `${entity.altitude === null ? "alt ?" : `${entity.altitude.toLocaleString()} ft`}`,
        group
      }));
  }
}

export function pageOf<T>(items: T[], page: number, size: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const clamped = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(clamped * size, clamped * size + size), page: clamped, pages };
}

// ---------------------------------------------------------------- input health

export type InputProblem = "blurred" | "no-controllers" | null;

/** Pure: what, if anything, is stopping the controllers from working right now. */
export function resolveInputProblem(telemetry: { session: unknown; visibilityState: XRVisibilityState | null }, inputSourceCount: number, sessionAgeMs: number): InputProblem {
  if (!telemetry.session) {
    return null;
  }
  if (telemetry.visibilityState === "visible-blurred") {
    return "blurred";
  }
  if (inputSourceCount === 0 && sessionAgeMs > 3000) {
    return "no-controllers";
  }
  return null;
}

