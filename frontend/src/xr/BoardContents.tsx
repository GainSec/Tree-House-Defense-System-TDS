import { useLayoutEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { BufferGeometry, Color, ConeGeometry, CylinderGeometry, Float32BufferAttribute, InstancedMesh, Matrix4, OctahedronGeometry, Quaternion, RingGeometry, Vector3 } from "three";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import type { SituationSourceHealth, SituationSourceId } from "../data/situationModel";
import { townhouseGeometry, houseZoneTone } from "../house/houseGeometry";
import { RF_CATEGORY_COLORS } from "../scene/materials";
import { sourcePylonColor, sourcePylonPosition } from "../scene/sourcePylonModel";
import { BOARD_RADIUS_SCENE, boardAircraftPosition, boardRfPosition, isPresenceEntity, requiresReview, uncertaintyFootprint, type BoardVec3 } from "./boardModel";
import { XR_COLORS } from "./theme";
import { applyFocus, insidePlate, type FocusState } from "./interaction";
import { lifeRfHeight, skyPosition } from "./lifeSize";
import { useDisposable } from "./useDisposable";

/**
 * Miniature board contents in scene units (meters on site). Rendered inside the
 * board's scaled group. Uses instancing so the draw-call count stays flat as the
 * entity budget grows: ~10 draw calls for all RF + aircraft tokens.
 */

export type BoardSelectable = RfSceneEntity | AircraftSceneEntity | { kind: "source"; source: SituationSourceId; label: string };

export interface BoardContentsProps {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  sourceHealth: SituationSourceHealth[];
  selectedId: string | null;
  selectedSource: SituationSourceId | null;
  showPresence: boolean;
  interactive: boolean;
  onSelect: (entity: BoardSelectable) => void;
  /** Zoom around a point; entities that fall off the plate are hidden. */
  focus: FocusState | null;
  /** Presence watchlist keys (green rings). */
  trackedKeys: ReadonlySet<string>;
  /** "board": tabletop diorama. "life": 1:1 scale around the operator, aircraft in the real sky. */
  layout?: "board" | "life";
  /**
   * Exact mesh picking (pointer events on the tokens). Off in an XR session, where the
   * controller aim assist (XRAimAssist) picks targets instead; on for the desktop simulator.
   */
  meshPicking?: boolean;
}

export interface BoardHoverProps {
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

const SOURCE_IDS: SituationSourceId[] = ["openwrt", "unifi", "kismet", "intercept"];
const SOURCE_LABELS: Record<SituationSourceId, string> = { openwrt: "OpenWrt", unifi: "UniFi", kismet: "Kismet", intercept: "Intercept" };
const STALE_GREY = new Color("#3a4650");

// Shared geometries (created once per module).
const TOKEN_GEOMETRY = new CylinderGeometry(0.62, 0.95, 2.2, 14).translate(0, 1.1, 0);
const REVIEW_GEOMETRY = new OctahedronGeometry(1.15, 0).translate(0, 1.6, 0);
const FOOTPRINT_GEOMETRY = new RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2).translate(0, 0.06, 0);
/** Life size: footprints are drawn at their true radius (metres), so the outline stays a few centimetres wide. */
const LIFE_FOOTPRINT_GEOMETRY = new RingGeometry(0.975, 1, 72).rotateX(-Math.PI / 2).translate(0, 0.02, 0);
const AIRCRAFT_GEOMETRY = new ConeGeometry(0.9, 2.6, 10).rotateX(Math.PI / 2);
const HALO_GEOMETRY = new RingGeometry(1.7, 2.1, 48).rotateX(-Math.PI / 2);

export function BoardContents(props: BoardContentsProps & BoardHoverProps) {
  const { sourceHealth, selectedId, selectedSource, showPresence, interactive, onSelect, hoveredId, onHover: setHoveredId, focus } = props;
  const rfEntities = useMemo(() => (focus ? props.rfEntities.filter((entity) => insidePlate(entity.position.x, entity.position.z, focus)) : props.rfEntities), [focus, props.rfEntities]);
  const aircraftEntities = useMemo(
    () => (focus ? props.aircraftEntities.filter((entity) => { const [x, , z] = boardAircraftPosition(entity); return insidePlate(x, z, focus); }) : props.aircraftEntities),
    [focus, props.aircraftEntities]
  );
  const zoom = focus?.zoom ?? 1;
  const life = props.layout === "life";
  const picking = interactive && props.meshPicking !== false;
  const normal = useMemo(() => rfEntities.filter((entity) => !requiresReview(entity)), [rfEntities]);
  const review = useMemo(() => rfEntities.filter(requiresReview), [rfEntities]);
  const presence = useMemo(() => (showPresence ? rfEntities.filter((entity) => isPresenceEntity(entity, props.trackedKeys)) : []), [props.trackedKeys, rfEntities, showPresence]);
  const selectedPosition = useMemo(() => selectionAnchor(rfEntities, aircraftEntities, selectedId, selectedSource, life), [aircraftEntities, life, rfEntities, selectedId, selectedSource]);
  const hoveredPosition = useMemo(
    () => (hoveredId && hoveredId !== selectedId ? selectionAnchor(rfEntities, aircraftEntities, hoveredId, null, life) : null),
    [aircraftEntities, hoveredId, life, rfEntities, selectedId]
  );

  return (
    // Scene coordinates are x=east, z=north. Mirror z so north points away from the operator at the board's front edge and east is on their right.
    <group scale={[1, 1, -1]}>
      {/* Focus zoom: magnify around the focus centre; heights grow more gently so aircraft stay near the board. */}
      <group position={focus ? [-focus.centerX * zoom, 0, -focus.centerZ * zoom] : [0, 0, 0]} scale={[zoom, Math.min(zoom, 2), zoom]}>
      {!focus || insidePlate(0, 0, focus) ? <HouseModel showZones={showPresence} subtle={life} /> : null}
      <SourcePylonTokens sourceHealth={sourceHealth} selectedSource={selectedSource} hoveredId={interactive ? hoveredId : null} interactive={picking} onSelect={onSelect} focus={focus} />
      {/* At life size a footprint is drawn at its true radius, so only the selected device shows one. */}
      <FootprintRings entities={life ? rfEntities.filter((entity) => entity.id === selectedId) : rfEntities} life={life} />
      <InstancedTokens
        name="rf-tokens"
        entities={normal}
        geometry={TOKEN_GEOMETRY}
        positionOf={life ? lifeRfPosition : boardRfPosition}
        colorOf={tokenColor}
        scaleOf={life ? lifeTokenScale : tokenScale}
        interactive={picking}
        onSelect={onSelect}
        onHover={setHoveredId}
      />
      <InstancedTokens
        name="review-tokens"
        entities={review}
        geometry={REVIEW_GEOMETRY}
        positionOf={life ? lifeReviewPosition : boardRfPosition}
        colorOf={(entity) => (entity.freshness === "live" ? XR_COLORS.hot : mixColor(XR_COLORS.hot, 0.45))}
        scaleOf={life ? LIFE_REVIEW_SCALE : UNIT_SCALE}
        interactive={picking}
        onSelect={onSelect}
        onHover={setHoveredId}
        emissive
      />
      <ReviewMarkers entities={review} />
      {presence.length > 0 ? <PresenceRings entities={presence} life={life} /> : null}
      <AircraftTokens entities={aircraftEntities} interactive={picking} onSelect={onSelect} onHover={setHoveredId} life={life} />
      {selectedPosition ? <SelectionHalo anchor={selectedPosition} color={XR_COLORS.accent} beam life={life} /> : null}
      {hoveredPosition && interactive ? <SelectionHalo anchor={hoveredPosition} color={XR_COLORS.text} life={life} /> : null}
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- house

function HouseModel({ showZones, subtle = false }: { showZones: boolean; subtle?: boolean }) {
  const edges = useMemo(() => {
    const positions: number[] = [];
    for (const edge of townhouseGeometry.edges) {
      positions.push(...edge.from, ...edge.to);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geometry;
  }, []);
  useDisposable(edges);

  return (
    <group name="house">
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={XR_COLORS.accent} />
      </lineSegments>
      {/* Life-size: zone plates would be a giant plane under your feet; the wireframe is enough. */}
      {showZones && !subtle
        ? townhouseGeometry.zones.map((zone) => (
            <mesh key={zone.id} position={[zone.center[0], 0.08, zone.center[2]]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={zone.size} />
              <meshBasicMaterial color={mixColor(houseZoneTone(zone.id).color, subtle ? 0.9 : 0.72)} />
            </mesh>
          ))
        : null}
    </group>
  );
}

// ---------------------------------------------------------------- RF / aircraft tokens

interface InstancedTokensProps<T extends { id: string }> {
  name: string;
  entities: T[];
  geometry: BufferGeometry;
  positionOf: (entity: T) => BoardVec3;
  colorOf: (entity: T) => string;
  scaleOf: (entity: T) => BoardVec3;
  rotationOf?: (entity: T) => number;
  interactive: boolean;
  emissive?: boolean;
  onSelect: (entity: T) => void;
  onHover: (id: string | null) => void;
}

const tmpMatrix = new Matrix4();
const tmpQuaternion = new Quaternion();
const tmpPosition = new Vector3();
const tmpScale = new Vector3();
const UP = new Vector3(0, 1, 0);
const tmpColor = new Color();

function InstancedTokens<T extends { id: string }>({ name, entities, geometry, positionOf, colorOf, scaleOf, rotationOf, interactive, emissive = false, onSelect, onHover }: InstancedTokensProps<T>) {
  const capacity = instanceCapacity(entities.length);
  const ref = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) {
      return;
    }
    entities.forEach((entity, index) => {
      tmpPosition.set(...positionOf(entity));
      tmpQuaternion.setFromAxisAngle(UP, rotationOf ? rotationOf(entity) : 0);
      tmpScale.set(...scaleOf(entity));
      tmpMatrix.compose(tmpPosition, tmpQuaternion, tmpScale);
      mesh.setMatrixAt(index, tmpMatrix);
      mesh.setColorAt(index, tmpColor.set(colorOf(entity)));
    });
    mesh.count = entities.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
    }
    mesh.computeBoundingSphere();
  }, [colorOf, entities, positionOf, rotationOf, scaleOf]);

  const entityAt = (event: ThreeEvent<PointerEvent | MouseEvent>) => {
    const index = event.instanceId;
    return typeof index === "number" ? entities[index] : undefined;
  };

  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      name={name}
      args={[geometry, undefined, capacity]}
      dispose={null}
      frustumCulled={false}
      onClick={
        interactive
          ? (event) => {
              const entity = entityAt(event);
              if (entity) {
                event.stopPropagation();
                onSelect(entity);
              }
            }
          : undefined
      }
      onPointerMove={
        interactive
          ? (event) => {
              const entity = entityAt(event);
              onHover(entity ? entity.id : null);
            }
          : undefined
      }
      onPointerOut={interactive ? () => onHover(null) : undefined}
    >
      {emissive ? <meshLambertMaterial emissive={XR_COLORS.hot} emissiveIntensity={0.35} /> : <meshLambertMaterial />}
    </instancedMesh>
  );
}

