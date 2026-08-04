import type { PostureLabel } from "../data/situationModel";
import type { InfrastructureAlertStatus } from "../data/useInfrastructureAlerts";
import type { SelectedSceneEntity } from "../ui/SelectionPanel";

export type WorldCardId = "posture" | "alerts" | "selection";
export type WorldCardStatus = "alert" | "watch" | "clear" | "live" | "empty" | "selected";
type Vec3 = [number, number, number];
export interface WorldPostureReasonChip {
  label: string;
  color: string;
  width: number;
}

const CARD_POSITIONS: Record<WorldCardId, Vec3> = {
  posture: [-20, 7.5, -18],
  alerts: [0, 7.2, -22],
  selection: [20, 7.5, -18]
};

const CARD_COLORS: Record<WorldCardStatus, string> = {
  alert: "#ff5c8a",
  watch: "#ffd166",
  clear: "#7df2e6",
  live: "#7df2e6",
  empty: "#6b7280",
  selected: "#a78bfa"
};

export function worldCardPosition(id: WorldCardId): Vec3 {
  return CARD_POSITIONS[id];
}

export function worldCardColor(status: WorldCardStatus): string {
  return CARD_COLORS[status];
}

export function worldPostureReasonChips(reasons: string[], postureLabel: PostureLabel | null): WorldPostureReasonChip[] {
  const source = reasons.length > 0 ? reasons : ["No active posture drivers"];
  const color = postureLabel === "ALERT" ? CARD_COLORS.alert : postureLabel === "WATCH" ? CARD_COLORS.watch : CARD_COLORS.clear;
  return source.slice(0, 3).map((label) => ({
    label,
    color,
    width: Math.min(5.2, Math.max(1.4, label.length * 0.13))
  }));
}

export function WorldStatusCards({
  postureLabel,
  postureReasons = [],
  alertStatus,
  selected
}: {
  postureLabel: PostureLabel | null;
  postureReasons?: string[];
  alertStatus: InfrastructureAlertStatus;
  selected: SelectedSceneEntity;
}) {
  const postureStatus: WorldCardStatus = postureLabel === "ALERT" ? "alert" : postureLabel === "WATCH" ? "watch" : "clear";
  const alertCardStatus: WorldCardStatus = alertStatus === "live" ? "live" : "empty";
  const selectionStatus: WorldCardStatus = selected ? "selected" : "empty";

  return (
    <group name="world-status-cards">
      <WorldCard id="posture" status={postureStatus} bars={postureLabel === "ALERT" ? 3 : postureLabel === "WATCH" ? 2 : 1} chips={worldPostureReasonChips(postureReasons, postureLabel)} />
      <WorldCard id="alerts" status={alertCardStatus} bars={alertStatus === "live" ? 3 : 1} />
      <WorldCard id="selection" status={selectionStatus} bars={selected ? 3 : 1} />
    </group>
  );
}

function WorldCard({ id, status, bars, chips = [] }: { id: WorldCardId; status: WorldCardStatus; bars: number; chips?: WorldPostureReasonChip[] }) {
  const color = worldCardColor(status);
  return (
    <group position={worldCardPosition(id)}>
      <mesh>
        <boxGeometry args={[7.2, 2.25, 0.12]} />
        <meshStandardMaterial color="#071216" emissive={color} emissiveIntensity={0.16} transparent opacity={0.74} roughness={0.26} metalness={0.18} />
      </mesh>
      <mesh position={[0, 1.22, 0.08]}>
        <boxGeometry args={[7.35, 0.12, 0.12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} transparent opacity={0.92} roughness={0.18} />
      </mesh>
      {Array.from({ length: bars }).map((_, index) => (
        <mesh key={index} position={[-2.2 + index * 2.2, -0.25, 0.09]}>
          <boxGeometry args={[1.55, 0.34, 0.1]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.72} transparent opacity={0.78} roughness={0.22} />
        </mesh>
      ))}
      {chips.map((chip, index) => (
        <mesh key={`${chip.label}:${index}`} position={[-2.2 + index * 2.15, -0.82, 0.1]}>
          <boxGeometry args={[chip.width, 0.16, 0.08]} />
          <meshStandardMaterial color={chip.color} emissive={chip.color} emissiveIntensity={0.7} transparent opacity={0.76} roughness={0.22} />
        </mesh>
      ))}
    </group>
  );
}
