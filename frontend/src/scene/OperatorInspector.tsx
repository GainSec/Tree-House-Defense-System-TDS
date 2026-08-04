import type { OperatorInspectorModel, OperatorInspectorStatus, OperatorInspectorTabId } from "../data/operatorInspector";
import type { ThirdPersonPose } from "./thirdPersonMotion";

export interface OperatorInspectorTabBar {
  id: OperatorInspectorTabId;
  active: boolean;
  x: number;
  width: number;
}

const STATUS_COLORS: Record<OperatorInspectorStatus, string> = {
  live: "#7df2e6",
  stale: "#ffd166",
  error: "#ff5c8a",
  empty: "#6b7280"
};

export function operatorInspectorPosition(pose: ThirdPersonPose): [number, number, number] {
  const forwardDistance = 5.8;
  const x = roundScene(pose.position.x + Math.sin(pose.yaw) * forwardDistance);
  const z = roundScene(pose.position.z - Math.cos(pose.yaw) * forwardDistance);
  return [x, 4.2, z];
}

export function operatorInspectorColor(model: OperatorInspectorModel): string {
  return STATUS_COLORS[model.status];
}

export function operatorInspectorTabBars(model: OperatorInspectorModel, activeTab: OperatorInspectorTabId | null): OperatorInspectorTabBar[] {
  const width = 1.7;
  const gap = 0.6;
  const total = model.tabs.length * width + Math.max(0, model.tabs.length - 1) * gap;
  const start = -total / 2 + width / 2;
  return model.tabs.map((tab, index) => ({
    id: tab.id,
    active: tab.id === activeTab,
    x: roundScene(start + index * (width + gap)),
    width
  }));
}

export function OperatorInspector({
  model,
  activeTab
}: {
  model: OperatorInspectorModel | null;
  activeTab: OperatorInspectorTabId | null;
}) {
  if (!model || model.status === "empty") {
    return null;
  }

  const color = operatorInspectorColor(model);
  const active = model.tabs.find((tab) => tab.id === activeTab) ?? model.tabs[0];
  const bars = operatorInspectorTabBars(model, active?.id ?? null);
  const metrics = active?.metrics.slice(0, 5) ?? [];

  return (
    <group name="operator-inspector">
      <mesh>
        <boxGeometry args={[8.7, 3.2, 0.16]} />
        <meshStandardMaterial color="#071216" emissive={color} emissiveIntensity={0.14} transparent opacity={0.82} roughness={0.24} metalness={0.16} />
      </mesh>
      <mesh position={[0, 1.72, 0.1]}>
        <boxGeometry args={[8.85, 0.12, 0.12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.95} transparent opacity={0.92} roughness={0.18} />
      </mesh>
      {bars.map((bar) => (
        <mesh key={bar.id} position={[bar.x, 1.16, 0.11]}>
          <boxGeometry args={[bar.width, bar.active ? 0.28 : 0.14, 0.12]} />
          <meshStandardMaterial color={bar.active ? color : "#34545a"} emissive={bar.active ? color : "#102226"} emissiveIntensity={bar.active ? 0.85 : 0.22} transparent opacity={bar.active ? 0.92 : 0.6} />
        </mesh>
      ))}
      {metrics.map((metric, index) => (
        <mesh key={`${metric.label}:${index}`} position={[-3.15 + index * 1.58, -0.2, 0.11]}>
          <boxGeometry args={[1.1, metricHeight(metric.value), 0.12]} />
          <meshStandardMaterial color={metricColor(metric.tone)} emissive={metricColor(metric.tone)} emissiveIntensity={0.58} transparent opacity={0.78} roughness={0.22} />
        </mesh>
      ))}
      <pointLight position={[0, 0.2, 0.8]} color={color} intensity={1.8} distance={10} />
    </group>
  );
}

function metricHeight(value: string): number {
  const numeric = Number.parseFloat(value.replace(/,/g, ""));
  if (!Number.isFinite(numeric)) {
    return 0.32;
  }
  return Math.max(0.22, Math.min(1.25, 0.24 + Math.log10(Math.max(1, Math.abs(numeric))) * 0.22));
}

function metricColor(tone: string): string {
  if (tone === "hot") {
    return "#ff5c8a";
  }
  if (tone === "warn") {
    return "#ffd166";
  }
  if (tone === "good") {
    return "#7df2e6";
  }
  if (tone === "muted") {
    return "#6b7280";
  }
  return "#a78bfa";
}

function roundScene(value: number): number {
  return Math.round(value * 100) / 100;
}
