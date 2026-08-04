import { Html } from "@react-three/drei";
import type { CSSProperties, ReactNode } from "react";
import type { CardDockId, CardDockItem, CardDockState } from "../ui/useCardDock";

export type DetachedCardContent = Partial<Record<CardDockId, ReactNode>>;

const CARD_COLORS: Record<CardDockId, string> = {
  alerts: "#ffd166",
  hud: "#7df2e6",
  filters: "#2dd4bf",
  selection: "#ff5c8a",
  situation: "#a78bfa"
};

export interface DetachedCardStation {
  label: string;
  color: string;
  platform: [number, number, number];
  mastHeight: number;
}

const DETACHED_CARD_STATIONS: Record<CardDockId, DetachedCardStation> = {
  alerts: { label: "Alerts", color: CARD_COLORS.alerts, platform: [3.35, 0.28, 0.2], mastHeight: 2.4 },
  hud: { label: "Command", color: CARD_COLORS.hud, platform: [3.35, 0.28, 0.2], mastHeight: 2.8 },
  filters: { label: "Filters", color: CARD_COLORS.filters, platform: [2.2, 0.08, 0.08], mastHeight: 2.6 },
  selection: { label: "Evidence", color: CARD_COLORS.selection, platform: [3.35, 0.28, 0.2], mastHeight: 2.5 },
  situation: { label: "Situation", color: CARD_COLORS.situation, platform: [3.35, 0.28, 0.2], mastHeight: 2.5 }
};

export function cardDockChipPosition(_id: CardDockId, index: number): [number, number, number] {
  return [-7.5 + index * 2.5, 3.1, -7.5];
}

export function hiddenCardObjectPosition(id: CardDockId, index: number): [number, number, number] {
  const positions: Partial<Record<CardDockId, [number, number, number]>> = {
    hud: [-5.8, 4.9, -8.2],
    filters: [0, 5.2, -8.2],
    selection: [-3.2, 3.9, -8.2],
    situation: [3.2, 4.6, -8.2]
  };
  return positions[id] ?? cardDockChipPosition(id, index);
}

export function hiddenCardObjectAriaLabel(id: CardDockId): string {
  const labels: Record<CardDockId, string> = {
    alerts: "Open realtime alarms",
    hud: "Open TDS dashboard",
    filters: "Open signal filters",
    selection: "Open object detail",
    situation: "Open phase 1 context"
  };
  return labels[id];
}

export function alertBeaconPosition(): [number, number, number] {
  return [0, 11, 10];
}

export function cardDockColor(id: CardDockId): string {
  return CARD_COLORS[id];
}

export function detachedCardStation(id: CardDockId): DetachedCardStation {
  return DETACHED_CARD_STATIONS[id];
}

export function detachedCardStyle(card: CardDockItem): CSSProperties {
  return {
    width: "360px",
    transform: `scale(${card.scale})`,
    transformOrigin: "top left"
  };
}

