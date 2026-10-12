import type { DashboardDataStatus, DashboardSceneOrigin, LayerStatus } from "./useDashboardData";
import type { InfrastructureAlertStatus } from "./useInfrastructureAlerts";

/**
 * Data provenance for the operator. Every surface that shows entities must
 * be able to say, unambiguously, which of these it is showing.
 */
export type ProvenanceLabel = "LIVE" | "CACHED" | "STALE" | "DEMO" | "ERROR" | "REPLAY";
export type ProvenanceTone = "good" | "warn" | "hot" | "muted" | "replay";

export interface ProvenanceInput {
  status: DashboardDataStatus;
  sceneOrigin: DashboardSceneOrigin;
  hasSceneModel: boolean;
  /** The backend identifies itself as the synthetic mock (site.source === "mock"). */
  syntheticSource?: boolean;
  layers: { rf: LayerStatus; aircraft: LayerStatus };
  lastLiveAt: string | null;
  cachedAt: string | null;
  error: string | null;
  pollIntervalMs: number;
  replayFrozen: boolean;
  replayCapturedAt?: string | null;
  /** The frozen frame was captured from built-in demo entities. */
  replaySynthetic?: boolean;
  alertsStatus: InfrastructureAlertStatus;
  now?: Date;
}

export interface DataProvenance {
  label: ProvenanceLabel;
  tone: ProvenanceTone;
  /** One-line headline suitable for a badge. */
  headline: string;
  /** Explanation for diagnostics and cards. */
  detail: string;
  /** True when the scene and other feeds disagree (e.g. frozen replay scene, live alerts). */
  mixed: boolean;
  mixedDetail: string | null;
  /** True when entities shown are not observations from this deployment. */
  synthetic: boolean;
  ageSeconds: number | null;
  backend: "connected" | "connecting" | "degraded" | "unreachable";
}

/** Scene is STALE once it has missed this many poll cycles. */
export const STALE_AFTER_POLLS = 3;
export const MIN_STALE_AFTER_MS = 45_000;

export function staleAfterMs(pollIntervalMs: number): number {
  return Math.max(MIN_STALE_AFTER_MS, pollIntervalMs * STALE_AFTER_POLLS);
}

export function resolveDataProvenance(input: ProvenanceInput): DataProvenance {
  const now = input.now ?? new Date();
  const ageSeconds = secondsSince(input.lastLiveAt, now);
  const backend = backendState(input);
  const alertsLive = input.alertsStatus === "live" || input.alertsStatus === "empty";

  if (input.replayFrozen) {
    const capturedAge = secondsSince(input.replayCapturedAt ?? null, now);
    const synthetic = input.replaySynthetic === true;
    return {
      label: "REPLAY",
      tone: "replay",
      headline: synthetic ? "REPLAY · DEMO" : "REPLAY",
      detail: `Scene frozen at a captured frame${capturedAge !== null ? ` (${formatAge(capturedAge)} ago)` : ""}. Entities are not updating.${
        synthetic ? " The frame contains built-in demo entities, NOT observations." : ""
      }`,
      mixed: alertsLive,
      mixedDetail: alertsLive ? "Mixed state: scene is REPLAY, alert feed is still LIVE." : null,
      synthetic,
      ageSeconds: capturedAge,
      backend
    };
  }

  if (!input.hasSceneModel) {
    const reason =
      input.status === "error"
        ? `Backend unreachable${input.error ? `: ${input.error}` : ""}.`
        : input.status === "loading"
          ? "Waiting for the first backend response."
          : "Backend returned no scene.";
    return {
      label: "DEMO",
      tone: "warn",
      headline: input.status === "error" ? "DEMO · BACKEND ERROR" : "DEMO",
      detail: `Built-in demo entities. These are NOT observations. ${reason}`,
      mixed: false,
      mixedDetail: null,
      synthetic: true,
      ageSeconds: null,
      backend
    };
  }

  if (input.syntheticSource) {
    return {
      label: "DEMO",
      tone: "warn",
      headline: "DEMO · MOCK BACKEND",
      detail: `Synthetic entities served by the TDS mock backend. These are NOT observations.${input.status === "error" ? " Mock backend is currently failing." : ""}`,
      mixed: false,
      mixedDetail: null,
      synthetic: true,
      ageSeconds: secondsSince(input.lastLiveAt, now),
      backend
    };
  }

  if (input.sceneOrigin === "cache") {
    const cachedAge = secondsSince(input.cachedAt, now);
    const failed = input.status === "error" || input.layers.rf === "error" || input.layers.aircraft === "error";
    return {
      label: failed ? "ERROR" : "CACHED",
      tone: failed ? "hot" : "muted",
      headline: failed ? "ERROR · CACHED DATA" : "CACHED",
      detail: `Showing the last locally cached map${cachedAge !== null ? ` from ${formatAge(cachedAge)} ago` : ""}. ${
        failed ? `Backend refresh failing${input.error ? `: ${input.error}` : ""}.` : "Waiting for a live refresh."
      }`,
      mixed: false,
      mixedDetail: null,
      synthetic: false,
      ageSeconds: cachedAge,
      backend
    };
  }

  const layerFailed = input.layers.rf === "error" || input.layers.aircraft === "error";
  if (input.status === "error" || layerFailed) {
    return {
      label: "ERROR",
      tone: "hot",
      headline: "ERROR · LAST KNOWN",
      detail: `Refresh failing${input.error ? `: ${input.error}` : ""}. Showing last live data${ageSeconds !== null ? ` from ${formatAge(ageSeconds)} ago` : ""}.`,
      mixed: false,
      mixedDetail: null,
      synthetic: false,
      ageSeconds,
      backend
    };
  }

  if (ageSeconds === null || ageSeconds * 1000 > staleAfterMs(input.pollIntervalMs)) {
    return {
      label: "STALE",
      tone: "muted",
      headline: "STALE",
      detail: `No successful refresh${ageSeconds !== null ? ` for ${formatAge(ageSeconds)}` : ""}.`,
      mixed: false,
      mixedDetail: null,
      synthetic: false,
      ageSeconds,
      backend
    };
  }

  const alertsFailed = input.alertsStatus === "error";
  return {
    label: "LIVE",
    tone: "good",
    headline: "LIVE",
    detail: `Live backend data, refreshed ${formatAge(ageSeconds)} ago.`,
    mixed: alertsFailed,
    mixedDetail: alertsFailed ? "Mixed state: scene is LIVE, alert feed is failing." : null,
    synthetic: false,
    ageSeconds,
    backend
  };
}

function backendState(input: ProvenanceInput): DataProvenance["backend"] {
  if (input.status === "loading") {
    return "connecting";
  }
  if (input.status === "error") {
    return "unreachable";
  }
  if (input.layers.rf === "error" || input.layers.aircraft === "error" || input.alertsStatus === "error") {
    return "degraded";
  }
  return "connected";
}

function secondsSince(value: string | null, now: Date): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.round((now.getTime() - parsed) / 1000));
}

export function formatAge(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3600)}h`;
  }
  return `${Math.round(seconds / 86_400)}d`;
}
