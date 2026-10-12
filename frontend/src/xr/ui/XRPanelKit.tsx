import { Container, Text } from "@react-three/uikit";
import type { ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import type { Object3D } from "three";
import { XR_COLORS, XR_PIXEL_SIZE, toneColor } from "../theme";
import type { CardTone } from "../cards";
import type { ProvenanceTone } from "../../data/provenance";
import { noteXRInteraction } from "../xrLog";

/**
 * GPU-rendered world-space UI primitives (uikit). Sizes are in uikit pixels:
 * with XR_PIXEL_SIZE = 1 mm, a 64 px button is 6.4 cm tall — a comfortable
 * controller-ray target at arm's length.
 */

export const XR_HIT_TARGET_MIN = 56;

const GLYPH_REPLACEMENTS: Record<string, string> = { "·": "|", "…": "...", "—": "-", "–": "-", "×": "x", "•": "*", "←": "<", "→": ">" };

/** The bundled MSDF font covers basic Latin only; map typographic characters so nothing renders as a missing glyph. */
export function xrText(value: string): string {
  return value.replace(/[^\x20-\x7e°]/g, (char) => GLYPH_REPLACEMENTS[char] ?? "?");
}

/** Name the underlying Object3D so diagnostics and browser checks can locate controls in the scene graph. */
export function nameObject(name: string | undefined) {
  return (object: Object3D | null) => {
    if (object && name) {
      object.name = name;
    }
  };
}

export function XRPanel({
  width,
  children,
  accent = XR_COLORS.panelBorder,
  padding = 20,
  gap = 12,
  name,
  anchorY = "top"
}: {
  width: number;
  children: ReactNode;
  accent?: string;
  padding?: number;
  gap?: number;
  name?: string;
  /** Panels hang from their top edge by default (grab bar sits above). */
  anchorY?: "top" | "center";
}) {
  return (
    <Container
      ref={nameObject(name)}
      pixelSize={XR_PIXEL_SIZE}
      anchorX="center"
      anchorY={anchorY}
      width={width}
      flexDirection="column"
      padding={padding}
      gap={gap}
      backgroundColor={XR_COLORS.panel}
      borderRadius={18}
      borderWidth={3}
      borderColor={accent}
    >
      {children}
    </Container>
  );
}

export function XRButton({
  label,
  onActivate,
  active = false,
  disabled = false,
  tone,
  width,
  height = XR_HIT_TARGET_MIN,
  fontSize = 22,
  testId
}: {
  label: string;
  onActivate: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: CardTone | ProvenanceTone;
  width?: number | `${number}%`;
  height?: number;
  fontSize?: number;
  testId?: string;
}) {
  const color = disabled ? XR_COLORS.muted : active ? XR_COLORS.panel : tone ? toneColor(tone) : XR_COLORS.text;
  const activeColor = tone ? toneColor(tone) : XR_COLORS.accent;
  return (
    <Container
      ref={nameObject(`xr-button:${testId ?? label}`)}
      height={Math.max(XR_HIT_TARGET_MIN, height)}
      width={width}
      flexGrow={width === undefined ? 1 : 0}
      minWidth={XR_HIT_TARGET_MIN}
      paddingX={14}
      alignItems="center"
      justifyContent="center"
      borderRadius={12}
      borderWidth={3}
      borderColor={active ? activeColor : XR_COLORS.panelBorder}
      backgroundColor={active ? activeColor : XR_COLORS.panelRaised}
      {...(disabled
        ? {}
        : {
            hover: { backgroundColor: active ? activeColor : XR_COLORS.hover, borderColor: activeColor },
            active: { backgroundColor: XR_COLORS.active },
            cursor: "pointer"
          })}
      // Activate on press, not click: a click needs press and release on the same button, which hand
      // tremor on a controller ray often breaks. Stopping the press also keeps a panel drag from starting.
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        if (!disabled) {
          noteXRInteraction(`ui:${testId ?? label}`);
          onActivate();
        }
      }}
    >
      <Text fontSize={fontSize} fontWeight="semi-bold" color={color}>
        {xrText(label)}
      </Text>
    </Container>
  );
}

export function XRRow({ children, gap = 10 }: { children: ReactNode; gap?: number }) {
  return (
    <Container flexDirection="row" gap={gap} alignItems="center" width="100%">
      {children}
    </Container>
  );
}

export function XRHeading({ children, color = XR_COLORS.accent, fontSize = 30 }: { children: string; color?: string; fontSize?: number }) {
  return (
    <Text fontSize={fontSize} fontWeight="bold" color={color}>
      {xrText(children)}
    </Text>
  );
}

export function XRLabel({ children, color = XR_COLORS.textMuted, fontSize = 18 }: { children: string; color?: string; fontSize?: number }) {
  return (
    <Text fontSize={fontSize} color={color}>
      {xrText(children)}
    </Text>
  );
}

export function XRBadge({ label, tone }: { label: string; tone: CardTone | ProvenanceTone }) {
  const color = toneColor(tone);
  return (
    <Container paddingX={12} paddingY={6} borderRadius={10} borderWidth={3} borderColor={color} backgroundColor={XR_COLORS.panelRaised} flexShrink={0}>
      <Text fontSize={20} fontWeight="bold" color={color} whiteSpace="pre">
        {xrText(label)}
      </Text>
    </Container>
  );
}

export function XRField({ label, value, tone, labelWidth = 150 }: { label: string; value: string; tone?: CardTone | ProvenanceTone; labelWidth?: number }) {
  return (
    <Container flexDirection="row" gap={12} width="100%" alignItems="flex-start">
      <Container width={labelWidth} flexShrink={0}>
        <Text fontSize={19} color={XR_COLORS.textMuted}>
          {xrText(label)}
        </Text>
      </Container>
      <Container flexGrow={1} flexShrink={1}>
        <Text fontSize={21} fontWeight="medium" color={tone ? toneColor(tone) : XR_COLORS.text} wordBreak="break-word">
          {xrText(value)}
        </Text>
      </Container>
    </Container>
  );
}

export function XRDivider() {
  return <Container height={2} width="100%" backgroundColor={XR_COLORS.panelBorder} />;
}
