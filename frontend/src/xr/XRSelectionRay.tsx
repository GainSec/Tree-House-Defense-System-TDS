import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  PointerCursorModel,
  PointerRayModel,
  XRSpace,
  useRayPointer,
  usePointerXRInputSourceEvents,
  useXR,
  useXRInputSourceStateContext,
  type XRStoreOptions
} from "@react-three/xr";
import { BufferGeometry, Euler, Float32BufferAttribute, Group, LineSegments, Quaternion, Vector3 } from "three";
import type { BoardAction, BoardTransform } from "./boardTransform";
import { stickAdjust, twoHandTransform, type HandPoint } from "./interaction";
import { XR_COLORS } from "./theme";
import { noteXRInteraction, xrLog } from "./xrLog";
import { useDisposable } from "./useDisposable";

/**
 * Controller input: aim-ray configuration, grip placement, two-handed scale /
 * rotate, thumbsticks and haptics.
 *
 * Grip state comes from BOTH WebXR squeeze events and polled gamepad button 1
 * (xr-standard squeeze), so placement still works on runtimes that do not fire
 * squeeze events. Haptics pulse when supported; nothing depends on them.
 */

export const TARGET_FRAME_RATE = 72;

/** Prefer exactly 72 Hz (Steam Frame standalone target), else the lowest rate above it, else the highest available. */
export function chooseFrameRate(supported: ArrayLike<number>): number | false {
  const rates = Array.from(supported).sort((a, b) => a - b);
  if (rates.length === 0) {
    return false;
  }
  if (rates.includes(TARGET_FRAME_RATE)) {
    return TARGET_FRAME_RATE;
  }
  return rates.find((rate) => rate > TARGET_FRAME_RATE) ?? rates[rates.length - 1];
}

export function buildXRStoreOptions({ emulate, assetBase }: { emulate: boolean; assetBase: string }): XRStoreOptions {
  const ray = { rayModel: { color: XR_COLORS.accent, opacity: 0.85 }, cursorModel: { color: XR_COLORS.accent } };
  return {
    // Never auto-emulate: an emulator would make capability detection lie. Opt in with ?emulate=1 (dev only).
    // No synthetic room: it would be a fake passthrough background.
    emulate: emulate ? { type: "metaQuest3", syntheticEnvironment: false } : false,
    offerSession: false,
    // Minimal optional features: no plane/mesh/hit-test (no table detection), no layers, no DOM overlay.
    anchors: false,
    planeDetection: false,
    meshDetection: false,
    hitTest: false,
    layers: false,
    domOverlay: false,
    bodyTracking: false,
    handTracking: true,
    frameRate: chooseFrameRate,
    // Self-hosted generic input profiles (see public/xr-input-profiles). No CDN.
    baseAssetPath: assetBase,
    defaultControllerProfileId: "generic-trigger-squeeze-thumbstick",
    controller: SmoothedRayController,
    hand: { model: false, teleportPointer: false, grabPointer: false, touchPointer: false, rayPointer: ray },
    transientPointer: true,
    gaze: false,
    screenInput: false
  };
}

const RAY_STYLE = { color: XR_COLORS.accent, opacity: 0.85, maxLength: 4 };
const rawPosition = new Vector3();
const rawQuaternion = new Quaternion();
const rawScale = new Vector3();

/**
 * Controller ray with jitter smoothing. Hand tremor at arm's length moves the
 * raw target ray by a degree or more, which made card buttons flicker between
 * hovered and not. The pointer (and the drawn ray) follow a filtered copy of
 * the target-ray space: slow movement is smoothed heavily, fast movement
 * follows almost immediately (a one-euro style adaptive filter).
 */
