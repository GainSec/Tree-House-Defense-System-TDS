import { useMemo, useRef, useState } from "react";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/uikit";
import { BufferGeometry, Float32BufferAttribute, Group, Vector3 } from "three";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import { BoardContents, lifeAimTargets, lifeRfPosition, skyAircraftPosition, type BoardContentsProps } from "./BoardContents";
import { useXRAimAssist } from "./XRAimAssist";
import { useXR } from "@react-three/xr";
import { FacingGroup } from "./FacingGroup";
import { bearingDegrees, compassLabel, elevationDegrees, nearestForLabels, sceneToWorld, type Vec3 } from "./lifeSize";
import { XR_COLORS, XR_PIXEL_SIZE } from "./theme";
import { XRLabel, XRPanel, xrText } from "./ui/XRPanelKit";
import { useDisposable } from "./useDisposable";

/**
 * Life-size presentation: the site at 1:1 around the operator. RF devices float
 * at chest height where they are, the house wireframe surrounds you, collectors
 * stand as pylons, and aircraft sit in the sky at their true bearing and
 * elevation angle (look up to find them). Nothing here fakes passthrough: the
 * ground disc is only drawn in VR.
 */
export function LifeSizeWorld({
  contents,
  northYaw,
  showGround,
  hoveredId,
  onHover,
  onTeleport
}: {
  contents: BoardContentsProps;
  northYaw: number;
  showGround: boolean;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onTeleport: (worldPoint: Vec3) => void;
}) {
  const worldRef = useRef<Group>(null);
  const inSession = useXR((xr) => xr.session) != null;
  const targets = useMemo(() => lifeAimTargets(contents.rfEntities, contents.aircraftEntities), [contents.aircraftEntities, contents.rfEntities]);
  useXRAimAssist({
    spaceRef: worldRef,
    // BoardContents mirrors z (north away from the operator).
    collect: () => targets.map((target) => ({ ...target, z: -target.z })),
    enabled: contents.interactive,
    hoveredId,
    onHover,
    onSelect: contents.onSelect
  });
  return (
    <group ref={worldRef} name="life-size-world" rotation={[0, northYaw, 0]}>
      {showGround ? <LifeGround onTeleport={onTeleport} northYaw={northYaw} /> : <TeleportPlane onTeleport={onTeleport} />}
      <DistanceRings />
      <CompassRing />
      <BoardContents {...contents} layout="life" meshPicking={!inSession} focus={null} hoveredId={hoveredId} onHover={onHover} />
      <LifeLabels rfEntities={contents.rfEntities} aircraftEntities={contents.aircraftEntities} northYaw={northYaw} hoveredId={hoveredId} selectedId={contents.selectedId} />
    </group>
  );
}

/** VR only: a dark ground with a site grid. Clicking/double-clicking it teleports (desktop simulator); in XR the thumbstick aims the teleport. */
function LifeGround({ onTeleport, northYaw }: { onTeleport: (point: Vec3) => void; northYaw: number }) {
  void northYaw;
  return (
    <group name="life-ground">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} onDoubleClick={(event: ThreeEvent<MouseEvent>) => onTeleport(event.point.toArray() as Vec3)}>
        <circleGeometry args={[95, 96]} />
        <meshLambertMaterial color={XR_COLORS.neutralFloor} />
      </mesh>
      <gridHelper args={[190, 38, XR_COLORS.panelBorder, "#2a3238"]} position={[0, 0.003, 0]} />
    </group>
  );
}

