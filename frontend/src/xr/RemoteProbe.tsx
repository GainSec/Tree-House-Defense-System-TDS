import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useXR } from "@react-three/xr";
import { perfStats } from "./perfStats";
import { xrLog } from "./xrLog";

/**
 * Opt-in remote test hook for driving a real headset session over Chrome
 * DevTools when nobody is wearing it (e.g. `ssh -L 9223:...` to the Frame).
 * Enabled only when localStorage "tds.xr.remote" is "1"; it adds no network
 * surface, only `window.__tdsRemote` for code already running in the page.
 *
 * Injected controller input is reported as such: it exercises the app's own
 * handling on the device, not the physical buttons.
 */
export const REMOTE_PROBE_KEY = "tds.xr.remote";

export function remoteProbeEnabled(): boolean {
  try {
    return window.localStorage.getItem(REMOTE_PROBE_KEY) === "1";
  } catch {
    return false;
  }
}

export type RemoteActions = Record<string, (...args: never[]) => unknown>;

interface Injection {
  axes?: number[];
  buttons?: number[];
  until: number;
}

export function RemoteProbe({ actions, state }: { actions: RemoteActions; state: () => Record<string, unknown> }) {
  const session = useXR((xr) => xr.session) ?? null;
  const gl = useThree((three) => three.gl);
  const latest = useRef({ actions, state });
  latest.current = { actions, state };
  const frames = useRef({ count: 0, worst: 0, last: 0, intervals: [] as number[] });
  const injections = useRef(new Map<string, Injection>());

  useFrame((_, delta) => {
    const f = frames.current;
    f.count += 1;
    f.intervals.push(delta * 1000);
    if (f.intervals.length > 600) f.intervals.shift();
    // Expire injected input.
    const now = performance.now();
    for (const [hand, injection] of injections.current) {
      if (injection.until < now) {
        injections.current.delete(hand);
        restoreGamepad(session, hand);
      }
    }
  });

  useEffect(() => {
    const api = {
      state: () => ({
        ...latest.current.state(),
        session: session
          ? {
              visibility: session.visibilityState,
              blend: session.environmentBlendMode,
              frameRate: (session as XRSession & { frameRate?: number }).frameRate ?? null,
              inputs: Array.from(session.inputSources).map((source) => ({
                hand: source.handedness,
                profiles: source.profiles,
                axes: source.gamepad ? Array.from(source.gamepad.axes).map((v) => Math.round(v * 100) / 100) : [],
                pressed: source.gamepad ? Array.from(source.gamepad.buttons).map((b, i) => (b.pressed ? i : -1)).filter((i) => i >= 0) : []
              }))
            }
          : null,
        perf: { ...perfStats, calls: gl.info.render.calls, triangles: gl.info.render.triangles }
      }),
      /** Frame intervals over the last `seconds` (measured in the page's own render loop). */
      measure: (seconds = 5) =>
        new Promise((resolve) => {
          frames.current.intervals = [];
          window.setTimeout(() => {
            const intervals = [...frames.current.intervals].sort((a, b) => a - b);
            const n = intervals.length;
            const mean = intervals.reduce((sum, v) => sum + v, 0) / Math.max(1, n);
            resolve({
              frames: n,
              fps: Math.round((n / seconds) * 10) / 10,
              meanMs: Math.round(mean * 100) / 100,
              p95Ms: Math.round((intervals[Math.floor(n * 0.95)] ?? 0) * 100) / 100,
              worstMs: Math.round((intervals[n - 1] ?? 0) * 100) / 100,
              over14ms: intervals.filter((v) => v > 14).length,
              calls: gl.info.render.calls,
              triangles: gl.info.render.triangles
            });
          }, seconds * 1000);
        }),
      /** Override a controller's gamepad axes/buttons for `ms` (buttons: indices held pressed). */
      inject: (hand: "left" | "right", input: { axes?: number[]; buttons?: number[] }, ms = 400) => {
        if (!session) return "no session";
        const source = Array.from(session.inputSources).find((candidate) => candidate.handedness === hand);
        if (!source?.gamepad) return `no ${hand} gamepad`;
        injections.current.set(hand, { ...input, until: performance.now() + ms });
        overrideGamepad(source, input);
        xrLog("info", `remote: injected ${hand} ${JSON.stringify(input)} for ${ms} ms`);
        return "ok";
      },
      act: (name: string, ...args: unknown[]) => {
        const action = latest.current.actions[name] as ((...a: unknown[]) => unknown) | undefined;
        if (!action) return `unknown action ${name}; have ${Object.keys(latest.current.actions).join(", ")}`;
        xrLog("info", `remote: ${name}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
        return action(...args) ?? "ok";
      }
    };
    (window as unknown as Record<string, unknown>).__tdsRemote = api;
    xrLog("info", "remote test hook enabled");
    return () => {
      delete (window as unknown as Record<string, unknown>).__tdsRemote;
    };
  }, [gl, session]);

  return null;
}

function overrideGamepad(source: XRInputSource, input: { axes?: number[]; buttons?: number[] }) {
  const real = Object.getPrototypeOf(source) && (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(source), "gamepad")?.get?.call(source) as Gamepad | null);
  if (!real) return;
  const fake = {
    id: real.id,
    index: real.index,
    connected: true,
    mapping: real.mapping,
    timestamp: performance.now(),
    hapticActuators: (real as Gamepad & { hapticActuators?: unknown }).hapticActuators,
    vibrationActuator: real.vibrationActuator,
    get axes() {
      const axes = Array.from(real.axes);
      input.axes?.forEach((value, index) => {
        if (index < axes.length) axes[index] = value;
      });
      return axes;
    },
    get buttons() {
      return Array.from(real.buttons).map((button, index) =>
        input.buttons?.includes(index) ? { pressed: true, touched: true, value: 1 } : button
      );
    }
  };
  Object.defineProperty(source, "gamepad", { configurable: true, get: () => fake });
}

function restoreGamepad(session: XRSession | null, hand: string) {
  if (!session) return;
  for (const source of session.inputSources) {
    if (source.handedness === hand && Object.prototype.hasOwnProperty.call(source, "gamepad")) {
      delete (source as unknown as Record<string, unknown>).gamepad;
    }
  }
}
