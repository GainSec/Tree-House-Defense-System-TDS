import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  enterableSessionModes,
  preferredSessionMode,
  probeXRCapabilities,
  resolveXRRuntimeState,
  describeProbe,
  type XRCapabilityProbe,
  type XRRuntimeState
} from "./capability";
import { xrLog } from "./xrLog";

export interface XRCapabilityValue {
  probe: XRCapabilityProbe | null;
  runtimeState: XRRuntimeState;
  preferredMode: XRSessionMode | null;
  enterableModes: XRSessionMode[];
  forceSimulator: boolean;
  emulated: boolean;
  reprobe: () => void;
}

const XRCapabilityContext = createContext<XRCapabilityValue | null>(null);

/**
 * Probes WebXR once on mount (and on demand) and exposes the explicit runtime
 * state. Children always render: the desktop simulator is the fallback.
 */
export function XRCapabilityGate({ children, forceSimulator, emulated }: { children: ReactNode; forceSimulator: boolean; emulated: boolean }) {
  const [probe, setProbe] = useState<XRCapabilityProbe | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let cancelled = false;
    probeXRCapabilities({ emulated })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setProbe(result);
        const state = resolveXRRuntimeState(result, { forceSimulator });
        xrLog("info", `capability: ${state} — ${describeProbe(result).join("; ")}`, result);
      })
      .catch((error) => {
        xrLog("error", `capability probe failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [emulated, forceSimulator, generation]);

  useEffect(() => {
    const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
    if (!xr) {
      return;
    }
    const onDeviceChange = () => {
      xrLog("info", "navigator.xr devicechange — re-probing");
      setGeneration((value) => value + 1);
    };
    xr.addEventListener("devicechange", onDeviceChange);
    return () => xr.removeEventListener("devicechange", onDeviceChange);
  }, []);

  const value = useMemo<XRCapabilityValue>(() => {
    const runtimeState = resolveXRRuntimeState(probe, { forceSimulator });
    return {
      probe,
      runtimeState,
      preferredMode: forceSimulator ? null : preferredSessionMode(runtimeState, probe),
      enterableModes: enterableSessionModes(probe, { forceSimulator }),
      forceSimulator,
      emulated,
      reprobe: () => setGeneration((current) => current + 1)
    };
  }, [emulated, forceSimulator, probe]);

  return <XRCapabilityContext.Provider value={value}>{children}</XRCapabilityContext.Provider>;
}

export function useXRCapability(): XRCapabilityValue {
  const value = useContext(XRCapabilityContext);
  if (!value) {
    throw new Error("useXRCapability must be used inside <XRCapabilityGate>");
  }
  return value;
}
