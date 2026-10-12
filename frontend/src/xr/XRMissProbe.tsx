import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { Matrix4, Object3D, Quaternion, Raycaster, Vector3, type Intersection } from "three";
import { msSinceXRInteraction, xrLog } from "./xrLog";

/**
 * Diagnostics for trigger presses that select nothing: re-casts the
 * controller's target ray at the moment of the press and logs what lies along
 * it (name path, distance, whether it is hidden, whether it has pointer
 * handlers). Hidden objects with handlers still block the pointer ray, which is
 * the kind of thing this is meant to expose.
 */
const raycaster = new Raycaster();
// Lines are excluded from pointer picking (see XRApp); keep them from cluttering the probe too.
raycaster.params.Line.threshold = 0.002;
const originMatrix = new Matrix4();
const poseMatrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const headPosition = new Vector3();

function hasHandlers(object: Object3D | null): boolean {
  for (let current = object; current; current = current.parent) {
    const r3f = (current as Object3D & { __r3f?: { eventCount?: number } }).__r3f;
    if (r3f?.eventCount) {
      return true;
    }
  }
  return false;
}

function isHidden(object: Object3D | null): boolean {
  for (let current = object; current; current = current.parent) {
    if (!current.visible) {
      return true;
    }
  }
  return false;
}

function pathOf(object: Object3D): string {
  const names: string[] = [];
  for (let current: Object3D | null = object; current && names.length < 4; current = current.parent) {
    names.push(current.name || current.type);
  }
  return names.join("<");
}

function describe(hit: Intersection): string {
  const flags = [hasHandlers(hit.object) ? "handler" : "", isHidden(hit.object) ? "HIDDEN" : ""].filter(Boolean).join(",");
  const instance = typeof hit.instanceId === "number" ? `#${hit.instanceId}` : "";
  return `${pathOf(hit.object)}${instance} d=${hit.distance.toFixed(2)}${flags ? ` [${flags}]` : ""}`;
}

export function XRMissProbe() {
  const session = useXR((xr) => xr.session) ?? null;
  const gl = useThree((three) => three.gl);
  const scene = useThree((three) => three.scene);

  useEffect(() => {
    if (!session) {
      return;
    }
    const onSelect = (event: XRInputSourceEvent) => {
      const reference = gl.xr.getReferenceSpace();
      const pose = reference ? event.frame.getPose(event.inputSource.targetRaySpace, reference) : null;
      if (!pose) {
        return;
      }
      originMatrix.copy(gl.xr.getCamera().parent?.matrixWorld ?? new Matrix4());
      poseMatrix.fromArray(pose.transform.matrix).premultiply(originMatrix);
      poseMatrix.decompose(position, quaternion, scale);
      raycaster.ray.origin.copy(position);
      raycaster.ray.direction.set(0, 0, -1).applyQuaternion(quaternion);
      raycaster.far = 50;
      const hits = raycaster.intersectObject(scene, true).filter((hit) => !hit.object.name.startsWith("xr-ray"));
      gl.xr.getCamera().getWorldPosition(headPosition);
      const summary = hits.slice(0, 6).map(describe).join(" | ") || "nothing within 50 m";
      const ray = `origin=(${position.toArray().map((v) => v.toFixed(2)).join(",")}) dir=(${raycaster.ray.direction.toArray().map((v) => v.toFixed(2)).join(",")}) head=(${headPosition.toArray().map((v) => v.toFixed(2)).join(",")})`;
      const hand = event.inputSource.handedness;
      window.setTimeout(() => {
        if (msSinceXRInteraction() > 450) {
          xrLog("warn", `miss probe (${hand}): ${ray} along ray: ${summary}`);
        }
      }, 420);
    };
    session.addEventListener("select", onSelect as EventListener);
    return () => session.removeEventListener("select", onSelect as EventListener);
  }, [gl, scene, session]);

  return null;
}
