import type { SiteAnchor } from "../domain/types";

export interface MapTileCoordinate {
  x: number;
  y: number;
  z: number;
}

export const MAP_TILE_ZOOM = 17;
export const MAP_GROUND_SIZE = 190;

export function lngLatToTile(latitude: number, longitude: number, zoom: number): MapTileCoordinate {
  const scale = 2 ** zoom;
  const latitudeRadians = (latitude * Math.PI) / 180;
  return {
    x: Math.floor(((longitude + 180) / 360) * scale),
    y: Math.floor(((1 - Math.log(Math.tan(latitudeRadians) + 1 / Math.cos(latitudeRadians)) / Math.PI) / 2) * scale),
    z: zoom
  };
}

export function mapTileUrl(site: SiteAnchor, zoom = MAP_TILE_ZOOM): string {
  const tile = lngLatToTile(site.latitude, site.longitude, zoom);
  return `https://tile.openstreetmap.org/${tile.z}/${tile.x}/${tile.y}.png`;
}

export function siteFloorHeadingRadians(site: SiteAnchor): number {
  const heading = site.floor_heading_degrees ?? 0;
  return Number.isFinite(heading) ? (heading * Math.PI) / 180 : 0;
}
