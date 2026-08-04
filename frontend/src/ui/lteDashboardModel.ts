import type { CollectionResponse } from "../data/api";
import type { CurrentStateItem, LteSettings, PresenceGraphNode, PresenceLinkGraph, RfMapFeature } from "../domain/types";

export interface LteSetupCheck {
  id: string;
  label: string;
  value: string;
  status: "ready" | "missing";
}

export interface LteDashboardModel {
  sensorState: CurrentStateItem | null;
  decodeState: CurrentStateItem | null;
  cellularGraphNodes: PresenceGraphNode[];
  lteRfItems: RfMapFeature[];
  rfMapCellularCount: number;
  statusLabel: string;
  hardwareLabel: string;
  directionLabel: string;
  downlinkLabel: string;
  uplinkLabel: string;
  apiOutput: string;
  readyChecks: LteSetupCheck[];
  decodePipeline: LteDecodeStage[];
  decodeFacts: Array<{ label: string; value: string }>;
  carrierCandidates: LteCarrierCandidate[];
  scanSummary: LteScanSummary | null;
  operatorRead: string;
  rawRows: CurrentStateItem[];
}

export interface LteScanAttempt {
  id: string;
  dl_freq_hz: number;
  ul_freq_hz: number | null;
  detected: boolean;
}

export interface LteScanSummary {
  rowKey: string;
  attemptCount: number;
  detectedCount: number;
  minDlFreqHz: number | null;
  maxDlFreqHz: number | null;
  attempts: LteScanAttempt[];
  lastSeenAt: string | null;
}

export interface LteCarrierCandidate {
  id: string;
  label: string;
  dl_freq_hz: number;
  ul_freq_hz: number | null;
  cell_id: number | null;
  pci: number | null;
  prb: number | null;
  earfcn: number | null;
  snr: string;
  confidence: "high" | "medium" | "low";
  last_seen_at: string | null;
}

export interface LteDecodeStage {
  label: string;
  value: string;
  status: "ready" | "missing";
}

export function buildLteDashboardModel(
  state: CollectionResponse<CurrentStateItem>,
  graph: PresenceLinkGraph,
  rfMap: CollectionResponse<RfMapFeature>
): LteDashboardModel {
  const rows = [...state.items].sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")));
  const sensorState = latestLteState(rows, "lte_sensor");
  const decodeState = latestLteState(rows, "lte_decode_status");
  const metadata = decodeState?.metadata ?? {};
  const sensorMetadata = sensorState?.metadata ?? {};
  const readyChecks = lteSetupChecks(decodeState);
  const directionLabel = stringValue(metadata.decode_channel) || stringValue(metadata.mode) || "not configured";
  const lteRfItems = rfMap.items.filter((item) => item.source === "ltesniffer" || item.category === "cellular");
  const cellularGraphNodes = graph.nodes.filter((node) => node.type === "cellular");
  const statusLabel =
    decodeState && readyChecks.some((check) => check.status === "ready")
      ? "Configured for live decode"
      : sensorState || decodeState
        ? "Probe only"
        : "No LTE collector state";
  return {
    sensorState,
    decodeState,
    cellularGraphNodes,
    lteRfItems,
    rfMapCellularCount: lteRfItems.length || cellularGraphNodes.length,
    statusLabel,
    hardwareLabel: stringValue(sensorMetadata.sdr) || stringValue(sensorState?.identity_hint) || "LibreSDR not observed",
    directionLabel,
    downlinkLabel: formatLteFrequency(metadata.dl_freq_hz),
    uplinkLabel: formatLteFrequency(metadata.ul_freq_hz),
    apiOutput: stringValue(metadata.api_output) || apiModeFallback(metadata.api_mode),
    readyChecks,
    decodePipeline: decodePipeline(decodeState),
    decodeFacts: decodeFacts(decodeState),
    carrierCandidates: carrierCandidates(rows),
    scanSummary: scanSummary(rows),
    operatorRead: operatorRead(sensorState, decodeState, statusLabel),
    rawRows: rows
  };
}

export function latestLteState(items: CurrentStateItem[], kind: string): CurrentStateItem | null {
  return items
    .filter((item) => item.source === "ltesniffer" && item.kind === kind)
    .sort((a, b) => String(b.last_seen_at ?? "").localeCompare(String(a.last_seen_at ?? "")))[0] ?? null;
}

