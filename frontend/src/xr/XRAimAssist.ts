import { useEffect, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import type { BoardSelectable } from "./BoardContents";
import { msSinceXRInteraction, noteXRInteraction } from "./xrLog";

/**
 * Controller aim assist for board / life-size targets (RF tokens, aircraft,
 * collector pylons). On the Frame the tokens are millimetres wide and hand
 * tremor made the exact mesh ray flicker on and off them, and a click needed
 * the press and the release to land on the same token. Instead:
 *
 * - hover = the target closest in ANGLE to the controller ray, within a cone
 *   (AIM_CONE_DEGREES, or a minimum radius for close targets);
 * - hysteresis keeps the current target until another is clearly closer or the
 *   ray leaves a wider cone, so a steady hand does not flicker;
 * - selection happens on trigger PRESS (selectstart), unless a UI button took
 *   that press.
 */
export interface AimPoint {
  id: string;
  /** Position in the local space of `spaceRef`. */
  x: number;
  y: number;
  z: number;
  entity: BoardSelectable;
}

export const AIM_CONE_DEGREES = 3.5;
const AIM_MIN_RADIUS_METERS = 0.035;
const KEEP_FACTOR = 1.7;
const SWITCH_FACTOR = 0.6;
const UI_PRESS_WINDOW_MS = 60;

const originMatrix = new Matrix4();
const poseMatrix = new Matrix4();
const rayOrigin = new Vector3();
const rayDirection = new Vector3();
const rayQuaternion = new Quaternion();
const rayScale = new Vector3();
const world = new Vector3();
const offset = new Vector3();

/** Angle (radians) from the ray to a point and the allowed cone at that distance; null when behind the controller. */
export function aimAngle(origin: Vector3, direction: Vector3, point: Vector3): { angle: number; cone: number } | null {
  offset.copy(point).sub(origin);
  const along = offset.dot(direction);
  if (along < 0.1) {
    return null;
  }
  const perpendicular = Math.sqrt(Math.max(0, offset.lengthSq() - along * along));
  const angle = Math.atan2(perpendicular, along);
  const cone = Math.max((AIM_CONE_DEGREES * Math.PI) / 180, Math.atan2(AIM_MIN_RADIUS_METERS, along));
  return { angle, cone };
}

/** Pick the hover target with hysteresis. `scores` maps id -> angle/cone for every candidate in front of the ray. */
export function pickAimTarget(scores: Map<string, { angle: number; cone: number }>, current: string | null): string | null {
  let best: string | null = null;
  let bestRatio = 1;
  for (const [id, score] of scores) {
    const ratio = score.angle / score.cone;
    if (ratio <= bestRatio) {
      best = id;
      bestRatio = ratio;
    }
  }
  const held = current ? scores.get(current) : undefined;
  if (held && held.angle / held.cone <= KEEP_FACTOR) {
    const heldRatio = held.angle / held.cone;
    if (best === null || best === current || bestRatio > heldRatio * SWITCH_FACTOR) {
      return current;
    }
  }
  return best;
}

export function useXRAimAssist({
  spaceRef,
  collect,
  enabled,
  hoveredId,
  onHover,
  onSelect
}: {
  spaceRef: RefObject<Object3D | null>;
  collect: () => AimPoint[];
  enabled: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (entity: BoardSelectable) => void;
}): void {
  const session = useXR((xr) => xr.session) ?? null;
  const gl = useThree((three) => three.gl);
  const activeSource = useRef<XRInputSource | null>(null);
  const hovered = useRef<{ id: string; entity: BoardSelectable } | null>(null);
  const live = useRef({ collect, enabled, onHover, onSelect, hoveredId });
  live.current = { collect, enabled, onHover, onSelect, hoveredId };
  const scores = useRef(new Map<string, { angle: number; cone: number }>());

  useEffect(() => {
    if (!session) {
      return;
    }
    const onSelectStart = (event: XRInputSourceEvent) => {
      activeSource.current = event.inputSource;
      const target = hovered.current;
      if (!target || !live.current.enabled) {
        return;
      }
      // Let UI pointer handlers for the same press run first; a button press wins over the board behind it.
      window.setTimeout(() => {
        if (msSinceXRInteraction() < UI_PRESS_WINDOW_MS) {
          return;
        }
        noteXRInteraction(`aim:${target.id}`);
        live.current.onSelect(target.entity);
      }, 0);
    };
    session.addEventListener("selectstart", onSelectStart as EventListener);
    return () => session.removeEventListener("selectstart", onSelectStart as EventListener);
  }, [session]);

  useFrame((_, __, frame: XRFrame | undefined) => {
    const space = spaceRef.current;
    if (!session || !frame || !space) {
      return;
    }
    if (!live.current.enabled) {
      if (hovered.current) {
        hovered.current = null;
        live.current.onHover(null);
      }
      return;
    }
    const reference = gl.xr.getReferenceSpace();
    const sources = Array.from(session.inputSources).filter((source) => source.targetRayMode === "tracked-pointer");
    const source =
      (activeSource.current && sources.includes(activeSource.current) ? activeSource.current : null) ??
      sources.find((candidate) => candidate.handedness === "right") ??
      sources[0];
    const pose = reference && source ? frame.getPose(source.targetRaySpace, reference) : null;
    if (!pose) {
      return;
    }
    originMatrix.copy(gl.xr.getCamera().parent?.matrixWorld ?? originMatrix.identity());
    poseMatrix.fromArray(pose.transform.matrix).premultiply(originMatrix);
    poseMatrix.decompose(rayOrigin, rayQuaternion, rayScale);
    rayDirection.set(0, 0, -1).applyQuaternion(rayQuaternion);

    space.updateWorldMatrix(true, false);
    const map = scores.current;
    map.clear();
    const entities = new Map<string, BoardSelectable>();
    for (const point of live.current.collect()) {
      world.set(point.x, point.y, point.z).applyMatrix4(space.matrixWorld);
      const score = aimAngle(rayOrigin, rayDirection, world);
      if (score) {
        map.set(point.id, score);
        entities.set(point.id, point.entity);
      }
    }
    const next = pickAimTarget(map, hovered.current?.id ?? null);
    if (next !== (hovered.current?.id ?? null)) {
      hovered.current = next ? { id: next, entity: entities.get(next)! } : null;
      live.current.onHover(next);
    } else if (next && hovered.current) {
      hovered.current.entity = entities.get(next)!;
    }
  });
}
