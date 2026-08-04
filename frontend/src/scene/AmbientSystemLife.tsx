import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Mesh } from "three";
import type { SituationSourceHealth } from "../data/situationModel";

export interface AmbientSystemLifeModel {
  color: string;
  opacity: number;
  pulseRate: number;
  radius: number;
}

export function ambientSystemLifeModel(sources: SituationSourceHealth[]): AmbientSystemLifeModel {
  if (sources.length === 0) {
    return { color: "#31535a", opacity: 0.025, pulseRate: 0.06, radius: 26 };
  }

  const liveCount = sources.filter((source) => source.status === "live").length;
  const staleCount = sources.filter((source) => source.status === "stale").length;
  const recordWeight = Math.min(0.04, sources.reduce((sum, source) => sum + source.recordCount, 0) / 2000);

  return {
    color: liveCount > 0 ? "#7df2e6" : staleCount > 0 ? "#ffd166" : "#46636a",
    opacity: round(Math.min(0.18, 0.035 + liveCount * 0.045 + staleCount * 0.025 + recordWeight)),
    pulseRate: round(0.12 + liveCount * 0.18 + staleCount * 0.08),
    radius: 27 + Math.min(5, sources.length)
  };
}

export function AmbientSystemLife({ sources }: { sources: SituationSourceHealth[] }) {
  const model = ambientSystemLifeModel(sources);
  const ring = useRef<Mesh>(null);

  useFrame(({ clock }) => {
    if (!ring.current) {
      return;
    }
    const pulse = 1 + Math.sin(clock.elapsedTime * model.pulseRate) * 0.018;
    ring.current.scale.setScalar(pulse);
  });

  return (
    <group name="ambient-system-life">
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
        <torusGeometry args={[model.radius, 0.035, 8, 96]} />
        <meshBasicMaterial color={model.color} transparent opacity={model.opacity} depthWrite={false} />
      </mesh>
    </group>
  );
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
