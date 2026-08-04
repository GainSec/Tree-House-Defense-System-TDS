import type { RfSceneEntity } from "./sceneModel";

export interface RfQualitySummary {
  score: number;
  label: "High confidence" | "Medium confidence" | "Low confidence";
  chips: string[];
  reasons: string[];
}

export function rfQualitySummary(entity: RfSceneEntity, now = new Date()): RfQualitySummary {
  const locationScore = entity.locationAccuracy === "real" ? 38 : entity.locationAccuracy === "receiver" ? 24 : 14;
  const freshnessScore = entity.freshness === "live" ? 26 : entity.freshness === "stale" ? 12 : 0;
  const signalScore = typeof entity.rssi === "number" ? Math.max(0, Math.min(18, Math.round((entity.rssi + 95) / 4))) : 6;
  const countScore = Math.min(12, Math.ceil(Math.log2(Math.max(1, entity.count))) * 3);
  const agePenalty = lastSeenAgeMinutes(entity.lastSeenAt, now) > 60 ? 10 : 0;
  const score = Math.max(0, Math.min(100, locationScore + freshnessScore + signalScore + countScore - agePenalty));

  return {
    score,
    label: score >= 75 ? "High confidence" : score >= 55 ? "Medium confidence" : "Low confidence",
    chips: qualityChips(entity, now),
    reasons: qualityReasons(entity, now)
  };
}

function qualityChips(entity: RfSceneEntity, now: Date): string[] {
  const chips = [
    entity.locationAccuracy === "real" ? "real GPS" : entity.locationAccuracy === "receiver" ? "receiver-origin" : "RSSI-estimated",
    entity.freshness,
    typeof entity.rssi === "number" ? `${entity.rssi} dBm` : "no RSSI",
    `${entity.count.toLocaleString()} sightings`
  ];
  const age = lastSeenAgeMinutes(entity.lastSeenAt, now);
  if (Number.isFinite(age)) {
    chips.push(age < 1 ? "seen now" : `${Math.round(age)}m age`);
  }
  return chips;
}

function qualityReasons(entity: RfSceneEntity, now: Date): string[] {
  const reasons = [
    entity.locationAccuracy === "real" ? "Coordinate came from source payload." : "Position is inferred for operator context.",
    entity.freshness === "live" ? "Recently observed by TDS." : "Observation is not currently live.",
    typeof entity.rssi === "number" ? "RSSI contributes to range estimate." : "RSSI missing, using default uncertainty."
  ];
  const age = lastSeenAgeMinutes(entity.lastSeenAt, now);
  if (Number.isFinite(age) && age > 60) {
    reasons.push("Last seen more than one hour ago.");
  }
  return reasons;
}

function lastSeenAgeMinutes(value: string | null, now: Date): number {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, (now.getTime() - parsed.getTime()) / 60_000);
}
