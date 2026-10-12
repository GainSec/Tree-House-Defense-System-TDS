import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { useXR } from "@react-three/xr";
import { FacingGroup } from "./FacingGroup";
import { pulseHaptics } from "./XRSelectionRay";
import { XRLabel, XRPanel } from "./ui/XRPanelKit";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Float32BufferAttribute, Group, Plane, Vector3 } from "three";
import { Text } from "@react-three/uikit";
import { BOARD_RADIUS_SCENE, BOARD_RADIUS_METERS, BOARD_SCENE_TO_METERS, aimAssistRadiusScene, nearestAimCandidate } from "./boardModel";
import type { BoardTransform, Vec3Tuple } from "./boardTransform";
import { BoardContents, aimTargets, type BoardContentsProps } from "./BoardContents";
import { useXRAimAssist } from "./XRAimAssist";
import { XR_COLORS, XR_PIXEL_SIZE } from "./theme";
import { nameObject } from "./ui/XRPanelKit";
import { useDisposable } from "./useDisposable";
import { xrLog } from "./xrLog";

/**
 * The floating, world-anchored board. Its root group lives in XR reference
 * space (local-floor meters) and never follows the head: the operator walks
 * around it. Everything that should keep a constant physical size (cards,
 * palette) is attached outside the scaled diorama group.
 */

const BoardRootContext = createContext<RefObject<Group | null> | null>(null);

export function useBoardRoot(): RefObject<Group | null> {
  const value = useContext(BoardRootContext);
  if (!value) {
    throw new Error("useBoardRoot must be used inside <FloatingOperationsBoard>");
  }
  return value;
}

export interface FloatingOperationsBoardProps {
  board: BoardTransform;
  placementMode: boolean;
  rimColor: string;
  contents: BoardContentsProps;
  /** Physical-size attachments (cards, palette) positioned relative to the board edge. */
  attachments: (edge: { radius: number; height: number }) => ReactNode;
  onPlacementDrag: (position: Vec3Tuple) => void;
  haptics: boolean;
  reducedMotion: boolean;
}

export function FloatingOperationsBoard({ board, placementMode, rimColor, contents, attachments, onPlacementDrag, haptics, reducedMotion }: FloatingOperationsBoardProps) {
  const rootRef = useRef<Group>(null);
  const dioramaRef = useRef<Group>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const targets = useMemo(() => aimTargets(contents.rfEntities, contents.aircraftEntities, contents.focus), [contents.aircraftEntities, contents.focus, contents.rfEntities]);
  const session = useXR((state) => state.session);
  // Light haptic tick when the aimed-at token changes (where the runtime supports haptics).
  useEffect(() => {
    if (!hoveredId || !haptics || !session) {
      return;
    }
    for (const source of Array.from(session.inputSources)) {
      if (source.handedness === "right" || session.inputSources.length === 1) {
        pulseHaptics(source, 0.12, 12);
      }
    }
  }, [haptics, hoveredId, session]);
  const hovered = hoveredId ? targets.find((target) => target.id === hoveredId) ?? null : null;
  const aimEnabled = contents.interactive && !placementMode;
  // In a session the controller aim assist picks targets; mesh picking and the plate projection are desktop-only.
  const inSession = session != null;
  useXRAimAssist({
    spaceRef: dioramaRef,
    collect: () => targets.map((target) => ({ id: target.id, x: target.x, y: target.y, z: -target.z, entity: target.entity })),
    enabled: aimEnabled,
    hoveredId,
    onHover: setHoveredId,
    onSelect: contents.onSelect
  });
  // Aim assist: map a plate hit to the nearest token within ~5 cm (tokens are only millimetres wide).
  const aim = (point: Vector3, select: boolean) => {
    const diorama = dioramaRef.current;
    if (!diorama) {
      return;
    }
    // Diorama-local -> displayed board-scene coordinates (undo the north-up mirror).
    const local = diorama.worldToLocal(point.clone());
    const id = nearestAimCandidate({ x: local.x, z: -local.z }, targets, aimAssistRadiusScene(board.scale));
    setHoveredId(id);
    if (select && id) {
      const target = targets.find((candidate) => candidate.id === id);
      if (target) {
        contents.onSelect(target.entity);
      }
    }
  };
  const radius = BOARD_RADIUS_METERS * board.scale;
  const sceneScale = BOARD_SCENE_TO_METERS * board.scale;
  const height = board.position[1];
  const unlocked = !board.locked;

  return (
    <BoardRootContext.Provider value={rootRef}>
      <group ref={rootRef} name="tds-board-root" position={board.position} rotation={[0, board.yaw, 0]}>
        <BoardGrounding radius={radius} height={height} />
        <BoardPlate
          radius={radius}
          rimColor={rimColor}
          placementMode={placementMode}
          unlocked={unlocked}
          onPlacementDrag={onPlacementDrag}
          rootRef={rootRef}
          onAim={aimEnabled && !inSession ? aim : undefined}
          onAimLeave={() => setHoveredId(null)}
        />
        <group ref={dioramaRef} name="tds-board-diorama" scale={sceneScale}>
          <BoardContents {...contents} interactive={aimEnabled} meshPicking={!inSession} hoveredId={aimEnabled ? hoveredId : null} onHover={setHoveredId} />
        </group>
        {unlocked ? <PlacementGhost radius={radius} active={placementMode} /> : null}
        <NorthMarker radius={radius} />
        {hovered && aimEnabled ? (
          <FacingGroup position={[hovered.x * sceneScale, hovered.top * sceneScale + 0.035, -hovered.z * sceneScale]} reducedMotion={reducedMotion} thresholdRadians={0.2}>
            <XRPanel width={300} padding={10} gap={2} name="xr-hover-tooltip" anchorY="center">
              <XRLabel fontSize={22} color="#dcefff">{hovered.label.length > 26 ? `${hovered.label.slice(0, 25)}...` : hovered.label}</XRLabel>
              <XRLabel fontSize={16}>{hovered.detail}</XRLabel>
            </XRPanel>
          </FacingGroup>
        ) : null}
        {attachments({ radius, height })}
      </group>
    </BoardRootContext.Provider>
  );
}

