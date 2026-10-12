import { Container } from "@react-three/uikit";
import { Euler, Vector3, type Camera } from "three";
import type { DataProvenance } from "../data/provenance";
import { ENTITY_BUDGETS, XR_LAYER_LABELS, XR_LAYER_ORDER, type EntityBudgetId, type XRLayerState, type XRLayerId } from "./boardModel";
import type { BoardAction, HeadPose } from "./boardTransform";
import type { PassthroughStatus } from "./capability";
import type { SecondaryPanel } from "./XRViewState";
import { XR_COLORS } from "./theme";
import { XRBadge, XRButton, XRLabel, XRPanel, XRRow } from "./ui/XRPanelKit";

export interface PaletteProps {
  provenance: DataProvenance;
  passthrough: PassthroughStatus;
  siteLabel: string;
  layers: XRLayerState;
  onToggleLayer: (id: XRLayerId) => void;
  secondaryPanel: SecondaryPanel;
  onOpenPanel: (panel: Exclude<SecondaryPanel, null>) => void;
  replayFrozen: boolean;
  replayLabel: string;
  onToggleReplay: () => void;
  onReplayStep: (direction: 1 | -1) => void;
  placementMode: boolean;
  onTogglePlacement: () => void;
  locked: boolean;
  onToggleLock: () => void;
  onSummon: () => void;
  onRoomScale: () => void;
  diagnosticsVisible: boolean;
  onToggleDiagnostics: () => void;
  inSession: boolean;
  onExit: () => void;
  entityCounts: string;
  budgetId: EntityBudgetId;
  presentation: "board" | "life";
  onPresentation: (value: "board" | "life") => void;
  onAlignNorth: () => void;
  onSnapTurn: (direction: 1 | -1) => void;
}

/** The control hub: layers, panels, placement, replay. Lives beside the board (never on the near edge) or on the wrist. */
export function XRLayerPalette(props: PaletteProps) {
  const {
    provenance,
    passthrough,
    siteLabel,
    layers,
    onToggleLayer,
    secondaryPanel,
    onOpenPanel,
    replayFrozen,
    replayLabel,
    onToggleReplay,
    onReplayStep,
    placementMode,
    onTogglePlacement,
    locked,
    onToggleLock,
    onSummon,
    onRoomScale,
    diagnosticsVisible,
    onToggleDiagnostics,
    inSession,
    onExit,
    entityCounts,
    budgetId,
    presentation,
    onPresentation,
    onAlignNorth,
    onSnapTurn
  } = props;
  const life = presentation === "life";
  return (
    <XRPanel width={600} name="xr-layer-palette" gap={10} padding={16}>
      <XRRow>
        <XRBadge label={provenance.headline} tone={provenance.tone} />
        <XRBadge label={`BACKEND ${provenance.backend.toUpperCase()}`} tone={provenance.backend === "connected" ? "good" : provenance.backend === "connecting" ? "muted" : "hot"} />
        <Container flexGrow={1} />
        <XRBadge label={passthrough.verdict === "runtime-reports-passthrough" ? "PASSTHROUGH" : passthrough.label} tone={passthrough.verdict === "runtime-reports-passthrough" ? "good" : "muted"} />
      </XRRow>
      <XRLabel fontSize={17}>{`${siteLabel} | ${entityCounts} | budget ${ENTITY_BUDGETS[budgetId].id}`}</XRLabel>
      <XRRow>
        <XRButton label="Board" active={!life} onActivate={() => onPresentation("board")} testId="mode-board" />
        <XRButton label="Life-size" active={life} onActivate={() => onPresentation("life")} testId="mode-life" />
      </XRRow>
      <XRRow>
        {XR_LAYER_ORDER.map((id) => (
          <XRButton key={id} label={XR_LAYER_LABELS[id]} active={layers[id]} onActivate={() => onToggleLayer(id)} testId={`layer-${id}`} />
        ))}
      </XRRow>
      <XRRow>
        <XRButton label="Filters" active={secondaryPanel === "filters"} onActivate={() => onOpenPanel("filters")} testId="open-filters" />
        <XRButton label="Find" active={secondaryPanel === "find"} onActivate={() => onOpenPanel("find")} testId="open-find" />
        <XRButton label="Legend" active={secondaryPanel === "legend"} onActivate={() => onOpenPanel("legend")} testId="open-legend" />
        <XRButton label="Settings" active={secondaryPanel === "settings"} onActivate={() => onOpenPanel("settings")} testId="open-settings" />
      </XRRow>
      {life ? (
        <XRRow>
          <XRButton label="Go to" active={secondaryPanel === "goto"} onActivate={() => onOpenPanel("goto")} testId="open-goto" />
          <XRButton label="Align N" onActivate={onAlignNorth} testId="align-north-quick" />
          <XRButton label="Turn L" onActivate={() => onSnapTurn(1)} testId="snap-left" />
          <XRButton label="Turn R" onActivate={() => onSnapTurn(-1)} testId="snap-right" />
        </XRRow>
      ) : (
        <XRRow>
          <XRButton label="Place" active={placementMode} disabled={locked} onActivate={onTogglePlacement} testId="place" />
          <XRButton label={locked ? "Unlock" : "Lock"} active={locked} onActivate={onToggleLock} testId="lock" />
          <XRButton label="Summon" onActivate={onSummon} testId="summon" />
          <XRButton label="Room" disabled={locked} onActivate={onRoomScale} testId="room-scale" />
        </XRRow>
      )}
      <XRRow>
        <XRButton label={replayFrozen ? "Live" : "Freeze"} active={replayFrozen} tone={replayFrozen ? "replay" : undefined} onActivate={onToggleReplay} testId="replay" />
        {replayFrozen ? (
          <>
            <XRButton label="< Prev" onActivate={() => onReplayStep(-1)} testId="replay-prev" />
            <XRButton label="Next >" onActivate={() => onReplayStep(1)} testId="replay-next" />
          </>
        ) : null}
        <XRButton label="Diag" active={diagnosticsVisible} onActivate={onToggleDiagnostics} testId="diagnostics" />
        {inSession ? <XRButton label="Exit XR" tone="hot" onActivate={onExit} testId="exit" /> : null}
      </XRRow>
      {replayFrozen ? <XRLabel fontSize={17} color={XR_COLORS.replay}>{replayLabel}</XRLabel> : null}
    </XRPanel>
  );
}

