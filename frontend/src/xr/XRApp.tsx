import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { XR, createXRStore, useXR } from "@react-three/xr";
import { DashboardStateProvider, useDashboardState } from "../state/DashboardStateProvider";
import { backendBaseUrl, backendBaseUrlLabel } from "../data/backendConfig";
import { XRCapabilityGate, useXRCapability } from "./XRCapabilityGate";
import { XRViewStateProvider } from "./XRViewState";
import { TdsXRExperience } from "./TdsXRExperience";
import { buildXRStoreOptions } from "./XRSelectionRay";
import { SIMULATOR_EYE_HEIGHT, SIMULATOR_KEY_HELP } from "./DesktopXRSimulator";
import { describeProbe, resolvePassthroughStatus } from "./capability";
import { xrLog } from "./xrLog";
import { startXRLogShipper } from "./xrLogShipper";
import "./xr.css";
import { Line } from "three";

// Wireframes (grid, house, rings, placement ghost) are never pointer targets. three.js hits a line
// anywhere within Raycaster.params.Line.threshold (1 world unit by default) of the ray, so under any
// ancestor with a handler they swallowed controller presses aimed at the cards behind them.
(Line.prototype as Line & { pointerEvents?: string }).pointerEvents = "none";

/**
 * `/vr` (aliases `/mr`, `/xr`): mixed-reality floating board.
 *
 * Query parameters:
 *   ?simulator=1        force the desktop simulator even if WebXR is available
 *   ?emulate=1          dev server only: inject the IWER Quest 3 emulator (labelled EMULATED; never hardware evidence)
 *   ?backend=<url>      TDS backend base URL (persisted; ?backend=same-origin clears)
 */
export default function XRApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const forceSimulator = params.get("simulator") === "1";
  // The emulator is stripped from production builds (see vite.config.ts).
  const emulate = import.meta.env.DEV && params.get("emulate") === "1";

  useEffect(() => startXRLogShipper(), []);

  useEffect(() => {
    const resolution = backendBaseUrl();
    xrLog("info", `XR page loaded (build ${__TDS_BUILD__}, ${navigator.userAgent}); backend ${backendBaseUrlLabel(resolution)}${resolution.invalid ? ` (ignored invalid ?backend=${resolution.invalid})` : ""}`);
    if (!window.isSecureContext) {
      xrLog("warn", "page is not a secure context: browsers expose WebXR only over HTTPS or localhost");
    }
  }, []);

  return (
    <DashboardStateProvider>
      <XRCapabilityGate forceSimulator={forceSimulator} emulated={emulate}>
        <XRViewStateProvider defaultBudget="standalone">
          <XRShell emulate={emulate} />
        </XRViewStateProvider>
      </XRCapabilityGate>
    </DashboardStateProvider>
  );
}

