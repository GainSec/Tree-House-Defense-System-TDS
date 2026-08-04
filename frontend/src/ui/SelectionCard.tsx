import type { CSSProperties, ReactNode } from "react";
import type { OperatorInspectorModel, OperatorInspectorTabId } from "../data/operatorInspector";
import { SelectionPanel, type SelectedSceneEntity } from "./SelectionPanel";
import type { PresenceDossier } from "../domain/types";

export function SelectionCard({
  selected,
  inspectorModel = null,
  activeInspectorTab = null,
  onInspectorTabChange,
  onPreviousSelection,
  onNextSelection,
  onClearSelection,
  cardControls,
  cardStyle,
  presenceDossier = null,
  onRunPresenceEnrichment,
  enrichmentRunning = false
}: {
  selected: SelectedSceneEntity;
  inspectorModel?: OperatorInspectorModel | null;
  activeInspectorTab?: OperatorInspectorTabId | null;
  onInspectorTabChange?: (tab: OperatorInspectorTabId) => void;
  onPreviousSelection?: () => void;
  onNextSelection?: () => void;
  onClearSelection?: () => void;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
  presenceDossier?: PresenceDossier | null;
  onRunPresenceEnrichment?: () => void;
  enrichmentRunning?: boolean;
}) {
  return (
    <section className="selection-card live-panel" aria-label="TDS selection card" style={cardStyle}>
      <header className="selection-card-header">
        <span className="panel-label">Object Detail</span>
        {cardControls}
      </header>
      <SelectionPanel
        selected={selected}
        inspectorModel={inspectorModel}
        activeInspectorTab={activeInspectorTab}
        onInspectorTabChange={onInspectorTabChange}
        onPrevious={onPreviousSelection}
        onNext={onNextSelection}
        onClear={onClearSelection}
        presenceDossier={presenceDossier}
        onRunPresenceEnrichment={onRunPresenceEnrichment}
        enrichmentRunning={enrichmentRunning}
      />
    </section>
  );
}
