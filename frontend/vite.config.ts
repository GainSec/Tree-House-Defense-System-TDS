import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

export function manualChunksForTds(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");

  if (normalized.includes("/node_modules/")) {
    // XR-only libraries are left ungrouped so default splitting keeps them with the lazy /vr chunk,
    // out of the desktop entry.
    if (
      normalized.includes("/node_modules/@react-three/xr/") ||
      normalized.includes("/node_modules/@pmndrs/xr/") ||
      normalized.includes("/node_modules/@pmndrs/pointer-events/") ||
      normalized.includes("/node_modules/@react-three/uikit/") ||
      normalized.includes("/node_modules/@pmndrs/uikit") ||
      normalized.includes("/node_modules/@pmndrs/msdfonts/") ||
      normalized.includes("/node_modules/iwer/") ||
      normalized.includes("/node_modules/@iwer/")
    ) {
      return undefined;
    }
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

const processEnv = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/**
 * Dev-only: proxy API calls to a TDS backend so the dev server stays same-origin
 * (no backend CORS changes needed). Override with TDS_DEV_BACKEND, e.g. the mock
 * backend: TDS_DEV_BACKEND=http://127.0.0.1:8787 npm run dev
 */
export const devBackendTarget = processEnv.TDS_DEV_BACKEND || "http://127.0.0.1:8000";
/** Optional: a gateway session cookie so the dev server can proxy to a login-protected TDS gateway. */
const devProxy = {
  target: devBackendTarget,
  changeOrigin: true,
  headers: processEnv.TDS_DEV_BACKEND_COOKIE ? { cookie: `tds_session=${processEnv.TDS_DEV_BACKEND_COOKIE}` } : undefined
};

const EMULATOR_STUB_ID = "\0tds-xr-emulator-stub";

/**
 * The IWER WebXR emulator (and its multi-megabyte synthetic rooms) is a development
 * aid only. Production builds replace @pmndrs/xr's lazily imported emulator with a stub.
 */
export function stripXREmulator(): Plugin {
  return {
    name: "tds-strip-xr-emulator",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === "./emulate.js" && importer && importer.replace(/\\/g, "/").includes("/@pmndrs/xr/dist/")) {
        return EMULATOR_STUB_ID;
      }
      return null;
    },
    load(id) {
      if (id === EMULATOR_STUB_ID) {
        return 'export function emulate() { throw new Error("WebXR emulator is not included in production builds"); }';
      }
      return null;
    }
  };
}

/** Unique per build so a headset showing a stale cached page is obvious (overlay, Diag panel, shipped logs). */
const buildId = `${processEnv.TDS_BUILD_SHA ?? "local"}-${new Date().toISOString().replace(/[-:]/g, "").slice(0, 13)}`;

export default defineConfig({
  base: "/static/",
  define: {
    __TDS_BUILD__: JSON.stringify(buildId)
  },
  plugins: [react(), stripXREmulator()],
  // One three.js instance: the opt-in IWER emulator (?emulate=1) ships its own nested copy.
  resolve: { dedupe: ["three"] },
  server: {
    proxy: {
      "/v1": devProxy,
      "/health": devProxy,
      "/ready": devProxy,
      "/xr-log": devProxy
    }
  },
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    environment: "node"
  },
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
