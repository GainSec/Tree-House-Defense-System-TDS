/**
 * Configurable TDS backend base URL.
 *
 * Desktop default is same-origin (empty base), which preserves the existing
 * behavior when the dashboard is served by the FastAPI backend. A headset or a
 * dev server on another host can point at a backend explicitly:
 *
 *   1. `?backend=https://tds.lan:8443` query parameter (persisted to localStorage)
 *   2. `localStorage["tds.backendBaseUrl"]`
 *   3. `VITE_TDS_BACKEND_URL` build-time environment variable
 *   4. same origin
 *
 * `?backend=same-origin` clears a persisted override.
 */

export const BACKEND_BASE_URL_STORAGE_KEY = "tds.backendBaseUrl";

export type BackendBaseUrlSource = "query" | "storage" | "env" | "same-origin";

export interface BackendBaseUrlResolution {
  baseUrl: string;
  source: BackendBaseUrlSource;
  invalid: string | null;
}

export interface BackendBaseUrlInput {
  search?: string;
  stored?: string | null;
  env?: string | null;
}

export function normalizeBackendBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

export function resolveBackendBaseUrl({ search = "", stored = null, env = null }: BackendBaseUrlInput): BackendBaseUrlResolution {
  const query = new URLSearchParams(search).get("backend");
  if (query !== null) {
    if (query === "" || query === "same-origin") {
      return { baseUrl: "", source: "same-origin", invalid: null };
    }
    const normalized = normalizeBackendBaseUrl(query);
    if (normalized) {
      return { baseUrl: normalized, source: "query", invalid: null };
    }
    return { ...resolveBackendBaseUrl({ stored, env }), invalid: query };
  }
  const fromStorage = normalizeBackendBaseUrl(stored);
  if (fromStorage) {
    return { baseUrl: fromStorage, source: "storage", invalid: null };
  }
  const fromEnv = normalizeBackendBaseUrl(env);
  if (fromEnv) {
    return { baseUrl: fromEnv, source: "env", invalid: null };
  }
  return { baseUrl: "", source: "same-origin", invalid: null };
}

export function joinBackendUrl(baseUrl: string, endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (!baseUrl) {
    return endpoint;
  }
  return `${baseUrl}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
}

let cachedResolution: BackendBaseUrlResolution | null = null;

export function backendBaseUrl(): BackendBaseUrlResolution {
  if (cachedResolution) {
    return cachedResolution;
  }
  const search = typeof window === "undefined" ? "" : window.location.search;
  const stored = readStoredBaseUrl();
  const env = typeof import.meta !== "undefined" ? (import.meta.env?.VITE_TDS_BACKEND_URL as string | undefined) ?? null : null;
  const resolution = resolveBackendBaseUrl({ search, stored, env });
  if (new URLSearchParams(search).has("backend") && !resolution.invalid) {
    writeStoredBaseUrl(resolution.source === "query" ? resolution.baseUrl : null);
  }
  cachedResolution = resolution;
  return resolution;
}

/** Human-readable label for diagnostics. */
export function backendBaseUrlLabel(resolution: BackendBaseUrlResolution = backendBaseUrl()): string {
  if (!resolution.baseUrl) {
    return typeof window === "undefined" ? "same origin" : `same origin (${window.location.origin})`;
  }
  return `${resolution.baseUrl} (${resolution.source})`;
}

function readStoredBaseUrl(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(BACKEND_BASE_URL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredBaseUrl(value: string | null): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (value) {
      localStorage.setItem(BACKEND_BASE_URL_STORAGE_KEY, value);
    } else {
      localStorage.removeItem(BACKEND_BASE_URL_STORAGE_KEY);
    }
  } catch {
    // Persistence is a convenience; the query parameter still applies for this load.
  }
}
