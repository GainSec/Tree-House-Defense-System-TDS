import { describe, expect, it } from "vitest";
import { joinBackendUrl, normalizeBackendBaseUrl, resolveBackendBaseUrl } from "../../data/backendConfig";

describe("backend base URL", () => {
  it("defaults to same origin, preserving desktop behavior", () => {
    expect(resolveBackendBaseUrl({})).toEqual({ baseUrl: "", source: "same-origin", invalid: null });
    expect(joinBackendUrl("", "/v1/map/rf")).toBe("/v1/map/rf");
  });

  it("prefers query, then storage, then env", () => {
    expect(resolveBackendBaseUrl({ search: "?backend=https://tds.lan:8443/", stored: "http://a", env: "http://b" })).toMatchObject({ baseUrl: "https://tds.lan:8443", source: "query" });
    expect(resolveBackendBaseUrl({ stored: "http://a:8000", env: "http://b" })).toMatchObject({ baseUrl: "http://a:8000", source: "storage" });
    expect(resolveBackendBaseUrl({ env: "http://b:9000/api/" })).toMatchObject({ baseUrl: "http://b:9000/api", source: "env" });
  });

  it("lets the query reset to same origin", () => {
    expect(resolveBackendBaseUrl({ search: "?backend=same-origin", stored: "http://a" }).source).toBe("same-origin");
  });

  it("rejects non-http schemes and reports invalid input", () => {
    expect(normalizeBackendBaseUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeBackendBaseUrl("not a url")).toBeNull();
    const resolution = resolveBackendBaseUrl({ search: "?backend=ftp://x", stored: "http://a:1" });
    expect(resolution.invalid).toBe("ftp://x");
    expect(resolution.baseUrl).toBe("http://a:1");
  });

  it("joins endpoints and leaves absolute URLs alone", () => {
    expect(joinBackendUrl("https://tds.lan", "/v1/events")).toBe("https://tds.lan/v1/events");
    expect(joinBackendUrl("https://tds.lan", "v1/events")).toBe("https://tds.lan/v1/events");
    expect(joinBackendUrl("https://tds.lan", "http://other/x")).toBe("http://other/x");
  });
});
