import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { Quaternion, Vector3, type Group } from "three";
import type { RfCorrelationArc, RfSceneEntity, RfSignalDistanceBand, RfVisualFreshnessClass } from "../data/sceneModel";
import type { PresenceDossier, RfMapCategory } from "../domain/types";

export const RF_SPHERE_SEGMENTS = {
  width: 14,
  height: 10
};

export const RF_RING_SEGMENTS = 28;
export const RF_UNCERTAINTY_RINGS_ENABLED = false;
export const RF_MARKER_SIZE_SCALE = 0.5;

export type RfMarkerModel = "wifi-symbol" | "bluetooth-symbol" | "utility-bolt" | "unknown-diamond" | "infrastructure-node" | "rail-track" | "iot-mesh" | "orb";
export type RfSourceConfidenceArc = RfCorrelationArc & { opacity: number };

const SOURCE_CONFIDENCE_COLORS: Record<string, string> = {
  unifi: "#22c55e",
  openwrt: "#f97316",
  kismet: "#22d3ee",
  intercept: "#f59e0b",
  rail_rf: "#7dd3fc",
  gps: "#a3e635",
  adsb: "#ffb86b"
};

export function rfMarkerModelForCategory(category: RfMapCategory): RfMarkerModel {
  if (category === "wifi") {
    return "wifi-symbol";
  }
  if (category === "ble") {
    return "bluetooth-symbol";
  }
  if (category === "utility") {
    return "utility-bolt";
  }
  if (category === "unknown_rf") {
    return "unknown-diamond";
  }
  if (category === "infrastructure") {
    return "infrastructure-node";
  }
  if (category === "rail") {
    return "rail-track";
  }
  if (category === "iot") {
    return "iot-mesh";
  }
  return "orb";
}

export function rfMarkerRenderScale(radius: number, minimum = 0): number {
  return Math.max(minimum, radius) * RF_MARKER_SIZE_SCALE;
}

export function rfDistanceBandHaloRadius(band: RfSignalDistanceBand = "unknown"): number {
  switch (band) {
    case "near":
      return 1.35;
    case "mid":
      return 2.35;
    case "far":
      return 3.45;
    case "unknown":
      return 1.9;
  }
}

export function rfDistanceBandHaloOpacity(
  band: RfSignalDistanceBand = "unknown",
  freshness: RfVisualFreshnessClass = "live",
  selected = false
): number {
  if (selected) {
    return freshness === "expired" ? 0.16 : 0.34;
  }
  if (freshness === "expired") {
    return 0;
  }
  if (freshness === "ghost") {
    return 0;
  }
  if (band === "near") {
    return 0.32;
  }
  return 0;
}

export function rfCorrelationHaloVisible(entity: RfSceneEntity, selected: boolean): boolean {
  const arcCount = entity.correlation?.arcs.length ?? 0;
  return selected ? arcCount > 0 : entity.correlation?.strength === "multi-source" && arcCount >= 3;
}

export function rfCorrelationHaloArcRadius(index: number, selected: boolean): number {
  return 0.96 + index * 0.16 + (selected ? 0.18 : 0);
}

export function rfSourceConfidenceArcs(dossier: PresenceDossier | null): RfSourceConfidenceArc[] {
  if (!dossier) {
    return [];
  }
  return [...dossier.source_confidence]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 5)
    .map((source) => {
      const confidence = Math.max(0.18, Math.min(1, source.confidence));
      const sourceId = source.source.toLowerCase();
      return {
        source: source.source,
        label: `${source.source} ${Math.round(confidence * 100)}%`,
        color: SOURCE_CONFIDENCE_COLORS[sourceId] ?? "#e6f1ff",
        opacity: Math.round(confidence * 100) / 100
      };
    });
}

export function RfField({
  entities,
  selectedId,
  selectedDossier = null,
  onSelect
}: {
  entities: RfSceneEntity[];
  selectedId: string | null;
  selectedDossier?: PresenceDossier | null;
  onSelect: (entity: RfSceneEntity) => void;
}) {
  return (
    <group>
      {entities.map((entity, index) => (
        <RfOrb
          key={entity.id}
          entity={entity}
          index={index}
          selected={selectedId === entity.id}
          selectedDossier={selectedDossier}
          onSelect={onSelect}
        />
      ))}
    </group>
  );
}

