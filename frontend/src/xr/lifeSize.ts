/**
 * Life-size presentation: the operator stands inside the site at 1:1 scale.
 *
 * Frames:
 *  - scene: TDS scene metres, x = east, z = north (as produced by sceneModel).
 *  - world: XR reference space metres, y up. Scene north maps to world -Z
 *    rotated by `northYaw` (so the world can be aligned with the real room).
 *  - origin: the XR origin (tracking space) placed in the world; moving it is
 *    how teleport and snap-turn work without moving the scene.
 */

export type Vec3 = [number, number, number];

export const FEET_TO_METRES = 0.3048;
/** Aircraft are drawn on a sky dome this far away, at their true bearing and elevation angle. */
export const SKY_DOME_RADIUS = 140;
/** RF tokens float in a comfortable band around chest height. */
export const RF_MIN_Y = 0.9;
export const RF_MAX_Y = 2.6;
/** How far from the site origin teleport may take the operator. */
export const MAX_TELEPORT_RADIUS = 90;
export const SNAP_TURN = Math.PI / 6;
export const STEP_DISTANCE = 1.5;

/** Scene point -> world point (north-up mirror, then yaw alignment). */
export function sceneToWorld(scene: Vec3, northYaw: number): Vec3 {
  const x = scene[0];
  const z = -scene[2];
  const cos = Math.cos(northYaw);
  const sin = Math.sin(northYaw);
  return [x * cos + z * sin, scene[1], -x * sin + z * cos];
}

/** World point -> scene point (inverse of sceneToWorld). */
export function worldToScene(world: Vec3, northYaw: number): Vec3 {
  const cos = Math.cos(northYaw);
  const sin = Math.sin(northYaw);
  const x = world[0] * cos - world[2] * sin;
  const z = world[0] * sin + world[2] * cos;
  return [x, world[1], -z];
}

/**
 * Where an aircraft appears in the sky: true compass bearing and true elevation
 * angle from the site, projected onto a dome so it is visible and pointable.
 * Altitude is in feet (as labelled in the UI).
 */
export function skyPosition(localMeters: { x: number; z: number }, altitudeFeet: number | null, radius = SKY_DOME_RADIUS): Vec3 {
  const distance = Math.hypot(localMeters.x, localMeters.z);
  const altitude = typeof altitudeFeet === "number" && Number.isFinite(altitudeFeet) && altitudeFeet > 0 ? altitudeFeet * FEET_TO_METRES : 300;
  const elevation = Math.atan2(altitude, Math.max(distance, 1));
  const horizontal = radius * Math.cos(elevation);
  const y = radius * Math.sin(elevation);
  if (distance < 1) {
    return [0, radius, 0];
  }
  return [(localMeters.x / distance) * horizontal, y, (localMeters.z / distance) * horizontal];
}

/** Elevation angle in degrees for labels ("23° up"). */
export function elevationDegrees(localMeters: { x: number; z: number }, altitudeFeet: number | null): number {
  const altitude = typeof altitudeFeet === "number" && altitudeFeet > 0 ? altitudeFeet * FEET_TO_METRES : 300;
  return Math.round((Math.atan2(altitude, Math.max(1, Math.hypot(localMeters.x, localMeters.z))) * 180) / Math.PI);
}

/** Compass bearing (0 = north, clockwise) from scene coordinates. */
export function bearingDegrees(x: number, z: number): number {
  return Math.round(((Math.atan2(x, z) * 180) / Math.PI + 360) % 360);
}

export function compassLabel(bearing: number): string {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(bearing / 45) % 8];
}

/** Scene RF height (1.8-8 m) squeezed into a chest-height band so tokens are easy to see and point at. */
export function lifeRfHeight(sceneY: number): number {
  return Math.min(RF_MAX_Y, Math.max(RF_MIN_Y, 1.0 + (sceneY - 1.8) * 0.35));
}

// ---------------------------------------------------------------- origin (locomotion)

export interface OriginPose {
  x: number;
  z: number;
  yaw: number;
}

export const DEFAULT_ORIGIN: OriginPose = { x: 0, z: 0, yaw: 0 };

/**
 * Teleport: move the origin so the operator's head ends up above `target`
 * (world metres). `headLocal` is the head position relative to the origin,
 * rotated into world space already (i.e. headWorld - origin).
 */
export function teleportOrigin(origin: OriginPose, headWorld: Vec3, target: Vec3, northYaw = 0): OriginPose {
  const clamped = clampToSite(target, northYaw);
  return { ...origin, x: origin.x + (clamped[0] - headWorld[0]), z: origin.z + (clamped[2] - headWorld[2]) };
}

/** Snap turn about the operator's head (so the head does not swing sideways). */
export function snapTurnOrigin(origin: OriginPose, headWorld: Vec3, dyaw: number): OriginPose {
  const cos = Math.cos(dyaw);
  const sin = Math.sin(dyaw);
  const dx = origin.x - headWorld[0];
  const dz = origin.z - headWorld[2];
  return { x: headWorld[0] + dx * cos + dz * sin, z: headWorld[2] - dx * sin + dz * cos, yaw: origin.yaw + dyaw };
}

