import { apiUrl } from "../data/api";
import { subscribeXRLog, xrLogEntries, type XRLogEntry } from "./xrLog";

/**
 * Ships [tds-xr] log entries to the gateway (POST /xr-log) so headset sessions
 * can be read over SSH on the server (deploy/xr-host/logs/xr-YYYY-MM-DD.jsonl).
 * Best-effort: stops quietly when the endpoint is absent (plain dev server).
 */
export function startXRLogShipper(): () => void {
  const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let shipped = 0;
  let disabled = false;
  let timer: number | undefined;

  const flush = (useBeacon = false) => {
    const entries = xrLogEntries();
    // The ring buffer keeps the last 40 entries; ship anything newer than what was sent.
    const pending: XRLogEntry[] = entries.slice(Math.max(0, entries.length - (totalLogged - shipped)));
    if (disabled || pending.length === 0) {
      return;
    }
    shipped = totalLogged;
    const body = JSON.stringify({ session, page: `${window.location.pathname}${window.location.search}`, entries: pending });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(apiUrl("/xr-log"), new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(apiUrl("/xr-log"), { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" })
      .then((response) => {
        if (response.status === 404 || response.status === 405) {
          disabled = true;
        }
      })
      .catch(() => undefined);
  };

  let totalLogged = xrLogEntries().length;
  const unsubscribe = subscribeXRLog(() => {
    totalLogged += 1;
    if (timer === undefined) {
      timer = window.setTimeout(() => {
        timer = undefined;
        flush();
      }, 1500);
    }
  });
  const onHide = () => flush(true);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onHide);

  return () => {
    unsubscribe();
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onHide);
    if (timer !== undefined) {
      window.clearTimeout(timer);
    }
    flush(true);
  };
}
