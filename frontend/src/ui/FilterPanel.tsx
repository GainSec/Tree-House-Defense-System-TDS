import type { RfMapCategory } from "../domain/types";
import type { CSSProperties, ReactNode } from "react";
import type { SceneFilters, SourceId } from "./useSceneFilters";
import { LAYER_LENS_MODES, layerLensLabel, type LayerLensMode } from "./useLayerLens";

const SOURCES: SourceId[] = ["kismet", "intercept", "rail_rf", "ltesniffer", "unifi", "openwrt"];
const CATEGORIES: RfMapCategory[] = ["wifi", "ble", "rail", "iot", "cellular", "unknown_rf", "infrastructure", "utility"];

export interface FilterPanelProps {
  filters: SceneFilters;
  onToggleSource: (source: SourceId) => void;
  onToggleCategory: (category: RfMapCategory) => void;
  onToggleAircraft: () => void;
  onToggleStale: () => void;
  layerLensMode?: LayerLensMode;
  onLayerLensChange?: (mode: LayerLensMode) => void;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
}

export function FilterPanel({
  filters,
  onToggleSource,
  onToggleCategory,
  onToggleAircraft,
  onToggleStale,
  layerLensMode = "all",
  onLayerLensChange,
  cardControls,
  cardStyle
}: FilterPanelProps) {
  return (
    <section className="filter-card" aria-label="TDS filter card" style={cardStyle}>
      <div className="hud-title">
        <span className="system-label">Filters</span>
        <span>Signal visibility</span>
        {cardControls}
      </div>
      <div className="filter-group" aria-label="Source filters">
        {SOURCES.map((source) => (
          <button key={source} type="button" className={filters.hiddenSources.includes(source) ? "filter-toggle is-off" : "filter-toggle"} onClick={() => onToggleSource(source)}>
            {source}
          </button>
        ))}
      </div>
      <div className="filter-group" aria-label="Layer filters">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            className={filters.hiddenCategories.includes(category) ? "filter-toggle is-off" : "filter-toggle"}
            onClick={() => onToggleCategory(category)}
          >
            {category.replace("_", " ")}
          </button>
        ))}
        <button type="button" className={filters.showAircraft ? "filter-toggle" : "filter-toggle is-off"} onClick={onToggleAircraft}>
          aircraft
        </button>
        <button type="button" className={filters.showStale ? "filter-toggle" : "filter-toggle is-off"} onClick={onToggleStale}>
          stale
        </button>
      </div>
      <div className="filter-group lens-group" aria-label="Layer lens">
        {LAYER_LENS_MODES.map((mode) => (
          <button key={mode} type="button" className={layerLensMode === mode ? "filter-toggle is-active" : "filter-toggle"} onClick={() => onLayerLensChange?.(mode)}>
            {layerLensLabel(mode)}
          </button>
        ))}
      </div>
    </section>
  );
}
