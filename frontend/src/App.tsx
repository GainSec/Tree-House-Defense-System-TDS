import { lazy, Suspense, type CSSProperties } from "react";
import { Hud } from "./ui/Hud";
import { SigintWorld } from "./scene/SigintWorld";
import { InfrastructureAlertCard } from "./ui/InfrastructureAlertCard";
import { SituationRail } from "./ui/SituationRail";
import { SelectionCard } from "./ui/SelectionCard";
import { CardChrome } from "./ui/CardChrome";
import { useCardDock, type CardDockId } from "./ui/useCardDock";
import { FilterPanel } from "./ui/FilterPanel";
import { OperatorCommandRail, buildScenarioBundleHtml, buildScenarioSnapshot, scenarioBundleFilename, type ScenarioSnapshot } from "./ui/OperatorCommandRail";
import { replayTimelineLabel } from "./ui/replayTimeline";
import { PresencePage } from "./ui/PresencePage";
import { PresenceGraphPage } from "./ui/PresenceGraphPage";
import { PresenceEntityPage, PresenceInvestigationPage } from "./ui/PresenceEntityPage";
import { LteDashboardPage } from "./ui/LteDashboardPage";
import { SettingsPage } from "./ui/SettingsPage";
import { AppNavigation, appPathname } from "./ui/AppNavigation";
import { DashboardStateProvider, useDashboardState } from "./state/DashboardStateProvider";

const XRApp = lazy(() => import("./xr/XRApp"));

type CardSurface = "overlay" | "detached";

const CARD_TRANSFORM_ORIGINS: Record<CardDockId, CSSProperties["transformOrigin"]> = {
  alerts: "top center",
  hud: "top left",
  filters: "top center",
  selection: "top left",
  situation: "top right"
};

export default function App() {
  const pathname = appPathname();
  if (pathname === "/vr" || pathname === "/mr" || pathname === "/xr") {
    return (
      <Suspense fallback={<main className="xr-loading">Loading TDS XR board…</main>}>
        <XRApp />
      </Suspense>
    );
  }
  if (pathname === "/lte") {
    return <LteDashboardPage />;
  }
  if (pathname === "/settings" || pathname === "/setting") {
    return <SettingsPage />;
  }
  if (pathname.startsWith("/presence/investigate/")) {
    return <PresenceInvestigationPage entityKey={decodeURIComponent(pathname.replace("/presence/investigate/", ""))} />;
  }
  if (pathname.startsWith("/presence/entities/")) {
    return <PresenceEntityPage entityKey={decodeURIComponent(pathname.replace("/presence/entities/", ""))} />;
  }
  if (pathname === "/presence/graph") {
    return <PresenceGraphPage />;
  }
  if (pathname === "/presence") {
    return <PresencePage />;
  }
  return <DashboardApp />;
}

function DashboardApp() {
  return (
    <DashboardStateProvider>
      <DesktopDashboard />
    </DashboardStateProvider>
  );
}

