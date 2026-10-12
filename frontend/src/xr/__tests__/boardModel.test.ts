import { describe, expect, it } from "vitest";
import {
  BOARD_RADIUS_SCENE,
  DEFAULT_XR_LAYERS,
  ENTITY_BUDGETS,
  applyXRLayers,
  boardAircraftPosition,
  nextEntityBudget,
  nextFilterLens,
  parseStoredXRLayers,
  selectBudgetedEntities,
  toggleXRLayer,
  uncertaintyFootprint,
  nearestAimCandidate,
  aimAssistRadiusScene
} from "../boardModel";
import { aircraftFeature, rfFeature, scene } from "./fixtures";

describe("entity budget selection", () => {
  const many = scene(
    [
      ...Array.from({ length: 30 }, (_, index) => rfFeature({ identity: `wifi-${index}`, rssi: -40 - index })),
      ...Array.from({ length: 6 }, (_, index) => rfFeature({ identity: `unk-${index}`, category: "unknown_rf", protocol: "subghz", rssi: -90, freshness: "stale" }))
    ],
    Array.from({ length: 10 }, (_, index) => aircraftFeature(`AC${index}`))
  );

  it("caps RF and aircraft to the budget and reports drops", () => {
    const result = selectBudgetedEntities({ rfEntities: many.rfEntities, aircraftEntities: many.aircraftEntities, budget: { rf: 10, aircraft: 4 } });
    expect(result.rfEntities).toHaveLength(10);
    expect(result.aircraftEntities).toHaveLength(4);
    expect(result.droppedRf).toBe(many.rfEntities.length - 10);
    expect(result.droppedAircraft).toBe(6);
  });

  it("promotes low-priority review-required unknown RF, capped at half the budget", () => {
    // Stale unknowns rank below live Wi-Fi, so only promotion can include them.
    expect(many.rfEntities.slice(0, 6).every((entity) => entity.category === "wifi")).toBe(true);
    const result = selectBudgetedEntities({ rfEntities: many.rfEntities, aircraftEntities: [], budget: { rf: 6, aircraft: 0 } });
    const unknown = result.rfEntities.filter((entity) => entity.category === "unknown_rf");
    expect(unknown.length).toBe(3);
  });

  it("always keeps the selected entity", () => {
    const last = many.rfEntities[many.rfEntities.length - 1];
    const result = selectBudgetedEntities({ rfEntities: many.rfEntities, aircraftEntities: [], budget: { rf: 4, aircraft: 0 }, selectedId: last.id });
    expect(result.rfEntities.map((entity) => entity.id)).toContain(last.id);
    expect(result.rfEntities).toHaveLength(4);

    const aircraftLast = many.aircraftEntities[9];
    const aircraft = selectBudgetedEntities({ rfEntities: [], aircraftEntities: many.aircraftEntities, budget: { rf: 0, aircraft: 2 }, selectedId: aircraftLast.id });
    expect(aircraft.aircraftEntities.map((entity) => entity.id)).toContain(aircraftLast.id);
    expect(aircraft.aircraftEntities).toHaveLength(2);
  });

  it("preserves scene priority order", () => {
    const result = selectBudgetedEntities({ rfEntities: many.rfEntities, aircraftEntities: [], budget: { rf: 36, aircraft: 0 } });
    expect(result.rfEntities.map((entity) => entity.id)).toEqual(many.rfEntities.map((entity) => entity.id));
  });

  it("handles a zero budget", () => {
    const result = selectBudgetedEntities({ rfEntities: many.rfEntities, aircraftEntities: many.aircraftEntities, budget: { rf: 0, aircraft: 0 }, selectedId: many.rfEntities[0].id });
    expect(result.rfEntities).toHaveLength(0);
    expect(result.aircraftEntities).toHaveLength(0);
  });

  it("standalone budget is the most conservative and budgets cycle", () => {
    expect(ENTITY_BUDGETS.standalone.rf).toBeLessThan(ENTITY_BUDGETS.balanced.rf);
    expect(nextEntityBudget("standalone")).toBe("balanced");
    expect(nextEntityBudget("desktop")).toBe("standalone");
  });
});

