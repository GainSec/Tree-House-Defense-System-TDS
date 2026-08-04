import type { SituationSourceHealth, SituationSourceId, SituationStatus } from "../data/situationModel";

type Vec3 = [number, number, number];

const SOURCE_NODE_POSITIONS: Record<SituationSourceId, Vec3> = {
  openwrt: [-32, 2.2, -28],
  unifi: [32, 2.2, -26],
  kismet: [-34, 2.2, 30],
  intercept: [34, 2.2, 28]
};

const SOURCE_NODE_COLORS: Record<SituationStatus, string> = {
  live: "#7df2e6",
  stale: "#ffd166",
  empty: "#ff5c8a"
};

export function sourceNodePosition(source: SituationSourceId): Vec3 {
  return SOURCE_NODE_POSITIONS[source];
}

export function sourceNodeColor(status: SituationStatus): string {
  return SOURCE_NODE_COLORS[status];
}

export function SourceHealthNodes({ sources }: { sources: SituationSourceHealth[] }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <group name="source-health-nodes">
      {sources.map((source) => {
        const color = sourceNodeColor(source.status);
        return (
          <group key={source.source} position={sourceNodePosition(source.source)}>
            <mesh position={[0, 0.16, -0.08]}>
              <boxGeometry args={[2.8, 1.78, 0.08]} />
              <meshStandardMaterial color="#071216" emissive={color} emissiveIntensity={0.18} transparent opacity={0.72} roughness={0.22} metalness={0.24} />
            </mesh>
            <mesh position={[0, 1.12, -0.03]}>
              <boxGeometry args={[2.88, 0.12, 0.12]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.88} roughness={0.18} />
            </mesh>
            <mesh position={[0, -1.15, 0]}>
              <cylinderGeometry args={[0.08, 0.12, 2.2, 14]} />
              <meshStandardMaterial color="#1e3a42" emissive={color} emissiveIntensity={0.24} roughness={0.35} metalness={0.3} />
            </mesh>
            <mesh position={[0, 0.08, 0]}>
              <sphereGeometry args={[0.72, 24, 18]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={source.status === "live" ? 1.35 : 0.78} roughness={0.18} />
            </mesh>
            <mesh position={[0, 0.96, 0]}>
              <boxGeometry args={[1.5, 0.14, 0.36]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.82} roughness={0.24} />
            </mesh>
            <pointLight position={[0, 0.18, 0]} color={color} intensity={source.status === "empty" ? 1.4 : 2.2} distance={10} />
          </group>
        );
      })}
    </group>
  );
}
