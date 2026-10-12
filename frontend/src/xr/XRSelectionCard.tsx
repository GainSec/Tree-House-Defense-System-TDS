import { Container } from "@react-three/uikit";
import type { DataProvenance } from "../data/provenance";
import type { CardField, SelectionCardModel } from "./cards";
import type { SelectionTab } from "./XRViewState";
import { XR_COLORS } from "./theme";
import { XRBadge, XRButton, XRDivider, XRField, XRHeading, XRLabel, XRPanel, XRRow } from "./ui/XRPanelKit";

const TABS: Array<{ id: SelectionTab; label: string }> = [
  { id: "summary", label: "Summary" },
  { id: "signal", label: "Signal" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" }
];

/** Spatial detail card for the selected entity. Read-only; deep investigation hands off to the desktop. */
export function XRSelectionCard({
  model,
  provenance,
  tab,
  onTab,
  tabRows,
  historyLoading,
  focusZoom,
  onFocus,
  focusLabel,
  onPrevious,
  onNext,
  onClear,
  onHide,
  onDesktop
}: {
  model: SelectionCardModel;
  provenance: DataProvenance;
  tab: SelectionTab;
  onTab: (tab: SelectionTab) => void;
  tabRows: Record<Exclude<SelectionTab, "summary">, CardField[]>;
  historyLoading: boolean;
  focusZoom: number;
  onFocus: () => void;
  /** Overrides the zoom button label (life-size uses "Go there"). */
  focusLabel?: string;
  onPrevious: () => void;
  onNext: () => void;
  onClear: () => void;
  onHide: () => void;
  onDesktop: () => void;
}) {
  const rows = tab === "summary" ? null : tabRows[tab];
  return (
    <XRPanel width={500} name="xr-selection-card" accent={model.posture.tone === "hot" ? XR_COLORS.hot : XR_COLORS.accent}>
      <XRRow>
        <XRBadge label={model.provenance.value} tone={provenance.tone} />
        <Container flexGrow={1} />
        <XRButton label="Hide" onActivate={onHide} width={96} testId="selection-hide" />
      </XRRow>
      <XRHeading fontSize={34}>{truncate(model.title, 30)}</XRHeading>
      <XRLabel fontSize={21}>{model.typeLabel}</XRLabel>
      <XRRow gap={6}>
        {TABS.map((candidate) => (
          <XRButton key={candidate.id} label={candidate.label} fontSize={19} active={tab === candidate.id} onActivate={() => onTab(candidate.id)} testId={`selection-tab-${candidate.id}`} />
        ))}
      </XRRow>
      <XRDivider />
      {tab === "summary" ? (
        <>
          <XRField label="Identity" value={truncate(model.identity, 36)} />
          <XRField label={model.primaryMetric.label} value={model.primaryMetric.value} tone={model.primaryMetric.tone} />
          <XRField label={model.lastObserved.label} value={model.lastObserved.value} />
          <XRField label={model.confidence.label} value={model.confidence.value} tone={model.confidence.tone} />
          <XRField label={model.freshness.label} value={model.freshness.value} tone={model.freshness.tone} />
          <XRField label="Sources" value={model.sources} />
          <XRField label={model.posture.label} value={model.posture.value} tone={model.posture.tone} />
        </>
      ) : rows && rows.length > 0 ? (
        rows.map((row, index) => <XRField key={`${row.label}-${index}`} label={row.label} value={truncate(row.value, 44)} tone={row.tone} />)
      ) : (
        <XRLabel>{tab === "history" ? (historyLoading ? "Loading presence dossier..." : "No presence history for this entity.") : "No data for this tab."}</XRLabel>
      )}
      {provenance.synthetic ? <XRLabel color={XR_COLORS.warn}>Demo entity: not an observation.</XRLabel> : null}
      {provenance.mixedDetail ? <XRLabel color={XR_COLORS.warn}>{provenance.mixedDetail}</XRLabel> : null}
      <XRRow>
        <XRButton label="Prev" onActivate={onPrevious} testId="selection-prev" />
        <XRButton label={focusLabel ?? (focusZoom > 1 ? `Zoom x${focusZoom}` : "Zoom in")} active={!focusLabel && focusZoom > 1} onActivate={onFocus} testId="selection-focus" />
        <XRButton label="Next" onActivate={onNext} testId="selection-next" />
      </XRRow>
      <XRRow>
        <XRButton label="Open on desktop" onActivate={onDesktop} testId="selection-desktop" />
        <XRButton label="Clear" onActivate={onClear} testId="selection-clear" />
      </XRRow>
    </XRPanel>
  );
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
