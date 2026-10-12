/**
 * World-space placement of the floating operations board.
 *
 * Coordinates are XR reference-space meters (`local-floor`: y=0 is the floor,
 * the user starts at the origin looking down -Z). The board's local +Z edge
 * faces the operator when `yaw` matches the operator's heading.
 */

export type Vec3Tuple = [number, number, number];

export interface BoardTransform {
  position: Vec3Tuple;
  yaw: number;
  /** Multiplier on the base board size (1 = ~1 m diameter). */
  scale: number;
  locked: boolean;
}

export const BOARD_LIMITS = {
  /** Low enough for a room-scale board lying near the floor. */
  minHeight: 0.05,
  maxHeight: 1.5,
  minScale: 0.5,
  /** 8x = an 8 m wide board: room scale. */
  maxScale: 8,
  /** Maximum horizontal distance from the XR origin. Keeps the board reachable and inside typical play areas. */
  maxDistance: 6
} as const;

export const DEFAULT_BOARD_DISTANCE = 1.25;
export const DEFAULT_BOARD_HEIGHT = 0.9;

export const DEFAULT_BOARD_TRANSFORM: BoardTransform = {
  position: [0, DEFAULT_BOARD_HEIGHT, -DEFAULT_BOARD_DISTANCE],
  yaw: 0,
  scale: 1,
  locked: false
};

export interface HeadPose {
  position: Vec3Tuple;
  /** Heading around +Y, three.js convention (0 = looking down -Z). */
  yaw: number;
}

export type BoardAction =
  | { type: "translate"; right: number; forward: number; viewerYaw: number }
  | { type: "raise"; dy: number }
  | { type: "rotate"; dyaw: number }
  | { type: "scale"; factor: number }
  | { type: "setPose"; position: Vec3Tuple; yaw: number }
  | { type: "setTransform"; position: Vec3Tuple; yaw: number; scale: number }
  | { type: "replace"; value: BoardTransform }
  | { type: "setLocked"; locked: boolean }
  | { type: "toggleLock" }
  | { type: "reset" }
  | { type: "recenter"; head: HeadPose };

/** Actions that move the board. Ignored while locked. */
const PLACEMENT_ACTIONS = new Set<BoardAction["type"]>(["translate", "raise", "rotate", "scale", "setPose", "setTransform"]);

export function boardReducer(state: BoardTransform, action: BoardAction): BoardTransform {
  if (state.locked && PLACEMENT_ACTIONS.has(action.type)) {
    return state;
  }
  switch (action.type) {
    case "translate": {
      const [x, y, z] = state.position;
      const sin = Math.sin(action.viewerYaw);
      const cos = Math.cos(action.viewerYaw);
      // Viewer forward is (-sin, 0, -cos); right is (cos, 0, -sin).
      const nx = x + cos * action.right - sin * action.forward;
      const nz = z - sin * action.right - cos * action.forward;
      return clampBoardTransform({ ...state, position: [nx, y, nz] });
    }
    case "raise":
      return clampBoardTransform({ ...state, position: [state.position[0], state.position[1] + action.dy, state.position[2]] });
    case "rotate":
      return clampBoardTransform({ ...state, yaw: state.yaw + action.dyaw });
    case "scale":
      return clampBoardTransform({ ...state, scale: state.scale * action.factor });
    case "setPose":
      return clampBoardTransform({ ...state, position: action.position, yaw: action.yaw });
    case "setTransform":
      return clampBoardTransform({ ...state, position: action.position, yaw: action.yaw, scale: action.scale });
    case "replace":
      // Summon / room-scale presets: allowed while locked (safety), lock state preserved.
      return clampBoardTransform({ ...action.value, locked: state.locked });
    case "setLocked":
      return { ...state, locked: action.locked };
    case "toggleLock":
      return { ...state, locked: !state.locked };
    case "reset":
      // Reset is a safety action: it works while locked and preserves the lock state.
      return { ...DEFAULT_BOARD_TRANSFORM, locked: state.locked };
    case "recenter":
      return clampBoardTransform({ ...placeInFrontOf(action.head, DEFAULT_BOARD_DISTANCE, state.position[1]), scale: state.scale, locked: state.locked });
  }
}

export function placeInFrontOf(head: HeadPose, distance = DEFAULT_BOARD_DISTANCE, height = DEFAULT_BOARD_HEIGHT): BoardTransform {
  const forwardX = -Math.sin(head.yaw);
  const forwardZ = -Math.cos(head.yaw);
  return clampBoardTransform({
    position: [head.position[0] + forwardX * distance, height, head.position[2] + forwardZ * distance],
    yaw: head.yaw,
    scale: 1,
    locked: false
  });
}

export function clampBoardTransform(value: BoardTransform): BoardTransform {
  const [rawX, rawY, rawZ] = value.position;
  let x = finiteOr(rawX, DEFAULT_BOARD_TRANSFORM.position[0]);
  let z = finiteOr(rawZ, DEFAULT_BOARD_TRANSFORM.position[2]);
  const distance = Math.hypot(x, z);
  if (distance > BOARD_LIMITS.maxDistance) {
    x = (x / distance) * BOARD_LIMITS.maxDistance;
    z = (z / distance) * BOARD_LIMITS.maxDistance;
  }
  const y = clamp(finiteOr(rawY, DEFAULT_BOARD_HEIGHT), BOARD_LIMITS.minHeight, BOARD_LIMITS.maxHeight);
  return {
    position: [round(x), round(y), round(z)],
    yaw: normalizeYaw(finiteOr(value.yaw, 0)),
    scale: round(clamp(finiteOr(value.scale, 1), BOARD_LIMITS.minScale, BOARD_LIMITS.maxScale)),
    locked: Boolean(value.locked)
  };
}

export function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let next = ((yaw % twoPi) + twoPi) % twoPi;
  if (next > Math.PI) {
    next -= twoPi;
  }
  return round(next, 5);
}

export const BOARD_STORAGE_KEY = "tds.xr.board.v1";

export function parseStoredBoardTransform(raw: string | null): BoardTransform | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<BoardTransform>;
    if (!Array.isArray(parsed.position) || parsed.position.length !== 3) {
      return null;
    }
    return clampBoardTransform({
      position: parsed.position.map(Number) as Vec3Tuple,
      yaw: Number(parsed.yaw),
      scale: Number(parsed.scale),
      locked: parsed.locked === true
    });
  } catch {
    return null;
  }
}

export function describeBoardTransform(value: BoardTransform): string {
  const [x, y, z] = value.position;
  const degrees = Math.round((value.yaw * 180) / Math.PI);
  return `x ${x.toFixed(2)} · h ${y.toFixed(2)}m · z ${z.toFixed(2)} · ${degrees}° · ×${value.scale.toFixed(2)}${value.locked ? " · LOCKED" : ""}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOr(value: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}
