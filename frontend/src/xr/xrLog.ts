/** Small ring-buffer logger: mirrors to the console and feeds the in-headset diagnostics panel. */

export interface XRLogEntry {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
}

const MAX_ENTRIES = 40;
const entries: XRLogEntry[] = [];
const listeners = new Set<() => void>();

export function xrLog(level: XRLogEntry["level"], message: string, data?: unknown): void {
  const entry = { at: new Date().toISOString(), level, message };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  const line = `[tds-xr] ${message}`;
  if (level === "error") {
    console.error(line, ...(data === undefined ? [] : [data]));
  } else if (level === "warn") {
    console.warn(line, ...(data === undefined ? [] : [data]));
  } else {
    console.info(line, ...(data === undefined ? [] : [data]));
  }
  listeners.forEach((listener) => listener());
}

export function xrLogEntries(): readonly XRLogEntry[] {
  return entries;
}

export function subscribeXRLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let lastInteractionAt = 0;

/** Called by UI and selection handlers so a trigger press that hit nothing can be detected and logged. */
export function noteXRInteraction(what: string): void {
  lastInteractionAt = performance.now();
  xrLog("info", `hit: ${what}`);
}

export function msSinceXRInteraction(): number {
  return performance.now() - lastInteractionAt;
}