function FootprintRings({ entities, life = false }: { entities: RfSceneEntity[]; life?: boolean }) {
  return (
    <InstancedTokens
      name="uncertainty-footprints"
      entities={entities}
      geometry={life ? LIFE_FOOTPRINT_GEOMETRY : FOOTPRINT_GEOMETRY}
      positionOf={boardRfPosition}
      colorOf={(entity) => mixColor(RF_CATEGORY_COLORS[entity.category] ?? XR_COLORS.text, 0.55)}
      scaleOf={(entity) => {
        const radius = uncertaintyFootprint(entity.uncertaintyRadius);
        return [radius, 1, radius];
      }}
      interactive={false}
      onSelect={noop}
      onHover={noop}
    />
  );
}

function PresenceRings({ entities, life = false }: { entities: RfSceneEntity[]; life?: boolean }) {
  return (
    <InstancedTokens
      name="presence-rings"
      entities={entities}
      geometry={FOOTPRINT_GEOMETRY}
      positionOf={(entity) => {
        const [x, , z] = boardRfPosition(entity);
        return [x, life ? 0.02 : 0.12, z];
      }}
      colorOf={() => XR_COLORS.good}
      scaleOf={() => (life ? [0.5, 1, 0.5] : [1.6, 1, 1.6])}
      interactive={false}
      onSelect={noop}
      onHover={noop}
    />
  );
}

