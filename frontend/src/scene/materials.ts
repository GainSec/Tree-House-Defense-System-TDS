import type { RfMapCategory } from "../domain/types";

export const RF_CATEGORY_COLORS: Record<RfMapCategory, string> = {
  wifi: "#57d7ff",
  ble: "#8dff9b",
  utility: "#ffd166",
  unknown_rf: "#ff4d6d",
  infrastructure: "#e6f1ff",
  aircraft: "#d9b8ff",
  rail: "#7dd3fc",
  iot: "#34d399",
  cellular: "#86efac"
};

export const SKY_COLOR = "#05070a";
export const GRID_COLOR = "#21484d";
