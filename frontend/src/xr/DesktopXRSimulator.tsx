import { useEffect, useRef, type ComponentRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Text } from "@react-three/uikit";
import type { BoardAction, BoardTransform } from "./boardTransform";
import { PLACEMENT_STEPS, headPoseFromCamera } from "./XRLayerPalette";
import { XR_COLORS, XR_PIXEL_SIZE } from "./theme";

/**
 * Desktop stand-in for the headset. It renders the SAME XR experience (board,
 * cards, palette) outside an XR session, with:
 *  - orbit = walking around the floating board
 *  - mouse = controller aim ray (click = trigger)
 *  - keyboard equivalents for grip placement and palette actions
 * The camera starts where the XR origin is (standing, 1.6 m eye height).
 */

export const SIMULATOR_EYE_HEIGHT = 1.6;

export interface SimulatorKeyActions {
  dispatchBoard: (action: BoardAction) => void;
  togglePlacement: () => void;
  toggleLayer: (index: number) => void;
  toggleDiagnostics: () => void;
  toggleAlerts: () => void;
  cycleLens: () => void;
  cycleBudget: () => void;
  selectAdjacent: (direction: 1 | -1) => void;
  clearSelection: () => void;
  toggleReplay: () => void;
  summon: () => void;
  cycleFocus: () => void;
  openPanel: (panel: "filters" | "find" | "legend" | "settings" | "hints") => void;
}

export const SIMULATOR_KEY_HELP: Array<[string, string]> = [
  ["Drag / scroll", "Walk around (orbit) / step closer"],
  ["Click", "Trigger: select token or press button"],
  ["P", "Placement mode (then drag the plate)"],
  ["Arrows", "Move board (relative to you)"],
  ["Q / E", "Rotate board"],
  ["R / F", "Raise / lower"],
  ["+ / -", "Scale"],
  ["L", "Lock / unlock"],
  ["0", "Reset placement"],
  ["C", "Summon the board in front of you"],
  ["X", "Zoom in on the selection (cycles 1x-8x)"],
  ["J / K / O", "Find / Legend / Settings panels"],
  ["Drag the bar above a panel", "Move that panel"],
  ["1-4", "Layers: RF, Presence, Airspace, Alerts"],
  ["V / B", "Cycle filter lens / entity budget"],
  ["[ / ]", "Previous / next entity"],
  ["Esc", "Clear selection"],
  ["A / G", "Hide-show alerts / diagnostics"],
  ["Z", "Freeze replay / resume live"]
];

export function DesktopXRSimulator({ board, actions }: { board: BoardTransform; actions: SimulatorKeyActions }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const camera = useThree((state) => state.camera);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    camera.position.set(0, SIMULATOR_EYE_HEIGHT, 0.15);
    camera.lookAt(board.position[0], board.position[1], board.position[2]);
    // Only on mount: afterwards the operator walks freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const [targetX, targetY, targetZ] = board.position;
  useEffect(() => {
    controls.current?.target.set(targetX, targetY, targetZ);
    controls.current?.update();
  }, [targetX, targetY, targetZ]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.metaKey || event.ctrlKey) {
        return;
      }
      const a = actionsRef.current;
      const yaw = headPoseFromCamera(camera).yaw;
      const move = (right: number, forward: number) => a.dispatchBoard({ type: "translate", right, forward, viewerYaw: yaw });
      const handled = (() => {
        switch (event.key) {
          case "ArrowLeft":
            return move(-PLACEMENT_STEPS.MOVE_STEP, 0), true;
          case "ArrowRight":
            return move(PLACEMENT_STEPS.MOVE_STEP, 0), true;
          case "ArrowUp":
            return move(0, PLACEMENT_STEPS.MOVE_STEP), true;
          case "ArrowDown":
            return move(0, -PLACEMENT_STEPS.MOVE_STEP), true;
          case "q":
          case "Q":
            return a.dispatchBoard({ type: "rotate", dyaw: PLACEMENT_STEPS.ROTATE_STEP }), true;
          case "e":
          case "E":
            return a.dispatchBoard({ type: "rotate", dyaw: -PLACEMENT_STEPS.ROTATE_STEP }), true;
          case "r":
          case "R":
            return a.dispatchBoard({ type: "raise", dy: PLACEMENT_STEPS.RAISE_STEP }), true;
          case "f":
          case "F":
            return a.dispatchBoard({ type: "raise", dy: -PLACEMENT_STEPS.RAISE_STEP }), true;
          case "+":
          case "=":
            return a.dispatchBoard({ type: "scale", factor: PLACEMENT_STEPS.SCALE_STEP }), true;
          case "-":
          case "_":
            return a.dispatchBoard({ type: "scale", factor: 1 / PLACEMENT_STEPS.SCALE_STEP }), true;
          case "l":
          case "L":
            return a.dispatchBoard({ type: "toggleLock" }), true;
          case "0":
            return a.dispatchBoard({ type: "reset" }), true;
          case "c":
          case "C":
            return a.summon(), true;
          case "x":
          case "X":
            return a.cycleFocus(), true;
          case "j":
          case "J":
            return a.openPanel("find"), true;
          case "k":
          case "K":
            return a.openPanel("legend"), true;
          case "o":
          case "O":
            return a.openPanel("settings"), true;
          case "p":
          case "P":
            return a.togglePlacement(), true;
          case "1":
          case "2":
          case "3":
          case "4":
            return a.toggleLayer(Number(event.key) - 1), true;
          case "v":
          case "V":
            return a.cycleLens(), true;
          case "b":
          case "B":
            return a.cycleBudget(), true;
          case "[":
            return a.selectAdjacent(-1), true;
          case "]":
            return a.selectAdjacent(1), true;
          case "Escape":
            return a.clearSelection(), true;
          case "a":
          case "A":
            return a.toggleAlerts(), true;
          case "g":
          case "G":
            return a.toggleDiagnostics(), true;
          case "z":
          case "Z":
            return a.toggleReplay(), true;
          default:
            return false;
        }
      })();
      if (handled) {
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [camera]);

  return (
    <>
      <OrbitControls
        ref={controls}
        makeDefault
        enablePan={false}
        minDistance={0.35}
        maxDistance={6}
        maxPolarAngle={Math.PI * 0.49}
        enableDamping
      />
      <XROriginMarker />
    </>
  );
}

/** Where the headset user starts (XR origin). Simulator-only. */
function XROriginMarker() {
  return (
    <group name="xr-origin-marker">
      <mesh position={[0, 0.004, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.16, 0.19, 40]} />
        <meshBasicMaterial color={XR_COLORS.accentDim} />
      </mesh>
      <mesh position={[0, 0.004, -0.26]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.05, 3]} />
        <meshBasicMaterial color={XR_COLORS.accentDim} />
      </mesh>
      <group position={[0, 0.006, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <Text pixelSize={XR_PIXEL_SIZE} fontSize={36} color={XR_COLORS.textMuted} anchorX="center" anchorY="center">
          XR origin
        </Text>
      </group>
    </group>
  );
}

/** Neutral environment for immersive-vr and the simulator. Never drawn in immersive-ar: passthrough must not be faked. */
export function NeutralEnvironment() {
  return (
    <group name="neutral-environment">
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
        <circleGeometry args={[8, 64]} />
        <meshLambertMaterial color={XR_COLORS.neutralFloor} />
      </mesh>
      <gridHelper args={[16, 32, XR_COLORS.panelBorder, "#2d363d"]} position={[0, 0.001, 0]} />
    </group>
  );
}