export function CardDockObjects({
  cards,
  detachedContent,
  onRestore
}: {
  cards: CardDockState;
  detachedContent: DetachedCardContent;
  onRestore: (id: CardDockId) => void;
}) {
  const hiddenCards = Object.values(cards).filter((card) => card.mode === "hidden" && card.id !== "alerts");
  const detachedCards = Object.values(cards).filter((card) => card.mode === "detached");

  return (
    <group name="card-dock-objects">
      {hiddenCards.map((card, index) => {
        const color = cardDockColor(card.id);
        return (
          <HiddenCardObject key={card.id} card={card} index={index} color={color} onRestore={() => onRestore(card.id)} />
        );
      })}
      {detachedCards.map((card) => (
        <group key={card.id} name={`${card.id}-operator-station`} position={card.position}>
          <DetachedCardGantry station={detachedCardStation(card.id)} />
          <Html transform position={[0, 0, 0.24]} rotation={[0, 0, 0]} style={{ pointerEvents: "auto" }}>
            <div className="detached-card-panel" style={detachedCardStyle(card)}>
              {detachedContent[card.id]}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

function DetachedCardGantry({ station }: { station: DetachedCardStation }) {
  return (
    <group name={`${station.label.toLowerCase()}-station-gantry`}>
      <mesh position={[0, -0.42, -0.06]}>
        <boxGeometry args={station.platform} />
        <meshStandardMaterial color="#071216" emissive={station.color} emissiveIntensity={0.28} transparent opacity={0.38} roughness={0.3} />
      </mesh>
      <mesh position={[-1.55, -0.42 - station.mastHeight / 2, -0.1]}>
        <boxGeometry args={[0.08, station.mastHeight, 0.08]} />
        <meshStandardMaterial color={station.color} emissive={station.color} emissiveIntensity={0.8} transparent opacity={0.72} roughness={0.22} />
      </mesh>
      <mesh position={[1.55, -0.42 - station.mastHeight / 2, -0.1]}>
        <boxGeometry args={[0.08, station.mastHeight, 0.08]} />
        <meshStandardMaterial color={station.color} emissive={station.color} emissiveIntensity={0.8} transparent opacity={0.72} roughness={0.22} />
      </mesh>
      <pointLight color={station.color} intensity={1.6} distance={8} />
    </group>
  );
}

function HiddenCardObject({ card, index, color, onRestore }: { card: CardDockItem; index: number; color: string; onRestore: () => void }) {
  if (card.id === "hud") {
    return <TdsLogoObject index={index} color={color} onRestore={onRestore} />;
  }

  return (
    <group name={`${card.id}-scene-open-object`} position={hiddenCardObjectPosition(card.id, index)}>
      <mesh onClick={onRestore}>
        <boxGeometry args={[2.05, 0.72, 0.2]} />
        <meshStandardMaterial color="#071216" emissive={color} emissiveIntensity={0.9} transparent opacity={0.92} roughness={0.22} />
      </mesh>
      <mesh position={[0, 0, -0.16]}>
        <boxGeometry args={[2.28, 0.94, 0.05]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.34} transparent opacity={0.18} roughness={0.5} />
      </mesh>
      <pointLight color={color} intensity={2.2} distance={8} />
      <Html transform center position={[0, 0, 0.2]} style={{ pointerEvents: "auto" }}>
        <button type="button" className="scene-object-chip" aria-label={hiddenCardObjectAriaLabel(card.id)} onClick={onRestore}>
          {card.id === "selection" ? "Detail" : card.id === "filters" ? "Filters" : "Context"}
        </button>
      </Html>
    </group>
  );
}

function TdsLogoObject({ index, color, onRestore }: { index: number; color: string; onRestore: () => void }) {
  return (
    <group name="tds-logo-scene-open-object" position={hiddenCardObjectPosition("hud", index)}>
      <mesh onClick={onRestore}>
        <cylinderGeometry args={[1.12, 1.12, 0.3, 6]} />
        <meshStandardMaterial color="#062026" emissive={color} emissiveIntensity={1.05} transparent opacity={0.95} roughness={0.18} metalness={0.2} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.36, 0.055, 8, 64]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.35} transparent opacity={0.84} roughness={0.2} />
      </mesh>
      <pointLight color={color} intensity={3.2} distance={10} />
      <Html transform center position={[0, 0, 0.26]} style={{ pointerEvents: "auto" }}>
        <button type="button" className="tds-logo-object-button" aria-label={hiddenCardObjectAriaLabel("hud")} onClick={onRestore}>
          TDS
        </button>
      </Html>
    </group>
  );
}

export function AlertBeacon({ onRestore }: { onRestore: () => void }) {
  return (
    <group name="realtime-alert-beacon" position={alertBeaconPosition()}>
      <mesh onClick={onRestore}>
        <sphereGeometry args={[2.25, 40, 26]} />
        <meshStandardMaterial color="#2d1504" emissive="#ffd166" emissiveIntensity={2.6} transparent opacity={0.96} roughness={0.12} metalness={0.18} />
      </mesh>
      <mesh position={[0, 0.34, 1.82]}>
        <boxGeometry args={[0.54, 2.28, 0.28]} />
        <meshStandardMaterial color="#fff7d6" emissive="#fff1a6" emissiveIntensity={1.9} roughness={0.14} />
      </mesh>
      <mesh position={[0, -1.28, 1.82]}>
        <sphereGeometry args={[0.36, 22, 14]} />
        <meshStandardMaterial color="#fff7d6" emissive="#fff1a6" emissiveIntensity={2.1} roughness={0.14} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.72, 0.09, 10, 72]} />
        <meshStandardMaterial color="#ffd166" emissive="#ffd166" emissiveIntensity={1.35} transparent opacity={0.84} />
      </mesh>
      <pointLight color="#ffd166" intensity={8.4} distance={28} />
      <Html transform center position={[0, 0, 2.5]} style={{ pointerEvents: "auto" }}>
        <button type="button" className="alert-beacon-button" aria-label="Open realtime alarms" onClick={onRestore}>!</button>
      </Html>
    </group>
  );
}