/** Restrained warning treatment: a thin amber ring around review-required tokens. No animation, no transparency. */
function ReviewMarkers({ entities }: { entities: RfSceneEntity[] }) {
  return (
    <InstancedTokens
      name="review-markers"
      entities={entities}
      geometry={FOOTPRINT_GEOMETRY}
      positionOf={(entity) => {
        const [x, , z] = boardRfPosition(entity);
        return [x, 0.1, z];
      }}
      colorOf={() => XR_COLORS.warn}
      scaleOf={() => [1.9, 1, 1.9]}
      interactive={false}
      onSelect={noop}
      onHover={noop}
    />
  );
}

function AircraftTokens({
  entities,
  interactive,
  onSelect,
  onHover,
  life
}: {
  entities: AircraftSceneEntity[];
  interactive: boolean;
  onSelect: (entity: AircraftSceneEntity) => void;
  onHover: (id: string | null) => void;
  life: boolean;
}) {
  const stalks = useMemo(() => {
    const positions: number[] = [];
    for (const entity of entities) {
      const [x, y, z] = boardAircraftPosition(entity);
      positions.push(x, 0.1, z, x, y, z);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    return geometry;
  }, [entities]);
  useDisposable(stalks);

  return (
    <group name="airspace">
      <InstancedTokens
        name="aircraft-tokens"
        entities={entities}
        geometry={AIRCRAFT_GEOMETRY}
        positionOf={life ? skyAircraftPosition : boardAircraftPosition}
        rotationOf={(entity) => (entity.heading * Math.PI) / 180}
        colorOf={() => RF_CATEGORY_COLORS.aircraft}
        scaleOf={life ? LIFE_AIRCRAFT_SCALE : UNIT_SCALE}
        interactive={interactive}
        onSelect={onSelect}
        onHover={onHover}
      />
      {entities.length > 0 && !life ? (
        <lineSegments geometry={stalks}>
          <lineBasicMaterial color={mixColor(RF_CATEGORY_COLORS.aircraft, 0.6)} />
        </lineSegments>
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------- infrastructure

function SourcePylonTokens({
  sourceHealth,
  selectedSource,
  hoveredId,
  interactive,
  onSelect,
  focus
}: {
  sourceHealth: SituationSourceHealth[];
  selectedSource: SituationSourceId | null;
  hoveredId: string | null;
  interactive: boolean;
  onSelect: (entity: BoardSelectable) => void;
  focus: FocusState | null;
}) {
  return (
    <group name="source-pylons">
      {SOURCE_IDS.filter((source) => {
        const [x, , z] = sourcePylonPosition(source);
        return insidePlate(x, z, focus);
      }).map((source) => {
        const health = sourceHealth.find((candidate) => candidate.source === source);
        const color = sourcePylonColor(health?.status ?? "empty");
        const [x, , z] = sourcePylonPosition(source);
        const selected = selectedSource === source;
        return (
          <group key={source} position={[x, 0, z]}>
            <mesh
              name={`pylon:${source}`}
              position={[0, 3, 0]}
              onClick={
                interactive
                  ? (event) => {
                      event.stopPropagation();
                      onSelect({ kind: "source", source, label: SOURCE_LABELS[source] });
                    }
                  : undefined
              }
            >
              <boxGeometry args={[1.6, 6, 1.6]} />
              <meshLambertMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.5 : 0.12} />
            </mesh>
            <mesh position={[0, 6.6, 0]}>
              <octahedronGeometry args={[1.2, 0]} />
              <meshLambertMaterial color={color} />
            </mesh>
            {selected ? <SelectionHalo anchor={{ position: [0, 0, 0], sky: false }} color={XR_COLORS.accent} beam /> : null}
            {!selected && hoveredId === `source:${source}` ? <SelectionHalo anchor={{ position: [0, 0, 0], sky: false }} color={XR_COLORS.text} /> : null}
          </group>
        );
      })}
    </group>
  );
}

// ---------------------------------------------------------------- selection

interface HaloAnchor {
  position: BoardVec3;
  /** Aircraft in life-size mode: a large ring around the plane in the sky, no ground beam. */
  sky: boolean;
}

/** Board units are map metres shrunk onto the table; at life size the same ring would be 4 m wide, so it is scaled down to a floor marker. */
const LIFE_HALO_SCALE = 0.3;

function SelectionHalo({ anchor, color, beam = false, life = false }: { anchor: HaloAnchor; color: string; beam?: boolean; life?: boolean }) {
  const { position } = anchor;
  const beamGeometry = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0.2, 0, 0, 14, 0], 3));
    return geometry;
  }, []);
  useDisposable(beamGeometry);
  if (anchor.sky) {
    return (
      <group position={position} scale={6}>
        <mesh geometry={HALO_GEOMETRY} dispose={null}>
          <meshBasicMaterial color={color} />
        </mesh>
      </group>
    );
  }
  return (
    <group position={[position[0], life ? 0.02 : 0.15, position[2]]}>
      <mesh geometry={HALO_GEOMETRY} dispose={null} scale={life ? LIFE_HALO_SCALE : 1}>
        <meshBasicMaterial color={color} />
      </mesh>
      {beam ? (
        <lineSegments geometry={beamGeometry}>
          <lineBasicMaterial color={color} />
        </lineSegments>
      ) : null}
    </group>
  );
}