/** Pedestal, floor shadow and anchor marker: grounds the floating board without needing a physical table. */
function BoardGrounding({ radius, height }: { radius: number; height: number }) {
  const columnHeight = Math.max(0.05, height - 0.04);
  return (
    <group name="board-grounding">
      <mesh position={[0, -0.04 - columnHeight / 2, 0]}>
        <cylinderGeometry args={[0.035, 0.07, columnHeight, 12]} />
        <meshLambertMaterial color={XR_COLORS.pedestal} />
      </mesh>
      <mesh position={[0, -0.025, 0]}>
        <cylinderGeometry args={[radius * 0.32, radius * 0.18, 0.03, 32]} />
        <meshLambertMaterial color={XR_COLORS.pedestal} />
      </mesh>
      {/* Floor projection: one transparent disc at y=0 world (board-local -height). */}
      <mesh position={[0, -height + 0.003, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-1}>
        <circleGeometry args={[radius * 0.95, 48]} />
        <meshBasicMaterial color={XR_COLORS.shadow} transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh position={[0, -height + 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.1, 0.115, 40]} />
        <meshBasicMaterial color={XR_COLORS.accentDim} />
      </mesh>
    </group>
  );
}

function BoardPlate({
  radius,
  rimColor,
  placementMode,
  unlocked,
  onPlacementDrag,
  rootRef,
  onAim,
  onAimLeave
}: {
  radius: number;
  rimColor: string;
  placementMode: boolean;
  unlocked: boolean;
  onPlacementDrag: (position: Vec3Tuple) => void;
  rootRef: RefObject<Group | null>;
  onAim?: (point: Vector3, select: boolean) => void;
  onAimLeave: () => void;
}) {
  const grid = useDisposable(useMemo(() => boardGridGeometry(radius), [radius]));
  // Desktop simulator: OrbitControls listen to DOM events directly, so pause them while dragging the plate.
  const controls = useThree((state) => state.controls) as { enabled: boolean } | null;
  const drag = useRef<{ pointerId: number; start: Vector3; boardStart: Vector3; plane: Plane } | null>(null);
  const hit = useMemo(() => new Vector3(), []);
  const canDrag = placementMode && unlocked;

  const onPointerDown = (event: ThreeEvent<PointerEvent>) => {
    const root = rootRef.current;
    if (!canDrag || !root || !event.ray) {
      return;
    }
    event.stopPropagation();
    const plane = new Plane(new Vector3(0, 1, 0), -root.position.y);
    if (!event.ray.intersectPlane(plane, hit)) {
      return;
    }
    drag.current = { pointerId: event.pointerId, start: hit.clone(), boardStart: root.position.clone(), plane };
    if (controls) {
      controls.enabled = false;
    }
    capturePointer(event);
  };
  const onPointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (onAim && !drag.current) {
      onAim(event.point, false);
      return;
    }
    const state = drag.current;
    const root = rootRef.current;
    if (!state || !root || event.pointerId !== state.pointerId || !event.ray) {
      return;
    }
    event.stopPropagation();
    if (event.ray.intersectPlane(state.plane, hit)) {
      root.position.set(state.boardStart.x + hit.x - state.start.x, state.boardStart.y, state.boardStart.z + hit.z - state.start.z);
    }
  };
  const onPointerUp = (event: ThreeEvent<PointerEvent>) => {
    const state = drag.current;
    const root = rootRef.current;
    if (!state || !root || event.pointerId !== state.pointerId) {
      return;
    }
    event.stopPropagation();
    drag.current = null;
    if (controls) {
      controls.enabled = true;
    }
    xrLog("info", "board: drag placement");
    onPlacementDrag([root.position.x, root.position.y, root.position.z]);
  };

  return (
    <group name="board-plate">
      <mesh
        name="board-plate-surface"
        position={[0, -0.006, 0]}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerOut={onAimLeave}
        onClick={
          onAim
            ? (event: ThreeEvent<MouseEvent>) => {
                event.stopPropagation();
                onAim(event.point, true);
              }
            : undefined
        }
      >
        <cylinderGeometry args={[radius, radius * 0.97, 0.012, 64]} />
        <meshLambertMaterial color={placementMode ? XR_COLORS.panelRaised : XR_COLORS.boardPlate} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[radius * 0.985, radius * 1.012, 96]} />
        <meshBasicMaterial color={rimColor} />
      </mesh>
      <lineSegments geometry={grid} position={[0, 0.0015, 0]}>
        <lineBasicMaterial color={XR_COLORS.boardGrid} />
      </lineSegments>
    </group>
  );
}