const MOVE_STEP = 0.1;
const RAISE_STEP = 0.05;
const ROTATE_STEP = Math.PI / 12;
const SCALE_STEP = 1.15;

/** Explicit placement buttons so the board is usable even when grip gestures are unreliable. */
export function XRBoardPlacementControls({ dispatch, viewerYaw, locked, onDone }: { dispatch: (action: BoardAction) => void; viewerYaw: () => number; locked: boolean; onDone: () => void }) {
  const move = (right: number, forward: number) => dispatch({ type: "translate", right, forward, viewerYaw: viewerYaw() });
  return (
    <XRPanel width={600} name="xr-placement-controls" gap={10} padding={16} accent={XR_COLORS.accent}>
      <XRLabel color={XR_COLORS.accent} fontSize={20}>
        {locked ? "Board locked" : "Hold grip to carry it, drag the board with the trigger, or use these"}
      </XRLabel>
      <XRRow>
        <XRButton label="Left" onActivate={() => move(-MOVE_STEP, 0)} disabled={locked} testId="move-left" />
        <XRButton label="Right" onActivate={() => move(MOVE_STEP, 0)} disabled={locked} testId="move-right" />
        <XRButton label="Away" onActivate={() => move(0, MOVE_STEP)} disabled={locked} testId="move-away" />
        <XRButton label="Closer" onActivate={() => move(0, -MOVE_STEP)} disabled={locked} testId="move-closer" />
      </XRRow>
      <XRRow>
        <XRButton label="Raise" onActivate={() => dispatch({ type: "raise", dy: RAISE_STEP })} disabled={locked} testId="raise" />
        <XRButton label="Lower" onActivate={() => dispatch({ type: "raise", dy: -RAISE_STEP })} disabled={locked} testId="lower" />
        <XRButton label="Turn L" onActivate={() => dispatch({ type: "rotate", dyaw: ROTATE_STEP })} disabled={locked} testId="rotate-left" />
        <XRButton label="Turn R" onActivate={() => dispatch({ type: "rotate", dyaw: -ROTATE_STEP })} disabled={locked} testId="rotate-right" />
      </XRRow>
      <XRRow>
        <XRButton label="Smaller" onActivate={() => dispatch({ type: "scale", factor: 1 / SCALE_STEP })} disabled={locked} testId="scale-down" />
        <XRButton label="Larger" onActivate={() => dispatch({ type: "scale", factor: SCALE_STEP })} disabled={locked} testId="scale-up" />
        <XRButton label={locked ? "Unlock" : "Lock"} active={locked} onActivate={() => dispatch({ type: "toggleLock" })} testId="placement-lock" />
        <XRButton label="Reset" onActivate={() => dispatch({ type: "reset" })} testId="reset" />
        <XRButton label="Done" onActivate={onDone} testId="placement-done" />
      </XRRow>
    </XRPanel>
  );
}

export const PLACEMENT_STEPS = { MOVE_STEP, RAISE_STEP, ROTATE_STEP, SCALE_STEP };

const headPosition = new Vector3();
const headEuler = new Euler(0, 0, 0, "YXZ");

/** Head pose from the active camera (XR camera pose while presenting). */
export function headPoseFromCamera(camera: Camera): HeadPose {
  camera.getWorldPosition(headPosition);
  headEuler.setFromQuaternion(camera.getWorldQuaternion(camera.quaternion.clone()), "YXZ");
  return { position: [headPosition.x, headPosition.y, headPosition.z], yaw: headEuler.y };
}