function SmoothedRayController() {
  const state = useXRInputSourceStateContext("controller");
  const raw = useRef<Group>(null);
  const smooth = useRef<Group>(null);
  const primed = useRef(false);
  const pointer = useRayPointer(smooth, state, { minDistance: 0.2, clickThresholdMs: 1000 });
  usePointerXRInputSourceEvents(pointer, state.inputSource, "select", state.events);

  // After the XR space matrices (-100) and before pointers move (-50).
  useFrame((_, delta) => {
    const source = raw.current;
    const target = smooth.current;
    if (!source || !target) {
      return;
    }
    const ready = (source as Group & { transformReady?: boolean }).transformReady !== false && source.visible;
    (target as Group & { transformReady?: boolean }).transformReady = ready;
    target.visible = ready;
    if (!ready) {
      primed.current = false;
      return;
    }
    source.matrix.decompose(rawPosition, rawQuaternion, rawScale);
    if (!primed.current) {
      target.position.copy(rawPosition);
      target.quaternion.copy(rawQuaternion);
      primed.current = true;
    } else {
      const dt = Math.max(delta, 1 / 240);
      const angle = target.quaternion.angleTo(rawQuaternion);
      // Cutoff rises with angular speed: ~1.2 Hz when holding still, quick when sweeping.
      const cutoff = 1.2 + 4 * (angle / dt);
      const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * dt);
      target.quaternion.slerp(rawQuaternion, Math.min(1, alpha));
      target.position.lerp(rawPosition, Math.min(1, alpha * 1.5));
    }
    target.matrix.compose(target.position, target.quaternion, rawScale.set(1, 1, 1));
  }, -75);

  return (
    <>
      <XRSpace ref={raw} space="target-ray-space" />
      <group ref={smooth} matrixAutoUpdate={false}>
        <PointerRayModel pointer={pointer} {...RAY_STYLE} />
        <PointerCursorModel pointer={pointer} {...RAY_STYLE} />
      </group>
    </>
  );
}

export function pulseHaptics(inputSource: XRInputSource | null | undefined, intensity = 0.4, durationMs = 30): void {
  const actuator = inputSource?.gamepad?.hapticActuators?.[0] as (GamepadHapticActuator & { pulse?: (value: number, duration: number) => Promise<boolean> }) | undefined;
  try {
    if (actuator?.pulse) {
      void actuator.pulse(intensity, durationMs);
    } else if (actuator && "playEffect" in actuator) {
      void actuator.playEffect("dual-rumble", { duration: durationMs, strongMagnitude: intensity, weakMagnitude: intensity });
    }
  } catch {
    // Haptics are optional.
  }
}

const poseEuler = new Euler(0, 0, 0, "YXZ");
const poseQuaternion = new Quaternion();

interface Held {
  source: XRInputSource;
  start: HandPoint;
  startYaw: number;
  now: HandPoint;
  nowYaw: number;
}

interface Manipulation {
  start: BoardTransform;
  /** Accumulated thumbstick adjustments while held (one hand). */
  extraScale: number;
  extraYaw: number;
  work: BoardTransform;
}

const SQUEEZE_BUTTON = 1;
const STICK_X = 2;
const STICK_Y = 3;

/**
 * Grip placement and thumbstick control. Moves the board root imperatively
 * every frame and commits a single board action when the gesture ends.
 */
