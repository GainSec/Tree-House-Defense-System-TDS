import type { Plugin } from "vite";
export declare function manualChunksForTds(id: string): string | undefined;
export declare const tdsChunkGroups: ({
    name: string;
    test: (id: string) => boolean;
    priority: number;
    maxSize?: undefined;
} | {
    name: string;
    test: (id: string) => boolean;
    priority: number;
    maxSize: number;
})[];
/**
 * Dev-only: proxy API calls to a TDS backend so the dev server stays same-origin
 * (no backend CORS changes needed). Override with TDS_DEV_BACKEND, e.g. the mock
 * backend: TDS_DEV_BACKEND=http://127.0.0.1:8787 npm run dev
 */
export declare const devBackendTarget: string;
/**
 * The IWER WebXR emulator (and its multi-megabyte synthetic rooms) is a development
 * aid only. Production builds replace @pmndrs/xr's lazily imported emulator with a stub.
 */
export declare function stripXREmulator(): Plugin;
declare const _default: import("vite").UserConfig;
export default _default;
