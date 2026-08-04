import { BackSide } from "three";
import { DAYTIME_SKYBOX } from "./daytimeSkyboxModel";

export function DaytimeSkybox() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[DAYTIME_SKYBOX.radius, 48, 24]} />
        <meshBasicMaterial color={DAYTIME_SKYBOX.upperColor} side={BackSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, -36, 0]}>
        <sphereGeometry args={[DAYTIME_SKYBOX.radius * 0.98, 48, 12, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.28]} />
        <meshBasicMaterial color={DAYTIME_SKYBOX.horizonColor} side={BackSide} transparent opacity={0.58} toneMapped={false} />
      </mesh>
      <mesh position={[0, -72, 0]}>
        <sphereGeometry args={[DAYTIME_SKYBOX.radius * 0.96, 48, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.2]} />
        <meshBasicMaterial color={DAYTIME_SKYBOX.groundHazeColor} side={BackSide} transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <mesh position={[92, 132, -168]}>
        <sphereGeometry args={[7, 24, 16]} />
        <meshBasicMaterial color={DAYTIME_SKYBOX.sunColor} transparent opacity={0.72} toneMapped={false} />
      </mesh>
    </group>
  );
}
