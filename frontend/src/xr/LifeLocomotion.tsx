import { useEffect, useRef, type ComponentRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { OrbitControls } from "@react-three/drei";
import { Group, Plane, Quaternion, Ray, Vector3 } from "three";
import { SNAP_TURN, STEP_DISTANCE, clampToSite, snapTurnOrigin, stepOrigin, teleportOrigin, type OriginPose, type Vec3 } from "./lifeSize";
import { headPoseFromCamera } from "./XRLayerPalette";
import { pulseHaptics } from "./XRSelectionRay";
import { XR_COLORS } from "./theme";
import { noteXRInteraction, xrLog } from "./xrLog";

const STICK_X = 2;
const STICK_Y = 3;
const floor = new Plane(new Vector3(0, 1, 0), 0);
const ray = new Ray();
const hit = new Vector3();
const orientation = new Quaternion();
const yawQuaternion = new Quaternion();
const UP = new Vector3(0, 1, 0);

/**
 * Life-size movement in XR (right thumbstick, comfort-first):
 *  - push forward: aim a teleport marker on the floor, release to jump there
 *  - flick left / right: snap turn 30 degrees
 *  - pull back: step back 1.5 m
 * Physically walking always works too.
 */
export function LifeLocomotion({ origin, northYaw, haptics, onOrigin }: { origin: OriginPose; northYaw: number; haptics: boolean; onOrigin: (origin: OriginPose) => void }) {
  const session = useXR((state) => state.session);
  const camera = useThree((state) => state.camera);
  const marker = useRef<Group>(null);
  const state = useRef({ aiming: false, target: null as Vec3 | null, turnArmed: true, backArmed: true });
  const live = useRef({ origin, northYaw, haptics, onOrigin });
  live.current = { origin, northYaw, haptics, onOrigin };

  useFrame((three, _delta, frame: XRFrame | undefined) => {
    const group = marker.current;
    if (!session || !frame || !group) {
      return;
    }
    const reference = three.gl.xr.getReferenceSpace();
    const right = Array.from(session.inputSources).find((source) => source.handedness === "right") ?? Array.from(session.inputSources)[0];
    const axes = right?.gamepad?.axes;
    if (!right || !reference || !axes || axes.length <= STICK_Y) {
      group.visible = false;
      return;
    }
    const x = axes[STICK_X];
    const y = axes[STICK_Y];
    const s = state.current;
    const head = headPoseFromCamera(camera);

    // Snap turn on a flick, re-armed once the stick returns to centre.
    if (Math.abs(x) < 0.3) s.turnArmed = true;
    if (s.turnArmed && Math.abs(x) > 0.75 && !s.aiming) {
      s.turnArmed = false;
      const next = snapTurnOrigin(live.current.origin, head.position, x > 0 ? -SNAP_TURN : SNAP_TURN);
      noteXRInteraction(`snap-turn:${x > 0 ? "right" : "left"}`);
      live.current.onOrigin(next);
      if (live.current.haptics) pulseHaptics(right, 0.2, 15);
    }
    // Step back on a pull.
    if (y < 0.3) s.backArmed = true;
    if (s.backArmed && y > 0.75 && !s.aiming) {
      s.backArmed = false;
      live.current.onOrigin(stepOrigin(live.current.origin, head.position, head.yaw, -STEP_DISTANCE, live.current.northYaw));
      noteXRInteraction("step-back");
    }

    // Teleport aim while pushed forward.
    if (y < -0.6) {
      s.aiming = true;
      const pose = frame.getPose(right.targetRaySpace, reference);
      s.target = null;
      if (pose) {
        // Pose is in tracking space; the XR origin pose (position + yaw) maps it into the world.
        const p = pose.transform.position;
        const o = pose.transform.orientation;
        const { x: ox, z: oz, yaw } = live.current.origin;
        orientation.set(o.x, o.y, o.z, o.w).premultiply(yawQuaternion.setFromAxisAngle(UP, yaw));
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        ray.origin.set(ox + p.x * cos + p.z * sin, p.y, oz - p.x * sin + p.z * cos);
        ray.direction.set(0, 0, -1).applyQuaternion(orientation);
        if (ray.intersectPlane(floor, hit) && hit.distanceTo(ray.origin) < 60) {
          s.target = clampToSite([hit.x, 0, hit.z], live.current.northYaw);
        }
      }
      group.visible = Boolean(s.target);
      if (s.target) group.position.set(s.target[0], 0.02, s.target[2]);
      return;
    }
    if (s.aiming) {
      s.aiming = false;
      group.visible = false;
      if (s.target) {
        const next = teleportOrigin(live.current.origin, head.position, s.target, live.current.northYaw);
        xrLog("info", `teleport to ${s.target[0].toFixed(1)},${s.target[2].toFixed(1)}`);
        noteXRInteraction("teleport");
        live.current.onOrigin(next);
        if (live.current.haptics) pulseHaptics(right, 0.35, 25);
      }
      s.target = null;
    }
  });

  return (
    <group ref={marker} visible={false} name="teleport-marker">
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.25, 0.32, 40]} />
        <meshBasicMaterial color={XR_COLORS.accent} />
      </mesh>
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.01, 0.01, 1.2, 6]} />
        <meshBasicMaterial color={XR_COLORS.accent} />
      </mesh>
    </group>
  );
}

