import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export function manualChunksForTds(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");

  if (normalized.includes("/node_modules/")) {
    if (normalized.includes("/node_modules/react/") || normalized.includes("/node_modules/react-dom/") || normalized.includes("/node_modules/scheduler/")) {
      return "vendor-react";
    }
    if (
      normalized.includes("/node_modules/three/") ||
      normalized.includes("/node_modules/three-stdlib/") ||
      normalized.includes("/node_modules/@react-three/") ||
      normalized.includes("/node_modules/@use-gesture/") ||
      normalized.includes("/node_modules/@pmndrs/") ||
      normalized.includes("/node_modules/maath/") ||
      normalized.includes("/node_modules/meshline/") ||
      normalized.includes("/node_modules/troika-")
    ) {
      return "vendor-3d";
    }
    return "vendor";
  }

  if (normalized.includes("/src/scene/") || normalized.includes("/src/house/")) {
    return "tds-scene";
  }
  if (normalized.includes("/src/ui/Presence") || normalized.includes("/src/ui/presence")) {
    return "tds-presence";
  }
  if (normalized.includes("/src/data/")) {
    return "tds-data";
  }
  return undefined;
}

export const tdsChunkGroups = [
  { name: "vendor-react", test: (id: string) => manualChunksForTds(id) === "vendor-react", priority: 60 },
  { name: "vendor-3d", test: (id: string) => manualChunksForTds(id) === "vendor-3d", priority: 50, maxSize: 450 * 1024 },
  { name: "vendor", test: (id: string) => manualChunksForTds(id) === "vendor", priority: 40 },
  { name: "tds-scene", test: (id: string) => manualChunksForTds(id) === "tds-scene", priority: 30 },
  { name: "tds-presence", test: (id: string) => manualChunksForTds(id) === "tds-presence", priority: 20 },
  { name: "tds-data", test: (id: string) => manualChunksForTds(id) === "tds-data", priority: 10 }
];

export default defineConfig({
  base: "/static/",
  plugins: [react()],
  build: {
    outDir: "../backend/app/static",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: tdsChunkGroups
        }
      }
    }
  }
});
