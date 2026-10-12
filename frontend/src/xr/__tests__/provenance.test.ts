import { describe, expect, it } from "vitest";
import { resolveDataProvenance, type ProvenanceInput } from "../../data/provenance";
import { appendReplayFrame, selectReplayFrame } from "../../ui/replayTimeline";
import { demoScene } from "../../data/demoScene";

const NOW = new Date("2026-10-10T12:00:00Z");

function input(overrides: Partial<ProvenanceInput> = {}): ProvenanceInput {
  return {
    status: "live",
    sceneOrigin: "live",
    hasSceneModel: true,
    layers: { rf: "live", aircraft: "live" },
    lastLiveAt: "2026-10-10T11:59:55Z",
    cachedAt: null,
    error: null,
    pollIntervalMs: 15_000,
    replayFrozen: false,
    alertsStatus: "live",
    now: NOW,
    ...overrides
  };
}

describe("data provenance labels", () => {
  it("LIVE for a fresh successful poll", () => {
    const result = resolveDataProvenance(input());
    expect(result.label).toBe("LIVE");
    expect(result.synthetic).toBe(false);
    expect(result.backend).toBe("connected");
  });

  it("DEMO when no backend scene exists, never LIVE", () => {
    const result = resolveDataProvenance(input({ hasSceneModel: false, sceneOrigin: null, status: "error", error: "fetch failed", lastLiveAt: null }));
    expect(result.label).toBe("DEMO");
    expect(result.synthetic).toBe(true);
    expect(result.detail).toContain("NOT observations");
    expect(result.backend).toBe("unreachable");
  });

  it("DEMO while waiting for the first response", () => {
    const result = resolveDataProvenance(input({ hasSceneModel: false, sceneOrigin: null, status: "loading", lastLiveAt: null }));
    expect(result.label).toBe("DEMO");
    expect(result.backend).toBe("connecting");
  });

  it("CACHED for a locally cached scene before the backend answers", () => {
    const result = resolveDataProvenance(input({ sceneOrigin: "cache", status: "loading", lastLiveAt: null, cachedAt: "2026-10-10T10:00:00Z" }));
    expect(result.label).toBe("CACHED");
    expect(result.detail).toContain("2h");
  });

  it("ERROR when the cached scene cannot be refreshed", () => {
    expect(resolveDataProvenance(input({ sceneOrigin: "cache", status: "error", lastLiveAt: null })).label).toBe("ERROR");
  });

  it("ERROR when a live scene stops refreshing", () => {
    const result = resolveDataProvenance(input({ status: "error", error: "502" }));
    expect(result.label).toBe("ERROR");
    expect(result.detail).toContain("502");
  });

  it("ERROR when only the RF layer fails (hook still reports live)", () => {
    expect(resolveDataProvenance(input({ layers: { rf: "error", aircraft: "live" } })).label).toBe("ERROR");
  });

  it("DEMO, never LIVE, when the backend is the synthetic mock", () => {
    const result = resolveDataProvenance(input({ syntheticSource: true }));
    expect(result.label).toBe("DEMO");
    expect(result.headline).toBe("DEMO · MOCK BACKEND");
    expect(result.synthetic).toBe(true);
    expect(result.backend).toBe("connected");
  });

  it("STALE once several poll cycles are missed", () => {
    const result = resolveDataProvenance(input({ lastLiveAt: "2026-10-10T11:58:00Z" }));
    expect(result.label).toBe("STALE");
  });

  it("flags mixed state when the scene is live but alerts are failing", () => {
    const result = resolveDataProvenance(input({ alertsStatus: "error" }));
    expect(result.label).toBe("LIVE");
    expect(result.mixed).toBe(true);
    expect(result.backend).toBe("degraded");
  });
});

describe("replay / live behavior", () => {
  it("REPLAY takes precedence and flags live alerts as mixed state", () => {
    const result = resolveDataProvenance(input({ replayFrozen: true, replayCapturedAt: "2026-10-10T11:59:00Z" }));
    expect(result.label).toBe("REPLAY");
    expect(result.mixed).toBe(true);
    expect(result.mixedDetail).toContain("alert feed is still LIVE");
  });

  it("REPLAY without live alerts is not mixed", () => {
    expect(resolveDataProvenance(input({ replayFrozen: true, alertsStatus: "error" })).mixed).toBe(false);
  });

  it("REPLAY of a demo frame stays flagged as synthetic", () => {
    const result = resolveDataProvenance(input({ replayFrozen: true, replaySynthetic: true }));
    expect(result.label).toBe("REPLAY");
    expect(result.synthetic).toBe(true);
    expect(result.headline).toBe("REPLAY · DEMO");
    expect(result.detail).toContain("NOT observations");
  });

  it("REPLAY wins over DEMO so a frozen frame is never presented as live", () => {
    expect(resolveDataProvenance(input({ replayFrozen: true, hasSceneModel: false })).label).toBe("REPLAY");
  });

  it("replay frames scrub within bounds", () => {
    let frames = appendReplayFrame([], demoScene, "2026-10-10T11:00:00Z");
    frames = appendReplayFrame(frames, demoScene, "2026-10-10T11:01:00Z");
    expect(selectReplayFrame(frames, 1, 1)?.index).toBe(1);
    expect(selectReplayFrame(frames, 1, -1)?.frame.capturedAt).toBe("2026-10-10T11:00:00Z");
    expect(selectReplayFrame([], 0, 1)).toBeNull();
  });
});