function RfOrb({
  entity,
  index,
  selected,
  selectedDossier,
  onSelect
}: {
  entity: RfSceneEntity;
  index: number;
  selected: boolean;
  selectedDossier: PresenceDossier | null;
  onSelect: (entity: RfSceneEntity) => void;
}) {
  const marker = useRef<Group>(null);
  const haloOpacity = rfDistanceBandHaloOpacity(entity.visual.distanceBand, entity.visual.freshnessClass, selected);
  const sourceConfidenceArcs = selected && selectedDossier?.entity.entity_key === entity.identity ? rfSourceConfidenceArcs(selectedDossier) : [];
  const correlationArcs = sourceConfidenceArcs.length > 0 ? sourceConfidenceArcs : entity.correlation?.arcs;

  useFrame(({ clock }) => {
    if (!marker.current) {
      return;
    }
    const pulse = 1 + Math.sin(clock.elapsedTime * entity.visual.pulseRate + index) * 0.16;
    marker.current.scale.setScalar(pulse);
  });

  return (
    <group position={[entity.position.x, entity.position.y, entity.position.z]}>
      {haloOpacity > 0 ? <DistanceBandHalo color={entity.visual.color} band={entity.visual.distanceBand} opacity={haloOpacity} /> : null}
      {selected ? <SelectionHalo color={entity.visual.color} radius={Math.max(1.1, rfMarkerRenderScale(entity.visual.radius, 0.72) * 1.7)} /> : null}
      {correlationArcs && (sourceConfidenceArcs.length > 0 || rfCorrelationHaloVisible(entity, selected)) ? <CorrelationHalo arcs={correlationArcs} selected={selected} /> : null}
      <group
        ref={marker}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entity);
        }}
      >
        <mesh visible={false}>
          <sphereGeometry args={[Math.max(1.1, rfMarkerRenderScale(entity.visual.radius, 0.72) * 1.8), 12, 8]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
        <RfMarkerModel entity={entity} selected={selected} />
      </group>
      {RF_UNCERTAINTY_RINGS_ENABLED ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.max(1.2, entity.uncertaintyRadius / 20), Math.max(1.45, entity.uncertaintyRadius / 20 + (selected ? 0.16 : 0.06)), RF_RING_SEGMENTS]} />
          <meshBasicMaterial color={entity.visual.color} transparent opacity={selected ? 0.72 : 0.32} />
        </mesh>
      ) : null}
    </group>
  );
}

