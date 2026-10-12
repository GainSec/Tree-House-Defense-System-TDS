import { describe, expect, it } from "vitest";
import { buildAlertCardModel, buildSelectionCardModel } from "../cards";
import { resolveDataProvenance } from "../../data/provenance";
import type { SituationSourceHealth } from "../../data/situationModel";
import type { InfrastructureAlert } from "../../data/useInfrastructureAlerts";
import { NOW, aircraftFeature, rfEntity, scene } from "./fixtures";

const live = resolveDataProvenance({
  status: "live",
  sceneOrigin: "live",
  hasSceneModel: true,
  layers: { rf: "live", aircraft: "live" },
  lastLiveAt: "2026-10-10T11:59:58Z",
  cachedAt: null,
  error: null,
  pollIntervalMs: 15_000,
  replayFrozen: false,
  alertsStatus: "live",
  now: NOW
});
const demo = resolveDataProvenance({
  status: "error",
  sceneOrigin: null,
  hasSceneModel: false,
  layers: { rf: "error", aircraft: "error" },
  lastLiveAt: null,
  cachedAt: null,
  error: "offline",
  pollIntervalMs: 15_000,
  replayFrozen: false,
  alertsStatus: "error",
  now: NOW
});

const kismetHealth: SituationSourceHealth = {
  source: "kismet",
  label: "Kismet",
  status: "stale",
  recordCount: 12,
  lastSeenAt: "2026-10-10T10:00:00Z",
  ageLabel: "2h ago",
  kindCounts: {},
  examples: []
};

describe("selected-card view model", () => {
  it("returns null without a selection", () => {
    expect(buildSelectionCardModel({ entity: null, provenance: live })).toBeNull();
  });

  it("builds an RF card with every required field", () => {
    const entity = rfEntity({ identity: "aa:bb", label: "Kitchen phone", rssi: -52, source: "kismet+unifi" });
    const card = buildSelectionCardModel({ entity, provenance: live, now: NOW })!;
    expect(card.title).toBe("Kitchen phone");
    expect(card.identity).toBe("aa:bb");
    expect(card.typeLabel).toContain("Wi-Fi");
    expect(card.primaryMetric.value).toBe("-52 dBm");
    expect(card.lastObserved.value).toBe("30s ago");
    expect(card.confidence.value).toMatch(/confidence/);
    expect(card.freshness.value).toBe("LIVE");
    expect(card.sources).toBe("kismet, unifi");
    expect(card.posture.value).toBe("OBSERVED");
    expect(card.provenance.value).toBe("LIVE");
    expect(card.desktopPath).toBe("/presence/entities/aa%3Abb");
  });

  it("marks unknown RF as review required", () => {
    const entity = rfEntity({ identity: "433", category: "unknown_rf", protocol: "subghz", rssi: null, frequency: "433.92" });
    const card = buildSelectionCardModel({ entity, provenance: live, now: NOW })!;
    expect(card.posture.value).toBe("REVIEW REQUIRED");
    expect(card.primaryMetric.value).toBe("433.92 MHz");
  });

  it("carries DEMO provenance into the card", () => {
    const entity = rfEntity({ identity: "x" });
    expect(buildSelectionCardModel({ entity, provenance: demo, now: NOW })!.provenance.value).toContain("DEMO");
  });

  it("builds aircraft and source cards", () => {
    const aircraft = scene([], [aircraftFeature("ABC")]).aircraftEntities[0];
    const aircraftCard = buildSelectionCardModel({ entity: aircraft, provenance: live, now: NOW })!;
    expect(aircraftCard.primaryMetric.value).toContain("12,000 ft");
    expect(aircraftCard.typeLabel).toContain("A320");

    const sourceCard = buildSelectionCardModel({ entity: { kind: "source", source: "kismet", label: "Kismet" }, provenance: live, sourceHealth: [kismetHealth], now: NOW })!;
    expect(sourceCard.posture.value).toBe("DEGRADED");
    expect(sourceCard.primaryMetric.value).toBe("12");
  });
});