export function XRGripPlacement({
  rootRef,
  board,
  placementMode,
  haptics,
  onGripStart,
  dispatch,
  viewerYaw,
  selectedKey
}: {
  rootRef: React.RefObject<Group | null>;
  board: BoardTransform;
  placementMode: boolean;
  haptics: boolean;
  onGripStart: () => void;
  dispatch: (action: BoardAction) => void;
  viewerYaw: () => number;
  selectedKey: string | null;
}) {
  const session = useXR((state) => state.session);
  const held = useRef(new Map<XRInputSource, Held>());
  const eventHeld = useRef(new Set<XRInputSource>());
  const lockedNotice = useRef(new Set<XRInputSource>());
  const manipulation = useRef<Manipulation | null>(null);
  const nudge = useRef<{ work: BoardTransform; idleFrames: number } | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const lastSelectSource = useRef<XRInputSource | null>(null);
  const live = useRef({ placementMode, haptics, onGripStart, dispatch, viewerYaw });
  live.current = { placementMode, haptics, onGripStart, dispatch, viewerYaw };

  const pulse = (source: XRInputSource, intensity: number, ms: number) => {
    if (live.current.haptics) {
      pulseHaptics(source, intensity, ms);
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }
    const onSqueezeStart = (event: XRInputSourceEvent) => eventHeld.current.add(event.inputSource);
    const onSqueezeEnd = (event: XRInputSourceEvent) => eventHeld.current.delete(event.inputSource);
    const onSelectStart = (event: XRInputSourceEvent) => {
      lastSelectSource.current = event.inputSource;
    };
    session.addEventListener("squeezestart", onSqueezeStart);
    session.addEventListener("squeezeend", onSqueezeEnd);
    session.addEventListener("selectstart", onSelectStart);
    return () => {
      session.removeEventListener("squeezestart", onSqueezeStart);
      session.removeEventListener("squeezeend", onSqueezeEnd);
      session.removeEventListener("selectstart", onSelectStart);
      eventHeld.current.clear();
      held.current.clear();
      manipulation.current = null;
    };
  }, [session]);

  // Light confirmation pulse when the selection changes from a trigger press.
  useEffect(() => {
    if (selectedKey && lastSelectSource.current) {
      pulse(lastSelectSource.current, 0.25, 20);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  useFrame((state, delta, frame: XRFrame | undefined) => {
    const root = rootRef.current;
    if (!frame || !root || !session) {
      return;
    }
    const reference = state.gl.xr.getReferenceSpace();
    if (!reference) {
      return;
    }
    const readPose = (source: XRInputSource): { point: HandPoint; yaw: number } | null => {
      const pose = frame.getPose(source.gripSpace ?? source.targetRaySpace, reference);
      if (!pose) {
        return null;
      }
      const { x, y, z } = pose.transform.position;
      const o = pose.transform.orientation;
      poseEuler.setFromQuaternion(poseQuaternion.set(o.x, o.y, o.z, o.w), "YXZ");
      return { point: { x, y, z }, yaw: poseEuler.y };
    };

    // Grip = squeeze event OR polled squeeze button. Drop event state for controllers that disappeared
    // mid-squeeze (no squeezeend arrives), otherwise the gesture would never commit.
    const present = new Set(Array.from(session.inputSources));
    for (const source of [...eventHeld.current]) {
      if (!present.has(source)) {
        eventHeld.current.delete(source);
      }
    }
    const wanted = new Set<XRInputSource>(eventHeld.current);
    for (const source of Array.from(session.inputSources)) {
      if (source.gamepad?.buttons[SQUEEZE_BUTTON]?.pressed) {
        wanted.add(source);
      }
    }

    let changed = false;
    for (const source of wanted) {
      if (held.current.has(source)) {
        continue;
      }
      if (boardRef.current.locked) {
        if (!lockedNotice.current.has(source)) {
          lockedNotice.current.add(source);
          xrLog("info", `grip ignored (${source.handedness}): board locked`);
          pulse(source, 0.15, 20);
        }
        continue;
      }
      const pose = readPose(source);
      if (!pose) {
        continue;
      }
      held.current.set(source, { source, start: pose.point, startYaw: pose.yaw, now: pose.point, nowYaw: pose.yaw });
      changed = true;
      pulse(source, 0.5, 40);
      noteXRInteraction(`grip:${source.handedness}`);
      live.current.onGripStart();
    }
    for (const source of [...lockedNotice.current]) {
      if (!wanted.has(source)) {
        lockedNotice.current.delete(source);
      }
    }
    for (const source of [...held.current.keys()]) {
      if (!wanted.has(source)) {
        held.current.delete(source);
        changed = true;
        pulse(source, 0.3, 25);
      }
    }

    if (changed) {
      if (held.current.size === 0 && manipulation.current) {
        const result = manipulation.current.work;
        manipulation.current = null;
        root.scale.setScalar(1);
        live.current.dispatch({ type: "setTransform", position: result.position, yaw: result.yaw, scale: result.scale });
        xrLog("info", `grip release: committed scale x${result.scale.toFixed(2)}`);
      } else if (held.current.size > 0) {
        // (Re)baseline from the board's current on-screen transform.
        const current = manipulation.current?.work ?? boardRef.current;
        manipulation.current = { start: current, extraScale: 1, extraYaw: 0, work: current };
        for (const hand of held.current.values()) {
          hand.start = hand.now;
          hand.startYaw = hand.nowYaw;
        }
        xrLog("info", `grip ${held.current.size >= 2 ? "two-handed" : "one-handed"}`);
      }
    }

    const m = manipulation.current;
    if (m && held.current.size > 0) {
      const hands = [...held.current.values()];
      for (const hand of hands) {
        const pose = readPose(hand.source);
        if (pose) {
          hand.now = pose.point;
          hand.nowYaw = pose.yaw;
        }
      }
      let work: BoardTransform;
      if (hands.length >= 2) {
        work = twoHandTransform(m.start, hands[0].start, hands[1].start, hands[0].now, hands[1].now);
      } else {
        const hand = hands[0];
        // Thumbstick on the holding controller: push/pull scales, left/right turns.
        const axes = hand.source.gamepad?.axes;
        if (axes && axes.length > STICK_Y) {
          const adjusted = stickAdjust({ ...m.start, scale: m.start.scale * m.extraScale, yaw: m.extraYaw }, { x: axes[STICK_X], y: axes[STICK_Y] }, delta, "held", 0);
          m.extraScale = adjusted.scale / m.start.scale;
          m.extraYaw = adjusted.yaw;
        }
        work = {
          ...m.start,
          position: [m.start.position[0] + hand.now.x - hand.start.x, m.start.position[1] + hand.now.y - hand.start.y, m.start.position[2] + hand.now.z - hand.start.z],
          yaw: m.start.yaw + (hand.nowYaw - hand.startYaw) + m.extraYaw,
          scale: m.start.scale * m.extraScale
        };
      }
      m.work = work;
      root.position.set(work.position[0], Math.max(0.05, Math.min(1.5, work.position[1])), work.position[2]);
      root.rotation.y = work.yaw;
      root.scale.setScalar(work.scale / boardRef.current.scale);
      return;
    }

    // Place mode, nothing held: thumbstick nudges the board relative to the viewer.
    if (live.current.placementMode && !boardRef.current.locked) {
      let stick: { x: number; y: number } | null = null;
      for (const source of Array.from(session.inputSources)) {
        const axes = source.gamepad?.axes;
        if (axes && axes.length > STICK_Y && (Math.abs(axes[STICK_X]) > 0.2 || Math.abs(axes[STICK_Y]) > 0.2)) {
          stick = { x: axes[STICK_X], y: axes[STICK_Y] };
          break;
        }
      }
      if (stick) {
        const base = nudge.current?.work ?? boardRef.current;
        const next = stickAdjust(base, stick, delta, "nudge", live.current.viewerYaw());
        nudge.current = { work: next, idleFrames: 0 };
        root.position.set(next.position[0], next.position[1], next.position[2]);
      } else if (nudge.current) {
        nudge.current.idleFrames += 1;
        if (nudge.current.idleFrames > 10) {
          const result = nudge.current.work;
          nudge.current = null;
          live.current.dispatch({ type: "setPose", position: result.position, yaw: result.yaw });
        }
      }
    }
  });

  return null;
}

const HAND_OFFSET = new Vector3(0.22, -0.28, -0.35);
const handWorld = new Vector3();

/**
 * Desktop controller-ray approximation: draws a ray from a virtual right hand to
 * whatever the mouse is pointing at, so the simulator reads like aiming a controller.
 */
export function DesktopRayVisual({ hitRef }: { hitRef: React.RefObject<Vector3 | null> }) {
  const lineRef = useRef<LineSegments>(null);
  const geometry = useMemo(() => {
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 0, 0, -1], 3));
    return result;
  }, []);
  useDisposable(geometry);

  useFrame(({ camera }) => {
    const line = lineRef.current;
    if (!line) {
      return;
    }
    const hit = hitRef.current;
    line.visible = Boolean(hit);
    if (!hit) {
      return;
    }
    handWorld.copy(HAND_OFFSET).applyQuaternion(camera.quaternion).add(camera.position);
    const positions = geometry.getAttribute("position") as Float32BufferAttribute;
    positions.setXYZ(0, handWorld.x, handWorld.y, handWorld.z);
    positions.setXYZ(1, hit.x, hit.y, hit.z);
    positions.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  return (
    <lineSegments ref={lineRef} geometry={geometry} frustumCulled={false} raycast={() => null}>
      <lineBasicMaterial color={XR_COLORS.accent} />
    </lineSegments>
  );
}
