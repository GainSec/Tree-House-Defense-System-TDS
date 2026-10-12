import { Canvas } from "@react-three/fiber";
import { useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { Grid, PerspectiveCamera } from "@react-three/drei";
import type { AircraftSceneEntity, RfSceneEntity, SceneModel } from "../data/sceneModel";
import { demoScene } from "../data/demoScene";
import { HouseWireframe } from "./HouseWireframe";
import { OperatorAvatar } from "./OperatorAvatar";
import { ThirdPersonRig } from "./ThirdPersonRig";
import { RfField } from "./RfField";
import { Airspace } from "./Airspace";
import { MapGround } from "./MapGround";
import { DaytimeSkybox } from "./DaytimeSkybox";
import { DAYTIME_SKYBOX } from "./daytimeSkyboxModel";
import { GRID_COLOR } from "./materials";
import { SCENE_RENDER_SCALE, type ThirdPersonPose } from "./thirdPersonMotion";
import type { SituationSourceHealth, SituationSourceId } from "../data/situationModel";
import type { InfrastructureAlert, InfrastructureAlertStatus } from "../data/useInfrastructureAlerts";
import type { SelectedSceneEntity } from "../ui/SelectionPanel";
import type { CurrentStateItem, PresenceDossier } from "../domain/types";
import type { OperatorInspectorModel, OperatorInspectorTabId, SourceInspectable } from "../data/operatorInspector";
import type { LayerLensMode } from "../ui/useLayerLens";
import type { CardDockId, CardDockState } from "../ui/useCardDock";
import { OperatorInspector, operatorInspectorPosition } from "./OperatorInspector";
import { SelectionTether } from "./SelectionTether";
import { SourcePylons } from "./SourcePylons";
import { AlertBeacon, CardDockObjects, hiddenCardObjectAriaLabel, type DetachedCardContent } from "./CardDockObjects";
import { MiniRadar } from "../ui/MiniRadar";
import { AmbientSystemLife } from "./AmbientSystemLife";
import { PostureContextBeacon } from "./PostureContextBeacon";
import { AlertPulseBeam } from "./AlertPulseBeam";

export { demoScene };

export function SigintWorld({
  sceneModel = demoScene,
  sourceHealth = [],
  selectedEntity = null,
  selectedDossier = null,
  selectedSource = null,
  selectedId = null,
  inspectorModel = null,
  activeInspectorTab = null,
  layerLensMode = "rf",
  infrastructureAlerts = [],
  infrastructureAlertStatus = "empty",
  sourceStates = {},
  cardDock = null,
  detachedCards = {},
  onRestoreCard,
  onSelect,
  onSelectSource
}: {
  sceneModel?: SceneModel;
  sourceHealth?: SituationSourceHealth[];
  selectedEntity?: SelectedSceneEntity;
  selectedDossier?: PresenceDossier | null;
  selectedSource?: SituationSourceId | null;
  selectedId?: string | null;
  inspectorModel?: OperatorInspectorModel | null;
  activeInspectorTab?: OperatorInspectorTabId | null;
  layerLensMode?: LayerLensMode;
  infrastructureAlerts?: InfrastructureAlert[];
  infrastructureAlertStatus?: InfrastructureAlertStatus;
  sourceStates?: Partial<Record<SituationSourceId, CurrentStateItem[]>>;
  cardDock?: CardDockState | null;
  detachedCards?: DetachedCardContent;
  onRestoreCard?: (id: CardDockId) => void;
  onSelect: (entity: RfSceneEntity | AircraftSceneEntity) => void;
  onSelectSource?: (source: SourceInspectable) => void;
}) {
  const [operatorPose, setOperatorPose] = useState<ThirdPersonPose>({
    position: { x: 0, z: -3 },
    yaw: 0
  });

  return (
    <div className="world-canvas" aria-label="Interactive 3D townhouse SIGINT scene">
      <Canvas shadows gl={{ antialias: true, alpha: false }} camera={{ position: [28, 22, 44], fov: 54 }}>
        <color attach="background" args={[DAYTIME_SKYBOX.upperColor]} />
        <fog attach="fog" args={[DAYTIME_SKYBOX.horizonColor, 64, 220]} />
        <PerspectiveCamera makeDefault position={[26, 16, 48]} fov={58} />
        <CameraAim />
        <DaytimeSkybox />
        <ambientLight intensity={0.26} color="#9cc6ff" />
        <directionalLight position={[56, 92, -80]} intensity={0.52} color="#dbeafe" />
        <pointLight position={[0, 9 * SCENE_RENDER_SCALE, -3 * SCENE_RENDER_SCALE]} intensity={15} color="#7df2e6" distance={38} />
        {cardDock?.alerts.mode === "hidden" ? <AlertBeacon onRestore={() => onRestoreCard?.("alerts")} /> : null}
        <group scale={SCENE_RENDER_SCALE}>
          <MapGround site={sceneModel.site} />
          <Grid
            args={[120, 120]}
            cellSize={5}
            cellThickness={0.55}
            cellColor={GRID_COLOR}
            sectionSize={15}
            sectionThickness={1}
            sectionColor="#3e7c83"
            fadeDistance={130}
            fadeStrength={1.7}
            position={[0, -0.02, 0]}
          />
          <AmbientSystemLife sources={sourceHealth} />
          <PostureContextBeacon sources={sourceHealth} rfCount={sceneModel.rfEntities.length} aircraftCount={sceneModel.aircraftEntities.length} />
          <AlertPulseBeam alerts={infrastructureAlerts} status={infrastructureAlertStatus} />
          <HouseWireframe />
          <SourcePylons
            sources={sourceHealth}
            sourceStates={sourceStates}
            layerLensMode={layerLensMode}
            selectedSource={selectedSource}
            onSelect={onSelectSource ?? (() => undefined)}
          />
          {cardDock ? <CardDockObjects cards={cardDock} detachedContent={detachedCards} onRestore={onRestoreCard ?? (() => undefined)} /> : null}
          <OperatorAvatar pose={operatorPose} />
          <group position={operatorInspectorPosition(operatorPose)} rotation={[0, operatorPose.yaw, 0]}>
            <OperatorInspector model={inspectorModel} activeTab={activeInspectorTab} />
          </group>
          <SelectionTether selected={selectedEntity} pose={operatorPose} inspector={inspectorModel} />
          <RfField entities={sceneModel.rfEntities} selectedId={selectedId} selectedDossier={selectedDossier} onSelect={onSelect} />
          <Airspace aircraft={sceneModel.aircraftEntities} selectedId={selectedId} onSelect={onSelect} />
        </group>
        <ThirdPersonRig pose={operatorPose} sceneScale={SCENE_RENDER_SCALE} onPoseChange={setOperatorPose} />
      </Canvas>
      <MiniRadar
        entities={[...sceneModel.rfEntities, ...sceneModel.aircraftEntities]}
        selectedId={selectedId}
        yaw={operatorPose.yaw}
        onSelect={onSelect}
      />
      {cardDock?.alerts.mode === "hidden" ? (
        <button type="button" className="scene-alert-beacon-overlay" aria-label="Open realtime alarms" onClick={() => onRestoreCard?.("alerts")}>
          !
        </button>
      ) : null}
      {cardDock
        ? Object.values(cardDock)
            .filter((card) => card.mode === "hidden" && card.id !== "alerts")
            .map((card) => (
              <button
                key={card.id}
                type="button"
                className={`scene-card-open-overlay is-${card.id}`}
                aria-label={hiddenCardObjectAriaLabel(card.id)}
                onClick={() => onRestoreCard?.(card.id)}
              >
                {card.id === "hud" ? "TDS" : card.id === "selection" ? "Detail" : "Context"}
              </button>
            ))
        : null}
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        © OpenStreetMap contributors
      </a>
    </div>
  );
}

function CameraAim() {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    camera.lookAt(0, 3.2, 0);
    camera.updateProjectionMatrix();
  }, [camera]);

  return null;
}
