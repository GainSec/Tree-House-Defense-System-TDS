import { buildSceneModel, type RfSceneEntity } from "../../data/sceneModel";
import type { AircraftMapFeature, RfMapFeature } from "../../domain/types";

export const NOW = new Date("2026-10-10T12:00:00Z");

export function rfFeature(overrides: Partial<RfMapFeature> & { identity: string }): RfMapFeature {
  return {
    label: overrides.identity,
    protocol: "wifi",
    kind: "device",
    source: "kismet",
    category: "wifi",
    latitude: 39.1,
    longitude: -77.17,
    location_accuracy: "estimated",
    estimated: true,
    rssi: -60,
    channel: null,
    frequency: null,
    manufacturer: null,
    first_seen_at: "2026-10-10T11:00:00Z",
    last_seen_at: "2026-10-10T11:59:30Z",
    count: 3,
    freshness: "live",
    ...overrides
  };
}

export function aircraftFeature(identity: string, overrides: Partial<AircraftMapFeature> = {}): AircraftMapFeature {
  return {
    identity,
    callsign: `CS${identity}`,
    model: "A320",
    owner: "",
    icao_type: "A320",
    registration: "",
    country: "",
    squawk: "",
    latitude: 39.2,
    longitude: -77.1,
    altitude: 12000,
    speed: 300,
    heading: 90,
    source: "adsb",
    protocol: "adsb",
    first_seen_at: null,
    last_seen_at: "2026-10-10T11:59:50Z",
    count: 1,
    ...overrides
  };
}

export function scene(rf: RfMapFeature[], aircraft: AircraftMapFeature[] = []) {
  return buildSceneModel({ rf, aircraft, now: NOW });
}

export function rfEntity(overrides: Partial<RfMapFeature> & { identity: string }): RfSceneEntity {
  return scene([rfFeature(overrides)]).rfEntities[0];
}
