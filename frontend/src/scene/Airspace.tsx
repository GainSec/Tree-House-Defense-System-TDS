import { Html, Line } from "@react-three/drei";
import type { AircraftSceneEntity } from "../data/sceneModel";

export type AircraftMarkerModel = "plane-model";
export interface AircraftAltitudeLadderRing {
  altitudeFeet: number;
  radius: number;
  opacity: number;
}

const AIRCRAFT_ALTITUDE_BANDS = [500, 1000, 2500, 5000] as const;

export function aircraftMarkerModel(): AircraftMarkerModel {
  return "plane-model";
}

export function aircraftMarkerScale(radius: number, selected: boolean): number {
  const baseScale = Math.max(3.4, radius * 1.22);
  return baseScale * (selected ? 1.36 : 1);
}

export function aircraftAltitudeLadderRings(altitudeFeet: number | null | undefined): AircraftAltitudeLadderRing[] {
  const altitudeWeight = typeof altitudeFeet === "number" && Number.isFinite(altitudeFeet) ? Math.min(1.2, Math.max(0, altitudeFeet) / 10000) : 0.55;
  return AIRCRAFT_ALTITUDE_BANDS.map((altitudeBand, index) => ({
    altitudeFeet: altitudeBand,
    radius: round(3.2 + index * 1.85 + altitudeWeight * 0.55),
    opacity: round(0.26 - index * 0.035)
  }));
}

export function aircraftAltitudeBandLabel(altitudeFeet: number | null | undefined): string {
  if (typeof altitudeFeet !== "number" || !Number.isFinite(altitudeFeet)) {
    return "alt unknown";
  }
  if (altitudeFeet < 1000) {
    return `${Math.round(altitudeFeet)} ft`;
  }
  return `${Math.round(altitudeFeet / 100) / 10}k ft`;
}

export function aircraftContrailOpacity(speed: number | null | undefined, selected: boolean): number {
  const speedBoost = typeof speed === "number" && Number.isFinite(speed) ? Math.min(0.26, Math.max(0, speed) / 1200) : 0.04;
  return round(Math.min(0.92, 0.36 + speedBoost + (selected ? 0.24 : 0)));
}

export function Airspace({
  aircraft,
  selectedId,
  onSelect
}: {
  aircraft: AircraftSceneEntity[];
  selectedId: string | null;
  onSelect: (entity: AircraftSceneEntity) => void;
}) {
  return (
    <group>
      {aircraft.map((entity) => (
        <AircraftMarker key={entity.id} entity={entity} selected={selectedId === entity.id} onSelect={onSelect} />
      ))}
    </group>
  );
}

function AircraftMarker({
  entity,
  selected,
  onSelect
}: {
  entity: AircraftSceneEntity;
  selected: boolean;
  onSelect: (entity: AircraftSceneEntity) => void;
}) {
  const headingRadians = ((entity.heading - 90) * Math.PI) / 180;
  const trailLength = Math.max(6, Math.min(24, (entity.speed ?? 120) / 10));
  const trailEnd: [number, number, number] = [
    -Math.cos(headingRadians) * trailLength,
    -1.5,
    Math.sin(headingRadians) * trailLength
  ];
  const contrailOpacity = aircraftContrailOpacity(entity.speed, selected);

  return (
    <group position={[entity.position.x, entity.position.y, entity.position.z]}>
      <AltitudeLadder entity={entity} selected={selected} />
      {selected ? (
        <>
          <mesh>
            <sphereGeometry args={[aircraftMarkerScale(entity.visual.radius, true) * 0.72, 18, 12]} />
            <meshBasicMaterial color={entity.visual.color} transparent opacity={0.18} />
          </mesh>
          <Html position={[0, -Math.max(7, entity.position.y * 0.45), 0]} center distanceFactor={14} className="airspace-selected-aircraft-label">
            <span>{entity.label}</span>
          </Html>
        </>
      ) : null}
      <group
        rotation={[0, -headingRadians, 0]}
        scale={aircraftMarkerScale(entity.visual.radius, selected)}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(entity);
        }}
      >
        <PlaneModel color={entity.visual.color} selected={selected} />
      </group>
      <Line points={[[0, 0, 0], trailEnd]} color={entity.visual.color} lineWidth={selected ? 2.5 : 1.5} transparent opacity={contrailOpacity} />
    </group>
  );
}

function AltitudeLadder({ entity, selected }: { entity: AircraftSceneEntity; selected: boolean }) {
  const rings = aircraftAltitudeLadderRings(entity.altitude);
  const ladderOpacity = selected ? 0.42 : 0.22;

  return (
    <group>
      <Line points={[[0, -Math.max(8, entity.position.y), 0], [0, 0, 0]]} color={entity.visual.color} lineWidth={selected ? 1.4 : 0.9} transparent opacity={ladderOpacity} />
      {rings.map((ring) => (
        <group key={ring.altitudeFeet}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -ring.radius * 0.12, 0]}>
            <torusGeometry args={[ring.radius, selected ? 0.024 : 0.016, 6, 64]} />
            <meshBasicMaterial color={entity.visual.color} transparent opacity={selected ? ring.opacity + 0.1 : ring.opacity} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <Html position={[rings[rings.length - 1]?.radius ?? 4, 0.65, 0]} center distanceFactor={18} className="airspace-altitude-label">
        <span style={{ color: entity.visual.color }}>{aircraftAltitudeBandLabel(entity.altitude)}</span>
      </Html>
    </group>
  );
}

function PlaneModel({ color, selected }: { color: string; selected: boolean }) {
  const emissiveIntensity = selected ? 1.9 : 0.82;

  return (
    <group>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0.2, 0, 0]}>
        <cylinderGeometry args={[0.18, 0.28, 2.8, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.22} />
      </mesh>
      <mesh rotation={[0, 0, -Math.PI / 2]} position={[1.75, 0, 0]}>
        <coneGeometry args={[0.28, 0.7, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.18} />
      </mesh>
      <mesh position={[0.2, -0.03, 0]}>
        <boxGeometry args={[0.5, 0.08, 2.8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.2} />
      </mesh>
      <mesh position={[-1.1, 0.12, 0]}>
        <boxGeometry args={[0.42, 0.07, 1.05]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.22} />
      </mesh>
      <mesh position={[-1.22, 0.48, 0]} rotation={[0, 0, 0.18]}>
        <boxGeometry args={[0.08, 0.82, 0.22]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={emissiveIntensity} roughness={0.22} />
      </mesh>
    </group>
  );
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
