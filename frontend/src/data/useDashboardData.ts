import { useEffect, useRef, useState } from "react";
import type {
  AircraftMapFeature,
  AirspaceLane,
  ChangeBriefing,
  RfBurstSwarm,
  RfMapFeature,
  SensorCoverageResponse,
  SiteAnchor,
  SpectrumOccupancyBucket
} from "../domain/types";
import {
  fetchAircraftMap,
  fetchAirspaceLanes,
  fetchChangeBriefing,
  fetchRfBurstSwarms,
  fetchRfMap,
  fetchSensorCoverage,
  fetchSpectrumOccupancy,
  type CollectionResponse
} from "./api";
import { buildSceneModel, type SceneModel } from "./sceneModel";

export type LayerStatus = "loading" | "live" | "empty" | "error";
export type DashboardDataStatus = "loading" | "live" | "error";

export interface DashboardDataState {
  status: DashboardDataStatus;
  sceneModel: SceneModel | null;
  layers: {
    rf: LayerStatus;
    aircraft: LayerStatus;
  };
  airspaceLanes: AirspaceLane[];
  spectrumOccupancy: SpectrumOccupancyBucket[];
  rfBursts: RfBurstSwarm[];
  changeBriefing: ChangeBriefing | null;
  sensorCoverage: SensorCoverageResponse | null;
  lastUpdatedAt: string | null;
  error: string | null;
}

export interface DashboardDataOptions {
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const MAP_CACHE_KEY = "tds:3d-dashboard:last-map";

interface CachedMapPayload {
  rf: {
    items: RfMapFeature[];
    count: number;
    total_count?: number;
  };
  aircraft: {
    items: AircraftMapFeature[];
    count: number;
    total_count?: number;
  };
  site?: SiteAnchor;
  cachedAt: string;
}

export function useDashboardData({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS }: DashboardDataOptions = {}): DashboardDataState {
  const cachedMapPayload = readCachedMapPayload();
  const cachedSceneModel = cachedMapPayload
    ? buildSceneModel({
        rf: cachedMapPayload.rf.items,
        aircraft: cachedMapPayload.aircraft.items,
        site: cachedMapPayload.site
      })
    : null;
  const previousSceneModel = useRef<SceneModel | null>(cachedSceneModel);
  const previousRfResponse = useRef<CollectionResponse<RfMapFeature>>(cachedMapPayload?.rf ?? { items: [], count: 0 });
  const previousAircraftResponse = useRef<CollectionResponse<AircraftMapFeature>>(cachedMapPayload?.aircraft ?? { items: [], count: 0 });
  const rfRequestId = useRef(0);
  const [state, setState] = useState<DashboardDataState>({
    status: "loading",
    sceneModel: cachedSceneModel,
    layers: {
      rf: "loading",
      aircraft: "loading"
    },
    airspaceLanes: [],
    spectrumOccupancy: [],
    rfBursts: [],
    changeBriefing: null,
    sensorCoverage: null,
    lastUpdatedAt: null,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    async function refresh() {
      const rfRequest = ++rfRequestId.current;
      void refreshRfMap(rfRequest);
      try {
        const [aircraftResponse, airspaceResponse, spectrumResponse, rfBurstResponse, changeBriefing, sensorCoverage] =
          await Promise.all([
            fetchAircraftMap(),
            fetchAirspaceLanes(),
            fetchSpectrumOccupancy(),
            fetchRfBurstSwarms(),
            fetchChangeBriefing(),
            fetchSensorCoverage()
          ]);
        if (cancelled) {
          return;
        }

        previousAircraftResponse.current = aircraftResponse;
        const sceneModel = buildSceneModel({
          rf: previousRfResponse.current.items,
          aircraft: aircraftResponse.items,
          site: siteFromResponses(previousRfResponse.current, aircraftResponse, previousSceneModel.current?.site)
        });
        writeLatestCache(previousRfResponse.current, aircraftResponse);
        previousSceneModel.current = sceneModel;
        setState((current) => ({
          status: "live",
          sceneModel,
          layers: {
            rf:
              current.layers.rf === "error" || current.layers.rf === "empty"
                ? current.layers.rf
                : previousRfResponse.current.items.length > 0
                  ? "live"
                  : "loading",
            aircraft: sceneModel.aircraftEntities.length > 0 ? "live" : "empty"
          },
          airspaceLanes: airspaceResponse.items,
          spectrumOccupancy: spectrumResponse.items,
          rfBursts: rfBurstResponse.items,
          changeBriefing,
          sensorCoverage,
          lastUpdatedAt: new Date().toISOString(),
          error: null
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }
        setState((current) => ({
          status: "error",
          sceneModel: previousSceneModel.current,
          layers: {
            rf: current.layers.rf,
            aircraft: "error"
          },
          airspaceLanes: [],
          spectrumOccupancy: [],
          rfBursts: [],
          changeBriefing: null,
          sensorCoverage: null,
          lastUpdatedAt: null,
          error: error instanceof Error ? error.message : "Dashboard refresh failed"
        }));
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(refresh, pollIntervalMs);
        }
      }
    }

    void refresh();

    async function refreshRfMap(requestId: number) {
      try {
        const rfResponse = await fetchRfMap();
        if (cancelled || requestId !== rfRequestId.current) {
          return;
        }
        previousRfResponse.current = rfResponse;
        const sceneModel = buildSceneModel({
          rf: rfResponse.items,
          aircraft: previousAircraftResponse.current.items,
          site: siteFromResponses(rfResponse, previousAircraftResponse.current, previousSceneModel.current?.site)
        });
        writeLatestCache(rfResponse, previousAircraftResponse.current);
        previousSceneModel.current = sceneModel;
        setState((current) => ({
          ...current,
          status: "live",
          sceneModel,
          layers: {
            rf: rfResponse.items.length > 0 ? "live" : "empty",
            aircraft: sceneModel.aircraftEntities.length > 0 ? "live" : current.layers.aircraft
          },
          lastUpdatedAt: new Date().toISOString(),
          error: null
        }));
      } catch (error) {
        if (cancelled || requestId !== rfRequestId.current) {
          return;
        }
        setState((current) => ({
          ...current,
          status: current.sceneModel ? "live" : "error",
          layers: {
            ...current.layers,
            rf: "error"
          },
          error: error instanceof Error ? error.message : "RF map refresh failed"
        }));
      }
    }

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [pollIntervalMs]);

  return state;
}

function readCachedMapPayload(): CachedMapPayload | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(MAP_CACHE_KEY);
    if (!raw) {
      return null;
    }
    const cached = JSON.parse(raw) as CachedMapPayload;
    if (!Array.isArray(cached.rf?.items) || !Array.isArray(cached.aircraft?.items)) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function writeLatestCache(rfResponse: CollectionResponse<RfMapFeature>, aircraftResponse: CollectionResponse<AircraftMapFeature>): void {
  writeCachedMapPayload({
    rf: rfResponse,
    aircraft: aircraftResponse,
    site: siteFromResponses(rfResponse, aircraftResponse),
    cachedAt: new Date().toISOString()
  });
}

function siteFromResponses(
  rfResponse: CollectionResponse<RfMapFeature>,
  aircraftResponse: CollectionResponse<AircraftMapFeature>,
  fallback?: SiteAnchor
): SiteAnchor | undefined {
  return rfResponse.site ?? aircraftResponse.site ?? fallback;
}

function writeCachedMapPayload(payload: CachedMapPayload): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(MAP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Cache writes are best-effort; live polling remains authoritative.
  }
}
