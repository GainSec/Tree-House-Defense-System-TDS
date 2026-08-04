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
declare const _default: import("vite").UserConfig;
export default _default;
