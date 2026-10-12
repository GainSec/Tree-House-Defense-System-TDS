import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { XROrigin, useXR } from "@react-three/xr";
import { Vector3 } from "three";
import { useDashboardState } from "../state/DashboardStateProvider";
import { backendBaseUrlLabel } from "../data/backendConfig";
import { replayTimelineLabel } from "../ui/replayTimeline";
import { useXRCapability } from "./XRCapabilityGate";
import { useXRView } from "./XRViewState";
import { resolvePassthroughStatus } from "./capability";
import { ENTITY_BUDGETS, XR_LAYER_ORDER, applyXRLayers, boardAircraftPosition, boardRfPosition, nextEntityBudget, nextFilterLens, selectBudgetedEntities } from "./boardModel";
import { buildAlertCardModel, buildSelectionCardModel, dossierRows, inspectorTabRows, type AlertCardItem, type SelectableBoardEntity } from "./cards";
import { describeBoardTransform } from "./boardTransform";
import { nextFocusZoom, roomScaleBoard, summonBoard, type ComfortMode } from "./interaction";
import { FloatingOperationsBoard, useBoardRoot } from "./FloatingOperationsBoard";
import type { BoardSelectable } from "./BoardContents";
import { FacingGroup } from "./FacingGroup";
import { DraggablePanel } from "./DraggablePanel";
import { XRSelectionCard } from "./XRSelectionCard";
import { XRAlertCard, XRAlertRestore } from "./XRAlertCard";
import { XRBoardPlacementControls, XRLayerPalette, headPoseFromCamera } from "./XRLayerPalette";
import { XRFiltersPanel, XRFindPanel, XRGotoPanel, XRHintsPanel, XRLegendPanel, XRSettingsPanel } from "./XRSecondaryPanels";
import { LifeSizeWorld } from "./LifeSizeWorld";
import { LifeDesktopControls, LifeLocomotion } from "./LifeLocomotion";
import { SNAP_TURN, WAYPOINTS, originForWaypoint, sceneToWorld, snapTurnOrigin, spawnInFrontOfHead, teleportOrigin, type Vec3 } from "./lifeSize";
import { lifeRfPosition } from "./BoardContents";
import { defaultPanelAnchor, type PanelId } from "./interaction";
import { PerfProbe, XRDiagnosticsPanel } from "./XRDiagnosticsPanel";
import { DesktopRayVisual, XRGripPlacement } from "./XRSelectionRay";
import { DesktopXRSimulator, NeutralEnvironment, type SimulatorKeyActions } from "./DesktopXRSimulator";
import { WristMount, XRStatusBanner } from "./XRStatusBanner";
import { useXRSessionTelemetry } from "./useXRSessionTelemetry";
import { DevProbe } from "./DevProbe";
import { RemoteProbe, remoteProbeEnabled } from "./RemoteProbe";
import { XRMissProbe } from "./XRMissProbe";
import { XR_COLORS, toneColor } from "./theme";
import { XRButton, XRLabel, XRPanel } from "./ui/XRPanelKit";
import { noteXRInteraction, xrLog } from "./xrLog";
import { useTrackedEntities } from "../data/useTrackedEntities";

/**
 * The XR presentation. Runs unchanged inside an immersive session or in the
 * desktop simulator; only input and environment differ.
 */
/** Board scale at which you are standing inside it, so panels follow you instead of the rim. */
const ROOM_SCALE_PANELS_AT = 2.5;

