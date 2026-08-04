import type { CurrentStateItem } from "../domain/types";
import type { SourceInspectable } from "../data/operatorInspector";
import type { SituationSourceHealth, SituationSourceId } from "../data/situationModel";
import { buildSourcePylonModel, type SourcePylonModel } from "./sourcePylonModel";
import type { LayerLensMode } from "../ui/useLayerLens";

const SOURCE_LABELS: Record<SituationSourceId, string> = {
  openwrt: "OpenWrt",
  unifi: "UniFi",
  kismet: "Kismet",
  intercept: "Intercept"
};

export function sourcePylonInspectable(source: SituationSourceId): SourceInspectable {
  return {
    kind: "source",
    source,
    label: SOURCE_LABELS[source]
  };
}

export function sourcePylonEmphasis(source: SituationSourceId, lens: LayerLensMode, selected: boolean): number {
  if (selected) {
    return 1;
  }
  if (lens === "network" && (source === "openwrt" || source === "unifi")) {
    return 0.92;
  }
  if (lens === "hardware" && (source === "kismet" || source === "intercept")) {
    return 0.92;
  }
  if (lens === "events") {
    return 0.74;
  }
  return lens === "rf" ? 0.68 : 0.42;
}

export function SourcePylons({
  sources,
  sourceStates,
  layerLensMode,
  selectedSource,
  onSelect
}: {
  sources: SituationSourceHealth[];
  sourceStates: Partial<Record<SituationSourceId, CurrentStateItem[]>>;
  layerLensMode: LayerLensMode;
  selectedSource: SituationSourceId | null;
  onSelect: (source: SourceInspectable) => void;
}) {
  return (
    <group name="source-pylons">
      {sources.map((source) => {
        const model = buildSourcePylonModel(source, sourceStates[source.source] ?? []);
        const selected = selectedSource === source.source;
        const emphasis = sourcePylonEmphasis(source.source, layerLensMode, selected);
        return (
          <group
            key={source.source}
            position={model.position}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(sourcePylonInspectable(source.source));
            }}
          >
            <mesh position={[0, 0.52, 0]} visible={false}>
              <cylinderGeometry args={[1.18, 1.18, 3.15, 16]} />
              <meshBasicMaterial transparent opacity={0} />
            </mesh>
            <SourcePylonShape model={model} emphasis={emphasis} />
            {model.metrics.slice(0, 4).map((metric, index) => (
              <mesh key={metric.label} position={[-0.84 + index * 0.56, -1.14, 0.08]}>
                <boxGeometry args={[0.34, 0.22 + metric.intensity * 0.76, 0.08]} />
                <meshStandardMaterial color={model.color} emissive={model.color} emissiveIntensity={0.35 + metric.intensity * 0.5} transparent opacity={0.62 + emphasis * 0.2} />
              </mesh>
            ))}
            {selected ? <pointLight color={model.color} intensity={2.8} distance={12} /> : null}
          </group>
        );
      })}
    </group>
  );
}

function SourcePylonShape({ model, emphasis }: { model: SourcePylonModel; emphasis: number }) {
  const baseMaterial = () => (
    <meshStandardMaterial color="#071216" emissive={model.color} emissiveIntensity={0.28 + emphasis * 0.55} transparent opacity={0.48 + emphasis * 0.34} roughness={0.24} />
  );
  const glowMaterial = () => (
    <meshStandardMaterial color={model.color} emissive={model.color} emissiveIntensity={model.pulse * emphasis} transparent opacity={0.74 + emphasis * 0.2} roughness={0.18} />
  );

  if (model.shape === "gateway") {
    return (
      <group name="source-pylon-gateway">
        <mesh position={[0, 0.04, 0]}><boxGeometry args={[1.55, 0.82, 1.08]} />{baseMaterial()}</mesh>
        <mesh position={[-0.42, 0.72, 0]}><cylinderGeometry args={[0.045, 0.045, 1.18, 8]} />{glowMaterial()}</mesh>
        <mesh position={[0.42, 0.72, 0]}><cylinderGeometry args={[0.045, 0.045, 1.18, 8]} />{glowMaterial()}</mesh>
        <mesh position={[0, 1.36, 0]}><torusGeometry args={[0.58, 0.03, 8, 42]} />{glowMaterial()}</mesh>
      </group>
    );
  }

  if (model.shape === "access-point") {
    return (
      <group name="source-pylon-access-point">
        <mesh position={[0, 0.28, 0]}><cylinderGeometry args={[0.92, 1.08, 0.32, 28]} />{baseMaterial()}</mesh>
        <mesh position={[0, 0.68, 0]}><sphereGeometry args={[0.42 + emphasis * 0.12, 20, 12]} />{glowMaterial()}</mesh>
        <mesh position={[0, 0.68, 0]}><torusGeometry args={[0.86, 0.025, 8, 52]} />{glowMaterial()}</mesh>
      </group>
    );
  }

  if (model.shape === "sensor-array") {
    return (
      <group name="source-pylon-sensor-array">
        <mesh position={[0, 0.08, 0]}><cylinderGeometry args={[0.34, 0.58, 2.35, 12]} />{baseMaterial()}</mesh>
        {[-0.54, 0, 0.54].map((offset) => (
          <mesh key={offset} position={[offset, 1.34, 0]}><sphereGeometry args={[0.24 + emphasis * 0.08, 14, 10]} />{glowMaterial()}</mesh>
        ))}
        <mesh position={[0, 1.52, 0]}><boxGeometry args={[1.46, 0.08, 0.08]} />{glowMaterial()}</mesh>
      </group>
    );
  }

  return (
    <group name="source-pylon-sdr">
      <mesh position={[0, 0.02, 0]}><boxGeometry args={[1.48, 0.48, 1.0]} />{baseMaterial()}</mesh>
      <mesh position={[0, 0.68, 0]}><cylinderGeometry args={[0.09, 0.09, 1.45, 10]} />{glowMaterial()}</mesh>
      <mesh position={[0, 1.38, 0]}><torusGeometry args={[0.66, 0.035, 8, 52]} />{glowMaterial()}</mesh>
      <mesh position={[0, 1.38, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.44, 0.028, 8, 42]} />{glowMaterial()}</mesh>
    </group>
  );
}
