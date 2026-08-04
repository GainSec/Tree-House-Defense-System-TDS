import type { SituationSourceHealth, SituationSourceId, SituationStatus } from "../data/situationModel";

export type PostureContextStatus = "clear" | "watch" | "empty";

export interface PostureContextSegment {
  source: SituationSourceId;
  color: string;
  rotation: number;
  arcLength: number;
}

export interface PostureContextModel {
  status: PostureContextStatus;
  color: string;
  segments: PostureContextSegment[];
  rfRodHeight: number;
  aircraftRodHeight: number;
}

const SOURCE_COLORS: Record<SituationStatus, string> = {
  live: "#7df2e6",
  stale: "#ffd166",
  empty: "#5f6f78"
};

const POSTURE_COLORS: Record<PostureContextStatus, string> = {
  clear: "#7df2e6",
  watch: "#ffd166",
  empty: "#5f6f78"
};

export function postureContextColor(status: PostureContextStatus): string {
  return POSTURE_COLORS[status];
}

export function buildPostureContextModel({
  sources,
  rfCount,
  aircraftCount
}: {
  sources: SituationSourceHealth[];
  rfCount: number;
  aircraftCount: number;
}): PostureContextModel {
  const liveCount = sources.filter((source) => source.status === "live").length;
  const staleCount = sources.filter((source) => source.status === "stale").length;
  const status: PostureContextStatus = sources.length === 0 || liveCount === 0 && staleCount === 0 ? "empty" : staleCount > 0 ? "watch" : "clear";
  const arcLength = sources.length > 0 ? Math.PI * 2 / sources.length : 0;

  return {
    status,
    color: postureContextColor(status),
    segments: sources.map((source, index) => ({
      source: source.source,
      color: SOURCE_COLORS[source.status],
      rotation: round(index * arcLength),
      arcLength: round(Math.max(0.42, arcLength * 0.68))
    })),
    rfRodHeight: scaledRodHeight(rfCount, 360),
    aircraftRodHeight: scaledRodHeight(aircraftCount, 20)
  };
}

export function PostureContextBeacon({
  sources,
  rfCount,
  aircraftCount
}: {
  sources: SituationSourceHealth[];
  rfCount: number;
  aircraftCount: number;
}) {
  const model = buildPostureContextModel({ sources, rfCount, aircraftCount });

  return (
    <group name="posture-context-beacon" position={[-8.5, 1.05, -11.5]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.05, 0.035, 8, 96]} />
        <meshBasicMaterial color={model.color} transparent opacity={0.16} depthWrite={false} />
      </mesh>
      {model.segments.map((segment) => (
        <mesh key={segment.source} rotation={[-Math.PI / 2, 0, segment.rotation]}>
          <torusGeometry args={[2.08, 0.07, 8, 16, segment.arcLength]} />
          <meshStandardMaterial color={segment.color} emissive={segment.color} emissiveIntensity={0.62} transparent opacity={0.78} roughness={0.24} />
        </mesh>
      ))}
      <mesh position={[-0.42, model.rfRodHeight / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.1, model.rfRodHeight, 8]} />
        <meshStandardMaterial color="#a78bfa" emissive="#a78bfa" emissiveIntensity={0.72} transparent opacity={0.86} roughness={0.2} />
      </mesh>
      <mesh position={[0.42, model.aircraftRodHeight / 2, 0]}>
        <cylinderGeometry args={[0.07, 0.1, model.aircraftRodHeight, 8]} />
        <meshStandardMaterial color="#ffb86b" emissive="#ffb86b" emissiveIntensity={0.72} transparent opacity={0.86} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.12, 0]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color={model.color} emissive={model.color} emissiveIntensity={0.9} transparent opacity={0.9} roughness={0.18} />
      </mesh>
    </group>
  );
}

function scaledRodHeight(value: number, cap: number): number {
  return round(0.35 + Math.min(1, Math.max(0, value) / cap) * 2.65);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