function selectionAnchor(
  rfEntities: RfSceneEntity[],
  aircraftEntities: AircraftSceneEntity[],
  selectedId: string | null,
  selectedSource: SituationSourceId | null,
  life = false
): HaloAnchor | null {
  if (selectedSource) {
    return null;
  }
  if (!selectedId) {
    return null;
  }
  const rf = rfEntities.find((entity) => entity.id === selectedId);
  if (rf) {
    return { position: boardRfPosition(rf), sky: false };
  }
  const aircraft = aircraftEntities.find((entity) => entity.id === selectedId);
  if (aircraft) {
    if (life) {
      return { position: skyAircraftPosition(aircraft), sky: true };
    }
    const [x, , z] = boardAircraftPosition(aircraft);
    return { position: [x, 0, z], sky: false };
  }
  return null;
}

// ---------------------------------------------------------------- life-size layout

const UNIT_SCALE = (): BoardVec3 => [1, 1, 1];
const LIFE_TOKEN_SCALE = 0.22;
const LIFE_REVIEW_SIZE = 0.3;
const LIFE_REVIEW_SCALE = (): BoardVec3 => [LIFE_REVIEW_SIZE, LIFE_REVIEW_SIZE, LIFE_REVIEW_SIZE];
const LIFE_AIRCRAFT_SCALE = (): BoardVec3 => [7, 7, 7];

