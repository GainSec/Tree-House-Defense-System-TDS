import { useEffect, useMemo, useState } from "react";

export type CardDockId = "alerts" | "hud" | "filters" | "selection" | "situation";
export type CardDockMode = "overlay" | "hidden" | "detached";
export type CardDockVec3 = [number, number, number];

export interface CardDockItem {
  id: CardDockId;
  label: string;
  mode: CardDockMode;
  position: CardDockVec3;
  scale: number;
}

export interface CardDockDragDelta {
  deltaX: number;
  deltaY: number;
}

export interface CardDockDragOptions {
  depth?: boolean;
  unitsPerPixel?: number;
}

export type CardDockState = Record<CardDockId, CardDockItem>;

export const CARD_DOCK_STORAGE_KEY = "tds.cardDock.v6";
export const CARD_DOCK_IDS: CardDockId[] = ["alerts", "hud", "filters", "selection", "situation"];
export const CARD_DOCK_POSITION_BOUNDS = {
  x: [-28, 28],
  y: [7, 24],
  z: [-30, 30],
  snap: 0.5
} as const;

const DEFAULT_CARD_DOCK_STATE: CardDockState = {
  alerts: { id: "alerts", label: "Alerts", mode: "detached", position: [-18, 14, -18], scale: 0.88 },
  hud: { id: "hud", label: "HUD", mode: "detached", position: [18, 14, -18], scale: 0.95 },
  filters: { id: "filters", label: "Filters", mode: "detached", position: [0, 15, -22], scale: 0.9 },
  selection: { id: "selection", label: "Selection", mode: "detached", position: [-18, 14, 18], scale: 0.95 },
  situation: { id: "situation", label: "Situation", mode: "detached", position: [18, 14, 18], scale: 0.9 }
};

export function createDefaultCardDockState(): CardDockState {
  return copyState(DEFAULT_CARD_DOCK_STATE);
}

export function cardDockItems(state: CardDockState): CardDockItem[] {
  return CARD_DOCK_IDS.map((id) => state[id]);
}

export function useCardDock() {
  const [cards, setCards] = useState<CardDockState>(() => hydrateCardDockState());

  useEffect(() => {
    writeStoredCardDockState(cards);
  }, [cards]);

  return useMemo(() => ({
    cards,
    items: cardDockItems(cards),
    hide: (id: CardDockId) => setCards((state) => updateCard(state, id, { mode: "hidden" })),
    show: (id: CardDockId) => setCards((state) => updateCard(state, id, { mode: "overlay" })),
    detach: (id: CardDockId) => setCards((state) => updateCard(state, id, { mode: "detached" })),
    nudge: (id: CardDockId, delta: CardDockVec3) => setCards((state) => {
      const card = state[id];
      return updateCard(state, id, {
        position: snapCardDockPosition([
          card.position[0] + delta[0],
          card.position[1] + delta[1],
          card.position[2] + delta[2]
        ])
      });
    }),
    move: (id: CardDockId, position: CardDockVec3) => setCards((state) => updateCard(state, id, { position: snapCardDockPosition(position) })),
    resize: (id: CardDockId, delta: number) => setCards((state) => {
      const card = state[id];
      return updateCard(state, id, { scale: clamp(round(card.scale + delta), 0.65, 1.6) });
    }),
    reset: (id: CardDockId) => setCards((state) => updateCard(state, id, DEFAULT_CARD_DOCK_STATE[id]))
  }), [cards]);
}

function hydrateCardDockState(): CardDockState {
  try {
    const parsed = JSON.parse(readStoredCardDockState() ?? "{}") as Partial<Record<CardDockId, Partial<CardDockItem>>>;
    return CARD_DOCK_IDS.reduce<CardDockState>((state, id) => {
      const incoming = parsed[id] ?? {};
      state[id] = {
        ...DEFAULT_CARD_DOCK_STATE[id],
        mode: validMode(incoming.mode) ? incoming.mode : DEFAULT_CARD_DOCK_STATE[id].mode,
        position: validVec3(incoming.position) ? snapCardDockPosition(incoming.position) : DEFAULT_CARD_DOCK_STATE[id].position,
        scale: validScale(incoming.scale) ? incoming.scale : DEFAULT_CARD_DOCK_STATE[id].scale
      };
      return state;
    }, createDefaultCardDockState());
  } catch {
    return createDefaultCardDockState();
  }
}

function readStoredCardDockState(): string | null {
  try {
    return window.localStorage?.getItem(CARD_DOCK_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredCardDockState(cards: CardDockState): void {
  try {
    window.localStorage?.setItem(CARD_DOCK_STORAGE_KEY, JSON.stringify(cards));
  } catch {
    // Layout persistence is optional; controls continue to work in memory.
  }
}

function updateCard(state: CardDockState, id: CardDockId, patch: Partial<CardDockItem>): CardDockState {
  return {
    ...state,
    [id]: {
      ...state[id],
      ...patch,
      id,
      label: state[id].label
    }
  };
}

function copyState(state: CardDockState): CardDockState {
  return CARD_DOCK_IDS.reduce<CardDockState>((copy, id) => {
    copy[id] = { ...state[id], position: [...state[id].position] };
    return copy;
  }, {} as CardDockState);
}

function validMode(value: unknown): value is CardDockMode {
  return value === "overlay" || value === "hidden" || value === "detached";
}

function validVec3(value: unknown): value is CardDockVec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function validScale(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.45 && value <= 2;
}

export function dragCardDockPosition(start: CardDockVec3, delta: CardDockDragDelta, options: CardDockDragOptions = {}): CardDockVec3 {
  const unitsPerPixel = options.unitsPerPixel ?? 0.035;
  if (options.depth) {
    return snapCardDockPosition([
      start[0],
      start[1],
      start[2] + delta.deltaY * unitsPerPixel
    ]);
  }
  return snapCardDockPosition([
    start[0] + delta.deltaX * unitsPerPixel,
    start[1] - delta.deltaY * unitsPerPixel,
    start[2]
  ]);
}

export function snapCardDockPosition(position: CardDockVec3): CardDockVec3 {
  return [
    snapToGrid(clamp(position[0], CARD_DOCK_POSITION_BOUNDS.x[0], CARD_DOCK_POSITION_BOUNDS.x[1]), CARD_DOCK_POSITION_BOUNDS.snap),
    snapToGrid(clamp(position[1], CARD_DOCK_POSITION_BOUNDS.y[0], CARD_DOCK_POSITION_BOUNDS.y[1]), CARD_DOCK_POSITION_BOUNDS.snap),
    snapToGrid(clamp(position[2], CARD_DOCK_POSITION_BOUNDS.z[0], CARD_DOCK_POSITION_BOUNDS.z[1]), CARD_DOCK_POSITION_BOUNDS.snap)
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function snapToGrid(value: number, gridSize: number): number {
  return round(Math.round(value / gridSize) * gridSize);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
