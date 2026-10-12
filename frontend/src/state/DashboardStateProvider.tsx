import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { applySceneFilters, useSceneFilters } from "../ui/useSceneFilters";
import type { SelectedSceneEntity } from "../ui/SelectionPanel";
import { buildOperatorInspectorModel, type OperatorInspectable, type OperatorInspectorTabId } from "../data/operatorInspector";
import { useDashboardData } from "../data/useDashboardData";
import { fetchPresenceDossier, runPresenceEnrichment } from "../data/api";
import { useInfrastructureAlerts } from "../data/useInfrastructureAlerts";
import { useSituationData } from "../data/useSituationData";
import { demoScene } from "../data/demoScene";
import { selectAdjacentEntity } from "../ui/selectionNavigation";
import { useLayerLens } from "../ui/useLayerLens";
import { OPERATOR_PRESETS, type OperatorPresetId } from "../ui/OperatorCommandRail";
import type { SceneModel } from "../data/sceneModel";
import type { PresenceDossier } from "../domain/types";
import { appendReplayFrame, selectReplayFrame, type ReplayFrame } from "../ui/replayTimeline";
import { resolveDataProvenance } from "../data/provenance";

/**
 * Shared dashboard state and actions. Desktop and XR presentations both consume
 * this so polling, selection, filters and replay exist exactly once per page.
 */