/** RF tokens float at chest height so you can look at and point to them. */
export function lifeRfPosition(entity: RfSceneEntity): BoardVec3 {
  return [entity.position.x, lifeRfHeight(entity.position.y), entity.position.z];
}

function lifeReviewPosition(entity: RfSceneEntity): BoardVec3 {
  // The review diamond's geometry sits 1.6 above its origin; lower it so it floats like the others.
  return [entity.position.x, lifeRfHeight(entity.position.y) - 1.6 * LIFE_REVIEW_SIZE, entity.position.z];
}

function lifeTokenScale(entity: RfSceneEntity): BoardVec3 {
  const [x, y, z] = tokenScale(entity);
  // About 0.3-0.45 m across: device-sized when you stand next to it, still easy to point at.
  return [x * LIFE_TOKEN_SCALE, y * LIFE_TOKEN_SCALE, z * LIFE_TOKEN_SCALE];
}

/** Aircraft in the real sky: true bearing and elevation on the sky dome. */
export function skyAircraftPosition(entity: AircraftSceneEntity): BoardVec3 {
  return skyPosition(entity.localMeters, entity.altitude);
}

// ---------------------------------------------------------------- helpers

function tokenColor(entity: RfSceneEntity): string {
  const base = RF_CATEGORY_COLORS[entity.category] ?? XR_COLORS.text;
  if (entity.freshness === "live") {
    return base;
  }
  return mixColor(base, entity.freshness === "stale" ? 0.5 : 0.78);
}

