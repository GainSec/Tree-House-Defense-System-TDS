export type ThirdPersonInput = {
  forward?: boolean;
  backward?: boolean;
  left?: boolean;
  right?: boolean;
  lookUp?: boolean;
};

export type ThirdPersonPose = {
  position: {
    x: number;
    z: number;
  };
  yaw: number;
};

const WALK_SPEED_METERS_PER_SECOND = 6;

export const SCENE_RENDER_SCALE = 0.56;

export const SKY_LOOK_POLAR_LIMITS = {
  min: 0.08,
  max: Math.PI - 0.08
};

export function scaleThirdPersonPose(pose: ThirdPersonPose, scale = SCENE_RENDER_SCALE): ThirdPersonPose {
  return {
    position: {
      x: pose.position.x * scale,
      z: pose.position.z * scale
    },
    yaw: pose.yaw
  };
}

export function stepThirdPersonPose(
  pose: ThirdPersonPose,
  input: ThirdPersonInput,
  cameraYaw: number,
  deltaSeconds: number
): ThirdPersonPose {
  const forwardIntent = Number(Boolean(input.forward)) - Number(Boolean(input.backward));
  const strafeIntent = Number(Boolean(input.right)) - Number(Boolean(input.left));

  if (forwardIntent === 0 && strafeIntent === 0) {
    return pose;
  }

  const forwardX = Math.sin(cameraYaw);
  const forwardZ = -Math.cos(cameraYaw);
  const rightX = Math.cos(cameraYaw);
  const rightZ = Math.sin(cameraYaw);

  let moveX = forwardX * forwardIntent + rightX * strafeIntent;
  let moveZ = forwardZ * forwardIntent + rightZ * strafeIntent;
  const magnitude = Math.hypot(moveX, moveZ);

  if (magnitude > 0) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }

  const distance = WALK_SPEED_METERS_PER_SECOND * deltaSeconds;

  return {
    position: {
      x: pose.position.x + moveX * distance,
      z: pose.position.z + moveZ * distance
    },
    yaw: Math.atan2(moveX, -moveZ)
  };
}