describe("alert card view model", () => {
  const alerts: InfrastructureAlert[] = [
    { id: "1", source: "unifi", type: "unifi_alarm", severity: "info", summary: "client joined", zoneId: null, createdAt: null, details: [] },
    { id: "2", source: "openwrt", type: "openwrt_alarm", severity: "critical", summary: "WAN down", zoneId: null, createdAt: null, details: ["wan"] }
  ];
  const unknown = scene([
    { ...rfEntityFeature("u1"), category: "unknown_rf" },
    { ...rfEntityFeature("u2"), category: "unknown_rf", freshness: "stale" },
    rfEntityFeature("w1")
  ]).rfEntities;

  it("includes only important exceptions, critical first", () => {
    const model = buildAlertCardModel({ alerts, alertsStatus: "live", rfEntities: unknown, sourceHealth: [kismetHealth], situationStatus: "live" });
    expect(model.items[0].title).toContain("WAN down");
    expect(model.items.some((item) => item.title.includes("client joined"))).toBe(false);
    expect(model.items.filter((item) => item.kind === "unknown-rf")).toHaveLength(2);
    expect(model.items.some((item) => item.kind === "collector")).toBe(true);
    expect(model.tone).toBe("hot");
  });

  it("reports feed failures and quiet states", () => {
    expect(buildAlertCardModel({ alerts: [], alertsStatus: "error", rfEntities: [], sourceHealth: [], situationStatus: "error" }).items.map((item) => item.kind)).toEqual(["feed", "feed"]);
    const quiet = buildAlertCardModel({ alerts: [], alertsStatus: "empty", rfEntities: [], sourceHealth: [], situationStatus: "live" });
    expect(quiet.items).toHaveLength(0);
    expect(quiet.statusLine).toBe("No exceptions");
    expect(quiet.tone).toBe("good");
  });
});

function rfEntityFeature(identity: string) {
  return {
    identity,
    label: identity,
    protocol: "subghz",
    kind: "device",
    source: "intercept",
    category: "wifi" as const,
    latitude: 36.1,
    longitude: -75.17,
    location_accuracy: "estimated" as const,
    estimated: true,
    rssi: -70,
    channel: null,
    frequency: null,
    manufacturer: null,
    first_seen_at: null,
    last_seen_at: "2026-10-10T11:59:00Z",
    count: 1,
    freshness: "live" as const
  };
}

describe("selection detail tabs", () => {
  it("reads signal and evidence rows from the shared inspector model", async () => {
    const { rfInspectorModel } = await import("../../data/operatorInspector");
    const { inspectorTabRows } = await import("../cards");
    const entity = rfEntity({ identity: "sig", rssi: -60, channel: "6" });
    const model = rfInspectorModel(entity);
    const signal = inspectorTabRows(model, "signal");
    expect(signal.find((row) => row.label === "RSSI")?.value).toBe("-60 dBm");
    expect(inspectorTabRows(model, "evidence").some((row) => row.label === "First Seen")).toBe(true);
    expect(inspectorTabRows(null, "signal")).toEqual([]);
  });

  it("summarises the presence dossier for the history tab", async () => {
    const { dossierRows } = await import("../cards");
    expect(dossierRows(null)).toEqual([]);
    const dossier = {
      entity: { label: "Phone", seen_count: 42, first_seen_at: "2026-10-09T12:00:00Z", last_seen_at: "2026-10-10T11:59:00Z" },
      watchlist: { label: "Visitor phone" },
      identity: { primary: "x", label: "Visitor phone", aliases: [], confidence: 0.82 },
      scores: { interest: 63.4, reliability: 70 },
      reliability: { score: 70, label: "Good", freshness: "live", sighting_count: 12, current_seen_count: 3, source_count: 2, strengths: [], gaps: [] },
      reasons: ["Seen at night", "Multiple sources", "ignored third"],
      anomalies: [{ id: "a", label: "New location", severity: "high", tone: "hot" }],
      rhythm: { sample_count: 10, peak_hours: [{ hour: 7, count: 4 }, { hour: 18, count: 3 }], hotspots: [] }
    } as unknown as import("../../domain/types").PresenceDossier;
    const rows = dossierRows(dossier, NOW);
    const byLabel = (label: string) => rows.filter((row) => row.label === label).map((row) => row.value);
    expect(byLabel("Identity")[0]).toBe("Visitor phone (82%)");
    expect(byLabel("Tracked")[0]).toContain("Visitor phone");
    expect(byLabel("Last seen")[0]).toBe("1m ago");
    expect(byLabel("Peak hours")[0]).toBe("07:00, 18:00");
    expect(byLabel("Reason")).toHaveLength(2);
    expect(rows.find((row) => row.label === "Anomaly")?.tone).toBe("hot");
  });
});
