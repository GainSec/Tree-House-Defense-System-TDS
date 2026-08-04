import { useState } from "react";

export type LayerLensMode = "all" | "wifi" | "ble" | "unknown" | "utility" | "airspace" | "alerts" | "rf" | "network" | "hardware" | "events";

export const LAYER_LENS_MODES: LayerLensMode[] = ["all", "wifi", "ble", "unknown", "utility", "airspace", "alerts", "rf", "network", "hardware", "events"];

const LAYER_LENS_LABELS: Record<LayerLensMode, string> = {
  all: "All",
  wifi: "Wi-Fi",
  ble: "BLE",
  unknown: "Unknown RF",
  utility: "Utilities",
  airspace: "Airspace",
  alerts: "Alerts",
  rf: "RF",
  network: "Network",
  hardware: "Hardware",
  events: "Events"
};

export function useLayerLens(initialMode: LayerLensMode = "all") {
  const [mode, setMode] = useState<LayerLensMode>(initialMode);

  return {
    mode,
    setMode,
    setModeFromString(value: string) {
      if (isLayerLensMode(value)) {
        setMode(value);
      }
    }
  };
}

export function isLayerLensMode(value: string): value is LayerLensMode {
  return LAYER_LENS_MODES.includes(value as LayerLensMode);
}

export function layerLensLabel(mode: LayerLensMode): string {
  return LAYER_LENS_LABELS[mode];
}
