import type { ProvenanceTone } from "../data/provenance";
import type { CardTone } from "./cards";

/** TDS visual vocabulary for XR (matches desktop cyan/amber/red accents). */
export const XR_COLORS = {
  accent: "#7df2e6",
  accentDim: "#2c6f6a",
  text: "#dcefff",
  textMuted: "#8aa6b4",
  panel: "#061114",
  panelRaised: "#0b1d22",
  panelBorder: "#1d4a4f",
  hover: "#123a40",
  active: "#1f6f73",
  good: "#8dff9b",
  warn: "#ffd166",
  hot: "#ff4d6d",
  replay: "#c4a7ff",
  muted: "#6b7f8a",
  boardPlate: "#071315",
  boardGrid: "#1c4247",
  pedestal: "#0d2428",
  shadow: "#000000",
  neutralEnvironment: "#1a1f24",
  neutralFloor: "#242b31"
} as const;

export function toneColor(tone: CardTone | ProvenanceTone | undefined): string {
  switch (tone) {
    case "good":
      return XR_COLORS.good;
    case "warn":
      return XR_COLORS.warn;
    case "hot":
      return XR_COLORS.hot;
    case "replay":
      return XR_COLORS.replay;
    case "muted":
      return XR_COLORS.muted;
    default:
      return XR_COLORS.text;
  }
}

/** uikit pixel size: 1 px = 1 mm, so a 360 px panel is 36 cm wide. */
export const XR_PIXEL_SIZE = 0.001;
