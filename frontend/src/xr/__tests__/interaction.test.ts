import { describe, expect, it } from "vitest";
import {
  COMFORT_PRESETS,
  FOCUS_ZOOM_STEPS,
  MIN_PANEL_DISTANCE,
  ROOM_SCALE,
  applyFocus,
  buildFindList,
  deadzone,
  defaultPanelAnchor,
  insidePlate,
  keepOutOfHandsZone,
  nextFocusZoom,
  nextTextSize,
  pageOf,
  panelAnchor,
  parsePanelOffsets,
  roomScaleBoard,
  stickAdjust,
  summonBoard,
  twoHandTransform
} from "../interaction";
import { BOARD_LIMITS, DEFAULT_BOARD_TRANSFORM, type BoardTransform } from "../boardTransform";
import { aircraftFeature, rfFeature, scene } from "./fixtures";

const board: BoardTransform = { ...DEFAULT_BOARD_TRANSFORM };

describe("comfort presets and summon", () => {
  it("seated puts the board lower than standing", () => {
    expect(COMFORT_PRESETS.seated.height).toBeLessThan(COMFORT_PRESETS.standing.height);
  });

  it("summons the board in front of the head at the preset height", () => {
    const seated = summonBoard(board, { position: [0, 1.15, 0], yaw: 0 }, "seated");
    expect(seated.position[1]).toBe(COMFORT_PRESETS.seated.height);
    expect(seated.position[2]).toBeCloseTo(-COMFORT_PRESETS.seated.distance, 3);
    const turned = summonBoard(board, { position: [1, 1.6, 1], yaw: Math.PI / 2 }, "standing");
    expect(turned.position[0]).toBeCloseTo(1 - COMFORT_PRESETS.standing.distance, 3);
    expect(turned.yaw).toBeCloseTo(Math.PI / 2, 4);
  });

  it("keeps scale and lock when summoning, and moves a large board further away", () => {
    const big = summonBoard({ ...board, scale: 3, locked: true }, { position: [0, 1.6, 0], yaw: 0 }, "standing");
    expect(big.scale).toBe(3);
    expect(big.locked).toBe(true);
    expect(-big.position[2]).toBeGreaterThan(COMFORT_PRESETS.standing.distance);
  });

  it("room scale puts a large board near the floor around the user", () => {
    const room = roomScaleBoard(board, { position: [0.5, 1.6, -0.2], yaw: 0.3 });
    expect(room.scale).toBe(ROOM_SCALE);
    expect(room.scale).toBeLessThanOrEqual(BOARD_LIMITS.maxScale);
    expect(room.position[1]).toBeLessThan(0.2);
    expect(room.position[0]).toBe(0.5);
  });
});

describe("panel layout", () => {
  it("never places the palette on the near edge of the board", () => {
    const [x] = defaultPanelAnchor("palette", 0.5);
    expect(Math.abs(x)).toBeGreaterThan(0.5);
  });

  it("applies persisted offsets and rejects bad ones", () => {
    const offsets = parsePanelOffsets(JSON.stringify({ palette: [0.1, 0, -0.2], alerts: [1, "x", 2], selection: [99, 0, 0] }));
    expect(offsets.palette).toEqual([0.1, 0, -0.2]);
    expect(offsets.alerts).toBeUndefined();
    expect(offsets.selection).toBeUndefined();
    const anchor = panelAnchor("palette", 0.5, offsets);
    const base = defaultPanelAnchor("palette", 0.5);
    expect(anchor[0]).toBeCloseTo(base[0] + 0.1, 5);
    expect(parsePanelOffsets("{")).toEqual({});
  });

  it("pushes panels out of the hands zone", () => {
    const moved = keepOutOfHandsZone([0.2, 0.8, -0.3], [0, 1.2, 0]);
    expect(Math.hypot(moved[0], moved[2])).toBeCloseTo(MIN_PANEL_DISTANCE, 4);
    expect(moved[1]).toBe(0.8);
    expect(keepOutOfHandsZone([0, 1, -2], [0, 1.2, 0])).toEqual([0, 1, -2]);
    const degenerate = keepOutOfHandsZone([0, 1, 0], [0, 1.2, 0]);
    expect(degenerate[2]).toBe(-MIN_PANEL_DISTANCE);
  });

  it("cycles text sizes", () => {
    expect(nextTextSize("m")).toBe("l");
    expect(nextTextSize("xl")).toBe("s");
  });
});

describe("focus zoom", () => {
  it("steps through zoom levels and wraps", () => {
    expect(nextFocusZoom(1)).toBe(2);
    expect(nextFocusZoom(FOCUS_ZOOM_STEPS[FOCUS_ZOOM_STEPS.length - 1])).toBe(1);
  });

  it("re-centres and scales positions", () => {
    const focus = { centerX: 10, centerZ: -5, zoom: 4 };
    expect(applyFocus(10, -5, focus)).toEqual({ x: 0, z: 0 });
    expect(applyFocus(12, -5, focus)).toEqual({ x: 8, z: 0 });
    expect(applyFocus(3, 4, null)).toEqual({ x: 3, z: 4 });
  });

  it("hides points that fall off the plate when zoomed", () => {
    const focus = { centerX: 0, centerZ: 0, zoom: 4 };
    expect(insidePlate(10, 0, focus)).toBe(true);
    expect(insidePlate(20, 0, focus)).toBe(false);
    expect(insidePlate(50, 0, null)).toBe(true);
  });
});

