import { Line } from "@react-three/drei";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { OperatorInspectorModel } from "../data/operatorInspector";
import type { ThirdPersonPose } from "./thirdPersonMotion";
import { operatorInspectorPosition } from "./OperatorInspector";

export type TetherSelectable = RfSceneEntity | AircraftSceneEntity;
type Vec3 = [number, number, number];

export function selectionTargetPosition(entity: TetherSelectable): Vec3 {
  return [roundScene(entity.position.x), roundScene(entity.position.y + (entity.kind === "aircraft" ? 0.6 : 0.4)), roundScene(entity.position.z)];
}

export function operatorInspectorAnchor(pose: ThirdPersonPose): Vec3 {
  return operatorInspectorPosition(pose);
}

export function selectionTetherPoints(entity: TetherSelectable | null, pose: ThirdPersonPose): [Vec3, Vec3] | null {
  if (!entity) {
    return null;
  }
  return [operatorInspectorAnchor(pose), selectionTargetPosition(entity)];
}

export function localTagTone(kind: "source" | "freshness" | "severity" | "signal", value: string): string {
  if (kind === "source") {
    return `source-${value}`;
  }
  if (kind === "severity") {
    return ["high", "critical"].includes(value) ? "hot" : value === "medium" ? "warn" : "neutral";
  }
  if (kind === "freshness") {
    return value === "live" ? "good" : value === "stale" ? "warn" : "muted";
  }
  return "neutral";
}

export function SelectionTether({
  selected,
  pose,
  inspector,
  color = "#7df2e6"
}: {
  selected: TetherSelectable | null;
  pose: ThirdPersonPose;
  inspector: OperatorInspectorModel | null;
  color?: string;
}) {
  const points = selectionTetherPoints(selected, pose);
  if (!points || !inspector) {
    return null;
  }
  const entity = selected;
  if (!entity) {
    return null;
  }
  const target = points[1];
  const tagColor = entity.visual.color;

  return (
    <group name="selection-tether">
      <Line points={points} color={color} lineWidth={1.5} transparent opacity={0.72} />
      <group position={[target[0], target[1] + 1.05, target[2]]}>
        {inspector.tags.slice(0, 4).map((tag, index) => (
          <mesh key={`${tag.label}:${index}`} position={[0, index * 0.32, 0]}>
            <boxGeometry args={[Math.max(0.7, Math.min(2.3, tag.label.length * 0.12)), 0.16, 0.08]} />
            <meshStandardMaterial color={tagColor} emissive={tagColor} emissiveIntensity={0.75} transparent opacity={0.78} roughness={0.2} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function roundScene(value: number): number {
  return Math.round(value * 100) / 100;
}
