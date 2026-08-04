import type { ThirdPersonPose } from "./thirdPersonMotion";

type Vec3 = [number, number, number];

interface OperatorStickPart {
  role: string;
  geometry: "sphere" | "cylinder" | "box" | "torus";
  position: Vec3;
  rotation?: Vec3;
  args: number[];
  color: string;
  emissive?: string;
}

export function operatorAvatarModel() {
  return {
    usesCapsule: false,
    head: {
      role: "head",
      geometry: "sphere",
      position: [0, 2.18, 0] as Vec3,
      args: [0.22, 18, 18],
      color: "#7df2e6",
      emissive: "#235e5a"
    },
    body: {
      role: "torso",
      geometry: "cylinder",
      position: [0, 1.42, 0] as Vec3,
      args: [0.055, 0.055, 1.15, 10],
      color: "#dcefff",
      emissive: "#20454a"
    },
    limbs: [
      limb("shoulders", [0, 1.78, 0], [0, 0, Math.PI / 2], 0.78),
      limb("left-arm", [-0.42, 1.48, 0], [0, 0, -0.46], 0.76),
      limb("right-arm", [0.42, 1.48, 0], [0, 0, 0.46], 0.76),
      limb("hips", [0, 0.93, 0], [0, 0, Math.PI / 2], 0.52),
      limb("left-leg", [-0.18, 0.42, 0], [0, 0, -0.2], 0.98),
      limb("right-leg", [0.18, 0.42, 0], [0, 0, 0.2], 0.98)
    ],
    feet: [
      foot("left-foot", [-0.28, -0.08, -0.08]),
      foot("right-foot", [0.28, -0.08, -0.08])
    ],
    orientationRing: {
      role: "facing-ring",
      geometry: "torus",
      position: [0, 0.08, -0.2] as Vec3,
      rotation: [Math.PI / 2, 0, 0] as Vec3,
      args: [0.48, 0.018, 8, 28],
      color: "#ff4d6d"
    }
  };
}

export function OperatorAvatar({ pose }: { pose: ThirdPersonPose }) {
  const model = operatorAvatarModel();

  return (
    <group position={[pose.position.x, 0, pose.position.z]} rotation={[0, pose.yaw, 0]}>
      <mesh position={model.body.position}>
        <cylinderGeometry args={model.body.args as [number, number, number, number]} />
        <meshStandardMaterial color={model.body.color} emissive={model.body.emissive} roughness={0.38} metalness={0.12} />
      </mesh>
      <mesh position={model.head.position}>
        <sphereGeometry args={model.head.args as [number, number, number]} />
        <meshStandardMaterial color={model.head.color} emissive={model.head.emissive} roughness={0.36} />
      </mesh>
      {model.limbs.map((part) => (
        <mesh key={part.role} position={part.position} rotation={part.rotation}>
          <cylinderGeometry args={part.args as [number, number, number, number]} />
          <meshStandardMaterial color={part.color} emissive={part.emissive} roughness={0.34} metalness={0.08} />
        </mesh>
      ))}
      {model.feet.map((part) => (
        <mesh key={part.role} position={part.position}>
          <boxGeometry args={part.args as [number, number, number]} />
          <meshStandardMaterial color={part.color} emissive={part.emissive} roughness={0.34} />
        </mesh>
      ))}
      <mesh position={model.orientationRing.position} rotation={model.orientationRing.rotation}>
        <torusGeometry args={model.orientationRing.args as [number, number, number, number]} />
        <meshBasicMaterial color={model.orientationRing.color} />
      </mesh>
    </group>
  );
}

function limb(role: string, position: Vec3, rotation: Vec3, length: number): OperatorStickPart {
  return {
    role,
    geometry: "cylinder",
    position,
    rotation,
    args: [0.038, 0.038, length, 10],
    color: "#dcefff",
    emissive: "#20454a"
  };
}

function foot(role: string, position: Vec3): OperatorStickPart {
  return {
    role,
    geometry: "box",
    position,
    args: [0.34, 0.08, 0.18],
    color: "#dcefff",
    emissive: "#20454a"
  };
}
