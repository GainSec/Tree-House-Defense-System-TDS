import { useEffect, useState } from "react";
import { useXR } from "@react-three/xr";
import { msSinceXRInteraction, xrLog } from "./xrLog";

export interface XRSessionTelemetry {
  session: XRSession | null;
  mode: XRSessionMode | null;
  environmentBlendMode: XREnvironmentBlendMode | null;
  visibilityState: XRVisibilityState | null;
  frameRate: number | null;
  supportedFrameRates: number[];
  inputProfiles: string[];
  enabledFeatures: string[];
  /** Raw WebXR input event counts, e.g. { "select:right": 3 }. Zero counts while pressing = input not reaching the page. */
  inputCounts: Record<string, number>;
}

const EMPTY: XRSessionTelemetry = {
  session: null,
  mode: null,
  environmentBlendMode: null,
  visibilityState: null,
  frameRate: null,
  supportedFrameRates: [],
  inputProfiles: [],
  enabledFeatures: [],
  inputCounts: {}
};

/**
 * Records what the runtime actually reports for the active session. This is the
 * evidence used for the hardware-validation checklist — nothing is assumed.
 */
export function useXRSessionTelemetry(): XRSessionTelemetry {
  const session = useXR((state) => state.session) ?? null;
  const mode = useXR((state) => state.mode) ?? null;
  const [telemetry, setTelemetry] = useState<XRSessionTelemetry>(EMPTY);

  useEffect(() => {
    if (!session) {
      setTelemetry(EMPTY);
      return;
    }
    const counts: Record<string, number> = {};
    const read = (): XRSessionTelemetry => {
      const extended = session as XRSession & { frameRate?: number; supportedFrameRates?: Float32Array; enabledFeatures?: string[] };
      return {
        inputCounts: counts,
        session,
        mode,
        environmentBlendMode: session.environmentBlendMode ?? null,
        visibilityState: session.visibilityState ?? null,
        frameRate: typeof extended.frameRate === "number" ? extended.frameRate : null,
        supportedFrameRates: extended.supportedFrameRates ? Array.from(extended.supportedFrameRates) : [],
        inputProfiles: Array.from(session.inputSources).map((source) => `${source.handedness}:${source.targetRayMode}:${source.profiles.join("|") || "no-profile"}${source.gamepad ? `:buttons=${source.gamepad.buttons.length},axes=${source.gamepad.axes.length},haptics=${source.gamepad.hapticActuators?.length ?? 0}` : ""}`),
        enabledFeatures: extended.enabledFeatures ? Array.from(extended.enabledFeatures) : []
      };
    };
    const initial = read();
    setTelemetry(initial);
    xrLog(
      "info",
      `session started: mode=${mode} environmentBlendMode=${initial.environmentBlendMode} frameRate=${initial.frameRate ?? "n/a"} supported=[${initial.supportedFrameRates.join(",")}] features=[${initial.enabledFeatures.join(",")}]`
    );
    const onInputs = () => {
      const next = read();
      setTelemetry(next);
      xrLog("info", `input sources: ${next.inputProfiles.join(" ; ") || "none"}`);
    };
    const onVisibility = () => {
      const next = read();
      setTelemetry(next);
      xrLog("info", `visibility: ${next.visibilityState}`);
    };
    const onFrameRate = () => {
      const next = read();
      setTelemetry(next);
      xrLog("info", `frame rate changed: ${next.frameRate}`);
    };
    const onEnd = () => xrLog("info", "session ended");
    const onInputEvent = (event: XRInputSourceEvent) => {
      const key = `${event.type}:${event.inputSource.handedness}`;
      counts[key] = (counts[key] ?? 0) + 1;
      if (event.type === "selectstart" || event.type === "squeezestart") {
        xrLog("info", `input ${key} (${event.inputSource.targetRayMode}, profiles ${event.inputSource.profiles.join("|") || "none"}) visibility=${session.visibilityState}`);
      }
      if (event.type === "select") {
        // If no UI or entity handler reacted shortly after the trigger, the ray hit nothing.
        window.setTimeout(() => {
          if (msSinceXRInteraction() > 450) {
            xrLog("warn", `trigger (${event.inputSource.handedness}) hit nothing selectable`);
          }
        }, 400);
      }
      setTelemetry((current) => ({ ...current, inputCounts: { ...counts } }));
    };
    const inputEvents = ["selectstart", "select", "selectend", "squeezestart", "squeeze", "squeezeend"] as const;
    inputEvents.forEach((type) => session.addEventListener(type, onInputEvent as EventListener));
    session.addEventListener("inputsourceschange", onInputs);
    session.addEventListener("visibilitychange", onVisibility);
    session.addEventListener("frameratechange", onFrameRate);
    session.addEventListener("end", onEnd);
    return () => {
      session.removeEventListener("inputsourceschange", onInputs);
      session.removeEventListener("visibilitychange", onVisibility);
      session.removeEventListener("frameratechange", onFrameRate);
      session.removeEventListener("end", onEnd);
      inputEvents.forEach((type) => session.removeEventListener(type, onInputEvent as EventListener));
    };
  }, [mode, session]);

  return telemetry;
}