/** Step along the gaze direction (head yaw), e.g. thumbstick forward. */
export function stepOrigin(origin: OriginPose, headWorld: Vec3, headYaw: number, distance: number, northYaw = 0): OriginPose {
  const target: Vec3 = [headWorld[0] - Math.sin(headYaw) * distance, headWorld[1], headWorld[2] - Math.cos(headYaw) * distance];
  return teleportOrigin(origin, headWorld, target, northYaw);
}

/** Keep teleport targets within MAX_TELEPORT_RADIUS of the site origin. */
export function clampToSite(target: Vec3, northYaw = 0, maxRadius = MAX_TELEPORT_RADIUS): Vec3 {
  const scene = worldToScene(target, northYaw);
  const distance = Math.hypot(scene[0], scene[2]);
  if (distance <= maxRadius) {
    return target;
  }
  const factor = maxRadius / distance;
  return sceneToWorld([scene[0] * factor, scene[1], scene[2] * factor], northYaw);
}

// ---------------------------------------------------------------- waypoints

export interface Waypoint {
  id: string;
  label: string;
  /** Scene metres (x east, z north). */
  scene: [number, number];
  /** Facing as a compass bearing in degrees. */
  facing: number;
}

export const WAYPOINTS: Waypoint[] = [
  { id: "receiver", label: "Receiver", scene: [0, 0], facing: 0 },
  { id: "north", label: "North side", scene: [0, 32], facing: 180 },
  { id: "south", label: "South side", scene: [0, -32], facing: 0 },
  { id: "east", label: "East side", scene: [22, 0], facing: 270 },
  { id: "west", label: "West side", scene: [-22, 0], facing: 90 },
  { id: "overview", label: "Overview", scene: [0, -70], facing: 0 }
];

/** Origin pose that puts the operator (whose head is at headLocal relative to the origin) at a waypoint, facing its bearing. */
export function originForWaypoint(waypoint: Waypoint, northYaw: number, headLocal: Vec3 = [0, 0, 0]): OriginPose {
  const world = sceneToWorld([waypoint.scene[0], 0, waypoint.scene[1]], northYaw);
  // Facing bearing b (clockwise from north). North is world -Z rotated by northYaw; three.js yaw turns counter-clockwise.
  const yaw = northYaw - (waypoint.facing * Math.PI) / 180;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const headX = headLocal[0] * cos + headLocal[2] * sin;
  const headZ = -headLocal[0] * sin + headLocal[2] * cos;
  return { x: world[0] - headX, z: world[2] - headZ, yaw };
}

// ---------------------------------------------------------------- north alignment

/**
 * Align north: the operator stands facing real north and presses Align. Returns
 * the world yaw at which scene north (-Z) should sit so it matches where they face.
 */
export function northYawFromHead(headYaw: number): number {
  return headYaw;
}

// ---------------------------------------------------------------- labels

export interface Labelled {
  id: string;
  /** World position. */
  world: Vec3;
}

/** The k nearest items within range of the head: only these get floating text labels (cost control). */
export function nearestForLabels<T extends Labelled>(items: T[], head: Vec3, k = 12, maxDistance = 35): T[] {
  return items
    .map((item) => ({ item, distance: Math.hypot(item.world[0] - head[0], item.world[2] - head[2]) }))
    .filter((entry) => entry.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k)
    .map((entry) => entry.item);
}

export const LIFE_STORAGE_KEY = "tds.xr.life.v1";

export interface LifeState {
  origin: OriginPose;
  northYaw: number;
}

export function parseLifeState(raw: string | null): LifeState {
  const fallback: LifeState = { origin: DEFAULT_ORIGIN, northYaw: 0 };
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LifeState>;
    const finite = (value: unknown, otherwise: number) => (typeof value === "number" && Number.isFinite(value) ? value : otherwise);
    return {
      origin: { x: finite(parsed.origin?.x, 0), z: finite(parsed.origin?.z, 0), yaw: finite(parsed.origin?.yaw, 0) },
      northYaw: finite(parsed.northYaw, 0)
    };
  } catch {
    return fallback;
  }
}

/**
 * Where to spawn a panel so it appears in front of the operator's current gaze:
 * `distance` ahead, `sideways` to the right, top edge `above` eye height.
 * Returned in origin-local coordinates (the panels group follows the XR origin).
 */
export function spawnInFrontOfHead(head: { position: Vec3; yaw: number }, origin: OriginPose, distance = 1.0, sideways = 0.3, above = 0.28): Vec3 {
  const forwardX = -Math.sin(head.yaw);
  const forwardZ = -Math.cos(head.yaw);
  const rightX = Math.cos(head.yaw);
  const rightZ = -Math.sin(head.yaw);
  const world: Vec3 = [head.position[0] + forwardX * distance + rightX * sideways, head.position[1] + above, head.position[2] + forwardZ * distance + rightZ * sideways];
  // World -> origin-local: translate, then rotate by -origin.yaw.
  const dx = world[0] - origin.x;
  const dz = world[2] - origin.z;
  const cos = Math.cos(-origin.yaw);
  const sin = Math.sin(-origin.yaw);
  return [dx * cos + dz * sin, world[1], -dx * sin + dz * cos];
}
