import { useEffect, useMemo, useState, type FormEvent } from "react";
import { fetchLteGraph, fetchLteRuntime, fetchLteSettings, fetchLteState, runLteAction, saveLteSettings, type CollectionResponse } from "../data/api";
import type { CurrentStateItem, LteAction, LteActionResult, LteRuntimeState, LteSettings, LteSettingsUpdate, PresenceLinkGraph } from "../domain/types";
import { AppNavigation } from "./AppNavigation";
import { buildLteDashboardModel, formatLteFrequency, lteDesiredSetupChecks, type LteCarrierCandidate, type LteDashboardModel } from "./lteDashboardModel";

interface LteDashboardState {
  state: CollectionResponse<CurrentStateItem>;
  graph: PresenceLinkGraph;
  runtime: LteRuntimeState | null;
  settings: LteSettings | null;
  loading: boolean;
  settingsLoading: boolean;
  settingsSaving: boolean;
  refreshingRawState: boolean;
  actionRunning: LteAction | null;
  actionResult: LteActionResult | null;
  awaitingCollectorOutputSince: string | null;
  error: string | null;
  settingsError: string | null;
  actionError: string | null;
  settingsSavedAt: string | null;
}

const EMPTY_COLLECTION = { items: [], count: 0 };
const EMPTY_GRAPH = { nodes: [], edges: [] };
const DEFAULT_LTE_SETTINGS: LteSettings = {
  id: "ltesniffer_runtime",
  enabled: false,
  profile: "band48_cbrs_tdd",
  mode: "probe",
  decode_channel: "probe",
  dl_freq_hz: null,
  ul_freq_hz: null,
  dl_freq_min_hz: null,
  dl_freq_max_hz: null,
  ul_freq_min_hz: null,
  ul_freq_max_hz: null,
  cell_id: null,
  prb: null,
  api_mode: null,
  antennas: 2,
  workers: 4,
  run_seconds: 20,
  uhd_args: "num_recv_frames=512",
  workdir: "/var/log/tds/ltesniffer",
  unmask_identities: false,
  suppress_stderr: true,
  warnings: [],
  source: "defaults",
  apply_note: "Saved desired collector settings. Restart or run the LTESniffer collector for live execution to pick them up."
};
const BAND48_CBRS_DEFAULTS: LteSettings = {
  ...DEFAULT_LTE_SETTINGS,
  enabled: true,
  mode: "both",
  decode_channel: "PDSCH/PUSCH",
  dl_freq_hz: 3570000000,
  ul_freq_hz: 3570000000,
  cell_id: 100,
  prb: 50,
  api_mode: 3,
  antennas: 2,
  workers: 4,
  run_seconds: 60,
  uhd_args: "num_recv_frames=512",
  workdir: "/var/log/tds/ltesniffer",
  unmask_identities: false,
  suppress_stderr: true
};
const LTE_PRB_HELP = "PRB is the LTE channel bandwidth in Physical Resource Blocks. 1.4 MHz = 6 PRB; 3 MHz = 15 PRB; 5 MHz = 25 PRB; 10 MHz = 50 PRB; 15 MHz = 75 PRB; 20 MHz = 100 PRB.";
const BAND48_MIN_HZ = 3550000000;
const BAND48_MAX_HZ = 3700000000;
const BAND48_EARFCN_OFFSET = 55240;
const BAND48_FREQ_LOW_HZ = 3550000000;
const PRB_BANDWIDTH: Record<number, string> = {
  6: "1.4 MHz",
  15: "3 MHz",
  25: "5 MHz",
  50: "10 MHz",
  75: "15 MHz",
  100: "20 MHz"
};

type LteSettingsForm = {
  enabled: boolean;
  profile: LteSettingsUpdate["profile"];
  mode: LteSettingsUpdate["mode"];
  dl_freq_hz: string;
  ul_freq_hz: string;
  dl_freq_min_hz: string;
  dl_freq_max_hz: string;
  ul_freq_min_hz: string;
  ul_freq_max_hz: string;
  cell_id: string;
  prb: string;
  api_mode: string;
  antennas: string;
  workers: string;
  run_seconds: string;
  uhd_args: string;
  workdir: string;
  unmask_identities: boolean;
  suppress_stderr: boolean;
};