export function lteSetupChecks(decodeState: CurrentStateItem | null): LteSetupCheck[] {
  const metadata = decodeState?.metadata ?? {};
  return [
    setupCheck("downlink", "Downlink", formatLteFrequency(metadata.dl_freq_hz), hasValue(metadata.dl_freq_hz)),
    setupCheck("uplink", "Uplink", formatLteFrequency(metadata.ul_freq_hz), hasValue(metadata.ul_freq_hz)),
    setupCheck("cell", "Cell ID", stringValue(metadata.cell_id) || "not set", hasValue(metadata.cell_id)),
    setupCheck("prb", "PRB", stringValue(metadata.prb) || "not set", hasValue(metadata.prb)),
    setupCheck("api", "API output", stringValue(metadata.api_output) || apiModeFallback(metadata.api_mode), hasValue(metadata.api_mode) || hasValue(metadata.api_output))
  ];
}

export function lteDesiredSetupChecks(settings: Pick<LteSettings, "dl_freq_hz" | "ul_freq_hz" | "cell_id" | "prb" | "api_mode">): LteSetupCheck[] {
  return [
    setupCheck("downlink", "Downlink", formatLteFrequency(settings.dl_freq_hz), hasValue(settings.dl_freq_hz)),
    setupCheck("uplink", "Uplink", formatLteFrequency(settings.ul_freq_hz), hasValue(settings.ul_freq_hz)),
    setupCheck("cell", "Cell ID", stringValue(settings.cell_id) || "not set", true),
    setupCheck("prb", "PRB", stringValue(settings.prb) || "not set", true),
    setupCheck("api", "API output", apiModeFallback(settings.api_mode), hasValue(settings.api_mode))
  ];
}

export function formatLteFrequency(value: unknown): string {
  const numeric = numberValue(value);
  if (numeric === null || numeric <= 0) {
    return "not set";
  }
  return `${(numeric / 1_000_000).toFixed(3)} MHz`;
}

function carrierCandidates(rows: CurrentStateItem[]): LteCarrierCandidate[] {
  const candidates = rows.flatMap((row) => candidatesFromState(row));
  const deduped = new Map<string, LteCarrierCandidate>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.id);
    if (!existing || candidateScore(candidate) > candidateScore(existing)) {
      deduped.set(candidate.id, candidate);
    }
  }
  return [...deduped.values()].sort((a, b) => candidateScore(b) - candidateScore(a));
}

function candidatesFromState(row: CurrentStateItem): LteCarrierCandidate[] {
  if (row.source !== "ltesniffer") {
    return [];
  }
  const metadata = row.metadata ?? {};
  const explicit = firstArray(metadata.carrier_candidates, metadata.lte_carriers, metadata.cells, row.raw_payload?.carrier_candidates, row.raw_payload?.cells);
  if (explicit.length > 0) {
    return explicit.map((candidate, index) => candidateFromPayload(row, objectValue(candidate), index)).filter((candidate): candidate is LteCarrierCandidate => candidate !== null);
  }
  return [];
}

function candidateFromPayload(row: CurrentStateItem, payload: Record<string, unknown>, index: number): LteCarrierCandidate | null {
  const dlFreq = numberValue(firstValue(payload.dl_freq_hz, payload.downlink_frequency_hz, payload.frequency_hz, payload.center_freq_hz, payload.freq_hz));
  if (dlFreq === null) {
    return null;
  }
  const ulFreq = numberValue(firstValue(payload.ul_freq_hz, payload.uplink_frequency_hz));
  const cellId = numberValue(firstValue(payload.cell_id, payload.cell, payload.enb_cell_id));
  const pci = numberValue(firstValue(payload.pci, payload.physical_cell_id));
  const prb = numberValue(payload.prb);
  const earfcn = numberValue(firstValue(payload.earfcn, payload.dl_earfcn));
  const snrValue = numberValue(firstValue(payload.snr_db, payload.snr));
  const identity = `${row.state_key}:${dlFreq}:${ulFreq ?? "unset"}${index ? `:${index}` : ""}`;
  return {
    id: identity,
    label: cellId !== null ? `Cell ${cellId}` : pci !== null ? `PCI ${pci}` : formatLteFrequency(dlFreq),
    dl_freq_hz: dlFreq,
    ul_freq_hz: ulFreq,
    cell_id: cellId,
    pci,
    prb,
    earfcn,
    snr: snrValue === null ? "not reported" : `${snrValue} dB`,
    confidence: candidateConfidence({ cellId, pci, prb, earfcn, snrValue }),
    last_seen_at: row.last_seen_at
  };
}

