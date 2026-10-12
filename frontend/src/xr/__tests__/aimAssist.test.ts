import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { aimAngle, pickAimTarget } from "../XRAimAssist";

const origin = new Vector3(0, 1, 0);
const forward = new Vector3(0, 0, -1);

describe("aimAngle", () => {
  it("ignores points behind the controller", () => {
    expect(aimAngle(origin, forward, new Vector3(0, 1, 1))).toBeNull();
  });

  it("accepts a token 2 cm off a ray at 1 m (inside the cone)", () => {
    const score = aimAngle(origin, forward, new Vector3(0.02, 1, -1))!;
    expect(score.angle).toBeLessThan(score.cone);
  });

  it("rejects a token 20 cm off a ray at 1 m", () => {
    const score = aimAngle(origin, forward, new Vector3(0.2, 1, -1))!;
    expect(score.angle).toBeGreaterThan(score.cone);
  });
});

describe("pickAimTarget", () => {
  const cone = 0.06;
  it("picks the candidate closest to the ray", () => {
    const scores = new Map([
      ["a", { angle: 0.04, cone }],
      ["b", { angle: 0.01, cone }]
    ]);
    expect(pickAimTarget(scores, null)).toBe("b");
  });

  it("returns null when nothing is inside the cone", () => {
    expect(pickAimTarget(new Map([["a", { angle: 0.1, cone }]]), null)).toBeNull();
  });

  it("keeps the current target through small tremor just outside the cone", () => {
    expect(pickAimTarget(new Map([["a", { angle: 0.08, cone }]]), "a")).toBe("a");
  });

  it("keeps the current target unless another is clearly closer", () => {
    const close = new Map([
      ["a", { angle: 0.03, cone }],
      ["b", { angle: 0.025, cone }]
    ]);
    expect(pickAimTarget(close, "a")).toBe("a");
    const clearly = new Map([
      ["a", { angle: 0.05, cone }],
      ["b", { angle: 0.005, cone }]
    ]);
    expect(pickAimTarget(clearly, "a")).toBe("b");
  });

  it("drops the target once the ray leaves the wider cone", () => {
    expect(pickAimTarget(new Map([["a", { angle: 0.2, cone }]]), "a")).toBeNull();
  });
});
