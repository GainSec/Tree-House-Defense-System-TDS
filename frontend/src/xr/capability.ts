/**
 * WebXR capability detection and honest passthrough reporting.
 *
 * Nothing here assumes Steam Frame (or any device) supports passthrough. The
 * only evidence accepted is what the active browser runtime reports:
 * `navigator.xr`, `isSessionSupported(...)`, and the live session's
 * `environmentBlendMode`.
 */

export type SessionSupport = "supported" | "unsupported" | "error" | "not-checked";

export interface XRCapabilityProbe {
  hasNavigatorXR: boolean;
  secureContext: boolean;
  immersiveAr: SessionSupport;
  immersiveVr: SessionSupport;
  arError: string | null;
  vrError: string | null;
  /** True when an emulator (IWER) injected navigator.xr. Never counts as hardware. */
  emulated: boolean;
  userAgent: string;
  checkedAt: string;
}

export type XRRuntimeState = "checking" | "immersive-ar available" | "immersive-vr only" | "WebXR unavailable" | "desktop simulator";

export type XRPresentationMode = "desktop-simulator" | "immersive-ar" | "immersive-vr";

export interface XRRuntimeOptions {
  /** `?simulator=1`: ignore any real runtime and stay in the desktop simulator. */
  forceSimulator?: boolean;
}

export function resolveXRRuntimeState(probe: XRCapabilityProbe | null, { forceSimulator = false }: XRRuntimeOptions = {}): XRRuntimeState {
  if (forceSimulator) {
    return "desktop simulator";
  }
  if (!probe) {
    return "checking";
  }
  if (probe.emulated) {
    return "desktop simulator";
  }
  if (!probe.hasNavigatorXR) {
    return "WebXR unavailable";
  }
  if (probe.immersiveAr === "supported") {
    return "immersive-ar available";
  }
  if (probe.immersiveVr === "supported") {
    return "immersive-vr only";
  }
  return "WebXR unavailable";
}

/** Which immersive session the primary "Enter" button should request, if any. */
export function preferredSessionMode(state: XRRuntimeState, probe: XRCapabilityProbe | null): XRSessionMode | null {
  if (state === "immersive-ar available") {
    return "immersive-ar";
  }
  if (state === "immersive-vr only") {
    return "immersive-vr";
  }
  if (state === "desktop simulator" && probe?.emulated) {
    return probe.immersiveAr === "supported" ? "immersive-ar" : probe.immersiveVr === "supported" ? "immersive-vr" : null;
  }
  return null;
}

export function enterableSessionModes(probe: XRCapabilityProbe | null, options: XRRuntimeOptions = {}): XRSessionMode[] {
  if (!probe || options.forceSimulator) {
    return [];
  }
  const modes: XRSessionMode[] = [];
  if (probe.immersiveAr === "supported") {
    modes.push("immersive-ar");
  }
  if (probe.immersiveVr === "supported") {
    modes.push("immersive-vr");
  }
  return modes;
}

export type PassthroughVerdict = "runtime-reports-passthrough" | "unavailable" | "not-active" | "unverified" | "emulated";

export interface PassthroughStatus {
  verdict: PassthroughVerdict;
  label: string;
  detail: string;
}

export interface PassthroughInput {
  runtimeState: XRRuntimeState;
  probe: XRCapabilityProbe | null;
  sessionMode: XRSessionMode | null;
  environmentBlendMode: XREnvironmentBlendMode | null;
}

export function resolvePassthroughStatus({ runtimeState, probe, sessionMode, environmentBlendMode }: PassthroughInput): PassthroughStatus {
  if (probe?.emulated) {
    return {
      verdict: "emulated",
      label: "EMULATED",
      detail: "IWER emulator injected navigator.xr. Nothing here reflects headset hardware."
    };
  }
  if (sessionMode === "immersive-ar") {
    if (environmentBlendMode === "alpha-blend" || environmentBlendMode === "additive") {
      return {
        verdict: "runtime-reports-passthrough",
        label: `PASSTHROUGH (${environmentBlendMode})`,
        detail: `Runtime reports environmentBlendMode="${environmentBlendMode}". Confirm visually on the headset before relying on it.`
      };
    }
    return {
      verdict: "not-active",
      label: "AR SESSION · OPAQUE",
      detail: `immersive-ar session granted but environmentBlendMode="${environmentBlendMode ?? "unreported"}". Passthrough is NOT confirmed.`
    };
  }
  if (sessionMode === "immersive-vr") {
    return {
      verdict: "unavailable",
      label: "NO PASSTHROUGH (VR)",
      detail:
        runtimeState === "immersive-ar available"
          ? "Running immersive-vr by choice; immersive-ar is reported as supported but not in use."
          : "Passthrough is unavailable in the active runtime: only immersive-vr is supported."
    };
  }
  switch (runtimeState) {
    case "immersive-ar available":
      return {
        verdict: "unverified",
        label: "AR REPORTED · UNVERIFIED",
        detail: 'isSessionSupported("immersive-ar") returned true. Passthrough is unverified until a session reports alpha-blend.'
      };
    case "immersive-vr only":
      return {
        verdict: "unavailable",
        label: "PASSTHROUGH UNAVAILABLE",
        detail: "Active runtime supports immersive-vr only. The board will render in a neutral VR environment."
      };
    case "WebXR unavailable":
      return {
        verdict: "unavailable",
        label: "WEBXR UNAVAILABLE",
        detail: probe && !probe.secureContext ? "WebXR requires a secure context (HTTPS or localhost)." : "navigator.xr is missing or reports no immersive modes."
      };
    case "desktop simulator":
      return { verdict: "unavailable", label: "SIMULATOR", detail: "Desktop simulator: no passthrough, no headset." };
    default:
      return { verdict: "unverified", label: "CHECKING", detail: "Probing WebXR support." };
  }
}

/** Probe the browser. Separate AR and VR checks; failures are recorded, not thrown. */
export async function probeXRCapabilities({ emulated = false }: { emulated?: boolean } = {}): Promise<XRCapabilityProbe> {
  const xr = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { xr?: XRSystem }).xr;
  const base = {
    hasNavigatorXR: Boolean(xr),
    secureContext: typeof window === "undefined" ? false : window.isSecureContext,
    emulated,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    checkedAt: new Date().toISOString()
  };
  if (!xr) {
    return { ...base, immersiveAr: "not-checked", immersiveVr: "not-checked", arError: null, vrError: null };
  }
  const [ar, vr] = await Promise.all([checkMode(xr, "immersive-ar"), checkMode(xr, "immersive-vr")]);
  return { ...base, immersiveAr: ar.support, immersiveVr: vr.support, arError: ar.error, vrError: vr.error };
}

async function checkMode(xr: XRSystem, mode: XRSessionMode): Promise<{ support: SessionSupport; error: string | null }> {
  try {
    const supported = await xr.isSessionSupported(mode);
    return { support: supported ? "supported" : "unsupported", error: null };
  } catch (error) {
    return { support: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

export function describeProbe(probe: XRCapabilityProbe | null): string[] {
  if (!probe) {
    return ["probe pending"];
  }
  return [
    `navigator.xr: ${probe.hasNavigatorXR ? "present" : "missing"}`,
    `secure context: ${probe.secureContext ? "yes" : "NO"}`,
    `immersive-ar: ${probe.immersiveAr}${probe.arError ? ` (${probe.arError})` : ""}`,
    `immersive-vr: ${probe.immersiveVr}${probe.vrError ? ` (${probe.vrError})` : ""}`,
    ...(probe.emulated ? ["emulator: IWER (not hardware)"] : [])
  ];
}