describe("layer selection", () => {
  const visible = scene(
    [rfFeature({ identity: "plain" }), rfFeature({ identity: "tracked", operator_context: { headline: "Watched phone" } })],
    [aircraftFeature("AC1")]
  );

  it("shows everything by default", () => {
    const result = applyXRLayers(visible, DEFAULT_XR_LAYERS);
    expect(result.rfEntities).toHaveLength(2);
    expect(result.aircraftEntities).toHaveLength(1);
  });

  it("hides aircraft with the airspace layer off", () => {
    expect(applyXRLayers(visible, toggleXRLayer(DEFAULT_XR_LAYERS, "airspace")).aircraftEntities).toHaveLength(0);
  });

  it("keeps presence-tracked RF when the RF layer is off but presence is on", () => {
    const result = applyXRLayers(visible, { ...DEFAULT_XR_LAYERS, rf: false });
    expect(result.rfEntities.map((entity) => entity.identity)).toEqual(["tracked"]);
    expect(applyXRLayers(visible, { ...DEFAULT_XR_LAYERS, rf: false, presence: false }).rfEntities).toHaveLength(0);
  });

  it("toggles a layer without mutating", () => {
    const toggled = toggleXRLayer(DEFAULT_XR_LAYERS, "rf");
    expect(toggled.rf).toBe(false);
    expect(DEFAULT_XR_LAYERS.rf).toBe(true);
  });

  it("parses stored layers defensively", () => {
    expect(parseStoredXRLayers(JSON.stringify({ rf: false, airspace: "nope" }))).toEqual({ ...DEFAULT_XR_LAYERS, rf: false });
    expect(parseStoredXRLayers("not json")).toEqual(DEFAULT_XR_LAYERS);
  });

  it("cycles the shared filter lens", () => {
    expect(nextFilterLens("all")).toBe("wifi");
    expect(nextFilterLens("utility")).toBe("all");
    expect(nextFilterLens("airspace")).toBe("all");
  });
});

describe("board layout", () => {
  it("keeps aircraft inside the board radius with bearing preserved", () => {
    const [x, y, z] = boardAircraftPosition({ localMeters: { x: 100_000, z: 0 }, altitude: 38_000 });
    expect(Math.hypot(x, z)).toBeLessThan(BOARD_RADIUS_SCENE);
    expect(x).toBeGreaterThan(0);
    expect(z).toBe(0);
    expect(y).toBeGreaterThan(12);
    expect(y).toBeLessThanOrEqual(30);
  });

  it("handles missing altitude", () => {
    expect(boardAircraftPosition({ localMeters: { x: 0, z: 0 }, altitude: null })).toEqual([0, 12, 0]);
  });

  it("bounds the uncertainty footprint", () => {
    expect(uncertaintyFootprint(8)).toBeLessThan(uncertaintyFootprint(72));
    expect(uncertaintyFootprint(10_000)).toBe(4.2);
    expect(uncertaintyFootprint(Number.NaN)).toBe(0.9);
  });
});

describe("aim assist", () => {
  const candidates = [
    { id: "a", x: 0, z: 0 },
    { id: "b", x: 4, z: 0 },
    { id: "c", x: 20, z: 20 }
  ];

  it("snaps to the nearest token within range", () => {
    expect(nearestAimCandidate({ x: 2.5, z: 0 }, candidates, 6)).toBe("b");
    expect(nearestAimCandidate({ x: 0.4, z: 0.4 }, candidates, 6)).toBe("a");
  });

  it("returns null when nothing is close enough", () => {
    expect(nearestAimCandidate({ x: 40, z: -40 }, candidates, 6)).toBeNull();
    expect(nearestAimCandidate({ x: 0, z: 0 }, [], 6)).toBeNull();
  });

  it("keeps the physical snap radius constant as the board scales", () => {
    expect(aimAssistRadiusScene(1)).toBeCloseTo(6.2, 1);
    expect(aimAssistRadiusScene(2)).toBeCloseTo(3.1, 1);
  });
});

describe("presence from the watchlist", () => {
  it("treats watchlisted entities as presence even without operator context", () => {
    const visible = scene([rfFeature({ identity: "AA:BB", state_key: "kismet:device:phone" }), rfFeature({ identity: "other" })]);
    const tracked = new Set(["kismet:device:phone"]);
    const result = applyXRLayers(visible, { ...DEFAULT_XR_LAYERS, rf: false }, tracked);
    expect(result.rfEntities.map((entity) => entity.identity)).toEqual(["AA:BB"]);
    expect(applyXRLayers(visible, { ...DEFAULT_XR_LAYERS, rf: false }).rfEntities).toHaveLength(0);
  });
});
