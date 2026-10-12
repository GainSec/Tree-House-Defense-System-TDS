import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useXRStore } from "@react-three/xr";
import { Box3, InstancedMesh, Matrix4, Vector3 } from "three";

/**
 * Development-only hook for automated browser checks: locates named scene
 * objects and returns their on-screen centre so tests can click them through the
 * real pointer-event path. Not included in production builds.
 */
export function DevProbe() {
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => state.controls) as unknown as { target: Vector3; update: () => void } | null;
  const store = useXRStore();
  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    const box = new Box3();
    const center = new Vector3();
    (window as unknown as Record<string, unknown>).__tdsXR = {
      names: (prefix = "") => {
        const found: string[] = [];
        scene.traverse((object) => {
          if (object.name && object.name.startsWith(prefix)) {
            found.push(object.name);
          }
        });
        return found;
      },
      screenPoint: (name: string, instanceId?: number) => {
        const object = scene.getObjectByName(name);
        if (!object) {
          return null;
        }
        object.updateWorldMatrix(true, true);
        if (instanceId !== undefined && object instanceof InstancedMesh) {
          const matrix = new Matrix4();
          object.getMatrixAt(instanceId, matrix);
          center.setFromMatrixPosition(matrix.premultiply(object.matrixWorld));
          center.y += 0.004;
        } else {
          box.setFromObject(object);
          box.getCenter(center);
        }
        center.project(camera);
        const rect = gl.domElement.getBoundingClientRect();
        return { x: rect.left + ((center.x + 1) / 2) * rect.width, y: rect.top + ((1 - center.y) / 2) * rect.height, z: center.z };
      },
      /** IWER emulator handle (only with ?emulate=1). */
      emulator: () => store.getState().emulator ?? null,
      session: () => store.getState().session ?? null,
      /** Simulator only: aim the camera (via the default controls) at a named object or instance. */
      lookAt: (name: string, instanceId?: number) => {
        const object = scene.getObjectByName(name);
        if (!object || !controls) return false;
        object.updateWorldMatrix(true, true);
        const point = new Vector3();
        if (instanceId !== undefined && object instanceof InstancedMesh) {
          const matrix = new Matrix4();
          object.getMatrixAt(instanceId, matrix);
          point.setFromMatrixPosition(matrix.premultiply(object.matrixWorld));
        } else {
          point.setFromMatrixPosition(object.matrixWorld);
        }
        const distance = camera.position.distanceTo(controls.target);
        controls.target.copy(camera.position).add(point.sub(camera.position).normalize().multiplyScalar(distance));
        controls.update();
        return true;
      },
      childCount: (name: string) => scene.getObjectByName(name)?.children.length ?? null,
      worldPosition: (name: string) => {
        const object = scene.getObjectByName(name);
        if (!object) return null;
        object.updateWorldMatrix(true, false);
        return new Vector3().setFromMatrixPosition(object.matrixWorld).toArray().map((v) => Math.round(v * 1000) / 1000);
      },
      instanceCount: (name: string) => {
        const object = scene.getObjectByName(name);
        return object instanceof InstancedMesh ? object.count : null;
      },
      boardPosition: () => {
        const root = scene.getObjectByName("tds-board-root");
        return root ? { position: root.position.toArray(), yaw: root.rotation.y, scale: (scene.getObjectByName("tds-board-diorama")?.scale.x ?? 0) } : null;
      }
    };
  }, [camera, controls, gl, scene, store]);
  return null;
}
