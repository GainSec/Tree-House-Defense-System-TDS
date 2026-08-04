import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { FilteredSceneEntities } from "./useSceneFilters";

export type SelectableSceneEntity = RfSceneEntity | AircraftSceneEntity;

export function allSelectableEntities(visible: FilteredSceneEntities): SelectableSceneEntity[] {
  return [...visible.rfEntities, ...visible.aircraftEntities];
}

export function selectAdjacentEntity({
  visible,
  selectedId,
  direction
}: {
  visible: FilteredSceneEntities;
  selectedId: string | null;
  direction: 1 | -1;
}): SelectableSceneEntity | null {
  const entities = allSelectableEntities(visible);
  if (entities.length === 0) {
    return null;
  }
  const currentIndex = selectedId ? entities.findIndex((entity) => entity.id === selectedId) : -1;
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + direction + entities.length) % entities.length;
  return entities[nextIndex] ?? null;
}