function DesktopDashboard() {
  const cardDock = useCardDock();
  const {
    filterControls,
    layerLens,
    dashboardData,
    infrastructureAlerts,
    situationData,
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
    renderedScene,
    selectedSceneEntity,
    selectedSource,
    selectedId,
    inspectorModel,
    selectAdjacent,
    selectInspectable
  } = useDashboardState();
  const captureSnapshot = () => {
    downloadScenarioSnapshot(
      buildScenarioSnapshot({
        sceneModel: renderedScene,
        selectedId
      })
    );
  };
  const cardControls = (id: CardDockId, compact = false) => (
    <CardChrome
      card={cardDock.cards[id]}
      compact={compact}
      onHide={cardDock.hide}
      onShow={cardDock.show}
      onDetach={cardDock.detach}
      onNudge={cardDock.nudge}
      onMove={cardDock.move}
      onResize={cardDock.resize}
      onReset={cardDock.reset}
    />
  );
  const cardSurfaceStyle = (id: CardDockId): CSSProperties => ({
    transform: `scale(${cardDock.cards[id].scale})`,
    transformOrigin: CARD_TRANSFORM_ORIGINS[id]
  });

  const alertsPanel = (surface: CardSurface) => (
    <InfrastructureAlertCard
      alerts={infrastructureAlerts.alerts}
      status={infrastructureAlerts.status}
      totalCount={infrastructureAlerts.totalCount}
      error={infrastructureAlerts.error}
      cardControls={cardControls("alerts", true)}
      cardStyle={surface === "overlay" ? cardSurfaceStyle("alerts") : undefined}
    />
  );
  const hudPanel = (surface: CardSurface) => (
    <Hud
      filters={filterControls.filters}
      dataStatus={dashboardData.status}
      lastUpdatedAt={dashboardData.lastUpdatedAt}
      error={dashboardData.error}
      airspaceLanes={dashboardData.airspaceLanes}
      spectrumOccupancy={dashboardData.spectrumOccupancy}
      rfBursts={dashboardData.rfBursts}
      changeBriefing={dashboardData.changeBriefing}
      sensorCoverage={dashboardData.sensorCoverage}
      layerLensMode={layerLens.mode}
      onLayerLensChange={layerLens.setMode}
      onToggleSource={filterControls.toggleSource}
      onToggleCategory={filterControls.toggleCategory}
      onToggleAircraft={filterControls.toggleAircraft}
      onToggleStale={filterControls.toggleStale}
      cardControls={cardControls("hud")}
      cardStyle={surface === "overlay" ? cardSurfaceStyle("hud") : undefined}
    />
  );
  const filterPanel = (surface: CardSurface) => (
    <FilterPanel
      filters={filterControls.filters}
      layerLensMode={layerLens.mode}
      onLayerLensChange={layerLens.setMode}
      onToggleSource={filterControls.toggleSource}
      onToggleCategory={filterControls.toggleCategory}
      onToggleAircraft={filterControls.toggleAircraft}
      onToggleStale={filterControls.toggleStale}
      cardControls={cardControls("filters")}
      cardStyle={surface === "overlay" ? cardSurfaceStyle("filters") : undefined}
    />
  );
  const selectionPanel = (surface: CardSurface) => (
    <SelectionCard
      selected={selectedSceneEntity}
      inspectorModel={inspectorModel}
      activeInspectorTab={activeInspectorTab}
      onInspectorTabChange={setActiveInspectorTab}
      onPreviousSelection={() => selectAdjacent(-1)}
      onNextSelection={() => selectAdjacent(1)}
      onClearSelection={() => selectInspectable(null)}
      cardControls={cardControls("selection")}
      cardStyle={surface === "overlay" ? cardSurfaceStyle("selection") : undefined}
      presenceDossier={presenceDossier}
      onRunPresenceEnrichment={selectedSceneEntity?.kind === "rf" ? requestPresenceEnrichment : undefined}
      enrichmentRunning={Boolean(selectedSceneEntity?.kind === "rf" && enrichingIdentity === selectedSceneEntity.identity)}
    />
  );
  const situationPanel = (surface: CardSurface) => (
    <SituationRail
      model={situationData.model}
      status={situationData.status}
      error={situationData.error}
      clients={situationData.clients}
      onSelectClient={(client) => selectInspectable({ kind: "client", client, label: client.alias || client.hostname || client.mac_address })}
      cardControls={cardControls("situation", true)}
      cardStyle={surface === "overlay" ? cardSurfaceStyle("situation") : undefined}
    />
  );
  const detachedCardContent = {
    alerts: cardDock.cards.alerts.mode === "detached" ? alertsPanel("detached") : null,
    hud: cardDock.cards.hud.mode === "detached" ? hudPanel("detached") : null,
    filters: cardDock.cards.filters.mode === "detached" ? filterPanel("detached") : null,
    selection: cardDock.cards.selection.mode === "detached" ? selectionPanel("detached") : null,
    situation: cardDock.cards.situation.mode === "detached" ? situationPanel("detached") : null
  };

  return (
    <main className="app-shell" data-testid="tds-3d-world">
      <AppNavigation className="app-nav-dashboard" />
      <SigintWorld
        sceneModel={renderedScene}
        sourceHealth={situationData.model?.sources ?? []}
        sourceStates={situationData.sourceStates}
        selectedEntity={selectedSceneEntity}
        selectedDossier={presenceDossier}
        selectedSource={selectedSource}
        selectedId={selectedId}
        inspectorModel={inspectorModel}
        activeInspectorTab={activeInspectorTab}
        layerLensMode={layerLens.mode}
        infrastructureAlerts={infrastructureAlerts.alerts}
        infrastructureAlertStatus={infrastructureAlerts.status}
        cardDock={cardDock.cards}
        detachedCards={detachedCardContent}
        onRestoreCard={cardDock.show}
        onSelect={selectInspectable}
        onSelectSource={selectInspectable}
      />
      {cardDock.cards.alerts.mode === "overlay" ? alertsPanel("overlay") : null}
      {cardDock.cards.hud.mode === "overlay" ? hudPanel("overlay") : null}
      {cardDock.cards.filters.mode === "overlay" ? filterPanel("overlay") : null}
      {cardDock.cards.selection.mode === "overlay" ? selectionPanel("overlay") : null}
      {cardDock.cards.situation.mode === "overlay" ? situationPanel("overlay") : null}
      <OperatorCommandRail
        activePreset={activePreset}
        replayFrozen={Boolean(frozenScene)}
        replayLabel={replayTimelineLabel(replayFrames, replayIndex)}
        onPreset={applyPreset}
        onFreeze={enterReplay}
        onResume={resumeLive}
        onReplayPrevious={() => scrubReplay(-1)}
        onReplayNext={() => scrubReplay(1)}
        onSnapshot={captureSnapshot}
      />
      <section className="card-restore-dock" aria-label="Card restore dock">
        {cardDock.items.filter((card) => card.mode === "detached").map((card) => (
          <div key={card.id} className={`card-restore-dock-group is-${card.mode}`}>
            <span>{card.label}</span>
            <button type="button" onClick={() => cardDock.show(card.id)} aria-label={`Restore ${card.label}`} title="Overlay">O</button>
            {card.mode === "detached" ? (
              <>
                <button type="button" onClick={() => cardDock.hide(card.id)} aria-label={`Hide ${card.label} from dock`} title="Hide">H</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [-1, 0, 0])} aria-label={`Move ${card.label} left from dock`} title="Left">Left</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [1, 0, 0])} aria-label={`Move ${card.label} right from dock`} title="Right">Right</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [0, 0.5, 0])} aria-label={`Move ${card.label} up from dock`} title="Up">Up</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [0, -0.5, 0])} aria-label={`Move ${card.label} down from dock`} title="Down">Down</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [0, 0, 1])} aria-label={`Move ${card.label} closer from dock`} title="Closer">In</button>
                <button type="button" className="card-restore-move" onClick={() => cardDock.nudge(card.id, [0, 0, -1])} aria-label={`Move ${card.label} farther from dock`} title="Farther">Out</button>
              </>
            ) : null}
            <button type="button" onClick={() => cardDock.resize(card.id, -0.1)} aria-label={`Make ${card.label} smaller from dock`} title="Smaller">-</button>
            <button type="button" onClick={() => cardDock.resize(card.id, 0.1)} aria-label={`Make ${card.label} larger from dock`} title="Larger">+</button>
            <button type="button" onClick={() => cardDock.reset(card.id)} aria-label={`Reset ${card.label} layout from dock`} title="Reset">R</button>
          </div>
        ))}
      </section>
      <section className="control-strip" aria-label="3D controls">
        <span>Drag mouse to orbit</span>
        <span>Hold Shift to look up</span>
        <span>WASD / arrows to move</span>
        <span>Scroll to zoom</span>
        <span>Character marks operator position</span>
      </section>
    </main>
  );
}

function downloadScenarioSnapshot(snapshot: ScenarioSnapshot) {
  if (typeof document === "undefined" || typeof URL === "undefined" || typeof Blob === "undefined") {
    return;
  }
  const blob = new Blob([buildScenarioBundleHtml(snapshot)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = scenarioBundleFilename(snapshot);
  link.click();
  URL.revokeObjectURL(url);
}