function XRShell({ emulate }: { emulate: boolean }) {
  const store = useMemo(() => {
    const assetBase = new URL(`${import.meta.env.BASE_URL}xr-input-profiles/`, window.location.origin).href;
    const created = createXRStore(buildXRStoreOptions({ emulate, assetBase }));
    created.onSessionEnd(() => xrLog("info", "XR session ended (user, browser or runtime)"));
    return created;
  }, [emulate]);
  useEffect(() => () => store.destroy(), [store]);
  const { reprobe } = useXRCapability();
  useEffect(() => {
    if (!emulate) {
      return;
    }
    // The emulator injects navigator.xr asynchronously after the store is created, after the first probe ran.
    return store.subscribe((state, previous) => {
      if (state.emulator && !previous.emulator) {
        xrLog("warn", "IWER emulator injected: all XR results on this page are EMULATED, not hardware");
        reprobe();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emulate, store]);

  return (
    <main className="xr-shell" data-testid="tds-xr-board">
      <Canvas
        className="xr-canvas"
        raycaster={{ params: { Line: { threshold: 0.002 }, Points: { threshold: 0.002 }, Mesh: {}, LOD: {}, Sprite: {} } }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, 1.75]}
        camera={{ position: [0, SIMULATOR_EYE_HEIGHT, 0.15], fov: 70, near: 0.05, far: 400 }}
      >
        <XR store={store}>
          <TdsXRExperience />
          <SessionBridge />
        </XR>
      </Canvas>
      <XROverlay store={store} />
    </main>
  );
}

/** Mirrors session presence to the DOM so the overlay can hide itself while presenting. */
function SessionBridge() {
  const session = useXR((state) => state.session);
  useEffect(() => {
    document.body.dataset.xrSession = session ? "active" : "none";
  }, [session]);
  return null;
}

function XROverlay({ store }: { store: ReturnType<typeof createXRStore> }) {
  const capability = useXRCapability();
  const { provenance, dashboardData } = useDashboardState();
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const passthrough = resolvePassthroughStatus({ runtimeState: capability.runtimeState, probe: capability.probe, sessionMode: null, environmentBlendMode: null });

  const enter = async (mode: XRSessionMode) => {
    setError(null);
    xrLog("info", `requesting ${mode} session`);
    try {
      const session = await store.enterXR(mode);
      if (!session) {
        throw new Error("runtime returned no session");
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      xrLog("error", `${mode} session request failed: ${message}`);
      setError(`${mode} failed: ${message}`);
    }
  };

  return (
    <aside className="xr-overlay" aria-label="XR controls">
      <header className="xr-overlay-header">
        <strong>TDS · MR board</strong>
        <a href={window.location.pathname.startsWith("/static") ? "/static/" : "/"}>Desktop dashboard</a>
      </header>
      <dl className="xr-overlay-status">
        <div>
          <dt>Runtime</dt>
          <dd data-testid="xr-runtime-state">{capability.runtimeState}</dd>
        </div>
        <div>
          <dt>Passthrough</dt>
          <dd data-testid="xr-passthrough">{passthrough.label}</dd>
        </div>
        <div>
          <dt>Data</dt>
          <dd data-testid="xr-provenance" className={`tone-${provenance.tone}`}>
            {provenance.headline}
          </dd>
        </div>
        <div>
          <dt>Build</dt>
          <dd data-testid="xr-build">{__TDS_BUILD__}</dd>
        </div>
        <div>
          <dt>Backend</dt>
          <dd>
            {provenance.backend} · {backendBaseUrlLabel()}
          </dd>
        </div>
      </dl>
      <p className="xr-overlay-detail">{passthrough.detail}</p>
      <p className="xr-overlay-detail">{provenance.detail}</p>
      {dashboardData.error ? <p className="xr-overlay-error">{dashboardData.error}</p> : null}
      <div className="xr-overlay-actions">
        {capability.enterableModes.includes("immersive-ar") ? (
          <button type="button" className="is-primary" onClick={() => void enter("immersive-ar")}>
            Enter MR (passthrough)
          </button>
        ) : null}
        {capability.enterableModes.includes("immersive-vr") ? (
          <button type="button" className={capability.enterableModes.includes("immersive-ar") ? "" : "is-primary"} onClick={() => void enter("immersive-vr")}>
            Enter VR (no passthrough)
          </button>
        ) : null}
        {capability.enterableModes.length === 0 ? (
          <span className="xr-overlay-note">{capability.runtimeState === "checking" ? "Checking WebXR…" : "No immersive session available — using the desktop simulator."}</span>
        ) : null}
      </div>
      {error ? <p className="xr-overlay-error">{error}</p> : null}
      <details className="xr-overlay-probe">
        <summary>WebXR probe</summary>
        <ul>
          {describeProbe(capability.probe).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
      <details className="xr-overlay-help" open={helpOpen} onToggle={(event) => setHelpOpen((event.target as HTMLDetailsElement).open)}>
        <summary>Simulator controls</summary>
        <dl>
          {SIMULATOR_KEY_HELP.map(([key, action]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{action}</dd>
            </div>
          ))}
        </dl>
      </details>
    </aside>
  );
}