export function useDashboardController() {
  const filterControls = useSceneFilters();
  const layerLens = useLayerLens();
  const dashboardData = useDashboardData();
  const infrastructureAlerts = useInfrastructureAlerts();
  const situationData = useSituationData({ alerts: infrastructureAlerts.alerts });
  const [selected, setSelected] = useState<OperatorInspectable>(null);
  const [activeInspectorTab, setActiveInspectorTab] = useState<OperatorInspectorTabId | null>("summary");
  const [activePreset, setActivePreset] = useState<OperatorPresetId>("all");
  const [frozenScene, setFrozenScene] = useState<SceneModel | null>(null);
  const [replayFrames, setReplayFrames] = useState<ReplayFrame[]>([]);
  const [replayIndex, setReplayIndex] = useState(0);
  const [presenceDossier, setPresenceDossier] = useState<PresenceDossier | null>(null);
  const [enrichingIdentity, setEnrichingIdentity] = useState<string | null>(null);
  const [provenanceNow, setProvenanceNow] = useState(() => new Date());
  const liveScene = dashboardData.sceneModel ?? demoScene;
  const sceneSource = frozenScene ?? liveScene;
  const visibleScene = useMemo(
    () =>
      applySceneFilters({
        rfEntities: sceneSource.rfEntities,
        aircraftEntities: sceneSource.aircraftEntities,
        filters: filterControls.filters,
        layerLensMode: layerLens.mode
      }),
    [filterControls.filters, layerLens.mode, sceneSource]
  );
  const renderedScene = useMemo(() => ({ ...sceneSource, ...visibleScene }), [sceneSource, visibleScene]);
  const selectedSceneEntity: SelectedSceneEntity = selected?.kind === "source" || selected?.kind === "client" ? null : selected;
  const selectedSource = selected?.kind === "source" ? selected.source : null;
  const selectedId = selectedSceneEntity?.id ?? null;
  const inspectorModel = useMemo(
    () =>
      buildOperatorInspectorModel({
        selected,
        sourceStates: situationData.sourceStates,
        alerts: infrastructureAlerts.alerts,
        relatedState: selectedSceneEntity ? relatedStateForSelection(selectedSceneEntity, situationData.sourceStates) : null
      }),
    [infrastructureAlerts.alerts, selected, selectedSceneEntity, situationData.sourceStates]
  );

  useEffect(() => {
    const id = window.setInterval(() => setProvenanceNow(new Date()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const provenance = useMemo(
    () =>
      resolveDataProvenance({
        status: dashboardData.status,
        sceneOrigin: dashboardData.sceneOrigin,
        hasSceneModel: dashboardData.sceneModel !== null,
        syntheticSource: isMockSite(dashboardData.sceneModel?.site),
        layers: dashboardData.layers,
        lastLiveAt: dashboardData.lastLiveAt,
        cachedAt: dashboardData.cachedAt,
        error: dashboardData.error,
        pollIntervalMs: dashboardData.pollIntervalMs,
        replayFrozen: frozenScene !== null,
        replayCapturedAt: frozenScene ? replayFrames[replayIndex]?.capturedAt ?? null : null,
        replaySynthetic: frozenScene === demoScene || isMockSite(frozenScene?.site),
        alertsStatus: infrastructureAlerts.status,
        now: provenanceNow
      }),
    [dashboardData, frozenScene, infrastructureAlerts.status, provenanceNow, replayFrames, replayIndex]
  );

  const selectAdjacent = (direction: 1 | -1) => {
    setSelected(selectAdjacentEntity({ visible: visibleScene, selectedId, direction }));
    setActiveInspectorTab("summary");
  };
  const selectInspectable = (entity: OperatorInspectable) => {
    setSelected(entity);
    setActiveInspectorTab("summary");
  };
  const applyPreset = (presetId: OperatorPresetId) => {
    const preset = OPERATOR_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }
    setActivePreset(preset.id);
    layerLens.setMode(preset.lensMode);
  };

  useEffect(() => {
    if (selectedSceneEntity?.kind !== "rf") {
      setPresenceDossier(null);
      return;
    }
    let cancelled = false;
    setPresenceDossier(null);
    fetchPresenceDossier(selectedSceneEntity.entityKey)
      .then((dossier) => {
        if (!cancelled) {
          setPresenceDossier(dossier);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPresenceDossier(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSceneEntity?.kind === "rf" ? selectedSceneEntity.entityKey : null, selectedSceneEntity?.kind]);

  const requestPresenceEnrichment = async () => {
    if (selectedSceneEntity?.kind !== "rf") {
      return;
    }
    const identity = selectedSceneEntity.identity;
    const entityKey = selectedSceneEntity.entityKey;
    setEnrichingIdentity(identity);
    try {
      await runPresenceEnrichment(entityKey);
      const dossier = await fetchPresenceDossier(entityKey);
      setPresenceDossier(dossier);
    } finally {
      setEnrichingIdentity(null);
    }
  };

  useEffect(() => {
    if (frozenScene) {
      return;
    }
    setReplayFrames((frames) => {
      const next = appendReplayFrame(frames, liveScene);
      setReplayIndex(next.length - 1);
      return next;
    });
  }, [frozenScene, liveScene]);
  const enterReplay = () => {
    const frames = replayFrames.length > 0 ? replayFrames : appendReplayFrame([], liveScene);
    const index = frames.length - 1;
    setReplayFrames(frames);
    setReplayIndex(index);
    setFrozenScene(frames[index].sceneModel);
  };
  const resumeLive = () => {
    setFrozenScene(null);
  };
  const scrubReplay = (direction: 1 | -1) => {
    const selectedFrame = selectReplayFrame(replayFrames, replayIndex, direction);
    if (!selectedFrame) {
      return;
    }
    setReplayIndex(selectedFrame.index);
    setFrozenScene(selectedFrame.frame.sceneModel);
  };

  return {
    filterControls,
    layerLens,
    dashboardData,
    infrastructureAlerts,
    situationData,
    selected,
    activeInspectorTab,
    setActiveInspectorTab,
    activePreset,
    applyPreset,
    frozenScene,
    replayFrames,
    replayIndex,
    enterReplay,
    resumeLive,
    scrubReplay,
    presenceDossier,
    enrichingIdentity,
    requestPresenceEnrichment,
    liveScene,
    sceneSource,
    visibleScene,
    renderedScene,
    selectedSceneEntity,
    selectedSource,
    selectedId,
    inspectorModel,
    selectAdjacent,
    selectInspectable,
    provenance
  };
}

export type DashboardController = ReturnType<typeof useDashboardController>;

const DashboardStateContext = createContext<DashboardController | null>(null);

export function DashboardStateProvider({ children }: { children: ReactNode }) {
  const controller = useDashboardController();
  return <DashboardStateContext.Provider value={controller}>{children}</DashboardStateContext.Provider>;
}

export function useDashboardState(): DashboardController {
  const value = useContext(DashboardStateContext);
  if (!value) {
    throw new Error("useDashboardState must be used inside <DashboardStateProvider>");
  }
  return value;
}

/** The mock backend (frontend/scripts/mock-tds-backend.mjs) tags its site so synthetic data is never labelled LIVE. */
function isMockSite(site: { source?: string } | undefined): boolean {
  return site?.source === "mock";
}

function relatedStateForSelection(selected: SelectedSceneEntity, sourceStates: ReturnType<typeof useSituationData>["sourceStates"]) {
  if (!selected) {
    return null;
  }
  const states = Object.values(sourceStates).flat();
  return (
    states.find((state) => state.state_key.includes(selected.identity)) ??
    states.find((state) => state.identity_hint?.toLowerCase() === selected.identity.toLowerCase()) ??
    null
  );
}
