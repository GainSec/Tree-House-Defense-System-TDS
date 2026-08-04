import { useState } from "react";
import type { DashboardDataStatus, LayerStatus } from "../data/useDashboardData";
import type { OperatorInspectorModel, OperatorInspectorTabId } from "../data/operatorInspector";
import type { InfrastructureAlertsState } from "../data/useInfrastructureAlerts";
import type { SituationDataState } from "../data/useSituationData";
import type { NetworkClient } from "../domain/types";
import { InfrastructureAlertCard } from "./InfrastructureAlertCard";
import { SelectionPanel, type SelectedSceneEntity } from "./SelectionPanel";
import { SituationRail } from "./SituationRail";

type DrawerTab = "hud" | "selection" | "alerts" | "context";

export function MobileInteractionDrawer({
  selected,
  rfVisible,
  aircraftVisible,
  dataStatus,
  rfLayerStatus,
  aircraftLayerStatus,
  lastUpdatedAt,
  alerts,
  situation,
  inspectorModel = null,
  activeInspectorTab = null,
  onInspectorTabChange,
  onPreviousSelection,
  onNextSelection,
  onClearSelection,
  onSelectClient
}: {
  selected: SelectedSceneEntity;
  rfVisible: number;
  aircraftVisible: number;
  dataStatus: DashboardDataStatus;
  rfLayerStatus: LayerStatus;
  aircraftLayerStatus: LayerStatus;
  lastUpdatedAt: string | null;
  alerts: Pick<InfrastructureAlertsState, "status" | "alerts" | "totalCount" | "error">;
  situation: Pick<SituationDataState, "model" | "status" | "error" | "clients">;
  inspectorModel?: OperatorInspectorModel | null;
  activeInspectorTab?: OperatorInspectorTabId | null;
  onInspectorTabChange?: (tab: OperatorInspectorTabId) => void;
  onPreviousSelection: () => void;
  onNextSelection: () => void;
  onClearSelection: () => void;
  onSelectClient?: (client: NetworkClient) => void;
}) {
  const [activeTab, setActiveTab] = useState<DrawerTab>("hud");

  return (
    <section className="mobile-drawer" aria-label="Mobile interaction drawer">
      <nav className="mobile-drawer-tabs" aria-label="Mobile panels">
        {(["hud", "selection", "alerts", "context"] as DrawerTab[]).map((tab) => (
          <button key={tab} type="button" className={activeTab === tab ? "is-active" : ""} onClick={() => setActiveTab(tab)}>
            {tabLabel(tab)}
          </button>
        ))}
      </nav>
      <div className="mobile-drawer-panel">
        {activeTab === "hud" ? (
          <div className="mobile-hud-summary">
            <strong>{rfVisible} RF / {aircraftVisible} aircraft</strong>
            <span>data {dataStatus} / RF {rfLayerStatus} / aircraft {aircraftLayerStatus}</span>
            <span>{lastUpdatedAt ? `sync ${new Date(lastUpdatedAt).toLocaleTimeString()}` : "sync pending"}</span>
          </div>
        ) : null}
        {activeTab === "selection" ? (
          <SelectionPanel
            selected={selected}
            inspectorModel={inspectorModel}
            activeInspectorTab={activeInspectorTab}
            onInspectorTabChange={onInspectorTabChange}
            onPrevious={onPreviousSelection}
            onNext={onNextSelection}
            onClear={onClearSelection}
          />
        ) : null}
        {activeTab === "alerts" ? (
          <InfrastructureAlertCard alerts={alerts.alerts} status={alerts.status} totalCount={alerts.totalCount} error={alerts.error} />
        ) : null}
        {activeTab === "context" ? (
          <SituationRail model={situation.model} status={situation.status} error={situation.error} clients={situation.clients} onSelectClient={onSelectClient} />
        ) : null}
      </div>
    </section>
  );
}

function tabLabel(tab: DrawerTab): string {
  if (tab === "hud") {
    return "HUD";
  }
  return tab[0].toUpperCase() + tab.slice(1);
}
