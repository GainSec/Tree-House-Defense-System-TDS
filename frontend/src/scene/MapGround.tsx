import { useTexture } from "@react-three/drei";
import { useEffect } from "react";
import { LinearFilter, SRGBColorSpace } from "three";
import type { SiteAnchor } from "../domain/types";
import { MAP_GROUND_SIZE, mapTileUrl, siteFloorHeadingRadians } from "./mapGroundModel";

export function MapGround({ site }: { site: SiteAnchor }) {
  const texture = useTexture(mapTileUrl(site));

  useEffect(() => {
    texture.colorSpace = SRGBColorSpace;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.anisotropy = 8;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <group position={[0, -0.08, 0]} rotation={[0, siteFloorHeadingRadians(site), 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[MAP_GROUND_SIZE, MAP_GROUND_SIZE, 1, 1]} />
        <meshBasicMaterial map={texture} color="#7f918c" transparent opacity={0.44} toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[MAP_GROUND_SIZE, MAP_GROUND_SIZE, 1, 1]} />
        <meshBasicMaterial color="#041013" transparent opacity={0.44} depthWrite={false} />
      </mesh>
    </group>
  );
}
