import { describe, expect, it } from "vitest";
import {
  BOARD_LIMITS,
  DEFAULT_BOARD_TRANSFORM,
  boardReducer,
  clampBoardTransform,
  normalizeYaw,
  parseStoredBoardTransform,
  placeInFrontOf,
  type BoardTransform
} from "../boardTransform";

const unlocked: BoardTransform = { ...DEFAULT_BOARD_TRANSFORM };
const locked: BoardTransform = { ...DEFAULT_BOARD_TRANSFORM, locked: true };

describe("default placement", () => {
  it("starts ~1-1.5 m in front of the origin at waist height", () => {
    const [x, y, z] = DEFAULT_BOARD_TRANSFORM.position;
    expect(x).toBe(0);
    expect(-z).toBeGreaterThanOrEqual(1);
    expect(-z).toBeLessThanOrEqual(1.5);
    expect(y).toBeGreaterThanOrEqual(0.8);
    expect(y).toBeLessThanOrEqual(1);
    expect(DEFAULT_BOARD_TRANSFORM.locked).toBe(false);
  });
});

describe("clampBoardTransform", () => {
  it("clamps height to the table range", () => {
    expect(clampBoardTransform({ ...unlocked, position: [0, 5, -1] }).position[1]).toBe(BOARD_LIMITS.maxHeight);
    expect(clampBoardTransform({ ...unlocked, position: [0, -2, -1] }).position[1]).toBe(BOARD_LIMITS.minHeight);
  });

  it("limits horizontal distance from the origin", () => {
    const result = clampBoardTransform({ ...unlocked, position: [30, 1, -40] });
    expect(Math.hypot(result.position[0], result.position[2])).toBeCloseTo(BOARD_LIMITS.maxDistance, 3);
  });

  it("replaces non-finite values with defaults", () => {
    const result = clampBoardTransform({ position: [Number.NaN, Number.POSITIVE_INFINITY, Number.NaN], yaw: Number.NaN, scale: Number.NaN, locked: false });
    expect(result.position).toEqual(DEFAULT_BOARD_TRANSFORM.position);
    expect(result.yaw).toBe(0);
    expect(result.scale).toBe(1);
  });

  it("normalizes yaw into (-pi, pi]", () => {
    expect(normalizeYaw(Math.PI * 3)).toBeCloseTo(Math.PI, 4);
    expect(normalizeYaw(-Math.PI / 2 - Math.PI * 2)).toBeCloseTo(-Math.PI / 2, 4);
  });
});

describe("scale limits", () => {
  it("clamps scale up and down", () => {
    let state = unlocked;
    for (let index = 0; index < 20; index += 1) {
      state = boardReducer(state, { type: "scale", factor: 1.5 });
    }
    expect(state.scale).toBe(BOARD_LIMITS.maxScale);
    for (let index = 0; index < 40; index += 1) {
      state = boardReducer(state, { type: "scale", factor: 0.5 });
    }
    expect(state.scale).toBe(BOARD_LIMITS.minScale);
  });
});

describe("boardReducer", () => {
  it("translates relative to the viewer heading", () => {
    const forward = boardReducer(unlocked, { type: "translate", right: 0, forward: 0.5, viewerYaw: 0 });
    expect(forward.position[2]).toBeCloseTo(DEFAULT_BOARD_TRANSFORM.position[2] - 0.5, 4);
    const right = boardReducer(unlocked, { type: "translate", right: 0.5, forward: 0, viewerYaw: 0 });
    expect(right.position[0]).toBeCloseTo(0.5, 4);
    const turnedRight = boardReducer(unlocked, { type: "translate", right: 0, forward: 1, viewerYaw: -Math.PI / 2 });
    expect(turnedRight.position[0]).toBeCloseTo(1, 4);
  });

  it("raises, rotates and sets pose while unlocked", () => {
    expect(boardReducer(unlocked, { type: "raise", dy: 0.1 }).position[1]).toBeCloseTo(DEFAULT_BOARD_TRANSFORM.position[1] + 0.1, 4);
    expect(boardReducer(unlocked, { type: "rotate", dyaw: 0.5 }).yaw).toBeCloseTo(0.5, 4);
    expect(boardReducer(unlocked, { type: "setPose", position: [1, 1, -2], yaw: 1 }).position).toEqual([1, 1, -2]);
  });
});

