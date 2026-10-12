import { useEffect, useState } from "react";
import { fetchPresenceWatchlist } from "./api";

const EMPTY = new Set<string>();

/**
 * Entity keys the operator tracks (presence watchlist). This is the source of
 * truth for "presence" in the XR board: the map's operator_context is only
 * populated for rail/IoT/cellular entities.
 */
export function useTrackedEntities(pollIntervalMs = 30_000): ReadonlySet<string> {
  const [tracked, setTracked] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetchPresenceWatchlist();
        if (!cancelled) {
          setTracked(new Set(response.items.filter((item) => item.enabled !== false).flatMap((item) => [item.entity_key, item.identity_hint].filter((key): key is string => Boolean(key)))));
        }
      } catch {
        // Keep the last known watchlist; presence is optional context.
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(refresh, pollIntervalMs);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [pollIntervalMs]);
  return tracked;
}
