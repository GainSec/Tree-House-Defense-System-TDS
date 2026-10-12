import { describe, expect, it } from "vitest";
import { apiPolicy } from "../tds-xr-gateway.mjs";

describe("gateway API policy", () => {
  it("forwards reads", () => {
    expect(apiPolicy("GET", "/v1/map/rf")).toBeNull();
    expect(apiPolicy("GET", "/v1/presence/entities/aa/dossier")).toBeNull();
    expect(apiPolicy("GET", "/v1/observations")).toBeNull();
  });

  it("never forwards ingestion or webhooks", () => {
    expect(apiPolicy("POST", "/v1/observations", "all")).toMatch(/LAN-only/);
    expect(apiPolicy("POST", "/v1/webhooks/unifi/alarm", "all")).toMatch(/LAN-only/);
    expect(apiPolicy("GET", "/v1/webhooks/unifi/alarm", "all")).toMatch(/LAN-only/);
  });

  it("presence mode allows only presence writes", () => {
    expect(apiPolicy("POST", "/v1/presence/watchlist", "presence")).toBeNull();
    expect(apiPolicy("PATCH", "/v1/presence/watchlist/12", "presence")).toBeNull();
    expect(apiPolicy("DELETE", "/v1/presence/watchlist/12", "presence")).toBeNull();
    expect(apiPolicy("POST", "/v1/presence/entities/aa%3Abb/enrichment", "presence")).toBeNull();
    expect(apiPolicy("POST", "/v1/control/services/kismet/actions", "presence")).toMatch(/disabled/);
    expect(apiPolicy("PUT", "/v1/control/site", "presence")).toMatch(/disabled/);
    expect(apiPolicy("POST", "/v1/lte/actions", "presence")).toMatch(/disabled/);
  });

  it("none mode blocks every write; all mode allows non-ingest writes", () => {
    expect(apiPolicy("POST", "/v1/presence/watchlist", "none")).toMatch(/disabled/);
    expect(apiPolicy("PUT", "/v1/control/site", "all")).toBeNull();
  });

  it("rejects non-API paths", () => {
    expect(apiPolicy("GET", "/etc/passwd")).toMatch(/not an API route/);
  });
});

describe("gateway hardening (review findings)", async () => {
  const { apiPolicy, canonicalApiPath, safeNext } = await import("../tds-xr-gateway.mjs");

  it("percent-encoding cannot reach blocked routes", () => {
    expect(apiPolicy("GET", "/v1/webhooks/unifi/%61larm")).toMatch(/LAN-only/);
    expect(apiPolicy("POST", "/v1/%6fbservations", "all")).toMatch(/LAN-only/);
    expect(apiPolicy("POST", "/v1/observations/", "all")).toMatch(/LAN-only/);
    expect(apiPolicy("post", "/v1/presence/watchlist", "none")).toMatch(/disabled/);
  });

  it("rejects ambiguous paths", () => {
    expect(apiPolicy("GET", "/v1/map/../observations")).toBe("malformed path");
    expect(apiPolicy("GET", "/v1//observations")).toBe("malformed path");
    expect(apiPolicy("GET", "/v1/map\\rf")).toBe("malformed path");
    expect(apiPolicy("GET", "/v1/map/%ZZ")).toBe("malformed path");
    expect(apiPolicy("GET", "/v1/map/rf%00")).toBe("malformed path");
    expect(canonicalApiPath("/v1/presence/entities/kismet%3Adevice%3Aab/dossier")).toBe("/v1/presence/entities/kismet:device:ab/dossier");
  });

  it("still allows encoded entity keys for reads and presence writes", () => {
    expect(apiPolicy("GET", "/v1/presence/entities/kismet%3Adevice%3Aab/dossier")).toBeNull();
    expect(apiPolicy("POST", "/v1/presence/entities/kismet%3Adevice%3Aab/enrichment", "presence")).toBeNull();
    // An encoded slash changes the segment count, so it does not match the write allowlist.
    expect(apiPolicy("POST", "/v1/presence/entities/a%2Fb/enrichment", "presence")).toMatch(/disabled/);
  });

  it("only redirects to same-origin paths", () => {
    expect(safeNext("/vr")).toBe("/vr");
    expect(safeNext("/presence/entities/x?y=1")).toBe("/presence/entities/x?y=1");
    expect(safeNext("//evil.com")).toBe("/vr");
    expect(safeNext("/\\evil.com")).toBe("/vr");
    expect(safeNext("/\t/evil.com")).toBe("/vr");
    expect(safeNext("https://evil.com")).toBe("/vr");
    expect(safeNext(null)).toBe("/vr");
  });
});
