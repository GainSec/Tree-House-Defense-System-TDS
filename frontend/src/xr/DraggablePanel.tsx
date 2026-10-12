import { useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Group, Quaternion, Vector3 } from "three";
import { FacingGroup } from "./FacingGroup";
import { keepOutOfHandsZone, panelAnchor, TEXT_SCALE, type PanelId } from "./interaction";
import { useXRView } from "./XRViewState";
import { XR_COLORS } from "./theme";
import { noteXRInteraction, xrLog } from "./xrLog";

const worldPosition = new Vector3();
const headPosition = new Vector3();
const scratch = new Vector3();
const parentInverse = new Quaternion();

/**
 * A world-space panel attached to the board. Panels hang below their anchor
 * (top edge at the anchor) and have a grab bar above them: point at the bar,
 * hold the trigger (or mouse button) and move to reposition. Positions persist
 * per device. Every frame the panel is kept out of the hands zone so it never
 * ends up in the operator's lap or around the controllers.
 */
export function DraggablePanel({ id, radius, children }: { id: PanelId; radius: number; children: ReactNode }) {
  const view = useXRView();
  const anchor = panelAnchor(id, radius, view.panelOffsets, view.comfortMode);
  const base = panelAnchor(id, radius, {}, view.comfortMode);
  const outer = useRef<Group>(null);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ pointerId: number; distance: number; grabOffset: Vector3 } | null>(null);
  const scale = TEXT_SCALE[view.textSize];

  useFrame(({ camera }) => {
    const group = outer.current;
    if (!group || drag.current || !group.parent) {
      return;
    }
    // Reset to the stored anchor, then push out of the hands zone if needed.
    group.position.set(anchor[0], anchor[1], anchor[2]);
    group.getWorldPosition(worldPosition);
    camera.getWorldPosition(headPosition);
    const safe = keepOutOfHandsZone([worldPosition.x, worldPosition.y, worldPosition.z], [headPosition.x, headPosition.y, headPosition.z]);
    if (safe[0] !== worldPosition.x || safe[2] !== worldPosition.z) {
      scratch.set(safe[0], safe[1], safe[2]);
      group.parent.worldToLocal(scratch);
      group.position.copy(scratch);
    }
  });

  const handlers = useMemo(
    () => ({
      onPointerDown: (event: ThreeEvent<PointerEvent>) => {
        const group = outer.current;
        if (!group || !event.ray) {
          return;
        }
        event.stopPropagation();
        group.getWorldPosition(worldPosition);
        drag.current = {
          pointerId: event.pointerId,
          distance: event.point.distanceTo(event.ray.origin),
          grabOffset: worldPosition.clone().sub(event.point)
        };
        noteXRInteraction(`panel-grab:${id}`);
        try {
          (event.target as unknown as { setPointerCapture?: (pointerId: number) => void }).setPointerCapture?.(event.pointerId);
        } catch {
          // best-effort
        }
      },
      onPointerMove: (event: ThreeEvent<PointerEvent>) => {
        const state = drag.current;
        const group = outer.current;
        if (!state || !group || !group.parent || event.pointerId !== state.pointerId || !event.ray) {
          return;
        }
        event.stopPropagation();
        scratch.copy(event.ray.direction).multiplyScalar(state.distance).add(event.ray.origin).add(state.grabOffset);
        group.parent.getWorldQuaternion(parentInverse).invert();
        group.parent.worldToLocal(scratch);
        group.position.copy(scratch);
      },
      onPointerUp: (event: ThreeEvent<PointerEvent>) => {
        const state = drag.current;
        const group = outer.current;
        if (!state || !group || event.pointerId !== state.pointerId) {
          return;
        }
        event.stopPropagation();
        drag.current = null;
        const offset: [number, number, number] = [group.position.x - base[0], group.position.y - base[1], group.position.z - base[2]];
        xrLog("info", `panel moved: ${id}`);
        view.setPanelOffset(id, offset.map((value) => Math.round(value * 1000) / 1000) as [number, number, number]);
      }
    }),
    [base, id, view]
  );

  return (
    <group ref={outer} name={`panel:${id}`} position={anchor}>
      <FacingGroup position={[0, 0, 0]} reducedMotion={view.reducedMotion}>
        <group scale={scale}>
          {/* Grab bar: a pill above the panel, like a window handle. */}
          <mesh
            name={`panel-grab:${id}`}
            position={[0, 0.03, 0.002]}
            onPointerOver={() => setHovered(true)}
            onPointerOut={() => setHovered(false)}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerUp}
            onLostPointerCapture={handlers.onPointerUp}
          >
            <boxGeometry args={[0.16, 0.022, 0.008]} />
            <meshBasicMaterial color={hovered ? XR_COLORS.accent : XR_COLORS.textMuted} />
          </mesh>
          {/* Wider invisible hit target for the grab bar. */}
          <mesh
            position={[0, 0.03, 0]}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerUp}
            onLostPointerCapture={handlers.onPointerUp}
          >
            <boxGeometry args={[0.24, 0.05, 0.01]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {children}
        </group>
      </FacingGroup>
    </group>
  );
}
