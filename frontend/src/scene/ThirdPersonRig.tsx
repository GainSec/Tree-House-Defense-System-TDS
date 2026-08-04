import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Vector3 } from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { SCENE_RENDER_SCALE, SKY_LOOK_POLAR_LIMITS, scaleThirdPersonPose, stepThirdPersonPose, type ThirdPersonInput, type ThirdPersonPose } from "./thirdPersonMotion";

const CAMERA_TARGET_Y = 2.1;
const SKY_LOOK_TARGET_Y = 120;
const SKY_LOOK_CAMERA_Y = 2.6;

export function ThirdPersonRig({
  pose,
  sceneScale = SCENE_RENDER_SCALE,
  onPoseChange
}: {
  pose: ThirdPersonPose;
  sceneScale?: number;
  onPoseChange: (pose: ThirdPersonPose) => void;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useRef<OrbitControlsImpl | null>(null);
  const poseRef = useRef(pose);
  const inputRef = useKeyboardInput();
  const cameraDirection = useMemo(() => new Vector3(), []);
  const nextTarget = useMemo(() => new Vector3(), []);
  const targetDelta = useMemo(() => new Vector3(), []);

  useEffect(() => {
    poseRef.current = pose;
  }, [pose]);

  useFrame((_, deltaSeconds) => {
    const currentPose = poseRef.current;
    camera.getWorldDirection(cameraDirection);

    const nextPose = stepThirdPersonPose(
      currentPose,
      inputRef.current,
      Math.atan2(cameraDirection.x, -cameraDirection.z),
      Math.min(deltaSeconds, 0.08)
    );

    const controlsCurrent = controls.current;
    if (controlsCurrent) {
      const renderedPose = scaleThirdPersonPose(nextPose, sceneScale);
      if (inputRef.current.lookUp) {
        nextTarget.set(renderedPose.position.x, SKY_LOOK_TARGET_Y * sceneScale, renderedPose.position.z);
        camera.position.set(renderedPose.position.x, SKY_LOOK_CAMERA_Y * sceneScale, renderedPose.position.z + 0.1 * sceneScale);
      } else {
        nextTarget.set(renderedPose.position.x, CAMERA_TARGET_Y * sceneScale, renderedPose.position.z);
      }
      targetDelta.copy(nextTarget).sub(controlsCurrent.target);
      if (!inputRef.current.lookUp) {
        camera.position.add(targetDelta);
      }
      controlsCurrent.target.copy(nextTarget);
      controlsCurrent.update();
    }

    if (nextPose !== currentPose) {
      poseRef.current = nextPose;
      onPoseChange(nextPose);
    }
  });

  const renderedPose = scaleThirdPersonPose(pose, sceneScale);

  return (
    <OrbitControls
      ref={controls}
      target={[renderedPose.position.x, CAMERA_TARGET_Y * sceneScale, renderedPose.position.z]}
      minDistance={10}
      maxDistance={72}
      minPolarAngle={SKY_LOOK_POLAR_LIMITS.min}
      maxPolarAngle={SKY_LOOK_POLAR_LIMITS.max}
      enableDamping
      dampingFactor={0.08}
      enablePan={false}
      makeDefault
    />
  );
}

function useKeyboardInput() {
  const inputRef = useRef<ThirdPersonInput>({});

  useEffect(() => {
    const setKey = (code: string, pressed: boolean) => {
      if (code === "KeyW" || code === "ArrowUp") {
        inputRef.current = { ...inputRef.current, forward: pressed };
      } else if (code === "KeyS" || code === "ArrowDown") {
        inputRef.current = { ...inputRef.current, backward: pressed };
      } else if (code === "KeyA" || code === "ArrowLeft") {
        inputRef.current = { ...inputRef.current, left: pressed };
      } else if (code === "KeyD" || code === "ArrowRight") {
        inputRef.current = { ...inputRef.current, right: pressed };
      } else if (code === "ShiftLeft" || code === "ShiftRight") {
        inputRef.current = { ...inputRef.current, lookUp: pressed };
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      setKey(event.code, true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      setKey(event.code, false);
    };
    const onBlur = () => {
      inputRef.current = {};
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return inputRef;
}