function tokenScale(entity: RfSceneEntity): BoardVec3 {
  const strength = typeof entity.rssi === "number" ? Math.max(0, Math.min(1, (entity.rssi + 95) / 60)) : 0.3;
  const width = 0.8 + strength * 0.5;
  const height = entity.category === "infrastructure" ? 2.2 : 0.8 + strength * 0.6;
  return [width, height, width];
}

const mixCache = new Map<string, string>();
/** Blend toward slate grey: conveys staleness without transparency. */
function mixColor(color: string, amount: number): string {
  const key = `${color}:${amount}`;
  const cached = mixCache.get(key);
  if (cached) {
    return cached;
  }
  const value = `#${new Color(color).lerp(STALE_GREY, amount).getHexString()}`;
  mixCache.set(key, value);
  return value;
}

function instanceCapacity(count: number): number {
  let capacity = 16;
  while (capacity < count) {
    capacity *= 2;
  }
  return capacity;
}

function noop() {
  return undefined;
}

export interface AimTarget {
  id: string;
  /** Displayed board-scene position (after focus zoom, before the north-up mirror). */
  x: number;
  z: number;
  /** Token top height in displayed scene units, for tooltips. */
  top: number;
  /** Height the controller aim assist aims at (token centre), displayed scene units. */
  y: number;
  label: string;
  detail: string;
  entity: BoardSelectable;
}

/** Aim-assist / tooltip targets: everything selectable that is currently on the plate. */
export function aimTargets(rfEntities: RfSceneEntity[], aircraftEntities: AircraftSceneEntity[], focus: FocusState | null = null): AimTarget[] {
  const targets: AimTarget[] = [];
  const zoomY = Math.min(focus?.zoom ?? 1, 2);
  const push = (id: string, x: number, z: number, top: number, y: number, label: string, detail: string, entity: BoardSelectable) => {
    if (!insidePlate(x, z, focus)) {
      return;
    }
    const shown = applyFocus(x, z, focus);
    targets.push({ id, x: shown.x, z: shown.z, top: top * zoomY, y: y * zoomY, label, detail, entity });
  };
  for (const entity of rfEntities) {
    const [x, , z] = boardRfPosition(entity);
    push(entity.id, x, z, 3.2, 1.2, entity.label, `${typeof entity.rssi === "number" ? `${entity.rssi} dBm` : "no RSSI"} | ${entity.category.replace("_", " ")} | ${entity.freshness}`, entity);
  }
  for (const entity of aircraftEntities) {
    const [x, y, z] = boardAircraftPosition(entity);
    push(entity.id, x, z, y + 1.5, y, entity.label, `${entity.altitude === null ? "alt ?" : `alt ${entity.altitude.toLocaleString()}`} | ${entity.speed === null ? "" : `${Math.round(entity.speed)} kt`}`, entity);
  }
  for (const source of SOURCE_IDS) {
    const [x, , z] = sourcePylonPosition(source);
    push(`source:${source}`, x, z, 8, 3, SOURCE_LABELS[source], "collector", { kind: "source", source, label: SOURCE_LABELS[source] });
  }
  return targets;
}

/** Life-size aim targets in life-world scene coordinates (metres, before the north-up mirror). */
export function lifeAimTargets(rfEntities: RfSceneEntity[], aircraftEntities: AircraftSceneEntity[]): { id: string; x: number; y: number; z: number; entity: BoardSelectable }[] {
  const targets: { id: string; x: number; y: number; z: number; entity: BoardSelectable }[] = [];
  for (const entity of rfEntities) {
    const [x, y, z] = lifeRfPosition(entity);
    // Token geometry stands on its origin; aim at its middle.
    targets.push({ id: entity.id, x, y: y + (requiresReview(entity) ? 0 : 0.25), z, entity });
  }
  for (const entity of aircraftEntities) {
    const [x, y, z] = skyAircraftPosition(entity);
    targets.push({ id: entity.id, x, y, z, entity });
  }
  for (const source of SOURCE_IDS) {
    const [x, , z] = sourcePylonPosition(source);
    targets.push({ id: `source:${source}`, x, y: 3, z, entity: { kind: "source", source, label: SOURCE_LABELS[source] } });
  }
  return targets;
}

export { BOARD_RADIUS_SCENE };
