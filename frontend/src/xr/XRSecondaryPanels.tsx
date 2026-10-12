import { useState } from "react";
import { Container, Text } from "@react-three/uikit";
import type { RfMapCategory } from "../domain/types";
import { RF_CATEGORY_COLORS } from "../scene/materials";
import { sourcePylonColor } from "../scene/sourcePylonModel";
import type { SceneFilters, SourceId } from "../ui/useSceneFilters";
import { layerLensLabel, type LayerLensMode } from "../ui/useLayerLens";
import { ENTITY_BUDGETS, nextEntityBudget, nextFilterLens, type EntityBudgetId } from "./boardModel";
import { categoryLabel } from "./cards";
import { FIND_GROUP_LABELS, buildFindList, nextTextSize, pageOf, type ComfortMode, type FindGroup, type TextSize } from "./interaction";
import type { AircraftSceneEntity, RfSceneEntity } from "../data/sceneModel";
import { XR_COLORS } from "./theme";
import { XRButton, XRDivider, XRHeading, XRLabel, XRPanel, XRRow, xrText } from "./ui/XRPanelKit";

const SOURCES: Array<{ id: SourceId; label: string }> = [
  { id: "kismet", label: "Kismet" },
  { id: "intercept", label: "Intercept" },
  { id: "unifi", label: "UniFi" },
  { id: "openwrt", label: "OpenWrt" },
  { id: "rail_rf", label: "Rail" },
  { id: "ltesniffer", label: "LTE" }
];
const CATEGORIES: RfMapCategory[] = ["wifi", "ble", "unknown_rf", "utility", "iot", "infrastructure", "rail", "cellular"];

function PanelHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <XRRow>
      <XRHeading fontSize={28}>{title}</XRHeading>
      <Container flexGrow={1} />
      <XRButton label="Close" onActivate={onClose} width={110} testId="secondary-close" />
    </XRRow>
  );
}

// ---------------------------------------------------------------- filters (shared with desktop)

export function XRFiltersPanel({
  filters,
  lens,
  budgetId,
  onToggleSource,
  onToggleCategory,
  onToggleAircraft,
  onToggleStale,
  onLens,
  onBudget,
  onClose
}: {
  filters: SceneFilters;
  lens: LayerLensMode;
  budgetId: EntityBudgetId;
  onToggleSource: (id: SourceId) => void;
  onToggleCategory: (id: RfMapCategory) => void;
  onToggleAircraft: () => void;
  onToggleStale: () => void;
  onLens: (mode: LayerLensMode) => void;
  onBudget: (id: EntityBudgetId) => void;
  onClose: () => void;
}) {
  return (
    <XRPanel width={560} name="xr-filters-panel" gap={10}>
      <PanelHeader title="Filters" onClose={onClose} />
      <XRLabel>Same filters as the desktop dashboard. Highlighted = shown.</XRLabel>
      <XRLabel color={XR_COLORS.accent}>Sources</XRLabel>
      <XRRow>
        {SOURCES.slice(0, 3).map((source) => (
          <XRButton key={source.id} label={source.label} active={!filters.hiddenSources.includes(source.id)} onActivate={() => onToggleSource(source.id)} testId={`filter-source-${source.id}`} />
        ))}
      </XRRow>
      <XRRow>
        {SOURCES.slice(3).map((source) => (
          <XRButton key={source.id} label={source.label} active={!filters.hiddenSources.includes(source.id)} onActivate={() => onToggleSource(source.id)} testId={`filter-source-${source.id}`} />
        ))}
      </XRRow>
      <XRLabel color={XR_COLORS.accent}>Categories</XRLabel>
      {[CATEGORIES.slice(0, 4), CATEGORIES.slice(4)].map((row, index) => (
        <XRRow key={index}>
          {row.map((category) => (
            <XRButton key={category} label={categoryLabel(category)} fontSize={19} active={!filters.hiddenCategories.includes(category)} onActivate={() => onToggleCategory(category)} testId={`filter-category-${category}`} />
          ))}
        </XRRow>
      ))}
      <XRRow>
        <XRButton label="Aircraft" active={filters.showAircraft} onActivate={onToggleAircraft} testId="filter-aircraft" />
        <XRButton label="Stale" active={filters.showStale} onActivate={onToggleStale} testId="filter-stale" />
      </XRRow>
      <XRRow>
        <XRButton label={`Lens: ${layerLensLabel(lens)}`} onActivate={() => onLens(nextFilterLens(lens))} testId="filter-lens" />
        <XRButton label={`Budget: ${ENTITY_BUDGETS[budgetId].id}`} onActivate={() => onBudget(nextEntityBudget(budgetId))} testId="filter-budget" />
      </XRRow>
    </XRPanel>
  );
}