const EYE_HEIGHT = 1.6;
const forward = new Vector3();

/**
 * Desktop first-person simulator for life-size: drag to look around (in place),
 * WASD / arrows to walk, Q/E to snap turn, double-click the ground to teleport.
 * The camera always follows the shared life origin, so XR and desktop agree.
 */
export function LifeDesktopControls({ origin, northYaw, onOrigin }: { origin: OriginPose; northYaw: number; onOrigin: (origin: OriginPose) => void }) {
  const camera = useThree((state) => state.camera);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const applied = useRef<OriginPose | null>(null);
  const live = useRef({ northYaw, onOrigin });
  live.current = { northYaw, onOrigin };

  /** Move the camera to an origin pose right away (keys can arrive faster than React re-renders). */
  const apply = (next: OriginPose) => {
    const prev = applied.current;
    applied.current = next;
    const target = controls.current?.target;
    if (!prev || prev.yaw !== next.yaw) {
      camera.position.set(next.x, EYE_HEIGHT, next.z);
      forward.set(-Math.sin(next.yaw), 0, -Math.cos(next.yaw));
      target?.copy(camera.position).addScaledVector(forward, 0.05);
    } else {
      const dx = next.x - prev.x;
      const dz = next.z - prev.z;
      camera.position.set(camera.position.x + dx, EYE_HEIGHT, camera.position.z + dz);
      target?.set(target.x + dx, target.y, target.z + dz);
    }
    controls.current?.update();
  };

  // External changes (waypoints, Go there, XR teleports) also move the camera.
  useEffect(() => {
    const prev = applied.current;
    if (!prev || prev.x !== origin.x || prev.z !== origin.z || prev.yaw !== origin.yaw) {
      apply(origin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, origin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey) return;
      const current = applied.current ?? { x: 0, z: 0, yaw: 0 };
      const { northYaw: yaw, onOrigin: set } = live.current;
      // Desktop: the head is directly above the origin; look direction comes from the camera.
      const head: Vec3 = [current.x, EYE_HEIGHT, current.z];
      const lookYaw = headPoseFromCamera(camera).yaw;
      const commit = (next: OriginPose) => {
        apply(next);
        set(next);
      };
      const key = event.key.toLowerCase();
      let next: OriginPose | null = null;
      if (key === "w" || key === "arrowup") next = stepOrigin(current, head, lookYaw, 0.75, yaw);
      else if (key === "s" || key === "arrowdown") next = stepOrigin(current, head, lookYaw, -0.75, yaw);
      else if (key === "a" || key === "arrowleft") next = stepOrigin(current, head, lookYaw + Math.PI / 2, 0.75, yaw);
      else if (key === "d" || key === "arrowright") next = stepOrigin(current, head, lookYaw - Math.PI / 2, 0.75, yaw);
      else if (key === "q" || key === "e") {
        const turned = snapTurnOrigin(current, head, key === "q" ? SNAP_TURN : -SNAP_TURN);
        // Keep looking the way the camera looked, rotated by the snap.
        next = { ...turned, x: current.x, z: current.z, yaw: lookYaw + (key === "q" ? SNAP_TURN : -SNAP_TURN) };
      }
      if (next) {
        event.preventDefault();
        commit({ ...next, yaw: next.yaw === current.yaw ? current.yaw : next.yaw });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  return <OrbitControls ref={controls} makeDefault enablePan={false} enableZoom={false} rotateSpeed={-0.35} minDistance={0.05} maxDistance={0.05} />;
}

export { EYE_HEIGHT };
