import { describe, expect, it } from "vitest";
import {
  MAX_TELEPORT_RADIUS,
  RF_MAX_Y,
  RF_MIN_Y,
  SKY_DOME_RADIUS,
  WAYPOINTS,
  bearingDegrees,
  clampToSite,
  compassLabel,
  elevationDegrees,
  lifeRfHeight,
  nearestForLabels,
  originForWaypoint,
  parseLifeState,
  sceneToWorld,
  skyPosition,
  snapTurnOrigin,
  stepOrigin,
  teleportOrigin,
  worldToScene
} from "../lifeSize";

const close = (a: number[], b: number[], digits = 4) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index], digits));

describe("scene <-> world", () => {
  it("puts scene north at world -Z with no alignment", () => {
    close(sceneToWorld([0, 1, 10], 0), [0, 1, -10]);
    close(sceneToWorld([5, 0, 0], 0), [5, 0, 0]);
  });

  it("round-trips under any alignment", () => {
    for (const yaw of [0, 0.7, -2, Math.PI]) {
      close(worldToScene(sceneToWorld([3, 1.2, -7], yaw), yaw), [3, 1.2, -7]);
    }
  });

  it("aligning north rotates the world", () => {
    // Operator faces east (three.js yaw -90deg) and aligns: scene north should now be in front of them (world +X).
    close(sceneToWorld([0, 0, 10], -Math.PI / 2), [10, 0, 0]);
  });
});

describe("sky placement", () => {
  it("keeps the true bearing and elevation on the dome", () => {
    const [x, y, z] = skyPosition({ x: 10_000, z: 0 }, 10_000 / 0.3048 / Math.sqrt(3));
    expect(Math.hypot(x, y, z)).toBeCloseTo(SKY_DOME_RADIUS, 3);
    expect(z).toBeCloseTo(0, 5);
    expect(x).toBeGreaterThan(0);
    // atan(1/sqrt(3)) = 30 degrees
    expect((Math.atan2(y, x) * 180) / Math.PI).toBeCloseTo(30, 2);
  });

  it("a distant airliner sits low; an overhead plane sits high", () => {
    expect(elevationDegrees({ x: 0, z: 40_000 }, 35_000)).toBeLessThan(20);
    expect(elevationDegrees({ x: 0, z: 500 }, 3_000)).toBeGreaterThan(60);
    expect(skyPosition({ x: 0, z: 0 }, 1000)).toEqual([0, SKY_DOME_RADIUS, 0]);
  });

  it("labels compass bearings", () => {
    expect(bearingDegrees(0, 10)).toBe(0);
    expect(bearingDegrees(10, 0)).toBe(90);
    expect(compassLabel(bearingDegrees(-10, -10))).toBe("SW");
  });
});

describe("RF heights", () => {
  it("keeps tokens in a chest-height band", () => {
    expect(lifeRfHeight(1.8)).toBeCloseTo(1, 5);
    expect(lifeRfHeight(-5)).toBe(RF_MIN_Y);
    expect(lifeRfHeight(50)).toBe(RF_MAX_Y);
  });
});

describe("locomotion", () => {
  const head: [number, number, number] = [0.3, 1.6, 0.2];

  it("teleports so the head lands on the target", () => {
    const origin = teleportOrigin({ x: 0, z: 0, yaw: 0 }, head, [5, 0, -5]);
    expect(origin.x + head[0]).toBeCloseTo(5, 5);
    expect(origin.z + head[2]).toBeCloseTo(-5, 5);
  });

  it("clamps teleport to the site radius", () => {
    const far = clampToSite([500, 0, 0]);
    expect(Math.hypot(far[0], far[2])).toBeCloseTo(MAX_TELEPORT_RADIUS, 3);
  });

  it("snap-turns about the head without moving it", () => {
    const origin = { x: 1, z: 2, yaw: 0 };
    const headWorld: [number, number, number] = [origin.x + 0.3, 1.6, origin.z + 0.2];
    const turned = snapTurnOrigin(origin, headWorld, Math.PI / 2);
    expect(turned.yaw).toBeCloseTo(Math.PI / 2, 5);
    // The origin swings around the head; its distance to the head is preserved.
    expect(Math.hypot(turned.x - headWorld[0], turned.z - headWorld[2])).toBeCloseTo(Math.hypot(0.3, 0.2), 5);
  });

  it("steps forward along the gaze", () => {
    const stepped = stepOrigin({ x: 0, z: 0, yaw: 0 }, [0, 1.6, 0], 0, 2);
    expect(stepped.z).toBeCloseTo(-2, 5);
  });
});

describe("waypoints", () => {
  it("puts the operator at the waypoint facing its bearing", () => {
    const north = WAYPOINTS.find((waypoint) => waypoint.id === "north")!;
    const origin = originForWaypoint(north, 0);
    close([origin.x, origin.z], [0, -32]);
    // Facing south (180deg): three.js yaw of +/-pi.
    expect(Math.abs(Math.cos(origin.yaw) + 1)).toBeLessThan(1e-6);
    const receiver = originForWaypoint(WAYPOINTS[0], 0, [0.2, 1.6, 0.1]);
    close([receiver.x + 0.2, receiver.z + 0.1], [0, 0]);
  });
});

describe("labels and persistence", () => {
  it("labels only the nearest items in range", () => {
    const items = [
      { id: "a", world: [1, 1, 0] as [number, number, number] },
      { id: "b", world: [20, 1, 0] as [number, number, number] },
      { id: "c", world: [100, 1, 0] as [number, number, number] }
    ];
    expect(nearestForLabels(items, [0, 1.6, 0], 5, 35).map((item) => item.id)).toEqual(["a", "b"]);
    expect(nearestForLabels(items, [0, 1.6, 0], 1).map((item) => item.id)).toEqual(["a"]);
  });

  it("parses stored life state defensively", () => {
    expect(parseLifeState(JSON.stringify({ origin: { x: 1, z: "no", yaw: 0.5 }, northYaw: 0.3 }))).toEqual({ origin: { x: 1, z: 0, yaw: 0.5 }, northYaw: 0.3 });
    expect(parseLifeState("{")).toEqual({ origin: { x: 0, z: 0, yaw: 0 }, northYaw: 0 });
  });
});

describe("spawn in front of the head", async () => {
  const { spawnInFrontOfHead } = await import("../lifeSize");
  it("spawns ahead of the gaze in origin-local space", () => {
    const local = spawnInFrontOfHead({ position: [0, 1.6, 0], yaw: 0 }, { x: 0, z: 0, yaw: 0 }, 1, 0, 0.3);
    close(local, [0, 1.9, -1]);
  });
  it("accounts for a turned and moved origin", () => {
    // Origin moved to (5,0,5) and turned 90deg; head at origin facing world -X (yaw +90deg).
    const local = spawnInFrontOfHead({ position: [5, 1.6, 5], yaw: Math.PI / 2 }, { x: 5, z: 5, yaw: Math.PI / 2 }, 1, 0, 0);
    // In the origin's own frame the head faces its local -Z.
    close(local, [0, 1.6, -1]);
  });
});