describe("two-handed manipulation", () => {
  const a = { x: -0.2, y: 1, z: -0.5 };
  const b = { x: 0.2, y: 1, z: -0.5 };

  it("scales with hand distance", () => {
    const result = twoHandTransform(board, a, b, { x: -0.4, y: 1, z: -0.5 }, { x: 0.4, y: 1, z: -0.5 });
    expect(result.scale).toBeCloseTo(2, 3);
    expect(result.position).toEqual(board.position);
  });

  it("yaws with the hands and follows their midpoint", () => {
    const turned = twoHandTransform(board, a, b, { x: 0, y: 1, z: -0.3 }, { x: 0, y: 1, z: -0.7 });
    expect(Math.abs(turned.yaw)).toBeCloseTo(Math.PI / 2, 3);
    const moved = twoHandTransform(board, a, b, { x: -0.1, y: 1.1, z: -0.5 }, { x: 0.3, y: 1.1, z: -0.5 });
    expect(moved.position[0]).toBeCloseTo(0.1, 4);
    expect(moved.position[1]).toBeCloseTo(board.position[1] + 0.1, 4);
  });

  it("respects scale limits", () => {
    expect(twoHandTransform(board, a, b, { x: -5, y: 1, z: -0.5 }, { x: 5, y: 1, z: -0.5 }).scale).toBe(BOARD_LIMITS.maxScale);
  });
});

describe("thumbstick", () => {
  it("ignores the deadzone", () => {
    expect(deadzone(0.1)).toBe(0);
    expect(deadzone(1)).toBeCloseTo(1, 5);
    expect(stickAdjust(board, { x: 0.1, y: -0.1 }, 0.1, "held", 0)).toBe(board);
  });

  it("pushing forward while held makes the board larger; sideways yaws", () => {
    expect(stickAdjust(board, { x: 0, y: -1 }, 0.5, "held", 0).scale).toBeGreaterThan(board.scale);
    expect(stickAdjust(board, { x: 1, y: 0 }, 0.5, "held", 0).yaw).toBeLessThan(0);
  });

  it("nudges relative to the viewer when not held", () => {
    const away = stickAdjust(board, { x: 0, y: -1 }, 0.5, "nudge", 0);
    expect(away.position[2]).toBeLessThan(board.position[2]);
    const right = stickAdjust(board, { x: 1, y: 0 }, 0.5, "nudge", 0);
    expect(right.position[0]).toBeGreaterThan(0);
  });
});

describe("find list", () => {
  const visible = scene(
    [
      rfFeature({ identity: "loud", rssi: -40 }),
      rfFeature({ identity: "quiet", rssi: -85 }),
      rfFeature({ identity: "unk", category: "unknown_rf", protocol: "subghz" }),
      rfFeature({ identity: "tracked", operator_context: { headline: "Watched" } })
    ],
    [aircraftFeature("A1")]
  );

  it("groups entities for jumping", () => {
    expect(buildFindList(visible.rfEntities, visible.aircraftEntities, "review").map((item) => item.label)).toEqual(["unk"]);
    expect(buildFindList(visible.rfEntities, visible.aircraftEntities, "tracked")[0].detail).toBe("Watched");
    expect(buildFindList(visible.rfEntities, visible.aircraftEntities, "strongest")[0].label).toBe("loud");
    expect(buildFindList(visible.rfEntities, visible.aircraftEntities, "aircraft")).toHaveLength(1);
  });

  it("pages results", () => {
    const items = Array.from({ length: 13 }, (_, index) => index);
    expect(pageOf(items, 0, 6)).toEqual({ items: [0, 1, 2, 3, 4, 5], page: 0, pages: 3 });
    expect(pageOf(items, 9, 6).page).toBe(2);
    expect(pageOf([], 0, 6).pages).toBe(1);
  });
});

describe("input problem detection", () => {
  it("flags a blurred session (system menu has focus)", async () => {
    const { resolveInputProblem } = await import("../interaction");
    expect(resolveInputProblem({ session: {}, visibilityState: "visible-blurred" }, 2, 10_000)).toBe("blurred");
  });

  it("flags missing controllers only after a grace period", async () => {
    const { resolveInputProblem } = await import("../interaction");
    expect(resolveInputProblem({ session: {}, visibilityState: "visible" }, 0, 1000)).toBeNull();
    expect(resolveInputProblem({ session: {}, visibilityState: "visible" }, 0, 5000)).toBe("no-controllers");
    expect(resolveInputProblem({ session: {}, visibilityState: "visible" }, 2, 5000)).toBeNull();
    expect(resolveInputProblem({ session: null, visibilityState: null }, 0, 5000)).toBeNull();
  });
});

describe("seated panel heights", () => {
  it("lowers panels proportionally in seated mode", async () => {
    const { defaultPanelAnchor, SEATED_PANEL_HEIGHT_FACTOR } = await import("../interaction");
    const standing = defaultPanelAnchor("secondary", 0.5, "standing");
    const seated = defaultPanelAnchor("secondary", 0.5, "seated");
    expect(seated[1]).toBeCloseTo(standing[1] * SEATED_PANEL_HEIGHT_FACTOR, 5);
    expect(seated[0]).toBe(standing[0]);
  });
});