/** AR: an invisible teleport plane on the real floor (no fake environment is drawn). */
function TeleportPlane({ onTeleport }: { onTeleport: (point: Vec3) => void }) {
  return (
    <mesh name="life-teleport-plane" rotation={[-Math.PI / 2, 0, 0]} onDoubleClick={(event: ThreeEvent<MouseEvent>) => onTeleport(event.point.toArray() as Vec3)}>
      <circleGeometry args={[95, 48]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

const RING_RADII = [10, 25, 50];

/** Range rings around the receiver (10 / 25 / 50 m), labelled, flat on the floor. */
function DistanceRings() {
  const geometry = useMemo(() => {
    const positions: number[] = [];
    for (const radius of RING_RADII) {
      const segments = 128;
      for (let index = 0; index < segments; index += 1) {
        const a0 = (index / segments) * Math.PI * 2;
        const a1 = ((index + 1) / segments) * Math.PI * 2;
        positions.push(Math.cos(a0) * radius, 0.02, Math.sin(a0) * radius, Math.cos(a1) * radius, 0.02, Math.sin(a1) * radius);
      }
    }
    const result = new BufferGeometry();
    result.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return result;
  }, []);
  useDisposable(geometry);
  return (
    <group name="distance-rings">
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={XR_COLORS.accentDim} />
      </lineSegments>
      {RING_RADII.map((radius) => (
        <group key={radius} position={[0, 0.03, -radius]} rotation={[-Math.PI / 2, 0, 0]}>
          <Text pixelSize={XR_PIXEL_SIZE * 8} fontSize={60} color={XR_COLORS.textMuted} anchorX="center" anchorY="center">
            {`${radius} m`}
          </Text>
        </group>
      ))}
    </group>
  );
}

/** Compass letters on the horizon so the operator knows where north is. */
function CompassRing() {
  const marks: Array<[string, number]> = [
    ["N", 0],
    ["E", 90],
    ["S", 180],
    ["W", 270]
  ];
  return (
    <group name="compass">
      {marks.map(([label, bearing]) => {
        const radians = (bearing * Math.PI) / 180;
        // Inside the north-up world group: north = -Z, east = +X.
        const position: Vec3 = [Math.sin(radians) * 70, 6, -Math.cos(radians) * 70];
        return (
          <FacingGroup key={label} position={position} thresholdRadians={0.05}>
            <Text pixelSize={XR_PIXEL_SIZE * 20} fontSize={200} fontWeight="bold" color={label === "N" ? XR_COLORS.hot : XR_COLORS.accent} anchorX="center" anchorY="center">
              {label}
            </Text>
          </FacingGroup>
        );
      })}
    </group>
  );
}

const headWorld = new Vector3();

interface LabelItem {
  id: string;
  world: Vec3;
  local: Vec3;
  title: string;
  detail: string;
  kind: "rf" | "aircraft";
}

/**
 * Floating name labels. Every aircraft gets one (they are few and far away);
 * RF devices get one only when they are among the nearest to the operator, plus
 * the hovered and selected ones. Recomputed a few times per second, not per frame.
 */
function LifeLabels({
  rfEntities,
  aircraftEntities,
  northYaw,
  hoveredId,
  selectedId
}: {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  northYaw: number;
  hoveredId: string | null;
  selectedId: string | null;
}) {
  const camera = useThree((state) => state.camera);
  const [nearIds, setNearIds] = useState<string[]>([]);
  /** Label scale per RF id: grows with distance so text keeps a readable angular size. */
  const [labelScale, setLabelScale] = useState<Record<string, number>>({});
  const lastUpdate = useRef(0);
  const group = useRef<Group>(null);

  const rfItems = useMemo<LabelItem[]>(
    () =>
      rfEntities.map((entity) => {
        const [x, y, z] = lifeRfPosition(entity);
        return {
          id: entity.id,
          // Labels live in the un-mirrored world group: apply the north-up mirror (z -> -z) here.
          local: [x, y + 0.85, -z],
          world: sceneToWorld([x, y, z], northYaw),
          title: entity.label,
          detail: `${typeof entity.rssi === "number" ? `${entity.rssi} dBm` : "no RSSI"} | ${entity.category.replace("_", " ")}`,
          kind: "rf"
        };
      }),
    [northYaw, rfEntities]
  );
  const aircraftItems = useMemo<LabelItem[]>(
    () =>
      aircraftEntities.map((entity) => {
        const [x, y, z] = skyAircraftPosition(entity);
        const bearing = bearingDegrees(entity.localMeters.x, entity.localMeters.z);
        return {
          id: entity.id,
          local: [x, y + 16, -z],
          world: sceneToWorld([x, y, z], northYaw),
          title: entity.label,
          detail: `${entity.altitude === null ? "alt ?" : `${entity.altitude.toLocaleString()} ft`} | ${compassLabel(bearing)} ${elevationDegrees(entity.localMeters, entity.altitude)}° up`,
          kind: "aircraft"
        };
      }),
    [aircraftEntities, northYaw]
  );

  useFrame((state) => {
    if (state.clock.elapsedTime - lastUpdate.current < 0.4) {
      return;
    }
    lastUpdate.current = state.clock.elapsedTime;
    camera.getWorldPosition(headWorld);
    const near = nearestForLabels(rfItems, [headWorld.x, headWorld.y, headWorld.z], 10, 30);
    const ids = near.map((item) => item.id);
    const scales: Record<string, number> = {};
    for (const item of rfItems) {
      const distance = Math.hypot(item.world[0] - headWorld.x, item.world[2] - headWorld.z);
      scales[item.id] = Math.round(Math.min(12, Math.max(1.2, distance / 2)) * 4) / 4;
    }
    if (ids.join("|") !== nearIds.join("|")) {
      setNearIds(ids);
    }
    if (JSON.stringify(scales) !== JSON.stringify(labelScale)) {
      setLabelScale(scales);
    }
  });

  const shown = [
    ...rfItems.filter((item) => nearIds.includes(item.id) || item.id === hoveredId || item.id === selectedId),
    ...aircraftItems
  ];

  return (
    <group ref={group} name="life-labels">
      {shown.map((item) => (
        <FacingGroup key={item.id} position={item.local} thresholdRadians={0.25}>
          <group scale={item.kind === "aircraft" ? 90 : labelScale[item.id] ?? 1} position={[0, item.kind === "aircraft" ? 0 : (labelScale[item.id] ?? 1) * 0.05, 0]}>
            <XRPanel width={item.kind === "aircraft" ? 280 : 300} padding={8} gap={2} anchorY="center" accent={item.id === selectedId ? XR_COLORS.accent : XR_COLORS.panelBorder}>
              <XRLabel fontSize={22} color={item.kind === "aircraft" ? "#d9b8ff" : XR_COLORS.text}>
                {xrText(item.title.length > 24 ? `${item.title.slice(0, 23)}...` : item.title)}
              </XRLabel>
              <XRLabel fontSize={16}>{item.detail}</XRLabel>
            </XRPanel>
          </group>
        </FacingGroup>
      ))}
    </group>
  );
}
