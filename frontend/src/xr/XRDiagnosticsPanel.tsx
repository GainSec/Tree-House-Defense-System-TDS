import { useEffect, useState, useSyncExternalStore } from "react";
import { useFrame } from "@react-three/fiber";
import { Container, Text } from "@react-three/uikit";
import { describeProbe, type PassthroughStatus, type XRCapabilityProbe, type XRRuntimeState } from "./capability";
import { FrameSampler, perfStats } from "./perfStats";
import { XR_COLORS } from "./theme";
import { XRButton, XRDivider, XRField, XRHeading, XRLabel, XRPanel, XRRow, xrText } from "./ui/XRPanelKit";
import { subscribeXRLog, xrLogEntries } from "./xrLog";
import type { XRSessionTelemetry } from "./useXRSessionTelemetry";
import type { DataProvenance } from "../data/provenance";
import { truncate } from "./XRSelectionCard";

/** Samples frame timing and renderer stats without causing React renders. */
export function PerfProbe() {
  const [sampler] = useState(() => new FrameSampler());
  useFrame((state, delta) => {
    sampler.push(delta, state.gl.info.render.calls, state.gl.info.render.triangles, state.clock.elapsedTime);
  });
  return null;
}

export interface DiagnosticsData {
  runtimeState: XRRuntimeState;
  probe: XRCapabilityProbe | null;
  passthrough: PassthroughStatus;
  telemetry: XRSessionTelemetry;
  presentation: string;
  backendUrl: string;
  provenance: DataProvenance;
  rfRendered: number;
  rfTotal: number;
  rfDropped: number;
  aircraftRendered: number;
  aircraftTotal: number;
  budgetLabel: string;
  boardDescription: string;
}

export function XRDiagnosticsPanel({ data, onClose, onReprobe }: { data: DiagnosticsData; onClose: () => void; onReprobe: () => void }) {
  const perf = usePerfSnapshot();
  const log = useSyncExternalStore(subscribeXRLog, xrLogEntries);
  const recent = log.slice(-5);
  return (
    <XRPanel width={560} name="xr-diagnostics" gap={8} accent={XR_COLORS.accentDim}>
      <XRRow>
        <XRHeading fontSize={26}>XR diagnostics</XRHeading>
        <Container flexGrow={1} />
        <XRButton label="Re-probe" onActivate={onReprobe} width={130} testId="diag-reprobe" />
        <XRButton label="Close" onActivate={onClose} width={100} testId="diag-close" />
      </XRRow>
      <XRField label="Build" value={__TDS_BUILD__} labelWidth={170} />
      <XRField label="Runtime" value={data.runtimeState} tone={data.runtimeState === "immersive-ar available" ? "good" : data.runtimeState === "immersive-vr only" ? "warn" : "muted"} labelWidth={170} />
      <XRField label="Presentation" value={data.presentation} labelWidth={170} />
      <XRField label="Passthrough" value={data.passthrough.label} tone={data.passthrough.verdict === "runtime-reports-passthrough" ? "good" : "warn"} labelWidth={170} />
      <XRLabel fontSize={16}>{data.passthrough.detail}</XRLabel>
      {describeProbe(data.probe).map((line) => (
        <XRLabel key={line} fontSize={16}>
          {line}
        </XRLabel>
      ))}
      {data.telemetry.session ? (
        <>
          <XRField label="Blend mode" value={data.telemetry.environmentBlendMode ?? "unreported"} labelWidth={170} />
          <XRField label="Session fps" value={`${data.telemetry.frameRate ?? "n/a"} (supported ${data.telemetry.supportedFrameRates.join("/") || "n/a"})`} labelWidth={170} />
          <XRField label="Visibility" value={data.telemetry.visibilityState ?? "n/a"} tone={data.telemetry.visibilityState === "visible" ? "good" : "warn"} labelWidth={170} />
          <XRField
            label="Input events"
            value={Object.keys(data.telemetry.inputCounts).length === 0 ? "none yet (press trigger/grip)" : Object.entries(data.telemetry.inputCounts).map(([key, count]) => `${key} ${count}`).join(", ")}
            labelWidth={170}
          />
          {data.telemetry.inputProfiles.map((profile) => (
            <XRLabel key={profile} fontSize={15}>
              {truncate(`input ${profile}`, 70)}
            </XRLabel>
          ))}
        </>
      ) : null}
      <XRDivider />
      <XRField label="Frame" value={`${perf.fps} fps · ${perf.frameMs} ms avg · ${perf.worstFrameMs} ms worst`} tone={perf.fps >= 70 ? "good" : perf.fps >= 55 ? "warn" : "hot"} labelWidth={170} />
      <XRField label="Draw calls" value={`${perf.drawCalls} · ${perf.triangles.toLocaleString()} tris`} labelWidth={170} />
      <XRField label="RF tokens" value={`${data.rfRendered} rendered / ${data.rfTotal} visible (${data.rfDropped} over budget)`} labelWidth={170} />
      <XRField label="Aircraft" value={`${data.aircraftRendered} / ${data.aircraftTotal}`} labelWidth={170} />
      <XRField label="Budget" value={data.budgetLabel} labelWidth={170} />
      <XRField label="Board" value={data.boardDescription} labelWidth={170} />
      <XRDivider />
      <XRField label="Data" value={`${data.provenance.headline} · backend ${data.provenance.backend}`} tone={data.provenance.tone} labelWidth={170} />
      <XRLabel fontSize={16}>{truncate(data.provenance.detail, 90)}</XRLabel>
      <XRField label="Backend URL" value={truncate(data.backendUrl, 46)} labelWidth={170} />
      <XRDivider />
      {recent.map((entry, index) => (
        <Text key={`${entry.at}-${index}`} fontSize={14} color={entry.level === "error" ? XR_COLORS.hot : entry.level === "warn" ? XR_COLORS.warn : XR_COLORS.textMuted}>
          {xrText(truncate(`${entry.at.slice(11, 19)} ${entry.message}`, 84))}
        </Text>
      ))}
      <XRLabel fontSize={14}>72 FPS target is not verified until measured on Steam Frame hardware.</XRLabel>
    </XRPanel>
  );
}

export function usePerfSnapshot() {
  const [snapshot, setSnapshot] = useState(() => ({ ...perfStats }));
  useEffect(() => {
    const id = window.setInterval(() => setSnapshot({ ...perfStats }), 500);
    return () => window.clearInterval(id);
  }, []);
  return snapshot;
}
