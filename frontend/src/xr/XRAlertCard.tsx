import { Container, Text } from "@react-three/uikit";
import type { ThreeEvent } from "@react-three/fiber";
import type { AlertCardItem, AlertCardModel } from "./cards";
import { XR_COLORS, toneColor } from "./theme";
import { XRBadge, XRButton, XRHeading, XRLabel, XRPanel, XRRow, nameObject, xrText } from "./ui/XRPanelKit";
import { truncate } from "./XRSelectionCard";
import { noteXRInteraction } from "./xrLog";

/** Important exceptions only: unknown RF needing review, degraded collectors, high-priority alerts. */
export function XRAlertCard({ model, onActivateItem, onHide }: { model: AlertCardModel; onActivateItem: (item: AlertCardItem) => void; onHide: () => void }) {
  return (
    <XRPanel width={430} name="xr-alert-card" accent={toneColor(model.tone)}>
      <XRRow>
        <XRHeading color={toneColor(model.tone)}>Exceptions</XRHeading>
        <Container flexGrow={1} />
        <XRBadge label={model.posture} tone={model.posture === "ALERT" ? "hot" : model.posture === "WATCH" ? "warn" : model.posture === "CLEAR" ? "good" : "muted"} />
        <XRButton label="Hide" onActivate={onHide} width={96} testId="alerts-hide" />
      </XRRow>
      <XRLabel fontSize={20}>{model.statusLine}</XRLabel>
      {model.items.map((item) => (
        <Container
          key={item.id}
          ref={nameObject(`xr-alert-item:${item.id}`)}
          flexDirection="column"
          gap={4}
          width="100%"
          minHeight={64}
          padding={12}
          borderRadius={10}
          borderWidth={3}
          borderColor={severityColor(item.severity)}
          backgroundColor={XR_COLORS.panelRaised}
          {...(item.entityId || item.source ? { hover: { backgroundColor: XR_COLORS.hover }, cursor: "pointer" } : {})}
          onPointerDown={(event: ThreeEvent<PointerEvent>) => {
            event.stopPropagation();
            noteXRInteraction(`alert:${item.id}`);
            onActivateItem(item);
          }}
        >
          <Text fontSize={21} fontWeight="semi-bold" color={severityColor(item.severity)}>
            {xrText(truncate(item.title, 40))}
          </Text>
          <Text fontSize={18} color={XR_COLORS.textMuted}>
            {xrText(truncate(item.detail, 52))}
          </Text>
        </Container>
      ))}
    </XRPanel>
  );
}

/** Small restore control shown on the board edge while the alert card is hidden. */
export function XRAlertRestore({ model, onRestore }: { model: AlertCardModel; onRestore: () => void }) {
  return (
    <XRPanel width={200} name="xr-alert-restore" accent={toneColor(model.tone)} padding={10}>
      <XRButton label={`Alerts ${model.totalExceptions}`} onActivate={onRestore} tone={model.tone} testId="alerts-restore" />
    </XRPanel>
  );
}

function severityColor(severity: AlertCardItem["severity"]): string {
  return severity === "critical" ? XR_COLORS.hot : severity === "high" ? XR_COLORS.warn : XR_COLORS.text;
}