function candidateConfidence(values: { cellId: number | null; pci: number | null; prb: number | null; earfcn: number | null; snrValue: number | null }): "high" | "medium" | "low" {
  const score = [values.cellId, values.pci, values.prb, values.earfcn, values.snrValue].filter((value) => value !== null).length;
  if (score >= 4) {
    return "high";
  }
  if (score >= 2) {
    return "medium";
  }
  return "low";
}

function candidateScore(candidate: LteCarrierCandidate): number {
  const confidenceScore = candidate.confidence === "high" ? 100 : candidate.confidence === "medium" ? 50 : 10;
  return confidenceScore + (candidate.snr === "not reported" ? 0 : 5) + (candidate.prb !== null ? 3 : 0);
}

function scanSummary(rows: CurrentStateItem[]): LteScanSummary | null {
  const row = rows.find((item) => {
    if (item.source !== "ltesniffer" || item.kind !== "lte_decode_status") {
      return false;
    }
    const metadata = item.metadata ?? {};
    const rawSummary = objectValue(item.raw_payload?.summary);
    return stringValue(firstValue(metadata.probe_mode, item.raw_payload?.probe_mode, rawSummary.probe_mode)) === "range_scan";
  });
  if (!row) {
    return null;
  }
  const metadata = row.metadata ?? {};
  const rawSummary = objectValue(row.raw_payload?.summary);
  const attempts = firstArray(row.raw_payload?.scan_attempts, rawSummary.scan_attempts, metadata.scan_attempts)
    .map((attempt, index) => scanAttemptFromPayload(objectValue(attempt), index))
    .filter((attempt): attempt is LteScanAttempt => attempt !== null);
  const attemptCount = numberValue(firstValue(metadata.scan_attempt_count, rawSummary.scan_attempt_count)) ?? attempts.length;
  const detectedCount = numberValue(firstValue(metadata.carrier_candidate_count, rawSummary.carrier_candidate_count)) ?? attempts.filter((attempt) => attempt.detected).length;
  const frequencies = attempts.map((attempt) => attempt.dl_freq_hz);
  return {
    rowKey: row.state_key,
    attemptCount,
    detectedCount,
    minDlFreqHz: frequencies.length ? Math.min(...frequencies) : null,
    maxDlFreqHz: frequencies.length ? Math.max(...frequencies) : null,
    attempts,
    lastSeenAt: row.last_seen_at
  };
}

function scanAttemptFromPayload(payload: Record<string, unknown>, index: number): LteScanAttempt | null {
  const dlFreq = numberValue(firstValue(payload.dl_freq_hz, payload.downlink_frequency_hz, payload.frequency_hz, payload.center_freq_hz, payload.freq_hz));
  if (dlFreq === null) {
    return null;
  }
  const ulFreq = numberValue(firstValue(payload.ul_freq_hz, payload.uplink_frequency_hz));
  return {
    id: `${dlFreq}:${ulFreq ?? "unset"}:${index}`,
    dl_freq_hz: dlFreq,
    ul_freq_hz: ulFreq,
    detected: payload.detected === true
  };
}

function decodeFacts(decodeState: CurrentStateItem | null): Array<{ label: string; value: string }> {
  const metadata = decodeState?.metadata ?? {};
  return [
    ["Direction", stringValue(metadata.decode_channel) || stringValue(metadata.mode)],
    ["Cell", stringValue(metadata.cell_id)],
    ["PRB", stringValue(metadata.prb)],
    ["Subframes", subframeValue(metadata.processed_subframes, metadata.expected_subframes)],
    ["PDCCH", metadata.pdcch_observed === true ? "observed" : ""],
    ["DCIs", stringValue(metadata.dci_count)],
    ["DCI formats", arrayValue(metadata.dci_formats).join(", ")],
    ["PDSCH success", stringValue(metadata.pdsch_success_count)],
    ["RNTIs", stringValue(metadata.rnti_count)],
    ["Identity events", stringValue(metadata.identity_event_count)],
    ["SNR", snrValue(metadata.snr_db)]
  ]
    .filter((row): row is [string, string] => Boolean(row[1]))
    .map(([label, value]) => ({ label, value }));
}