export function TdsXRExperience() {
  const dashboard = useDashboardState();
  const capability = useXRCapability();
  const view = useXRView();
  const telemetry = useXRSessionTelemetry();
  const camera = useThree((state) => state.camera);
  const session = useXR((state) => state.session);
  const inSession = Boolean(session);
  const isAR = telemetry.mode === "immersive-ar";
  const desktopHit = useRef<Vector3 | null>(null);
  const trackedKeys = useTrackedEntities();
  const life = view.presentation === "life";
  /** Room-scale board (you stand inside it): panels travel with you like life-size instead of sitting metres away at the rim. */
  const boardAroundYou = !life && view.board.scale >= ROOM_SCALE_PANELS_AT;
  const aroundOperator = life || boardAroundYou;
  const [lifeHoveredId, setLifeHoveredId] = useState<string | null>(null);
  const [remoteEnabled] = useState(remoteProbeEnabled);

  const passthrough = resolvePassthroughStatus({
    runtimeState: capability.runtimeState,
    probe: capability.probe,
    sessionMode: telemetry.mode,
    environmentBlendMode: telemetry.environmentBlendMode
  });

  const budget = ENTITY_BUDGETS[view.budgetId];
  // /v1/map/rf also returns aircraft (category "aircraft"); the airspace layer draws them, so drop them from RF tokens.
  const visibleRf = useMemo(() => dashboard.visibleScene.rfEntities.filter((entity) => entity.category !== "aircraft"), [dashboard.visibleScene.rfEntities]);
  const layered = useMemo(
    () => applyXRLayers({ rfEntities: visibleRf, aircraftEntities: dashboard.visibleScene.aircraftEntities }, view.layers, trackedKeys),
    [dashboard.visibleScene.aircraftEntities, trackedKeys, view.layers, visibleRf]
  );
  const budgeted = useMemo(
    () => selectBudgetedEntities({ rfEntities: layered.rfEntities, aircraftEntities: layered.aircraftEntities, budget, selectedId: dashboard.selectedId }),
    [budget, dashboard.selectedId, layered]
  );
  const sourceHealth = dashboard.situationData.model?.sources ?? [];
  const selectedEntity = (dashboard.selected && dashboard.selected.kind !== "client" ? dashboard.selected : null) as SelectableBoardEntity | null;
  const selectionCard = useMemo(
    () => buildSelectionCardModel({ entity: selectedEntity, provenance: dashboard.provenance, sourceHealth, inspector: dashboard.inspectorModel }),
    [dashboard.inspectorModel, dashboard.provenance, selectedEntity, sourceHealth]
  );
  const tabRows = useMemo(
    () => ({
      signal: inspectorTabRows(dashboard.inspectorModel, "signal"),
      evidence: inspectorTabRows(dashboard.inspectorModel, "evidence"),
      history: dossierRows(dashboard.presenceDossier)
    }),
    [dashboard.inspectorModel, dashboard.presenceDossier]
  );
  const alertCard = useMemo(
    () =>
      buildAlertCardModel({
        alerts: dashboard.infrastructureAlerts.alerts,
        alertsStatus: dashboard.infrastructureAlerts.status,
        rfEntities: dashboard.sceneSource.rfEntities,
        sourceHealth,
        situationStatus: dashboard.situationData.status,
        posture: dashboard.situationData.model?.posture ?? null
      }),
    [dashboard.infrastructureAlerts, dashboard.sceneSource.rfEntities, dashboard.situationData, sourceHealth]
  );

  const select = (entity: BoardSelectable) => {
    noteXRInteraction(`select:${entity.kind === "source" ? `source:${entity.source}` : entity.id}`);
    dashboard.selectInspectable(entity);
    view.setSelectionCardHidden(false);
  };
  const entityCentre = (id: string): { x: number; z: number } | null => {
    const rf = dashboard.sceneSource.rfEntities.find((candidate) => candidate.id === id);
    if (rf) {
      const [x, , z] = boardRfPosition(rf);
      return { x, z };
    }
    const aircraft = dashboard.sceneSource.aircraftEntities.find((candidate) => candidate.id === id);
    if (aircraft) {
      const [x, , z] = boardAircraftPosition(aircraft);
      return { x, z };
    }
    return null;
  };
  const jumpTo = (id: string) => {
    const entity = dashboard.sceneSource.rfEntities.find((candidate) => candidate.id === id) ?? dashboard.sceneSource.aircraftEntities.find((candidate) => candidate.id === id);
    if (!entity) {
      return;
    }
    select(entity);
    if (life) {
      if (entity.kind === "rf") {
        goTo(entity.id);
      }
      return;
    }
    const centre = entityCentre(id);
    if (centre) {
      view.setFocus({ centerX: centre.x, centerZ: centre.z, zoom: Math.max(2, view.focus?.zoom ?? 2) });
    }
  };
  /** Life-size: teleport to stand ~2.5 m from an RF device, facing it. */
  const goTo = (id: string) => {
    const rf = dashboard.sceneSource.rfEntities.find((candidate) => candidate.id === id);
    if (!rf) {
      return;
    }
    const target = sceneToWorld(lifeRfPosition(rf), view.northYaw);
    const head = headPoseFromCamera(camera);
    const dx = head.position[0] - target[0];
    const dz = head.position[2] - target[2];
    const length = Math.hypot(dx, dz) || 1;
    const stand: Vec3 = [target[0] + (dx / length) * 2.5, 0, target[2] + (dz / length) * 2.5];
    const moved = teleportOrigin(view.lifeOrigin, head.position, stand, view.northYaw);
    const headAfter: Vec3 = [stand[0], head.position[1], stand[2]];
    const facing = Math.atan2(-(target[0] - stand[0]), -(target[2] - stand[2]));
    view.setLifeOrigin(snapTurnOrigin(moved, headAfter, facing - head.yaw));
    xrLog("info", `go to ${rf.label}`);
  };
  const goToWaypoint = (waypointId: string) => {
    const waypoint = WAYPOINTS.find((candidate) => candidate.id === waypointId);
    if (!waypoint) {
      return;
    }
    const head = headPoseFromCamera(camera);
    const o = view.lifeOrigin;
    // Head position relative to the origin, in origin-local (unrotated) axes.
    const dx = head.position[0] - o.x;
    const dz = head.position[2] - o.z;
    const cos = Math.cos(-o.yaw);
    const sin = Math.sin(-o.yaw);
    const local: Vec3 = [dx * cos + dz * sin, 0, -dx * sin + dz * cos];
    view.setLifeOrigin(originForWaypoint(waypoint, view.northYaw, inSession ? local : [0, 0, 0]));
    noteXRInteraction(`goto:${waypoint.id}`);
  };
  const snapTurn = (direction: 1 | -1) => {
    const head = headPoseFromCamera(camera);
    const next = snapTurnOrigin(view.lifeOrigin, head.position, direction * SNAP_TURN);
    view.setLifeOrigin(inSession ? next : { ...next, x: head.position[0], z: head.position[2] });
  };
  const cycleFocus = () => {
    const zoom = nextFocusZoom(view.focus?.zoom ?? 1);
    const centre = dashboard.selectedId ? entityCentre(dashboard.selectedId) : null;
    view.setFocus(zoom === 1 || !centre ? null : { centerX: centre.x, centerZ: centre.z, zoom });
  };
  const activateAlertItem = (item: AlertCardItem) => {
    if (item.entityId) {
      jumpTo(item.entityId);
    } else if (item.source) {
      select({ kind: "source", source: item.source, label: sourceHealth.find((health) => health.source === item.source)?.label ?? item.source });
    }
  };
  const toggleReplay = () => (dashboard.frozenScene ? dashboard.resumeLive() : dashboard.enterReplay());
  const summon = (mode: ComfortMode = view.comfortMode) => view.dispatchBoard({ type: "replace", value: summonBoard(view.board, headPoseFromCamera(camera), mode) });
  const openOnDesktop = () => {
    if (!selectionCard) {
      return;
    }
    const prefix = window.location.pathname.startsWith("/static") ? "/static" : "";
    xrLog("info", `desktop handoff: ${selectionCard.desktopPath}`);
    void session?.end();
    window.location.href = `${prefix}${selectionCard.desktopPath}`;
  };

  const keyActions: SimulatorKeyActions = {
    dispatchBoard: view.dispatchBoard,
    togglePlacement: () => view.setPlacementMode(!view.placementMode && !view.board.locked),
    toggleLayer: (index) => {
      const id = XR_LAYER_ORDER[index];
      if (id) {
        view.toggleLayer(id);
      }
    },
    toggleDiagnostics: () => view.setDiagnosticsVisible(!view.diagnosticsVisible),
    toggleAlerts: () => view.setAlertCardHidden(!view.alertCardHidden),
    cycleLens: () => dashboard.layerLens.setMode(nextFilterLens(dashboard.layerLens.mode)),
    cycleBudget: () => view.setBudgetId(nextEntityBudget(view.budgetId)),
    selectAdjacent: (direction) => {
      dashboard.selectAdjacent(direction);
      view.setSelectionCardHidden(false);
    },
    clearSelection: () => {
      dashboard.selectInspectable(null);
      view.setFocus(null);
    },
    toggleReplay,
    summon: () => summon(),
    cycleFocus,
    openPanel: (panel) => view.setSecondaryPanel(panel)
  };

  const remoteActions = {
    summon: (mode?: ComfortMode) => summon(mode ?? view.comfortMode),
    presentation: (value: "board" | "life") => view.setPresentation(value),
    select: (id: string) => {
      const entity = dashboard.sceneSource.rfEntities.find((c) => c.id === id) ?? dashboard.sceneSource.aircraftEntities.find((c) => c.id === id);
      if (!entity) return `no entity ${id}`;
      select(entity);
      return entity.label;
    },
    jumpTo,
    goTo,
    waypoint: goToWaypoint,
    snapTurn,
    panel: (panel: typeof view.secondaryPanel) => view.setSecondaryPanel(panel),
    tab: view.setSelectionTab,
    layer: view.toggleLayer,
    diagnostics: (value: boolean) => view.setDiagnosticsVisible(value),
    focus: cycleFocus,
    clear: keyActions.clearSelection,
    next: () => keyActions.selectAdjacent(1),
    roomScale: () => view.dispatchBoard({ type: "replace", value: roomScaleBoard(view.board, headPoseFromCamera(camera)) }),
    lock: () => view.dispatchBoard({ type: "toggleLock" }),
    comfort: (mode: ComfortMode) => {
      view.setComfortMode(mode);
      summon(mode);
    },
    alignNorth: () => view.setNorthYaw(headPoseFromCamera(camera).yaw),
    replay: toggleReplay,
    alertItem: (index: number) => {
      const item = alertCard.items[index];
      if (!item) return "no alert item";
      activateAlertItem(item);
      return item.title;
    }
  };
  const remoteState = () => ({
    build: __TDS_BUILD__,
    presentation: view.presentation,
    provenance: dashboard.provenance.label,
    selected: selectionCard ? { id: selectionCard.id, title: selectionCard.title } : null,
    selectionTab: view.selectionTab,
    secondaryPanel: view.secondaryPanel,
    board: describeBoardTransform(view.board),
    lifeOrigin: view.lifeOrigin,
    northYaw: view.northYaw,
    head: headPoseFromCamera(camera),
    rf: budgeted.rfEntities.slice(0, 60).map((e) => ({ id: e.id, label: e.label, category: e.category })),
    aircraft: budgeted.aircraftEntities.map((e) => ({ id: e.id, label: e.label })),
    alerts: alertCard.items.map((item) => item.title)
  });

  const rimColor = toneColor(dashboard.provenance.tone);
  const siteLabel = dashboard.sceneSource.site?.label ?? "site";
  const counts = `${budgeted.rfEntities.length} RF${budgeted.droppedRf > 0 ? ` (+${budgeted.droppedRf})` : ""} | ${budgeted.aircraftEntities.length} aircraft${view.focus ? ` | zoom x${view.focus.zoom}` : ""}`;
  const wristPalette = view.wristMenu && inSession;

  const palette = view.placementMode ? (
    <XRBoardPlacementControls dispatch={view.dispatchBoard} viewerYaw={() => headPoseFromCamera(camera).yaw} locked={view.board.locked} onDone={() => view.setPlacementMode(false)} />
  ) : (
    <XRLayerPalette
      provenance={dashboard.provenance}
      passthrough={passthrough}
      siteLabel={siteLabel}
      layers={view.layers}
      onToggleLayer={(id) => {
        view.toggleLayer(id);
        if (id === "alerts") {
          view.setAlertCardHidden(false);
        }
      }}
      secondaryPanel={view.secondaryPanel}
      onOpenPanel={view.setSecondaryPanel}
      replayFrozen={Boolean(dashboard.frozenScene)}
      replayLabel={replayTimelineLabel(dashboard.replayFrames, dashboard.replayIndex)}
      onToggleReplay={toggleReplay}
      onReplayStep={dashboard.scrubReplay}
      placementMode={view.placementMode}
      onTogglePlacement={keyActions.togglePlacement}
      locked={view.board.locked}
      onToggleLock={() => view.dispatchBoard({ type: "toggleLock" })}
      onSummon={() => summon()}
      onRoomScale={() => view.dispatchBoard({ type: "replace", value: roomScaleBoard(view.board, headPoseFromCamera(camera)) })}
      diagnosticsVisible={view.diagnosticsVisible}
      onToggleDiagnostics={keyActions.toggleDiagnostics}
      inSession={inSession}
      onExit={() => void session?.end()}
      entityCounts={counts}
      budgetId={view.budgetId}
      presentation={view.presentation}
      onPresentation={view.setPresentation}
      onAlignNorth={() => view.setNorthYaw(headPoseFromCamera(camera).yaw)}
      onSnapTurn={snapTurn}
    />
  );

  const secondary = (() => {
    switch (view.secondaryPanel) {
      case "filters":
        return (
          <XRFiltersPanel
            filters={dashboard.filterControls.filters}
            lens={dashboard.layerLens.mode}
            budgetId={view.budgetId}
            onToggleSource={dashboard.filterControls.toggleSource}
            onToggleCategory={dashboard.filterControls.toggleCategory}
            onToggleAircraft={dashboard.filterControls.toggleAircraft}
            onToggleStale={dashboard.filterControls.toggleStale}
            onLens={dashboard.layerLens.setMode}
            onBudget={view.setBudgetId}
            onClose={() => view.setSecondaryPanel(null)}
          />
        );
      case "find":
        return <XRFindPanel rfEntities={visibleRf} aircraftEntities={dashboard.visibleScene.aircraftEntities} selectedId={dashboard.selectedId} trackedKeys={trackedKeys} onJump={jumpTo} onClose={() => view.setSecondaryPanel(null)} />;
      case "legend":
        return <XRLegendPanel onClose={() => view.setSecondaryPanel(null)} />;
      case "settings":
        return (
          <XRSettingsPanel
            comfortMode={view.comfortMode}
            onComfortMode={(mode) => {
              view.setComfortMode(mode);
              summon(mode);
            }}
            textSize={view.textSize}
            onTextSize={view.setTextSize}
            reducedMotionPreference={view.reducedMotionPreference}
            onReducedMotion={view.setReducedMotionPreference}
            wristMenu={view.wristMenu}
            onWristMenu={view.setWristMenu}
            haptics={view.haptics}
            onHaptics={view.setHaptics}
            onResetPanels={view.resetPanels}
            onShowHints={() => view.setSecondaryPanel("hints")}
            onClose={() => view.setSecondaryPanel(null)}
          />
        );
      case "goto":
        return (
          <XRGotoPanel
            waypoints={WAYPOINTS}
            onWaypoint={goToWaypoint}
            northYaw={view.northYaw}
            onAlignNorth={() => view.setNorthYaw(headPoseFromCamera(camera).yaw)}
            onResetNorth={() => view.setNorthYaw(0)}
            onClose={() => view.setSecondaryPanel(null)}
          />
        );
      case "hints":
        return (
          <XRHintsPanel
            onDismiss={() => {
              view.setHintsSeen(true);
              view.setSecondaryPanel(null);
            }}
          />
        );
      default:
        return null;
    }
  })();

  // Panels are built once and placed either around the board or around the operator (life-size).
  const panelAt = (id: "palette" | "selection" | "alerts" | "secondary" | "diagnostics", radius: number, content: ReactNode) => (
    <DraggablePanel id={(aroundOperator ? `life-${id}` : id) as PanelId} radius={radius}>
      {content}
    </DraggablePanel>
  );
  const diagnosticsData = {
    runtimeState: capability.runtimeState,
    probe: capability.probe,
    passthrough,
    telemetry,
    presentation: `${inSession ? `${telemetry.mode}` : capability.emulated ? "desktop simulator (IWER emulator)" : "desktop simulator"} | ${life ? "life-size" : "board"}`,
    backendUrl: backendBaseUrlLabel(),
    provenance: dashboard.provenance,
    rfRendered: budgeted.rfEntities.length,
    rfTotal: layered.rfEntities.length,
    rfDropped: budgeted.droppedRf,
    aircraftRendered: budgeted.aircraftEntities.length,
    aircraftTotal: layered.aircraftEntities.length,
    budgetLabel: `${budget.label}: ${budget.rf} RF / ${budget.aircraft} aircraft`,
    boardDescription: life
      ? `life-size | origin ${view.lifeOrigin.x.toFixed(1)}, ${view.lifeOrigin.z.toFixed(1)} | north ${Math.round((view.northYaw * 180) / Math.PI)} deg`
      : describeBoardTransform(view.board)
  };
  const panels = (radius: number) => (
    <>
      {!wristPalette ? panelAt("palette", radius, palette) : null}
      {selectionCard && !view.selectionCardHidden
        ? panelAt(
            "selection",
            radius,
            <XRSelectionCard
              model={selectionCard}
              provenance={dashboard.provenance}
              tab={view.selectionTab}
              onTab={view.setSelectionTab}
              tabRows={tabRows}
              historyLoading={false}
              focusZoom={view.focus?.zoom ?? 1}
              onFocus={life ? () => dashboard.selectedId && goTo(dashboard.selectedId) : cycleFocus}
              focusLabel={life ? "Go there" : undefined}
              onPrevious={() => keyActions.selectAdjacent(-1)}
              onNext={() => keyActions.selectAdjacent(1)}
              onClear={keyActions.clearSelection}
              onHide={() => view.setSelectionCardHidden(true)}
              onDesktop={openOnDesktop}
            />
          )
        : null}
      {view.layers.alerts && !view.alertCardHidden
        ? panelAt("alerts", radius, <XRAlertCard model={alertCard} onActivateItem={activateAlertItem} onHide={() => view.setAlertCardHidden(true)} />)
        : null}
      {secondary ? panelAt("secondary", radius, secondary) : null}
      {view.diagnosticsVisible
        ? panelAt("diagnostics", radius, <XRDiagnosticsPanel onClose={() => view.setDiagnosticsVisible(false)} onReprobe={capability.reprobe} data={diagnosticsData} />)
        : null}
    </>
  );
  const o = view.lifeOrigin;

  // Life-size: cards appear in front of wherever you are looking when they open.
  const spawn = (id: PanelId, distance: number, sideways: number, above: number) => {
    // The XR origin only moves in life-size; around a room-scale board it stays at the room origin.
    const local = spawnInFrontOfHead(headPoseFromCamera(camera), life ? view.lifeOrigin : { x: 0, z: 0, yaw: 0 }, distance, sideways, above);
    const base = defaultPanelAnchor(id, 0, view.comfortMode);
    view.setPanelOffset(id, [local[0] - base[0], local[1] - base[1], local[2] - base[2]]);
  };
  const selectionKey = selectionCard?.id ?? null;
  useEffect(() => {
    if (aroundOperator && selectionKey) {
      spawn("life-selection", 1.0, 0.38, 0.3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aroundOperator, selectionKey]);
  useEffect(() => {
    if (aroundOperator && view.secondaryPanel) {
      spawn("life-secondary", 1.15, -0.1, 0.4);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aroundOperator, view.secondaryPanel]);

  return (
    <>
      <PerfProbe />
      {import.meta.env.DEV ? <DevProbe /> : null}
      <XRMissProbe />
      {remoteEnabled ? <RemoteProbe actions={remoteActions as never} state={remoteState} /> : null}
      {/* The XR origin is the operator's play space; life-size moves it to teleport and snap turn. */}
      <XROrigin position={life ? [o.x, 0, o.z] : [0, 0, 0]} rotation={[0, life ? o.yaw : 0, 0]} />
      {!isAR ? <color attach="background" args={[life ? "#0c1218" : XR_COLORS.neutralEnvironment]} /> : null}
      {!isAR && !life ? <NeutralEnvironment /> : null}
      <hemisphereLight args={["#dcefff", "#1a2a2e", 1.4]} />
      <directionalLight position={[1.5, 3, 1]} intensity={1.1} />
      {!inSession && !life ? <DesktopXRSimulator board={view.board} actions={keyActions} /> : null}
      {!inSession && life ? <LifeDesktopControls origin={view.lifeOrigin} northYaw={view.northYaw} onOrigin={view.setLifeOrigin} /> : null}
      {inSession && life ? <LifeLocomotion origin={view.lifeOrigin} northYaw={view.northYaw} haptics={view.haptics} onOrigin={view.setLifeOrigin} /> : null}
      {!inSession ? <DesktopRayVisual hitRef={desktopHit} /> : null}
      <XRStatusBanner telemetry={telemetry} />
      {wristPalette ? <WristMount>{palette}</WristMount> : null}
      {/* Desktop only: in a session a handler here would make every object in the scene (wireframes included)
          a pointer target, and three.js hits lines within ~1 m of the ray, so they swallowed controller presses. */}
      <group
        name="tds-xr-experience"
        onPointerMove={
          inSession
            ? undefined
            : (event: ThreeEvent<PointerEvent>) => {
                desktopHit.current = event.point.clone();
              }
        }
        onPointerOut={
          inSession
            ? undefined
            : () => {
                desktopHit.current = null;
              }
        }
      >
        {life ? (
          <>
            <LifeSizeWorld
              contents={{
                rfEntities: budgeted.rfEntities,
                aircraftEntities: budgeted.aircraftEntities,
                sourceHealth,
                selectedId: dashboard.selectedId,
                selectedSource: dashboard.selectedSource,
                showPresence: view.layers.presence,
                interactive: true,
                onSelect: select,
                focus: null,
                trackedKeys
              }}
              northYaw={view.northYaw}
              showGround={!isAR}
              hoveredId={lifeHoveredId}
              onHover={setLifeHoveredId}
              onTeleport={(point) => {
                const head = headPoseFromCamera(camera);
                view.setLifeOrigin(teleportOrigin(view.lifeOrigin, inSession ? head.position : [view.lifeOrigin.x, 1.6, view.lifeOrigin.z], point, view.northYaw));
              }}
            />
            {/* Panels travel with the operator's play space. */}
            <group name="life-panels" position={[o.x, 0, o.z]} rotation={[0, o.yaw, 0]}>
              {panels(0)}
              {dashboard.provenance.label !== "LIVE" ? (
                <FacingGroup name="provenance-banner" position={[0, 2.35, -1.6]} reducedMotion={view.reducedMotion}>
                  <ProvenanceBanner />
                </FacingGroup>
              ) : null}
            </group>
          </>
        ) : (
          <FloatingOperationsBoard
            board={view.board}
            placementMode={view.placementMode}
            rimColor={rimColor}
            haptics={view.haptics}
            reducedMotion={view.reducedMotion}
            contents={{
              rfEntities: budgeted.rfEntities,
              aircraftEntities: budgeted.aircraftEntities,
              sourceHealth,
              selectedId: dashboard.selectedId,
              selectedSource: dashboard.selectedSource,
              showPresence: view.layers.presence,
              interactive: true,
              onSelect: select,
              focus: view.focus,
              trackedKeys
            }}
            onPlacementDrag={(position) => view.dispatchBoard({ type: "setPose", position, yaw: view.board.yaw })}
            attachments={({ radius }) => (
              <>
                <GripPlacementBridge inSession={inSession} selectedKey={selectionCard?.id ?? null} />
                {alertCard.items.length > 0 && view.layers.alerts ? <AlertRing radius={radius} color={toneColor(alertCard.tone)} /> : null}
                {!boardAroundYou ? panels(radius) : null}
                {selectionCard && view.selectionCardHidden ? (
                  <FacingGroup position={[radius + 0.14, 0.12, radius * 0.4]} reducedMotion={view.reducedMotion}>
                    <XRPanel width={200} padding={10} name="xr-selection-restore">
                      <XRButton label="Show detail" onActivate={() => view.setSelectionCardHidden(false)} testId="selection-restore" />
                    </XRPanel>
                  </FacingGroup>
                ) : null}
                {view.layers.alerts && view.alertCardHidden ? (
                  <FacingGroup position={[-(radius + 0.14), 0.12, -0.1]} reducedMotion={view.reducedMotion}>
                    <XRAlertRestore model={alertCard} onRestore={() => view.setAlertCardHidden(false)} />
                  </FacingGroup>
                ) : null}
                {dashboard.provenance.label !== "LIVE" ? (
                  <FacingGroup name="provenance-banner" position={[0, 0.1, -(radius + 0.06)]} reducedMotion={view.reducedMotion}>
                    <ProvenanceBanner />
                  </FacingGroup>
                ) : null}
              </>
            )}
          />
        )}
        {boardAroundYou ? <group name="room-scale-panels">{panels(0)}</group> : null}
      </group>
    </>
  );
}

function GripPlacementBridge({ inSession, selectedKey }: { inSession: boolean; selectedKey: string | null }) {
  const rootRef = useBoardRoot();
  const view = useXRView();
  const camera = useThree((state) => state.camera);
  if (!inSession) {
    return null;
  }
  return (
    <XRGripPlacement
      rootRef={rootRef}
      board={view.board}
      placementMode={view.placementMode}
      haptics={view.haptics}
      selectedKey={selectedKey}
      onGripStart={() => view.setPlacementMode(true)}
      dispatch={view.dispatchBoard}
      viewerYaw={() => headPoseFromCamera(camera).yaw}
    />
  );
}

function AlertRing({ radius, color }: { radius: number; color: string }) {
  return (
    <mesh name="alert-ring" position={[0, 0.0018, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius * 0.955, radius * 0.972, 96]} />
      <meshBasicMaterial color={color} />
    </mesh>
  );
}

function ProvenanceBanner() {
  const { provenance } = useDashboardState();
  const color = toneColor(provenance.tone);
  const headline = provenance.synthetic ? `${provenance.label === "REPLAY" ? "REPLAY OF " : ""}DEMO DATA — NOT LIVE OBSERVATIONS` : provenance.headline;
  return (
    <XRPanel width={680} name="xr-provenance-banner" accent={color} padding={18} gap={8} anchorY="center">
      <XRLabel color={color} fontSize={40}>
        {headline}
      </XRLabel>
      <XRLabel fontSize={22}>{provenance.detail.length > 110 ? `${provenance.detail.slice(0, 109)}…` : provenance.detail}</XRLabel>
      {provenance.mixedDetail ? (
        <XRLabel fontSize={22} color={XR_COLORS.warn}>
          {provenance.mixedDetail}
        </XRLabel>
      ) : null}
    </XRPanel>
  );
}
