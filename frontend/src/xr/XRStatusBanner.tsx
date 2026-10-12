import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import { XRSpace, useXRInputSourceState } from "@react-three/xr";
import { Group, Vector3 } from "three";
import { XR_COLORS } from "./theme";
import { XRLabel, XRPanel } from "./ui/XRPanelKit";
import { xrLog } from "./xrLog";
import type { XRSessionTelemetry } from "./useXRSessionTelemetry";
import { resolveInputProblem, type InputProblem } from "./interaction";

const MESSAGES: Record<Exclude<InputProblem, null>, { title: string; detail: string }> = {
  blurred: {
    title: "Controllers paused: a Steam menu has focus",
    detail: "Close the Steam / system menu (press the Steam button) to use the board again."
  },
  "no-controllers": {
    title: "No controllers reported to this page",
    detail: "Wake the controllers, or Exit XR and enter again."
  }
};

const forward = new Vector3();

/**
 * Small head-relative banner (the one exception to world-anchored UI) that
 * explains why input is not working. Only shown while there is a problem.
 */
export function XRStatusBanner({ telemetry }: { telemetry: XRSessionTelemetry }) {
  const ref = useRef<Group>(null);
  const [problem, setProblem] = useState<InputProblem>(null);
  const startedAt = useRef(0);
  const last = useRef<InputProblem>(null);

  useEffect(() => {
    startedAt.current = performance.now();
  }, [telemetry.session]);

  useFrame(({ camera }) => {
    const next = resolveInputProblem(telemetry, telemetry.session ? telemetry.session.inputSources.length : 0, performance.now() - startedAt.current);
    if (next !== last.current) {
      last.current = next;
      setProblem(next);
      xrLog(next ? "warn" : "info", next ? `input problem: ${next}` : "input problem cleared");
    }
    const group = ref.current;
    if (!group || !next) {
      return;
    }
    camera.getWorldDirection(forward);
    group.position.copy(camera.position).addScaledVector(forward, 0.9);
    group.position.y -= 0.18;
    group.quaternion.copy(camera.quaternion);
  });

  if (!telemetry.session) {
    return null;
  }
  return (
    <group ref={ref} visible={problem !== null}>
      {problem ? (
        <XRPanel width={560} name="xr-status-banner" accent={XR_COLORS.warn} padding={14} gap={6} anchorY="center">
          <XRLabel color={XR_COLORS.warn} fontSize={26}>
            {MESSAGES[problem].title}
          </XRLabel>
          <XRLabel fontSize={19}>{MESSAGES[problem].detail}</XRLabel>
        </XRPanel>
      ) : null}
    </group>
  );
}

/** Optional wrist menu: renders its children on the left controller, tilted toward the face. */
export function WristMount({ children }: { children: ReactNode }) {
  const left = useXRInputSourceState("controller", "left");
  if (!left?.inputSource.gripSpace) {
    return null;
  }
  return (
    <XRSpace space={left.inputSource.gripSpace}>
      <group position={[0, 0.07, 0.04]} rotation={[-1.1, 0, 0]} scale={0.42}>
        {children}
      </group>
    </XRSpace>
  );
}
