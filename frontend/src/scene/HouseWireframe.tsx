import { Line } from "@react-three/drei";
import { HOUSE_DIMENSIONS, houseZoneTone, houseZoneVolume, townhouseGeometry, type HouseEdge, type HouseZone } from "../house/houseGeometry";

const EDGE_COLORS: Record<HouseEdge["role"], string> = {
  "exterior-horizontal": "#7df2e6",
  "exterior-vertical": "#dcefff",
  interior: "#4aa7b0",
  facade: "#ffd166",
  balcony: "#8dff9b"
};

export function HouseWireframe() {
  return (
    <group>
      {townhouseGeometry.edges.map((houseEdge) => (
        <Line
          key={houseEdge.id}
          points={[houseEdge.from, houseEdge.to]}
          color={EDGE_COLORS[houseEdge.role]}
          lineWidth={houseEdge.role === "exterior-vertical" ? 1.8 : 1.2}
          transparent
          opacity={houseEdge.role === "interior" ? 0.46 : 0.82}
        />
      ))}
      {townhouseGeometry.levels.map((level) => (
        <mesh key={level.name} position={[0, level.y - 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[HOUSE_DIMENSIONS.width, HOUSE_DIMENSIONS.depth]} />
          <meshBasicMaterial color="#12262a" transparent opacity={0.12} depthWrite={false} />
        </mesh>
      ))}
      {townhouseGeometry.zones.map((zone) => (
        <group key={zone.id}>
          <ZoneVolume zone={zone} />
          <ZonePlate zone={zone} />
        </group>
      ))}
    </group>
  );
}

function ZoneVolume({ zone }: { zone: HouseZone }) {
  const volume = houseZoneVolume(zone);
  const tone = houseZoneTone(zone.id);

  return (
    <mesh position={volume.center}>
      <boxGeometry args={volume.size} />
      <meshBasicMaterial color={tone.color} transparent opacity={tone.opacity} depthWrite={false} />
    </mesh>
  );
}

function ZonePlate({ zone }: { zone: HouseZone }) {
  return (
    <group position={zone.center}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={zone.size} />
        <meshBasicMaterial color="#15383d" transparent opacity={zone.id === "balcony" ? 0.22 : 0.14} depthWrite={false} />
      </mesh>
    </group>
  );
}