// ---------------------------------------------------------------- find / jump

const FIND_GROUPS: FindGroup[] = ["review", "tracked", "strongest", "aircraft"];
const PAGE_SIZE = 5;

export function XRFindPanel({
  rfEntities,
  aircraftEntities,
  selectedId,
  trackedKeys,
  onJump,
  onClose
}: {
  rfEntities: RfSceneEntity[];
  aircraftEntities: AircraftSceneEntity[];
  selectedId: string | null;
  trackedKeys: ReadonlySet<string>;
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState<FindGroup>("review");
  const [page, setPage] = useState(0);
  const list = buildFindList(rfEntities, aircraftEntities, group, trackedKeys);
  const paged = pageOf(list, page, PAGE_SIZE);
  return (
    <XRPanel width={560} name="xr-find-panel" gap={10}>
      <PanelHeader title="Find" onClose={onClose} />
      <XRRow>
        {FIND_GROUPS.map((candidate) => (
          <XRButton
            key={candidate}
            label={FIND_GROUP_LABELS[candidate]}
            fontSize={18}
            active={group === candidate}
            onActivate={() => {
              setGroup(candidate);
              setPage(0);
            }}
            testId={`find-group-${candidate}`}
          />
        ))}
      </XRRow>
      {paged.items.length === 0 ? <XRLabel>Nothing in this group right now.</XRLabel> : null}
      {paged.items.map((item, index) => (
        <XRButton
          key={item.id}
          label={`${item.label}  |  ${item.detail}`}
          fontSize={19}
          active={item.id === selectedId}
          onActivate={() => onJump(item.id)}
          testId={`find-item-${index}`}
        />
      ))}
      <XRRow>
        <XRButton label="< Prev" disabled={paged.page === 0} onActivate={() => setPage(paged.page - 1)} testId="find-prev" />
        <XRLabel>{`${paged.page + 1} / ${paged.pages}  (${list.length})`}</XRLabel>
        <XRButton label="Next >" disabled={paged.page >= paged.pages - 1} onActivate={() => setPage(paged.page + 1)} testId="find-next" />
      </XRRow>
    </XRPanel>
  );
}

// ---------------------------------------------------------------- legend

function Swatch({ color, label, detail }: { color: string; label: string; detail?: string }) {
  return (
    <Container flexDirection="row" gap={12} alignItems="center" width="100%">
      <Container width={28} height={28} borderRadius={14} backgroundColor={color} flexShrink={0} />
      <Text fontSize={20} color={XR_COLORS.text}>
        {xrText(label)}
      </Text>
      {detail ? (
        <Text fontSize={17} color={XR_COLORS.textMuted}>
          {xrText(detail)}
        </Text>
      ) : null}
    </Container>
  );
}

export function XRLegendPanel({ onClose }: { onClose: () => void }) {
  return (
    <XRPanel width={560} name="xr-legend-panel" gap={8}>
      <PanelHeader title="Legend" onClose={onClose} />
      <XRLabel color={XR_COLORS.accent}>Tokens (colour = category, size = signal)</XRLabel>
      {(["wifi", "ble", "iot", "utility", "infrastructure", "rail", "cellular"] as RfMapCategory[]).map((category) => (
        <Swatch key={category} color={RF_CATEGORY_COLORS[category]} label={categoryLabel(category)} />
      ))}
      <Swatch color={XR_COLORS.hot} label="Red diamond + amber ring" detail="unknown RF, needs review" />
      <Swatch color={RF_CATEGORY_COLORS.aircraft} label="Cone on a stalk" detail="aircraft (range/altitude squashed)" />
      <XRDivider />
      <Swatch color="#3a4650" label="Greyed token" detail="stale or expired" />
      <Swatch color={XR_COLORS.textMuted} label="Flat ring" detail="location uncertainty" />
      <Swatch color={XR_COLORS.good} label="Green ring" detail="tracked / presence" />
      <Swatch color={XR_COLORS.accent} label="Cyan halo + beam" detail="selected" />
      <XRDivider />
      <XRLabel color={XR_COLORS.accent}>Collector pylons</XRLabel>
      <Swatch color={sourcePylonColor("live")} label="Reporting" />
      <Swatch color={sourcePylonColor("stale")} label="Degraded / stale" />
      <Swatch color={sourcePylonColor("empty")} label="No data" />
      <XRLabel color={XR_COLORS.accent}>Board rim = data provenance</XRLabel>
      <Swatch color={XR_COLORS.good} label="LIVE" />
      <Swatch color={XR_COLORS.warn} label="DEMO" detail="not observations" />
      <Swatch color={XR_COLORS.hot} label="ERROR" detail="last known data" />
      <Swatch color={XR_COLORS.replay} label="REPLAY" detail="frozen frame" />
    </XRPanel>
  );
}

// ---------------------------------------------------------------- settings

export function XRSettingsPanel({
  comfortMode,
  onComfortMode,
  textSize,
  onTextSize,
  reducedMotionPreference,
  onReducedMotion,
  wristMenu,
  onWristMenu,
  haptics,
  onHaptics,
  onResetPanels,
  onShowHints,
  onClose
}: {
  comfortMode: ComfortMode;
  onComfortMode: (mode: ComfortMode) => void;
  textSize: TextSize;
  onTextSize: (size: TextSize) => void;
  reducedMotionPreference: boolean | null;
  onReducedMotion: (value: boolean | null) => void;
  wristMenu: boolean;
  onWristMenu: (value: boolean) => void;
  haptics: boolean;
  onHaptics: (value: boolean) => void;
  onResetPanels: () => void;
  onShowHints: () => void;
  onClose: () => void;
}) {
  const motionLabel = reducedMotionPreference === null ? "Auto" : reducedMotionPreference ? "On" : "Off";
  return (
    <XRPanel width={560} name="xr-settings-panel" gap={10}>
      <PanelHeader title="Settings" onClose={onClose} />
      <XRLabel color={XR_COLORS.accent}>Comfort (moves the board in front of you)</XRLabel>
      <XRRow>
        <XRButton label="Standing" active={comfortMode === "standing"} onActivate={() => onComfortMode("standing")} testId="comfort-standing" />
        <XRButton label="Seated" active={comfortMode === "seated"} onActivate={() => onComfortMode("seated")} testId="comfort-seated" />
      </XRRow>
      <XRRow>
        <XRButton label={`Text: ${textSize.toUpperCase()}`} onActivate={() => onTextSize(nextTextSize(textSize))} testId="text-size" />
        <XRButton
          label={`Reduce motion: ${motionLabel}`}
          onActivate={() => onReducedMotion(reducedMotionPreference === null ? true : reducedMotionPreference ? false : null)}
          testId="reduced-motion"
        />
      </XRRow>
      <XRRow>
        <XRButton label={`Wrist menu: ${wristMenu ? "On" : "Off"}`} active={wristMenu} onActivate={() => onWristMenu(!wristMenu)} testId="wrist-menu" />
        <XRButton label={`Haptics: ${haptics ? "On" : "Off"}`} active={haptics} onActivate={() => onHaptics(!haptics)} testId="haptics" />
      </XRRow>
      <XRRow>
        <XRButton label="Reset panel layout" onActivate={onResetPanels} testId="reset-panels" />
        <XRButton label="Controller help" onActivate={onShowHints} testId="show-hints" />
      </XRRow>
      <XRLabel fontSize={16}>{`Build ${__TDS_BUILD__}`}</XRLabel>
    </XRPanel>
  );
}

// ---------------------------------------------------------------- first-run hints

export function XRHintsPanel({ onDismiss }: { onDismiss: () => void }) {
  const rows: Array<[string, string]> = [
    ["Point + trigger", "select a token or press a button"],
    ["Aim near a token", "it snaps to the nearest one (white ring)"],
    ["Hold grip", "carry the board; both grips = scale and turn"],
    ["Grip + thumbstick", "push/pull = size, left/right = turn"],
    ["Bar above a panel", "point, hold trigger, move = reposition"],
    ["Summon", "brings the board in front of you"],
    ["Steam button", "if rays disappear, a Steam menu has focus: close it"]
  ];
  return (
    <XRPanel width={600} name="xr-hints-panel" gap={10} accent={XR_COLORS.accent}>
      <XRHeading fontSize={30}>Controls</XRHeading>
      {rows.map(([gesture, effect]) => (
        <Container key={gesture} flexDirection="row" gap={14} width="100%">
          <Container width={220} flexShrink={0}>
            <Text fontSize={20} fontWeight="semi-bold" color={XR_COLORS.accent}>
              {xrText(gesture)}
            </Text>
          </Container>
          <Text fontSize={20} color={XR_COLORS.text}>
            {xrText(effect)}
          </Text>
        </Container>
      ))}
      <XRButton label="Got it" onActivate={onDismiss} testId="hints-dismiss" />
    </XRPanel>
  );
}

// ---------------------------------------------------------------- life-size: go to / align

export function XRGotoPanel({
  waypoints,
  onWaypoint,
  northYaw,
  onAlignNorth,
  onResetNorth,
  onClose
}: {
  waypoints: Array<{ id: string; label: string }>;
  onWaypoint: (id: string) => void;
  northYaw: number;
  onAlignNorth: () => void;
  onResetNorth: () => void;
  onClose: () => void;
}) {
  return (
    <XRPanel width={560} name="xr-goto-panel" gap={10}>
      <PanelHeader title="Go to" onClose={onClose} />
      <XRLabel>Jump to a spot on site. You can also walk, or push the right stick forward to aim a teleport.</XRLabel>
      <XRRow>
        {waypoints.slice(0, 3).map((waypoint) => (
          <XRButton key={waypoint.id} label={waypoint.label} onActivate={() => onWaypoint(waypoint.id)} testId={`goto-${waypoint.id}`} />
        ))}
      </XRRow>
      <XRRow>
        {waypoints.slice(3).map((waypoint) => (
          <XRButton key={waypoint.id} label={waypoint.label} onActivate={() => onWaypoint(waypoint.id)} testId={`goto-${waypoint.id}`} />
        ))}
      </XRRow>
      <XRDivider />
      <XRLabel color={XR_COLORS.accent}>Line up with the real world</XRLabel>
      <XRLabel>Stand at the receiver, face true north, then press Align north.</XRLabel>
      <XRRow>
        <XRButton label="Align north" onActivate={onAlignNorth} testId="align-north" />
        <XRButton label="Reset north" onActivate={onResetNorth} testId="reset-north" />
      </XRRow>
      <XRLabel fontSize={16}>{`North offset ${Math.round((northYaw * 180) / Math.PI)} deg`}</XRLabel>
    </XRPanel>
  );
}
