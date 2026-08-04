import type { Coordinate, CoordinateInput, LocalMeters, LocationAccuracy, SiteAnchor } from "./types";

const METERS_PER_DEGREE_LATITUDE = 111_320;
const DEFAULT_AIRCRAFT_SCENE_Y = 70;
const MAX_AIRCRAFT_SCENE_Y = 180;
const FEET_PER_SCENE_UNIT = 105;

export const SITE_ANCHOR: SiteAnchor = {
  latitude: 0,
  longitude: 0,
  label: "TDS Lab"
};

export function normalizeCoordinate(coordinate: CoordinateInput): Coordinate | null {
  const { latitude, longitude } = coordinate;
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    return null;
  }

  return { latitude, longitude };
}

export function latLonToLocalMeters(coordinate: CoordinateInput, anchor: SiteAnchor = SITE_ANCHOR): LocalMeters {
  const normalized = normalizeCoordinate(coordinate);
  if (!normalized) {
    return { x: 0, z: 0 };
  }

  const anchorLatitudeRadians = (anchor.latitude * Math.PI) / 180;
  const metersPerDegreeLongitude = METERS_PER_DEGREE_LATITUDE * Math.cos(anchorLatitudeRadians);
  return {
    x: roundMeters((normalized.longitude - anchor.longitude) * metersPerDegreeLongitude),
    z: roundMeters((normalized.latitude - anchor.latitude) * METERS_PER_DEGREE_LATITUDE)
  };
}

export function altitudeFeetToSceneY(altitudeFeet: number | null | undefined): number {
  if (typeof altitudeFeet !== "number" || !Number.isFinite(altitudeFeet) || altitudeFeet <= 0) {
    return DEFAULT_AIRCRAFT_SCENE_Y;
  }

  return Math.min(MAX_AIRCRAFT_SCENE_Y, Math.max(24, altitudeFeet / FEET_PER_SCENE_UNIT));
}

export function accuracyRadiusMeters(accuracy: LocationAccuracy): number {
  if (accuracy === "real") {
    return 8;
  }
  if (accuracy === "estimated") {
    return 36;
  }
  return 72;
}

function roundMeters(value: number): number {
  if (Math.abs(value) < 0.000001) {
    return 0;
  }
  return Math.round(value * 1000) / 1000;
}