describe("lock / unlock", () => {
  it("ignores all placement actions while locked", () => {
    expect(boardReducer(locked, { type: "translate", right: 1, forward: 1, viewerYaw: 0 })).toBe(locked);
    expect(boardReducer(locked, { type: "raise", dy: 0.2 })).toBe(locked);
    expect(boardReducer(locked, { type: "rotate", dyaw: 1 })).toBe(locked);
    expect(boardReducer(locked, { type: "scale", factor: 2 })).toBe(locked);
    expect(boardReducer(locked, { type: "setPose", position: [2, 1, 2], yaw: 2 })).toBe(locked);
  });

  it("toggles and sets lock state", () => {
    expect(boardReducer(unlocked, { type: "toggleLock" }).locked).toBe(true);
    expect(boardReducer(locked, { type: "toggleLock" }).locked).toBe(false);
    expect(boardReducer(unlocked, { type: "setLocked", locked: true }).locked).toBe(true);
  });
});

describe("placement reset", () => {
  it("restores the default placement and preserves the lock", () => {
    const moved = boardReducer(boardReducer(unlocked, { type: "scale", factor: 2 }), { type: "translate", right: 1, forward: 1, viewerYaw: 0 });
    const reset = boardReducer({ ...moved, locked: true }, { type: "reset" });
    expect(reset.position).toEqual(DEFAULT_BOARD_TRANSFORM.position);
    expect(reset.scale).toBe(1);
    expect(reset.locked).toBe(true);
  });

  it("recenters in front of the head, keeping height and scale", () => {
    const state: BoardTransform = { position: [3, 1.2, 3], yaw: 0, scale: 2, locked: false };
    const result = boardReducer(state, { type: "recenter", head: { position: [1, 1.7, 1], yaw: Math.PI / 2 } });
    // Facing +90° (looking down -X): board lands 1.25 m toward -X.
    expect(result.position[0]).toBeCloseTo(1 - 1.25, 3);
    expect(result.position[2]).toBeCloseTo(1, 3);
    expect(result.position[1]).toBe(1.2);
    expect(result.scale).toBe(2);
    expect(result.yaw).toBeCloseTo(Math.PI / 2, 4);
  });

  it("placeInFrontOf faces the board's front edge back at the operator", () => {
    const placed = placeInFrontOf({ position: [0, 1.6, 0], yaw: 0 });
    expect(placed.position[2]).toBeLessThan(0);
    expect(placed.yaw).toBe(0);
  });
});

describe("persistence", () => {
  it("round-trips and clamps stored transforms", () => {
    const stored = JSON.stringify({ position: [0.2, 9, -1], yaw: 0.3, scale: 99, locked: true });
    const parsed = parseStoredBoardTransform(stored);
    expect(parsed?.position[1]).toBe(BOARD_LIMITS.maxHeight);
    expect(parsed?.scale).toBe(BOARD_LIMITS.maxScale);
    expect(parsed?.locked).toBe(true);
  });

  it("rejects malformed storage", () => {
    expect(parseStoredBoardTransform("{")).toBeNull();
    expect(parseStoredBoardTransform(JSON.stringify({ position: [1, 2] }))).toBeNull();
    expect(parseStoredBoardTransform(null)).toBeNull();
  });
});

describe("setTransform and replace", () => {
  it("sets position, yaw and scale together, clamped", () => {
    const next = boardReducer(unlocked, { type: "setTransform", position: [0.5, 1, -2], yaw: 0.4, scale: 99 });
    expect(next.position).toEqual([0.5, 1, -2]);
    expect(next.yaw).toBeCloseTo(0.4, 4);
    expect(next.scale).toBe(BOARD_LIMITS.maxScale);
  });

  it("setTransform is ignored while locked; replace still works and keeps the lock", () => {
    expect(boardReducer(locked, { type: "setTransform", position: [1, 1, 1], yaw: 0, scale: 2 })).toBe(locked);
    const replaced = boardReducer(locked, { type: "replace", value: { position: [0, 0.62, -1.1], yaw: 0, scale: 1, locked: false } });
    expect(replaced.position).toEqual([0, 0.62, -1.1]);
    expect(replaced.locked).toBe(true);
  });
});