function CorrelationHalo({ arcs, selected }: { arcs: Array<RfCorrelationArc | RfSourceConfidenceArc>; selected: boolean }) {
  const segmentLength = Math.PI * 1.62;
  const startOffset = -Math.PI * 0.78;

  return (
    <group position={[0, 0.06, 0]}>
      {arcs.slice(0, 5).map((arc, index) => (
        <mesh key={`${arc.source}:${index}`} rotation={[-Math.PI / 2, 0, startOffset + index * 0.68]}>
          <torusGeometry args={[rfCorrelationHaloArcRadius(index, selected), selected ? 0.028 : 0.02, 8, 24, segmentLength]} />
          <meshBasicMaterial color={arc.color} transparent opacity={"opacity" in arc ? arc.opacity : selected ? 0.86 : 0.48} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function DistanceBandHalo({ color, band = "unknown", opacity }: { color: string; band?: RfSignalDistanceBand; opacity: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]}>
      <torusGeometry args={[rfDistanceBandHaloRadius(band), 0.025, 8, 32]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} />
    </mesh>
  );
}

function SelectionHalo({ color, radius }: { color: string; radius: number }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
        <torusGeometry args={[radius, 0.045, 8, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.86} />
      </mesh>
      <pointLight color={color} intensity={2.4} distance={12} />
    </group>
  );
}

function RfMarkerModel({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const model = rfMarkerModelForCategory(entity.category);
  if (model === "wifi-symbol") {
    return <WifiSymbol entity={entity} selected={selected} />;
  }
  if (model === "bluetooth-symbol") {
    return <BluetoothSymbol entity={entity} selected={selected} />;
  }
  if (model === "utility-bolt") {
    return <UtilityBoltSymbol entity={entity} selected={selected} />;
  }
  if (model === "unknown-diamond") {
    return <UnknownDiamondSymbol entity={entity} selected={selected} />;
  }
  if (model === "infrastructure-node") {
    return <InfrastructureNodeSymbol entity={entity} selected={selected} />;
  }
  if (model === "rail-track") {
    return <RailTrackSymbol entity={entity} selected={selected} />;
  }
  if (model === "iot-mesh") {
    return <IotMeshSymbol entity={entity} selected={selected} />;
  }
  return <OrbSymbol entity={entity} selected={selected} />;
}

function OrbSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  return (
    <mesh>
      <sphereGeometry args={[rfMarkerRenderScale(entity.visual.radius), RF_SPHERE_SEGMENTS.width, RF_SPHERE_SEGMENTS.height]} />
      <meshStandardMaterial
        color={entity.visual.color}
        emissive={entity.visual.color}
        emissiveIntensity={selected ? 2 : 1.15}
        transparent
        opacity={selected ? 1 : entity.visual.opacity}
        roughness={0.18}
      />
    </mesh>
  );
}

function WifiSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.72);
  const opacity = selected ? 1 : entity.visual.opacity;

  return (
    <group scale={radius} rotation={[0, 0, Math.PI]}>
      {[1.55, 1.05, 0.58].map((arcRadius, index) => (
        <mesh key={arcRadius} position={[0, -0.2 - index * 0.04, 0]}>
          <torusGeometry args={[arcRadius, 0.07, 8, 28, Math.PI]} />
          <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.2 : 1.25} transparent opacity={opacity} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, -0.25, 0]}>
        <sphereGeometry args={[0.16, 14, 10]} />
        <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.4 : 1.4} transparent opacity={opacity} roughness={0.16} />
      </mesh>
    </group>
  );
}

function BluetoothSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.66);
  const opacity = selected ? 1 : entity.visual.opacity;
  const segments: Array<[[number, number, number], [number, number, number]]> = [
    [[0, -1.2, 0], [0, 1.2, 0]],
    [[0, 1.2, 0], [0.72, 0.52, 0]],
    [[0.72, 0.52, 0], [-0.5, 0, 0]],
    [[-0.5, 0, 0], [0.72, -0.52, 0]],
    [[0.72, -0.52, 0], [0, -1.2, 0]]
  ];

  return (
    <group scale={radius}>
      {segments.map(([start, end], index) => (
        <CylinderSegment key={index} start={start} end={end} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2.3 : 1.3} />
      ))}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.3 : 1.3} transparent opacity={opacity} roughness={0.18} />
      </mesh>
    </group>
  );
}

function UtilityBoltSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.66);
  const opacity = selected ? 1 : entity.visual.opacity;
  const segments: Array<[[number, number, number], [number, number, number]]> = [
    [[0.18, 1.1, 0], [-0.3, 0.18, 0]],
    [[-0.3, 0.18, 0], [0.22, 0.18, 0]],
    [[0.22, 0.18, 0], [-0.18, -1.05, 0]]
  ];

  return (
    <group scale={radius}>
      {segments.map(([start, end], index) => (
        <CylinderSegment key={index} start={start} end={end} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2.6 : 1.45} />
      ))}
      <mesh position={[0, 0, 0]} rotation={[0, 0, Math.PI / 4]}>
        <boxGeometry args={[1.12, 1.12, 0.05]} />
        <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 1.3 : 0.72} transparent opacity={opacity * 0.16} roughness={0.22} />
      </mesh>
    </group>
  );
}

function UnknownDiamondSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.66);
  const opacity = selected ? 1 : entity.visual.opacity;

  return (
    <group scale={radius} rotation={[0, 0, Math.PI / 4]}>
      <mesh>
        <octahedronGeometry args={[0.82, 0]} />
        <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.2 : 1.18} transparent opacity={opacity} roughness={0.18} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.08, 0.035, 8, 36]} />
        <meshBasicMaterial color={entity.visual.color} transparent opacity={selected ? 0.72 : 0.36} depthWrite={false} />
      </mesh>
    </group>
  );
}

function InfrastructureNodeSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.68);
  const opacity = selected ? 1 : entity.visual.opacity;
  const nodes: Array<[number, number, number]> = [
    [0, 0.86, 0],
    [-0.76, -0.44, 0],
    [0.76, -0.44, 0]
  ];

  return (
    <group scale={radius}>
      <CylinderSegment start={nodes[0]} end={nodes[1]} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2 : 1.1} />
      <CylinderSegment start={nodes[1]} end={nodes[2]} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2 : 1.1} />
      <CylinderSegment start={nodes[2]} end={nodes[0]} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2 : 1.1} />
      {nodes.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[0.2, 12, 8]} />
          <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.3 : 1.25} transparent opacity={opacity} roughness={0.18} />
        </mesh>
      ))}
    </group>
  );
}

function RailTrackSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.7);
  const opacity = selected ? 1 : entity.visual.opacity;
  const rails: Array<[[number, number, number], [number, number, number]]> = [
    [[-0.48, -1.05, 0], [-0.48, 1.05, 0]],
    [[0.48, -1.05, 0], [0.48, 1.05, 0]],
    [[-0.78, -0.55, 0], [0.78, -0.55, 0]],
    [[-0.78, 0, 0], [0.78, 0, 0]],
    [[-0.78, 0.55, 0], [0.78, 0.55, 0]]
  ];

  return (
    <group scale={radius}>
      {rails.map(([start, end], index) => (
        <CylinderSegment key={index} start={start} end={end} color={entity.visual.color} opacity={opacity} emissiveIntensity={selected ? 2.4 : 1.28} />
      ))}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.08, 0.035, 8, 36]} />
        <meshBasicMaterial color={entity.visual.color} transparent opacity={selected ? 0.64 : 0.28} depthWrite={false} />
      </mesh>
    </group>
  );
}

function IotMeshSymbol({ entity, selected }: { entity: RfSceneEntity; selected: boolean }) {
  const radius = rfMarkerRenderScale(entity.visual.radius, 0.64);
  const opacity = selected ? 1 : entity.visual.opacity;
  const nodes: Array<[number, number, number]> = [
    [0, 0.92, 0],
    [-0.78, 0.18, 0],
    [-0.42, -0.78, 0],
    [0.54, -0.68, 0],
    [0.84, 0.28, 0]
  ];

  return (
    <group scale={radius}>
      {nodes.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[0.15, 10, 8]} />
          <meshStandardMaterial color={entity.visual.color} emissive={entity.visual.color} emissiveIntensity={selected ? 2.3 : 1.25} transparent opacity={opacity} roughness={0.18} />
        </mesh>
      ))}
      {nodes.map((position, index) => (
        <CylinderSegment key={`link-${index}`} start={position} end={nodes[(index + 1) % nodes.length]} color={entity.visual.color} opacity={opacity * 0.82} emissiveIntensity={selected ? 1.9 : 1.05} />
      ))}
    </group>
  );
}

function CylinderSegment({
  start,
  end,
  color,
  opacity,
  emissiveIntensity
}: {
  start: [number, number, number];
  end: [number, number, number];
  color: string;
  opacity: number;
  emissiveIntensity: number;
}) {
  const { midpoint, length, quaternion } = useMemo(() => {
    const startVector = new Vector3(...start);
    const endVector = new Vector3(...end);
    const direction = endVector.clone().sub(startVector);
    return {
      midpoint: startVector.clone().add(endVector).multiplyScalar(0.5),
      length: direction.length(),
      quaternion: new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize())
    };
  }, [end, start]);

  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[0.055, 0.055, length, 8]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} transparent opacity={opacity} roughness={0.18} />
    </mesh>
  );
}
