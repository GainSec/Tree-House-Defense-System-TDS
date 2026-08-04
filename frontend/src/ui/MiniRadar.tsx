import type { CSSProperties } from "react";
import type { AircraftSceneEntity, RfSceneEntity, ScenePosition } from "../data/sceneModel";

export type MiniRadarEntity = RfSceneEntity | AircraftSceneEntity;

export interface MiniRadarBlip {
  id: string;
  label: string;
  kind: MiniRadarEntity["kind"];
  color: string;
  selected: boolean;
  x: number;
  y: number;
}

const RADAR_SCENE_RADIUS = 80;
const RADAR_PIXEL_RADIUS = 34;

export function miniRadarBlipPosition(position: Pick<ScenePosition, "x" | "z">): { x: number; y: number } {
  return {
    x: clampRadar((position.x / RADAR_SCENE_RADIUS) * RADAR_PIXEL_RADIUS),
    y: clampRadar((position.z / RADAR_SCENE_RADIUS) * RADAR_PIXEL_RADIUS)
  };
}

export function buildMiniRadarBlips(entities: MiniRadarEntity[], selectedId: string | null, limit = 10): MiniRadarBlip[] {
  return [...entities]
    .sort((left, right) => Number(right.id === selectedId) - Number(left.id === selectedId))
    .slice(0, limit)
    .map((entity) => {
      const position = miniRadarBlipPosition(entity.position);
      return {
        id: entity.id,
        label: entity.label,
        kind: entity.kind,
        color: entity.visual.color,
        selected: entity.id === selectedId,
        x: position.x,
        y: position.y
      };
    });
}

export function compassHeadingLabel(yaw: number): string {
  const normalizedDegrees = ((yaw * 180) / Math.PI + 360) % 360;
  return ["N", "E", "S", "W"][Math.round(normalizedDegrees / 90) % 4];
}

export function MiniRadar({
  entities,
  selectedId,
  yaw,
  onSelect
}: {
  entities: MiniRadarEntity[];
  selectedId: string | null;
  yaw: number;
  onSelect?: (entity: MiniRadarEntity) => void;
}) {
  const blips = buildMiniRadarBlips(entities, selectedId);
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));

  return (
    <aside className="mini-radar" aria-label="Operator mini radar">
      <div className="mini-radar-heading">{compassHeadingLabel(yaw)}</div>
      <div className="mini-radar-disk">
        <div className="mini-radar-needle" style={{ transform: `rotate(${yaw}rad)` }} />
        {blips.map((blip) => (
          <button
            key={blip.id}
            type="button"
            className={blip.selected ? `mini-radar-blip is-${blip.kind} is-selected` : `mini-radar-blip is-${blip.kind}`}
            aria-label={blip.selected ? `${blip.label} selected` : blip.label}
            style={{ "--blip-x": `${blip.x}px`, "--blip-y": `${blip.y}px`, "--blip-color": blip.color } as CSSProperties}
            onClick={() => {
              const entity = entityById.get(blip.id);
              if (entity) {
                onSelect?.(entity);
              }
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function clampRadar(value: number): number {
  return Math.round(Math.max(-RADAR_PIXEL_RADIUS, Math.min(RADAR_PIXEL_RADIUS, value)));
}
