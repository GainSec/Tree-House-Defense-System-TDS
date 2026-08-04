import { useEffect, useMemo, useState } from "react";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { RfMapCategory } from "../domain/types";
import type { LayerLensMode } from "./useLayerLens";

export type SourceId = "kismet" | "intercept" | "rail_rf" | "unifi" | "openwrt" | "ltesniffer";

export interface SceneFilters {
  hiddenSources: SourceId[];
  hiddenCategories: RfMapCategory[];
  showAircraft: boolean;
  showStale: boolean;
}

export interface FilteredSceneEntities {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
}

export const defaultSceneFilters: SceneFilters = {
  hiddenSources: [],
  hiddenCategories: [],
  showAircraft: true,
  showStale: true
};

export const SCENE_FILTER_STORAGE_KEY = "tds.sceneFilters.v1";
const SOURCE_IDS: SourceId[] = ["kismet", "intercept", "rail_rf", "unifi", "openwrt", "ltesniffer"];
const CATEGORY_IDS: RfMapCategory[] = ["wifi", "ble", "utility", "unknown_rf", "infrastructure", "aircraft", "rail", "iot", "cellular"];

export function applySceneFilters({
  rfEntities,
  aircraftEntities,
  filters,
  layerLensMode = "all"
}: FilteredSceneEntities & { filters: SceneFilters; layerLensMode?: LayerLensMode }): FilteredSceneEntities {
  const hiddenSources = new Set<string>(filters.hiddenSources);
  const hiddenCategories = new Set<RfMapCategory>(filters.hiddenCategories);
  const activeCategory = categoryForLayerLens(layerLensMode);

  return {
    rfEntities: rfEntities.filter((entity) => {
      if (layerLensMode === "airspace") {
        return false;
      }
      if (hiddenSources.has(entity.source)) {
        return false;
      }
      if (hiddenCategories.has(entity.category)) {
        return false;
      }
      if (activeCategory && entity.category !== activeCategory) {
        return false;
      }
      if (!filters.showStale && entity.freshness !== "live") {
        return false;
      }
      return true;
    }),
    aircraftEntities: filters.showAircraft ? aircraftEntities : []
  };
}

export function useSceneFilters(initialFilters: SceneFilters = defaultSceneFilters) {
  const [filters, setFilters] = useState<SceneFilters>(() => readStoredSceneFilters() ?? initialFilters);

  useEffect(() => {
    writeStoredSceneFilters(filters);
  }, [filters]);

  return useMemo(
    () => ({
      filters,
      toggleSource(source: SourceId) {
        setFilters((current) => ({
          ...current,
          hiddenSources: toggleListValue(current.hiddenSources, source)
        }));
      },
      toggleCategory(category: RfMapCategory) {
        setFilters((current) => ({
          ...current,
          hiddenCategories: toggleListValue(current.hiddenCategories, category)
        }));
      },
      toggleAircraft() {
        setFilters((current) => ({ ...current, showAircraft: !current.showAircraft }));
      },
      toggleStale() {
        setFilters((current) => ({ ...current, showStale: !current.showStale }));
      }
    }),
    [filters]
  );
}

function toggleListValue<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((candidate) => candidate !== value) : [...values, value];
}

function readStoredSceneFilters(): SceneFilters | null {
  if (typeof localStorage === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(SCENE_FILTER_STORAGE_KEY);
    return raw ? normalizeSceneFilters(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function writeStoredSceneFilters(filters: SceneFilters): void {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(SCENE_FILTER_STORAGE_KEY, JSON.stringify(normalizeSceneFilters(filters)));
  } catch {
    // Dashboard filter persistence is best-effort.
  }
}

function normalizeSceneFilters(value: Partial<SceneFilters> | null | undefined): SceneFilters {
  return {
    hiddenSources: Array.isArray(value?.hiddenSources) ? value.hiddenSources.filter(isSourceId) : [],
    hiddenCategories: Array.isArray(value?.hiddenCategories) ? value.hiddenCategories.filter(isRfMapCategory) : [],
    showAircraft: typeof value?.showAircraft === "boolean" ? value.showAircraft : true,
    showStale: typeof value?.showStale === "boolean" ? value.showStale : true
  };
}

function isSourceId(value: unknown): value is SourceId {
  return typeof value === "string" && SOURCE_IDS.includes(value as SourceId);
}

function isRfMapCategory(value: unknown): value is RfMapCategory {
  return typeof value === "string" && CATEGORY_IDS.includes(value as RfMapCategory);
}

function categoryForLayerLens(mode: LayerLensMode): RfMapCategory | null {
  switch (mode) {
    case "wifi":
      return "wifi";
    case "ble":
      return "ble";
    case "unknown":
      return "unknown_rf";
    case "utility":
      return "utility";
    default:
      return null;
  }
}
