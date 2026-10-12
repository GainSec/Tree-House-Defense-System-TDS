import { useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Quaternion, Vector3 } from "three";

const worldPosition = new Vector3();
const cameraPosition = new Vector3();
const parentQuaternion = new Quaternion();
const forward = new Vector3();

/**
 * Yaw-only facing with hysteresis: a card turns toward the viewer only after the
 * viewer has walked more than `thresholdRadians` around it, so it stays readable
 * without constantly orbiting the user. Snaps instead of easing under reduced motion.
 */
export function FacingGroup({
  children,
  position,
  thresholdRadians = 0.45,
  reducedMotion = false,
  name
}: {
  children: ReactNode;
  position: [number, number, number];
  thresholdRadians?: number;
  reducedMotion?: boolean;
  name?: string;
}) {
  const ref = useRef<Group>(null);
  const target = useRef<number | null>(null);

  useFrame((state, delta) => {
    const group = ref.current;
    if (!group || !group.parent) {
      return;
    }
    group.getWorldPosition(worldPosition);
    state.camera.getWorldPosition(cameraPosition);
    group.parent.getWorldQuaternion(parentQuaternion);
    forward.set(cameraPosition.x - worldPosition.x, 0, cameraPosition.z - worldPosition.z);
    if (forward.lengthSq() < 1e-6) {
      return;
    }
    // Convert world direction into the parent's yaw frame.
    forward.applyQuaternion(parentQuaternion.invert());
    const desired = Math.atan2(forward.x, forward.z);
    if (target.current === null || Math.abs(angleDelta(desired, target.current)) > thresholdRadians) {
      target.current = desired;
    }
    const current = group.rotation.y;
    const diff = angleDelta(target.current, current);
    if (reducedMotion || Math.abs(diff) < 0.002) {
      group.rotation.y = target.current;
    } else {
      group.rotation.y = current + diff * Math.min(1, delta * 6);
    }
  });

  return (
    <group ref={ref} name={name} position={position}>
      {children}
    </group>
  );
}

function angleDelta(a: number, b: number): number {
  let diff = a - b;
  while (diff > Math.PI) {
    diff -= Math.PI * 2;
  }
  while (diff < -Math.PI) {
    diff += Math.PI * 2;
  }
  return diff;
}