export function LteDashboardPage() {
  const [state, setState] = useState<LteDashboardState>({
    state: EMPTY_COLLECTION,
    graph: EMPTY_GRAPH,
    runtime: null,
    settings: null,
    loading: true,
    settingsLoading: true,
    settingsSaving: false,
    refreshingRawState: false,
    actionRunning: null,
    actionResult: null,
    awaitingCollectorOutputSince: null,
    error: null,
    settingsError: null,
    actionError: null,
    settingsSavedAt: null
  });
  const [settingsForm, setSettingsForm] = useState<LteSettingsForm>(() => formFromSettings(DEFAULT_LTE_SETTINGS));
  const profileGuidance = useMemo(() => lteProfileGuidance(settingsForm, state.settings?.warnings ?? []), [settingsForm, state.settings?.warnings]);

  const loadLteCore = async (refreshingRawState = false) => {
    if (refreshingRawState) {
      setState((current) => ({ ...current, refreshingRawState: true, error: null }));
    }
    try {
      const [lteState, graph, runtime] = await Promise.all([fetchLteState(), fetchLteGraph(), fetchLteRuntime()]);
      setState((current) => ({
        ...current,
        state: lteState,
        graph,
        runtime,
        loading: false,
        refreshingRawState: false,
        awaitingCollectorOutputSince: collectorOutputHasArrived(lteState.items, current.awaitingCollectorOutputSince) || runtimeHasProgress(runtime, current.awaitingCollectorOutputSince) ? null : current.awaitingCollectorOutputSince,
        error: null
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loading: false,
        refreshingRawState: false,
        error: error instanceof Error ? error.message : "Unable to load LTE dashboard data"
      }));
    }
  };

  const loadLteSettings = async () => {
    try {
      const settings = await fetchLteSettings();
      setSettingsForm(formFromSettings(settings));
      setState((current) => ({ ...current, settings, settingsLoading: false, settingsError: null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        settingsLoading: false,
        settingsError: error instanceof Error ? error.message : "Unable to load LTE settings"
      }));
    }
  };

  const submitSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState((current) => ({ ...current, settingsSaving: true, settingsError: null, settingsSavedAt: null }));
    try {
      const settings = await saveLteSettings(payloadFromForm(settingsForm));
      setSettingsForm(formFromSettings(settings));
      setState((current) => ({ ...current, settings, settingsSaving: false, settingsSavedAt: new Date().toISOString(), settingsError: null }));
    } catch (error) {
      setState((current) => ({
        ...current,
        settingsSaving: false,
        settingsError: error instanceof Error ? error.message : "Unable to save LTE settings"
      }));
    }
  };

  const triggerLteAction = async (action: LteAction) => {
    const actionStartedAt = new Date().toISOString();
    setState((current) => ({ ...current, actionRunning: action, actionResult: null, actionError: null }));
    try {
      const result = await runLteAction(action);
      setState((current) => ({
        ...current,
        actionRunning: null,
        actionResult: result,
        awaitingCollectorOutputSince: action === "stop_live" ? null : actionStartedAt,
        actionError: null
      }));
      await Promise.all([loadLteCore(true), loadLteSettings()]);
    } catch (error) {
      setState((current) => ({
        ...current,
        actionRunning: null,
        actionResult: null,
        actionError: error instanceof Error ? error.message : "Unable to run LTE collector action"
      }));
    }
  };

  const applyCarrierCandidate = (candidate: LteCarrierCandidate) => {
    setSettingsForm((current) => ({
      ...current,
      enabled: true,
      dl_freq_hz: String(candidate.dl_freq_hz),
      ul_freq_hz: String(candidate.ul_freq_hz ?? candidate.dl_freq_hz),
      cell_id: candidate.cell_id === null ? current.cell_id : String(candidate.cell_id),
      prb: candidate.prb === null ? current.prb : String(candidate.prb)
    }));
  };

  useEffect(() => {
    void loadLteCore();
    void loadLteSettings();
    const coreInterval = window.setInterval(() => void loadLteCore(), 5_000);
    return () => {
      window.clearInterval(coreInterval);
    };
  }, []);

  const model = useMemo(() => buildLteDashboardModel(state.state, state.graph, EMPTY_COLLECTION), [state.state, state.graph]);
  const desiredChecks = useMemo(() => lteDesiredSetupChecks(state.settings ?? DEFAULT_LTE_SETTINGS), [state.settings]);
  const desiredRange = useMemo(() => lteDesiredRangeSummary(state.settings ?? DEFAULT_LTE_SETTINGS), [state.settings]);

  return (
    <main className="lte-page">
      <header className="lte-header">
        <div>
          <p className="presence-eyebrow">TDS cellular lab</p>
          <h1>LTE Lab</h1>
        </div>
        <AppNavigation />
      </header>

      {state.error ? <div className="presence-alert">{state.error}</div> : null}

      <section className="lte-hero">
        <div>
          <span>Collector state</span>
          <strong>{model.statusLabel}</strong>
          <p>{model.operatorRead}</p>
          {model.statusLabel === "Probe only" ? <p className="lte-next-step">Add private testbed frequencies to move from probe to live decode.</p> : null}
        </div>
        <div className="lte-status-grid" aria-label="LTE collector status">
          <LteMetric label="Hardware" value={model.hardwareLabel} />
          <LteMetric label="UHD args" value={String(model.sensorState?.metadata.uhd_args ?? "not set")} />
          <LteMetric label="Direction" value={model.directionLabel} />
          <LteMetric label="Downlink" value={model.downlinkLabel} />
          <LteMetric label="Uplink" value={model.uplinkLabel} />
          <LteMetric label="API output" value={model.apiOutput} />
          <LteMetric label="Last seen" value={formatTime(model.decodeState?.last_seen_at ?? model.sensorState?.last_seen_at)} />
        </div>
      </section>

      {state.loading ? <p className="lte-loading">Loading LTE collector state...</p> : null}

      <section className="lte-grid">
        <section className="lte-panel lte-settings-panel" aria-label="LTE collector settings">
          <PanelHeader eyebrow="Runtime" title="Collector Settings" />
          <form className="lte-settings-form" onSubmit={submitSettings}>
            <label className="lte-toggle-row">
              <input
                type="checkbox"
                checked={settingsForm.enabled}
                onChange={(event) => setSettingsForm((current) => ({ ...current, enabled: event.target.checked }))}
              />
              <span>Enable live decode</span>
            </label>
            <div className="lte-form-grid">
              <label>
                <span>Profile</span>
                <select
                  aria-label="LTE profile"
                  value={settingsForm.profile}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, profile: event.target.value as LteSettingsUpdate["profile"] }))}
                >
                  <option value="band48_cbrs_tdd">Band 48 CBRS TDD</option>
                  <option value="custom">Custom / advanced</option>
                </select>
              </label>
              <label>
                <span>Mode</span>
                <select
                  aria-label="LTE mode"
                  value={settingsForm.mode}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, mode: event.target.value as LteSettingsUpdate["mode"] }))}
                >
                  <option value="probe">probe</option>
                  <option value="downlink">downlink PDSCH</option>
                  <option value="uplink">uplink PUSCH</option>
                  <option value="both">both PDSCH + PUSCH</option>
                </select>
              </label>
              <LteInput label="DL frequency Hz" value={settingsForm.dl_freq_hz} onChange={(value) => setSettingsForm((current) => ({ ...current, dl_freq_hz: value }))} />
              <LteInput label="UL frequency Hz" value={settingsForm.ul_freq_hz} onChange={(value) => setSettingsForm((current) => ({ ...current, ul_freq_hz: value }))} />
              {settingsForm.profile === "custom" ? (
                <>
                  <LteInput label="DL min Hz" value={settingsForm.dl_freq_min_hz} optional onChange={(value) => setSettingsForm((current) => ({ ...current, dl_freq_min_hz: value }))} />
                  <LteInput label="DL max Hz" value={settingsForm.dl_freq_max_hz} optional onChange={(value) => setSettingsForm((current) => ({ ...current, dl_freq_max_hz: value }))} />
                  <LteInput label="UL min Hz" value={settingsForm.ul_freq_min_hz} optional onChange={(value) => setSettingsForm((current) => ({ ...current, ul_freq_min_hz: value }))} />
                  <LteInput label="UL max Hz" value={settingsForm.ul_freq_max_hz} optional onChange={(value) => setSettingsForm((current) => ({ ...current, ul_freq_max_hz: value }))} />
                </>
              ) : null}
              <LteInput label="Cell ID" value={settingsForm.cell_id} optional onChange={(value) => setSettingsForm((current) => ({ ...current, cell_id: value }))} />
              <LteInput label="PRB" value={settingsForm.prb} help={LTE_PRB_HELP} optional onChange={(value) => setSettingsForm((current) => ({ ...current, prb: value }))} />
              <label>
                <LteFieldLabel label="API mode" optional />
                <select
                  aria-label="LTE API mode"
                  value={settingsForm.api_mode}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, api_mode: event.target.value }))}
                >
                  <option value="">not set</option>
                  <option value="0">0 identity map</option>
                  <option value="1">1 IMSI</option>
                  <option value="2">2 capability</option>
                  <option value="3">3 all</option>
                </select>
              </label>
              <LteInput label="Antennas" value={settingsForm.antennas} onChange={(value) => setSettingsForm((current) => ({ ...current, antennas: value }))} />
              <LteInput label="Workers" value={settingsForm.workers} onChange={(value) => setSettingsForm((current) => ({ ...current, workers: value }))} />
              <LteInput label="Run seconds" value={settingsForm.run_seconds} onChange={(value) => setSettingsForm((current) => ({ ...current, run_seconds: value }))} />
              <div className="lte-band-summary" aria-label="LTE profile guidance">
                <span className={`lte-profile-pill is-${settingsForm.profile}`}>{settingsForm.profile === "custom" ? "Custom" : "Band 48"}</span>
                <strong>{profileGuidance.summary}</strong>
                <small>{profileGuidance.detail}</small>
              </div>
              <label className="lte-wide-field">
                <span>UHD args</span>
                <input
                  aria-label="LTE UHD args"
                  value={settingsForm.uhd_args}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, uhd_args: event.target.value }))}
                />
              </label>
              <label className="lte-wide-field">
                <span>Workdir</span>
                <input
                  aria-label="LTE workdir"
                  value={settingsForm.workdir}
                  onChange={(event) => setSettingsForm((current) => ({ ...current, workdir: event.target.value }))}
                />
              </label>
            </div>
            <label className="lte-toggle-row">
              <input
                type="checkbox"
                checked={settingsForm.unmask_identities}
                onChange={(event) => setSettingsForm((current) => ({ ...current, unmask_identities: event.target.checked }))}
              />
              <span>Unmask testbed identities</span>
            </label>
            <label className="lte-toggle-row">
              <input
                type="checkbox"
                checked={settingsForm.suppress_stderr}
                onChange={(event) => setSettingsForm((current) => ({ ...current, suppress_stderr: event.target.checked }))}
              />
              <span>Suppress LTESniffer stderr noise</span>
            </label>
            <div className="lte-settings-actions">
              <button type="button" onClick={() => setSettingsForm(formFromSettings(BAND48_CBRS_DEFAULTS))}>
                Use Band 48 CBRS defaults
              </button>
              <button type="submit" disabled={state.settingsSaving || state.settingsLoading}>
                {state.settingsSaving ? "Saving..." : "Save LTE settings"}
              </button>
              <span>
                {state.settingsSavedAt
                  ? "Saved"
                  : state.settings?.source === "saved"
                    ? "Saved config loaded"
                    : "Default config"}
              </span>
            </div>
            {state.settingsError ? <p className="lte-settings-error">{state.settingsError}</p> : null}
            {profileGuidance.warnings.length > 0 ? (
              <div className="lte-settings-warning" role="status">
                {profileGuidance.warnings.map((warning) => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            ) : null}
            <p className="lte-settings-note">{`Desired decode: ${state.settings?.decode_channel ?? DEFAULT_LTE_SETTINGS.decode_channel}`}</p>
            <p className="lte-settings-note">{state.settings?.apply_note ?? DEFAULT_LTE_SETTINGS.apply_note}</p>
          </form>
          <div className="lte-ops-actions" aria-label="LTE operational controls">
            <button type="button" disabled={state.actionRunning !== null} onClick={() => void triggerLteAction("probe")}>
              {state.actionRunning === "probe" ? "Running Probe..." : "Run Probe"}
            </button>
            <button type="button" disabled={state.actionRunning !== null} onClick={() => void triggerLteAction("scan_ranges")}>
              {state.actionRunning === "scan_ranges" ? "Scanning Ranges..." : "Scan Ranges"}
            </button>
            <button type="button" disabled={state.actionRunning !== null} onClick={() => void triggerLteAction("start_live")}>
              {state.actionRunning === "start_live" ? "Starting Live..." : "Start Live Decode"}
            </button>
            <button type="button" disabled={state.actionRunning !== null} onClick={() => void triggerLteAction("restart_live")}>
              {state.actionRunning === "restart_live" ? "Restarting Live..." : "Restart Live Decode"}
            </button>
            <button type="button" disabled={state.actionRunning !== null} onClick={() => void triggerLteAction("stop_live")}>
              {state.actionRunning === "stop_live" ? "Stopping Live..." : "Stop Live Decode"}
            </button>
          </div>
          {state.actionResult ? (
            <p className={`lte-action-result is-${state.actionResult.status}`}>
              {state.actionResult.message || `${state.actionResult.service_name ?? state.actionResult.collector_id} ${state.actionResult.status}`}
            </p>
          ) : null}
          {state.awaitingCollectorOutputSince ? (
            <p className="lte-action-result is-accepted">
              Waiting for collector output. Live runtime rows should appear as soon as LTESniffer emits output; final current-state rows post after the pass exits.
            </p>
          ) : null}
          {state.actionError ? <p className="lte-settings-error">{state.actionError}</p> : null}
          <LteRuntimePanel runtime={state.runtime} awaiting={Boolean(state.awaitingCollectorOutputSince)} onRefresh={() => void loadLteCore(true)} refreshing={state.refreshingRawState} />
        </section>

        <section className="lte-panel" aria-label="LTE desired setup checklist">
          <PanelHeader eyebrow="Bring-up" title="Desired Config" />
          <div className="lte-range-strip" aria-label="LTE desired frequency range">
            <article>
              <span>Allowed range</span>
              <strong>{desiredRange.allowedRange}</strong>
            </article>
            <article>
              <span>Tuned center</span>
              <strong>{desiredRange.tunedCenter}</strong>
            </article>
            <article>
              <span>Profile</span>
              <strong>{desiredRange.profile}</strong>
            </article>
            <article>
              <span>Readiness</span>
              <strong>{desiredRange.readiness}</strong>
            </article>
          </div>
          <div className="lte-check-grid">
            {desiredChecks.map((check) => (
              <article className={`lte-check is-${check.status}`} key={check.id}>
                <span>{check.label}</span>
                <strong>{check.value}</strong>
                <b>{check.status}</b>
              </article>
            ))}
          </div>
          <div className="lte-last-run" aria-label="LTE last run observed">
            <div className="lte-subsection-title">
              <span>Last Run Observed</span>
              <strong>{formatTime(model.decodeState?.last_seen_at)}</strong>
            </div>
            <div className="lte-check-grid">
              {model.readyChecks.map((check) => (
                <article className={`lte-check is-${check.status}`} key={check.id}>
                  <span>{check.label}</span>
                  <strong>{check.value}</strong>
                  <b>{check.status}</b>
                </article>
              ))}
            </div>
          </div>
          <p className="lte-command">.venv/bin/python tools/ltesniffer_collect.py --mode probe</p>
        </section>

        <section className="lte-panel" aria-label="LTE detected carrier candidates">
          <PanelHeader eyebrow="Scan Results" title="Detected Carriers" />
          {model.scanSummary ? (
            <div className="lte-scan-summary" aria-label="LTE last range scan summary">
              <div>
                <span>Last scan</span>
                <strong>{model.scanSummary.attemptCount} attempts</strong>
                <small>{formatScanRange(model.scanSummary.minDlFreqHz, model.scanSummary.maxDlFreqHz)}</small>
              </div>
              <div>
                <span>Detected</span>
                <strong>{model.scanSummary.detectedCount} detected</strong>
                <small>{formatTime(model.scanSummary.lastSeenAt)}</small>
              </div>
            </div>
          ) : null}
          {model.carrierCandidates.length > 0 ? (
            <div className="lte-node-list">
              {model.carrierCandidates.map((candidate) => (
                <article key={candidate.id}>
                  <strong>{candidate.label}</strong>
                  <span>{formatLteFrequency(candidate.dl_freq_hz)}</span>
                  <span>{candidate.ul_freq_hz ? `UL ${formatLteFrequency(candidate.ul_freq_hz)}` : "UL follows DL unless edited"}</span>
                  <span>{candidate.earfcn ? `EARFCN ${candidate.earfcn}` : "EARFCN not reported"}</span>
                  <span>{candidate.pci !== null ? `PCI ${candidate.pci}` : "PCI not reported"}</span>
                  <span>{candidate.prb !== null ? `${candidate.prb} PRB` : "PRB not reported"}</span>
                  <span>{candidate.snr}</span>
                  <span>{candidate.confidence} confidence</span>
                  <button type="button" onClick={() => applyCarrierCandidate(candidate)} aria-label={`Use Carrier ${candidate.label}`}>
                    Use Carrier
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="lte-empty">{model.scanSummary ? "No carrier candidates found in the last scan." : "No carrier candidates yet. Save ranges, then run Scan Ranges."}</p>
          )}
          {model.scanSummary?.attempts.length ? (
            <div className="lte-scan-attempts" aria-label="LTE range scan attempts">
              {model.scanSummary.attempts.map((attempt) => (
                <span className={attempt.detected ? "is-detected" : "is-miss"} key={attempt.id}>
                  <b>{formatLteFrequency(attempt.dl_freq_hz)}</b>
                  <small>{attempt.detected ? "detected" : "miss"}</small>
                </span>
              ))}
            </div>
          ) : null}
          {model.scanSummary && model.scanSummary.attempts.length === 0 ? (
            <p className="lte-empty">The last scan reported {model.scanSummary.attemptCount} attempts, but no per-frequency attempt payload was included.</p>
          ) : null}
        </section>

        <section className="lte-panel" aria-label="LTE decode status">
          <PanelHeader eyebrow="Decode" title="PDSCH / PUSCH Status" />
          <div className="lte-pipeline" aria-label="LTE decode pipeline">
            <span>Decode pipeline</span>
            <div>
              {model.decodePipeline.map((stage) => (
                <article className={`is-${stage.status}`} key={stage.label}>
                  <strong>{stage.label}</strong>
                  <small>{stage.value}</small>
                </article>
              ))}
            </div>
          </div>
          {model.decodeFacts.length > 0 ? (
            <div className="lte-decode-grid">
              {model.decodeFacts.map((fact) => (
                <LteMetric key={fact.label} label={fact.label} value={fact.value} />
              ))}
            </div>
          ) : (
            <p className="lte-empty">No decode status has been submitted yet.</p>
          )}
        </section>

        <section className="lte-panel" aria-label="Cellular graph nodes">
          <PanelHeader eyebrow="Graph" title="Cellular Nodes" />
          <div className="lte-node-list">
            {model.cellularGraphNodes.map((node) => (
              <article key={node.id}>
                <strong>{node.label}</strong>
                <span>{[node.source, node.protocol, node.kind].filter(Boolean).join(" / ") || "cellular"}</span>
              </article>
            ))}
            {model.cellularGraphNodes.length === 0 ? <p className="lte-empty">No cellular graph nodes yet.</p> : null}
          </div>
        </section>

        <section className="lte-panel" aria-label="LTE RF map count">
          <PanelHeader eyebrow="RF Map" title="Cellular Map Footprint" />
          <div className="lte-big-number">
            <strong>{model.rfMapCellularCount}</strong>
            <span>LTE/cellular RF map records</span>
          </div>
        </section>
      </section>

      <details className="lte-panel lte-raw-panel" aria-label="LTESniffer current state rows" open>
        <summary className="lte-raw-panel-summary">
          <span>Source payloads</span>
          <strong>Raw Current State</strong>
          <small>{model.rawRows.length} rows</small>
          <button
            type="button"
            aria-label="Refresh raw LTE state"
            disabled={state.refreshingRawState}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void loadLteCore(true);
            }}
          >
            {state.refreshingRawState ? "Refreshing..." : "Refresh"}
          </button>
        </summary>
        <div className="lte-state-table">
          <div className="lte-state-table-head">
            <span>Kind</span>
            <span>Identity</span>
            <span>Mode</span>
            <span>Evidence</span>
            <span>Seen</span>
            <span>Updated</span>
          </div>
          {model.rawRows.map((row, index) => (
            <div className="lte-state-row" key={row.state_key}>
              <div className="lte-state-row-main">
                <span>{row.kind}</span>
                <strong>{row.identity_hint ?? row.state_key}</strong>
                <span>{String(row.metadata.mode ?? "unknown")}</span>
                <span>{stateEvidence(row)}</span>
                <span>{row.seen_count} seen</span>
                <span>{formatTime(row.last_seen_at)}</span>
              </div>
              <RawOutputDetails row={row} openByDefault={index === 0} />
            </div>
          ))}
          {model.rawRows.length === 0 ? <p className="lte-empty">No LTESniffer rows are in current state.</p> : null}
        </div>
      </details>
    </main>
  );
}

function RawOutputDetails({ row, openByDefault = false }: { row: CurrentStateItem; openByDefault?: boolean }) {
  const rawOutput = rawOutputForRow(row);
  if (!rawOutput) {
    return <p className="lte-raw-output-empty">No raw collector output captured for this row yet.</p>;
  }
  return (
    <details className="lte-raw-output" open={openByDefault}>
      <summary>Raw output</summary>
      <pre>{rawOutput}</pre>
    </details>
  );
}

function LteRuntimePanel({ runtime, awaiting, refreshing, onRefresh }: { runtime: LteRuntimeState | null; awaiting: boolean; refreshing: boolean; onRefresh: () => void }) {
  if (!awaiting && (!runtime || !runtime.status || runtime.status === "idle")) {
    return null;
  }
  const status = runtime?.status ?? "waiting";
  const summary = runtimeSummary(runtime);
  const rawOutput = runtime?.raw_output_tail?.trim() ?? "";
  return (
    <section className={`lte-runtime is-${runtime?.active ? "active" : status}`} aria-label="LTESniffer live runtime output">
      <div className="lte-runtime-header">
        <div>
          <span>Live collector output</span>
          <strong>{statusLabel(status, runtime?.active ?? awaiting)}</strong>
        </div>
        <button type="button" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <div className="lte-runtime-facts">
        <LteMetric label="Mode" value={runtime?.mode ?? "waiting"} />
        <LteMetric label="Elapsed" value={elapsedRuntime(runtime)} />
        <LteMetric label="Cells" value={summary.cells} />
        <LteMetric label="Frames" value={summary.frames} />
        <LteMetric label="RNTIs" value={summary.rntis} />
        <LteMetric label="Updated" value={formatTime(runtime?.updated_at)} />
      </div>
      {runtime?.command_text ? <p className="lte-command">{runtime.command_text}</p> : null}
      {runtime?.error ? <p className="lte-settings-error">{runtime.error}</p> : null}
      <details className="lte-raw-output" open={Boolean(rawOutput)}>
        <summary>Live raw output</summary>
        {rawOutput ? <pre>{rawOutput}</pre> : <p className="lte-raw-output-empty">Waiting for LTESniffer stdout.</p>}
      </details>
    </section>
  );
}

function PanelHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="presence-panel-header">
      <div>
        <p>{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function LteMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="lte-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function LteInput({ label, value, help, optional, onChange }: { label: string; value: string; help?: string; optional?: boolean; onChange: (value: string) => void }) {
  return (
    <label>
      <LteFieldLabel label={label} help={help} optional={optional} />
      <input aria-label={`LTE ${label}`} inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LteFieldLabel({ label, help, optional }: { label: string; help?: string; optional?: boolean }) {
  return (
    <span className="lte-field-label">
      <span title={help}>{label}</span>
      {optional ? <b>optional</b> : null}
    </span>
  );
}

function lteDesiredRangeSummary(settings: LteSettings) {
  const sameCarrier = settings.dl_freq_hz !== null && settings.ul_freq_hz !== null && settings.dl_freq_hz === settings.ul_freq_hz;
  const tunedCenter = sameCarrier
    ? formatLteFrequency(settings.dl_freq_hz)
    : `DL ${formatLteFrequency(settings.dl_freq_hz)} / UL ${formatLteFrequency(settings.ul_freq_hz)}`;
  if (settings.profile === "custom") {
    return {
      allowedRange: customRangeText(settings),
      tunedCenter,
      profile: "Custom",
      readiness: lteReadiness(settings)
    };
  }
  return {
    allowedRange: "3550-3700 MHz",
    tunedCenter,
    profile: "Band 48 CBRS TDD",
    readiness: lteReadiness(settings)
  };
}

function lteReadiness(settings: LteSettings): string {
  if (!settings.enabled || settings.mode === "probe") {
    return "Probe only";
  }
  if (settings.mode === "downlink" && settings.dl_freq_hz !== null) {
    return "Live decode ready";
  }
  if ((settings.mode === "uplink" || settings.mode === "both") && settings.dl_freq_hz !== null && settings.ul_freq_hz !== null) {
    return "Live decode ready";
  }
  if (settings.profile === "custom" && customScanRangeReady(settings)) {
    return "Scan ready";
  }
  return "Needs tuned carrier";
}

function customScanRangeReady(settings: LteSettings): boolean {
  if (settings.mode === "downlink") {
    return hasFrequencyOrRange(settings, "dl");
  }
  if (settings.mode === "uplink" || settings.mode === "both") {
    return hasFrequencyOrRange(settings, "dl") && hasFrequencyOrRange(settings, "ul");
  }
  return false;
}

function hasFrequencyOrRange(settings: LteSettings, prefix: "dl" | "ul"): boolean {
  if (prefix === "dl") {
    return settings.dl_freq_hz !== null || settings.dl_freq_min_hz !== null || settings.dl_freq_max_hz !== null;
  }
  return settings.ul_freq_hz !== null || settings.ul_freq_min_hz !== null || settings.ul_freq_max_hz !== null;
}

function customRangeText(settings: LteSettings): string {
  const dlRange = formatRange(settings.dl_freq_min_hz, settings.dl_freq_max_hz);
  const ulRange = formatRange(settings.ul_freq_min_hz, settings.ul_freq_max_hz);
  if (dlRange && ulRange) {
    return `DL ${dlRange} / UL ${ulRange}`;
  }
  return dlRange || ulRange || "Custom / not enforced";
}

function formatRange(minHz: number | null, maxHz: number | null): string {
  if (minHz !== null && maxHz !== null) {
    return `${formatLteFrequency(minHz)}-${formatLteFrequency(maxHz)}`;
  }
  if (minHz !== null) {
    return `>= ${formatLteFrequency(minHz)}`;
  }
  if (maxHz !== null) {
    return `<= ${formatLteFrequency(maxHz)}`;
  }
  return "";
}

function lteProfileGuidance(form: LteSettingsForm, backendWarnings: string[]) {
  const dl = nullableNumber(form.dl_freq_hz);
  const ul = nullableNumber(form.ul_freq_hz);
  const prb = nullableNumber(form.prb);
  const warnings = [...backendWarnings];
  const dlEarfcn = band48Earfcn(dl);
  const ulEarfcn = band48Earfcn(ul);
  const bandwidth = prb === null ? "bandwidth not set" : PRB_BANDWIDTH[prb] ?? `${prb} PRB`;

  if (form.profile === "custom") {
    if (warnings.length === 0) {
      warnings.push(customScanFormReady(form) ? "Custom scan ranges are configured. Scan first, then select a detected carrier before live decode." : "Custom / advanced allows out-of-range values. Verify RF authorization and matching cell parameters before live decode.");
    }
    return {
      summary: customScanFormReady(form) ? "Custom scan ranges configured" : "Custom / advanced allows out-of-range values",
      detail: `DL ${formatEarfcn(dlEarfcn)} / UL ${formatEarfcn(ulEarfcn)} / ${bandwidth}`,
      warnings
    };
  }

  if (isOutsideBand48(dl)) {
    warnings.push("DL frequency is outside Band 48 / CBRS 3550000000-3700000000 Hz.");
  }
  if (isOutsideBand48(ul)) {
    warnings.push("UL frequency is outside Band 48 / CBRS 3550000000-3700000000 Hz.");
  }
  if (form.enabled && form.mode !== "probe" && dl !== null && ul !== null && dl !== ul) {
    warnings.push("Band 48 CBRS TDD uses one shared RF carrier, so DL and UL should match.");
  }

  return {
    summary: "Band 48 CBRS TDD validates 3550-3700 MHz",
    detail: `DL ${formatEarfcn(dlEarfcn)} / UL ${formatEarfcn(ulEarfcn)} / ${bandwidth}`,
    warnings
  };
}

function customScanFormReady(form: LteSettingsForm): boolean {
  const mode = form.mode;
  const dl = nullableNumber(form.dl_freq_hz);
  const ul = nullableNumber(form.ul_freq_hz);
  const hasDlRange = dl !== null || nullableNumber(form.dl_freq_min_hz) !== null || nullableNumber(form.dl_freq_max_hz) !== null;
  const hasUlRange = ul !== null || nullableNumber(form.ul_freq_min_hz) !== null || nullableNumber(form.ul_freq_max_hz) !== null;
  if (mode === "downlink") {
    return dl === null && hasDlRange;
  }
  if (mode === "uplink" || mode === "both") {
    return (dl === null || ul === null) && hasDlRange && hasUlRange;
  }
  return false;
}

function band48Earfcn(frequencyHz: number | null): number | null {
  if (frequencyHz === null || isOutsideBand48(frequencyHz)) {
    return null;
  }
  return Math.round((frequencyHz - BAND48_FREQ_LOW_HZ) / 100000) + BAND48_EARFCN_OFFSET;
}

function formatEarfcn(value: number | null): string {
  return value === null ? "EARFCN not set" : `EARFCN ${value}`;
}

function isOutsideBand48(value: number | null): boolean {
  return value !== null && (value < BAND48_MIN_HZ || value > BAND48_MAX_HZ);
}

function formatTime(value: string | null | undefined): string {
  if (!value) {
    return "not seen";
  }
  return new Date(value).toLocaleString();
}

function collectorOutputHasArrived(rows: CurrentStateItem[], awaitingSince: string | null): boolean {
  if (!awaitingSince) {
    return false;
  }
  const awaitingTime = Date.parse(awaitingSince);
  if (!Number.isFinite(awaitingTime)) {
    return false;
  }
  return rows.some((row) => {
    const lastSeen = Date.parse(row.last_seen_at ?? "");
    return Number.isFinite(lastSeen) && lastSeen >= awaitingTime;
  });
}

function runtimeHasProgress(runtime: LteRuntimeState | null, awaitingSince: string | null): boolean {
  if (!runtime || !awaitingSince) {
    return false;
  }
  const awaitingTime = Date.parse(awaitingSince);
  const updatedTime = Date.parse(runtime.updated_at ?? "");
  return Number.isFinite(awaitingTime) && Number.isFinite(updatedTime) && updatedTime >= awaitingTime;
}

function statusLabel(status: string, active: boolean): string {
  if (active) {
    return "Running now";
  }
  if (status === "idle") {
    return "Idle";
  }
  if (status === "timeout") {
    return "Capture window ended";
  }
  if (status === "complete") {
    return "Last pass complete";
  }
  if (status === "error" || status === "unreadable") {
    return "Needs attention";
  }
  return status;
}

function elapsedRuntime(runtime: LteRuntimeState | null): string {
  if (!runtime) {
    return "waiting";
  }
  const elapsed = typeof runtime.elapsed_seconds === "number" ? runtime.elapsed_seconds : null;
  const total = typeof runtime.run_seconds === "number" ? runtime.run_seconds : null;
  if (elapsed === null && total === null) {
    return "not reported";
  }
  if (elapsed !== null && total !== null) {
    return `${Math.round(elapsed)} / ${total}s`;
  }
  return elapsed !== null ? `${Math.round(elapsed)}s` : `${total}s window`;
}

function runtimeSummary(runtime: LteRuntimeState | null): { cells: string; frames: string; rntis: string } {
  const summary = runtime?.summary ?? {};
  const cellCount = numberValue(summary.cell_search_detected_count) ?? arrayLength(summary.carrier_candidates) ?? arrayLength(summary.cell_search_results);
  const processed = numberValue(summary.processed_subframes);
  const expected = numberValue(summary.expected_subframes);
  const rntiCount = numberValue(summary.rnti_count) ?? arrayLength(summary.rnti_activity);
  return {
    cells: cellCount === null ? "none yet" : String(cellCount),
    frames: processed === null ? "none yet" : `${processed}${expected !== null ? ` / ${expected}` : ""}`,
    rntis: rntiCount === null ? "none yet" : String(rntiCount)
  };
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function rawOutputForRow(row: CurrentStateItem): string {
  const chunks: string[] = [];
  const seen = new Set<string>();
  const addText = (label: string, value: unknown) => {
    const text = rawTextValue(value);
    if (!text || seen.has(`${label}:${text}`)) {
      return;
    }
    seen.add(`${label}:${text}`);
    chunks.push(label ? `${label}\n${text}` : text);
  };

  addPayloadTexts("", row.metadata);
  addPayloadTexts("", row.raw_payload);

  const summary = recordValue(row.raw_payload.summary);
  addPayloadTexts("summary", summary);

  const components = recordValue(row.raw_payload.components);
  for (const [mode, component] of Object.entries(components)) {
    addPayloadTexts(`${mode} component`, recordValue(component));
  }

  const scanAttempts = arrayValue(firstRawValue(row.raw_payload.scan_attempts, summary.scan_attempts));
  scanAttempts.forEach((attempt, index) => {
    const payload = recordValue(attempt);
    addText(scanAttemptLabel(payload, index), payload.output_tail);
  });

  return chunks.join("\n\n");

  function addPayloadTexts(label: string, payload: Record<string, unknown>) {
    for (const key of ["raw_output", "raw_output_tail", "output", "output_tail", "probe_output"]) {
      addText(label, payload[key]);
    }
  }
}

function scanAttemptLabel(payload: Record<string, unknown>, index: number): string {
  const dl = typeof payload.dl_freq_hz === "number" ? formatLteFrequency(payload.dl_freq_hz) : `attempt ${index + 1}`;
  return `scan ${dl}`;
}

function rawTextValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function firstRawValue(...values: unknown[]): unknown {
  return values.find((value) => value !== null && value !== undefined);
}

function formatScanRange(minHz: number | null, maxHz: number | null): string {
  if (minHz === null || maxHz === null) {
    return "range not reported";
  }
  if (minHz === maxHz) {
    return formatLteFrequency(minHz);
  }
  return `${formatLteFrequency(minHz)} - ${formatLteFrequency(maxHz)}`;
}

function stateEvidence(row: CurrentStateItem): string {
  const metadata = row.metadata ?? {};
  const probeMode = typeof metadata.probe_mode === "string" ? metadata.probe_mode : "";
  const attempts = typeof metadata.scan_attempt_count === "number" ? `${metadata.scan_attempt_count} attempts` : "";
  const candidates = typeof metadata.carrier_candidate_count === "number" ? `${metadata.carrier_candidate_count} candidates` : "";
  return [probeMode, attempts, candidates].filter(Boolean).join(" / ") || "status";
}

function formFromSettings(settings: Partial<LteSettings>): LteSettingsForm {
  const merged = { ...DEFAULT_LTE_SETTINGS, ...settings };
  return {
    enabled: Boolean(merged.enabled),
    profile: merged.profile ?? "band48_cbrs_tdd",
    mode: merged.mode ?? "probe",
    dl_freq_hz: frequencyTextValue(merged.dl_freq_hz),
    ul_freq_hz: frequencyTextValue(merged.ul_freq_hz),
    dl_freq_min_hz: frequencyTextValue(merged.dl_freq_min_hz),
    dl_freq_max_hz: frequencyTextValue(merged.dl_freq_max_hz),
    ul_freq_min_hz: frequencyTextValue(merged.ul_freq_min_hz),
    ul_freq_max_hz: frequencyTextValue(merged.ul_freq_max_hz),
    cell_id: textValue(merged.cell_id),
    prb: textValue(merged.prb),
    api_mode: textValue(merged.api_mode),
    antennas: textValue(merged.antennas),
    workers: textValue(merged.workers),
    run_seconds: textValue(merged.run_seconds),
    uhd_args: merged.uhd_args || DEFAULT_LTE_SETTINGS.uhd_args,
    workdir: merged.workdir || DEFAULT_LTE_SETTINGS.workdir,
    unmask_identities: Boolean(merged.unmask_identities),
    suppress_stderr: merged.suppress_stderr !== false
  };
}

function payloadFromForm(form: LteSettingsForm): LteSettingsUpdate {
  return {
    enabled: form.enabled,
    profile: form.profile,
    mode: form.mode,
    dl_freq_hz: nullableFrequencyHz(form.dl_freq_hz),
    ul_freq_hz: nullableFrequencyHz(form.ul_freq_hz),
    dl_freq_min_hz: nullableFrequencyHz(form.dl_freq_min_hz),
    dl_freq_max_hz: nullableFrequencyHz(form.dl_freq_max_hz),
    ul_freq_min_hz: nullableFrequencyHz(form.ul_freq_min_hz),
    ul_freq_max_hz: nullableFrequencyHz(form.ul_freq_max_hz),
    cell_id: nullableNumber(form.cell_id),
    prb: nullableNumber(form.prb),
    api_mode: nullableNumber(form.api_mode),
    antennas: nullableNumber(form.antennas) ?? DEFAULT_LTE_SETTINGS.antennas,
    workers: nullableNumber(form.workers) ?? DEFAULT_LTE_SETTINGS.workers,
    run_seconds: nullableNumber(form.run_seconds) ?? DEFAULT_LTE_SETTINGS.run_seconds,
    uhd_args: form.uhd_args.trim() || DEFAULT_LTE_SETTINGS.uhd_args,
    workdir: form.workdir.trim() || DEFAULT_LTE_SETTINGS.workdir,
    unmask_identities: form.unmask_identities,
    suppress_stderr: form.suppress_stderr
  };
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableFrequencyHz(value: string): number | null {
  const parsed = nullableNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

function textValue(value: string | number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function frequencyTextValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Number.isInteger(value) && value >= 1000000 && value % 1000000 === 0) {
    return `${value / 1000000}e6`;
  }
  return String(value);
}