function decodePipeline(decodeState: CurrentStateItem | null): LteDecodeStage[] {
  const metadata = decodeState?.metadata ?? {};
  const labels = arrayValue(metadata.decode_pipeline);
  const channel = stringValue(metadata.decode_channel) || stringValue(metadata.mode);
  const fallback = channel && channel !== "probe" ? ["PDCCH", "DCI", "RNTI", channel] : ["PDCCH", "DCI", "RNTI"];
  return (labels.length ? labels : fallback).map((label) => ({
    label,
    value: pipelineValue(label, metadata),
    status: pipelineReady(label, metadata) ? "ready" : "missing"
  }));
}

function pipelineReady(label: string, metadata: Record<string, unknown>): boolean {
  if (label === "PDCCH") {
    return metadata.pdcch_observed === true || numberValue(metadata.dci_count) !== null || numberValue(metadata.rnti_count) !== null;
  }
  if (label === "DCI") {
    return numberValue(metadata.dci_count) !== null;
  }
  if (label === "RNTI") {
    return numberValue(metadata.rnti_count) !== null;
  }
  if (label.includes("PDSCH")) {
    return numberValue(metadata.pdsch_success_count) !== null || stringValue(metadata.decode_channel).includes("PDSCH");
  }
  if (label.includes("PUSCH")) {
    return stringValue(metadata.decode_channel).includes("PUSCH");
  }
  return false;
}

function pipelineValue(label: string, metadata: Record<string, unknown>): string {
  if (label === "PDCCH") {
    return metadata.pdcch_observed === true ? "observed" : "pending";
  }
  if (label === "DCI") {
    return stringValue(metadata.dci_count) || "pending";
  }
  if (label === "RNTI") {
    return stringValue(metadata.rnti_count) || "pending";
  }
  if (label.includes("PDSCH")) {
    return stringValue(metadata.pdsch_success_count) || "configured";
  }
  if (label.includes("PUSCH")) {
    return "configured";
  }
  return "pending";
}

function operatorRead(sensorState: CurrentStateItem | null, decodeState: CurrentStateItem | null, statusLabel: string): string {
  const metadata = decodeState?.metadata ?? {};
  const rawRead = stringValue(metadata.operator_read);
  if (rawRead) {
    return rawRead;
  }
  if (statusLabel === "Configured for live decode") {
    return `${stringValue(metadata.decode_channel) || "LTE"} decode is configured for the private testbed.`;
  }
  if (sensorState || decodeState) {
    return "Probe has found the LTE collector path. Add private testbed frequencies to move from probe to live decode.";
  }
  return "No LTESniffer current-state records are available yet. Run the safe probe collector to populate this page.";
}

function setupCheck(id: string, label: string, value: string, ready: boolean): LteSetupCheck {
  return { id, label, value, status: ready ? "ready" : "missing" };
}

function subframeValue(processed: unknown, expected: unknown): string {
  const processedValue = stringValue(processed);
  if (!processedValue) {
    return "";
  }
  const expectedValue = stringValue(expected);
  return expectedValue ? `${processedValue}/${expectedValue}` : processedValue;
}

function snrValue(value: unknown): string {
  const numeric = numberValue(value);
  return numeric === null ? "" : `${numeric} dB`;
}

function apiModeFallback(value: unknown): string {
  const mode = numberValue(value);
  if (mode === 0) {
    return "identity mapping";
  }
  if (mode === 1) {
    return "IMSI collecting";
  }
  if (mode === 2) {
    return "UECapability profiling";
  }
  if (mode === 3) {
    return "identity mapping, IMSI collecting, and UECapability profiling";
  }
  return "not set";
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function firstValue(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined && value !== "");
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function arrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => stringValue(item)).filter(Boolean);
}

function firstArray(...values: unknown[]): unknown[] {
  const found = values.find((value) => Array.isArray(value));
  return Array.isArray(found) ? found : [];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
