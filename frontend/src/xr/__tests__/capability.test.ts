import { describe, expect, it } from "vitest";
import {
  enterableSessionModes,
  preferredSessionMode,
  resolvePassthroughStatus,
  resolveXRRuntimeState,
  type XRCapabilityProbe
} from "../capability";

function probe(overrides: Partial<XRCapabilityProbe> = {}): XRCapabilityProbe {
  return {
    hasNavigatorXR: true,
    secureContext: true,
    immersiveAr: "unsupported",
    immersiveVr: "unsupported",
    arError: null,
    vrError: null,
    emulated: false,
    userAgent: "test",
    checkedAt: "2026-10-10T00:00:00Z",
    ...overrides
  };
}

describe("resolveXRRuntimeState", () => {
  it("reports checking before the probe completes", () => {
    expect(resolveXRRuntimeState(null)).toBe("checking");
  });

  it("reports WebXR unavailable without navigator.xr", () => {
    expect(resolveXRRuntimeState(probe({ hasNavigatorXR: false, immersiveAr: "not-checked", immersiveVr: "not-checked" }))).toBe("WebXR unavailable");
  });

  it("prefers immersive-ar when supported", () => {
    expect(resolveXRRuntimeState(probe({ immersiveAr: "supported", immersiveVr: "supported" }))).toBe("immersive-ar available");
  });

  it("reports immersive-vr only when AR is unsupported", () => {
    expect(resolveXRRuntimeState(probe({ immersiveVr: "supported" }))).toBe("immersive-vr only");
  });

  it("treats AR probe errors as not supported", () => {
    expect(resolveXRRuntimeState(probe({ immersiveAr: "error", arError: "boom", immersiveVr: "supported" }))).toBe("immersive-vr only");
  });

  it("reports WebXR unavailable when navigator.xr exists but no immersive mode is supported", () => {
    expect(resolveXRRuntimeState(probe())).toBe("WebXR unavailable");
  });

  it("never reports an emulator as a real runtime", () => {
    expect(resolveXRRuntimeState(probe({ emulated: true, immersiveAr: "supported" }))).toBe("desktop simulator");
  });

  it("honors a forced simulator", () => {
    expect(resolveXRRuntimeState(probe({ immersiveAr: "supported" }), { forceSimulator: true })).toBe("desktop simulator");
    expect(enterableSessionModes(probe({ immersiveAr: "supported" }), { forceSimulator: true })).toEqual([]);
  });
});

describe("session mode selection", () => {
  it("requests immersive-ar only when supported", () => {
    const ar = probe({ immersiveAr: "supported", immersiveVr: "supported" });
    expect(preferredSessionMode(resolveXRRuntimeState(ar), ar)).toBe("immersive-ar");
    expect(enterableSessionModes(ar)).toEqual(["immersive-ar", "immersive-vr"]);
  });

  it("falls back to immersive-vr", () => {
    const vr = probe({ immersiveVr: "supported" });
    expect(preferredSessionMode(resolveXRRuntimeState(vr), vr)).toBe("immersive-vr");
    expect(enterableSessionModes(vr)).toEqual(["immersive-vr"]);
  });

  it("offers nothing when unavailable", () => {
    const none = probe({ hasNavigatorXR: false });
    expect(preferredSessionMode(resolveXRRuntimeState(none), none)).toBeNull();
  });
});

describe("resolvePassthroughStatus", () => {
  it("never claims passthrough for a VR-only runtime", () => {
    const status = resolvePassthroughStatus({ runtimeState: "immersive-vr only", probe: probe({ immersiveVr: "supported" }), sessionMode: null, environmentBlendMode: null });
    expect(status.verdict).toBe("unavailable");
    expect(status.label).toContain("UNAVAILABLE");
  });

  it("treats isSessionSupported(immersive-ar) as unverified until a session reports blending", () => {
    const status = resolvePassthroughStatus({ runtimeState: "immersive-ar available", probe: probe({ immersiveAr: "supported" }), sessionMode: null, environmentBlendMode: null });
    expect(status.verdict).toBe("unverified");
  });

  it("flags an AR session with opaque blending as not passthrough", () => {
    const status = resolvePassthroughStatus({ runtimeState: "immersive-ar available", probe: probe({ immersiveAr: "supported" }), sessionMode: "immersive-ar", environmentBlendMode: "opaque" });
    expect(status.verdict).toBe("not-active");
  });

  it("reports runtime passthrough only for alpha-blend/additive AR sessions", () => {
    const status = resolvePassthroughStatus({ runtimeState: "immersive-ar available", probe: probe({ immersiveAr: "supported" }), sessionMode: "immersive-ar", environmentBlendMode: "alpha-blend" });
    expect(status.verdict).toBe("runtime-reports-passthrough");
  });

  it("labels emulated sessions as emulated even if they report alpha-blend", () => {
    const status = resolvePassthroughStatus({ runtimeState: "desktop simulator", probe: probe({ emulated: true, immersiveAr: "supported" }), sessionMode: "immersive-ar", environmentBlendMode: "alpha-blend" });
    expect(status.verdict).toBe("emulated");
  });

  it("calls out insecure contexts", () => {
    const status = resolvePassthroughStatus({ runtimeState: "WebXR unavailable", probe: probe({ hasNavigatorXR: false, secureContext: false }), sessionMode: null, environmentBlendMode: null });
    expect(status.detail).toContain("secure context");
  });
});
