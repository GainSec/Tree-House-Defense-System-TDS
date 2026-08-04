import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { InfrastructureAlert, InfrastructureAlertStatus } from "../data/useInfrastructureAlerts";

export interface AlertPulseModel {
  visible: boolean;
  color: string;
  intensity: number;
  beamHeight: number;
  ringCount: number;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  warning: 2,
  low: 1,
  info: 1
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#ff5c8a",
  high: "#ff5c8a",
  medium: "#ffd166",
  warning: "#ffd166",
  low: "#7df2e6",
  info: "#7df2e6",
  unknown: "#ff77e9"
};

export function alertPulseColor(severity: string): string {
  return SEVERITY_COLORS[severity.toLowerCase()] ?? SEVERITY_COLORS.unknown;
}

export function buildAlertPulseModel({
  alerts,
  status
}: {
  alerts: InfrastructureAlert[];
  status: InfrastructureAlertStatus;
}): AlertPulseModel {
  if (status !== "live" || alerts.length === 0) {
    return { visible: false, color: alertPulseColor("unknown"), intensity: 0, beamHeight: 0, ringCount: 0 };
  }
  const strongest = [...alerts].sort((left, right) => severityRank(right.severity) - severityRank(left.severity))[0];
  return {
    visible: true,
    color: alertPulseColor(strongest.severity),
    intensity: round(0.48 + Math.min(1, alerts.length / 5) * 0.52),
    beamHeight: round(3.4 + Math.min(1, alerts.length / 5) * 3.4 + severityRank(strongest.severity) * 0.25),
    ringCount: Math.min(4, Math.max(2, alerts.length + 1))
  };
}

export function AlertPulseBeam({
  alerts,
  status
}: {
  alerts: InfrastructureAlert[];
  status: InfrastructureAlertStatus;
}) {
  const model = buildAlertPulseModel({ alerts, status });
  const pulse = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!pulse.current || !model.visible) {
      return;
    }
    const scale = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.04;
    pulse.current.scale.set(scale, 1, scale);
  });

  if (!model.visible) {
    return null;
  }

  return (
    <group ref={pulse} name="alert-pulse-beam" position={[0, 0.18, -13.5]}>
      <mesh position={[0, model.beamHeight / 2, 0]}>
        <cylinderGeometry args={[0.18, 0.66, model.beamHeight, 24, 1, true]} />
        <meshBasicMaterial color={model.color} transparent opacity={0.13 + model.intensity * 0.12} depthWrite={false} />
      </mesh>
      {Array.from({ length: model.ringCount }).map((_, index) => (
        <mesh key={index} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08 + index * 0.08, 0]}>
          <torusGeometry args={[1.2 + index * 0.68, 0.035, 8, 72]} />
          <meshBasicMaterial color={model.color} transparent opacity={0.28 - index * 0.045} depthWrite={false} />
        </mesh>
      ))}
      <pointLight color={model.color} intensity={2.2 + model.intensity * 2.4} distance={18} />
    </group>
  );
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.toLowerCase()] ?? 1;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