function PlacementGhost({ radius, active }: { radius: number; active: boolean }) {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    const outer = radius * 1.08;
    const segments = 48;
    for (let index = 0; index < segments; index += 2) {
      const a0 = (index / segments) * Math.PI * 2;
      const a1 = ((index + 1) / segments) * Math.PI * 2;
      positions.push(Math.cos(a0) * outer, 0.004, Math.sin(a0) * outer, Math.cos(a1) * outer, 0.004, Math.sin(a1) * outer);
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return result;
  }, [radius]);
  useDisposable(geometry);
  return (
    <lineSegments name="placement-ghost" geometry={geometry}>
      <lineBasicMaterial color={active ? XR_COLORS.accent : XR_COLORS.accentDim} />
    </lineSegments>
  );
}

function NorthMarker({ radius }: { radius: number }) {
  return (
    <group position={[0, 0.004, -radius * 1.0 - 0.025]} rotation={[-Math.PI / 2, 0, 0]}>
      <Text ref={nameObject("north-marker")} pixelSize={XR_PIXEL_SIZE} fontSize={34} fontWeight="bold" color={XR_COLORS.accent} anchorX="center" anchorY="center">
        N
      </Text>
    </group>
  );
}

function boardGridGeometry(radius: number): BufferGeometry {
  const positions: number[] = [];
  const rings = [0.25, 0.5, 0.75];
  for (const fraction of rings) {
    const r = radius * fraction;
    const segments = 64;
    for (let index = 0; index < segments; index += 1) {
      const a0 = (index / segments) * Math.PI * 2;
      const a1 = ((index + 1) / segments) * Math.PI * 2;
      positions.push(Math.cos(a0) * r, 0, Math.sin(a0) * r, Math.cos(a1) * r, 0, Math.sin(a1) * r);
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    positions.push(Math.cos(angle) * radius * 0.12, 0, Math.sin(angle) * radius * 0.12, Math.cos(angle) * radius * 0.98, 0, Math.sin(angle) * radius * 0.98);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  return geometry;
}

function capturePointer(event: ThreeEvent<PointerEvent>) {
  try {
    (event.target as unknown as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(event.pointerId);
  } catch {
    // Capture is best-effort; dragging still works while the ray stays on the plate.
  }
}

export { BOARD_RADIUS_SCENE };
