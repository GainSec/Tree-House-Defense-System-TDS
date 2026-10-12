import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState, type ReactNode } from "react";
import { BOARD_STORAGE_KEY, DEFAULT_BOARD_TRANSFORM, boardReducer, parseStoredBoardTransform, type BoardAction, type BoardTransform, type Vec3Tuple } from "./boardTransform";
import { DEFAULT_XR_LAYERS, ENTITY_BUDGETS, parseStoredXRLayers, toggleXRLayer, type EntityBudgetId, type XRLayerId, type XRLayerState } from "./boardModel";
import { parsePanelOffsets, type ComfortMode, type FocusState, type PanelId, type PanelOffsets, type TextSize, TEXT_SIZE_ORDER } from "./interaction";
import { xrLog } from "./xrLog";
import { LIFE_STORAGE_KEY, parseLifeState, type LifeState, type OriginPose } from "./lifeSize";

/**
 * Local XR view state: board placement, layers, budgets, panels and comfort
 * settings. Everything is persisted per device (localStorage). Read-only with
 * respect to TDS: nothing here writes to the backend.
 */

export type SecondaryPanel = "filters" | "find" | "legend" | "settings" | "hints" | "goto" | null;
export type Presentation = "board" | "life";
export type SelectionTab = "summary" | "signal" | "evidence" | "history";

interface StoredPreferences {
  comfortMode: ComfortMode;
  textSize: TextSize;
  reducedMotion: boolean | null;
  wristMenu: boolean;
  haptics: boolean;
  hintsSeen: boolean;
  budgetId: EntityBudgetId;
  presentation: Presentation;
}

const DEFAULT_PREFERENCES: StoredPreferences = {
  comfortMode: "standing",
  textSize: "m",
  reducedMotion: null,
  wristMenu: false,
  haptics: true,
  hintsSeen: false,
  budgetId: "standalone",
  presentation: "board"
};

const KEYS = {
  layers: "tds.xr.layers.v1",
  preferences: "tds.xr.preferences.v1",
  panels: "tds.xr.panels.v1"
};

export interface XRViewState {
  board: BoardTransform;
  dispatchBoard: (action: BoardAction) => void;
  placementMode: boolean;
  setPlacementMode: (value: boolean) => void;
  layers: XRLayerState;
  toggleLayer: (id: XRLayerId) => void;
  budgetId: EntityBudgetId;
  setBudgetId: (id: EntityBudgetId) => void;
  alertCardHidden: boolean;
  setAlertCardHidden: (value: boolean) => void;
  selectionCardHidden: boolean;
  setSelectionCardHidden: (value: boolean) => void;
  selectionTab: SelectionTab;
  setSelectionTab: (tab: SelectionTab) => void;
  diagnosticsVisible: boolean;
  setDiagnosticsVisible: (value: boolean) => void;
  secondaryPanel: SecondaryPanel;
  setSecondaryPanel: (panel: SecondaryPanel) => void;
  focus: FocusState | null;
  setFocus: (focus: FocusState | null) => void;
  panelOffsets: PanelOffsets;
  setPanelOffset: (id: PanelId, offset: Vec3Tuple) => void;
  resetPanels: () => void;
  comfortMode: ComfortMode;
  setComfortMode: (mode: ComfortMode) => void;
  textSize: TextSize;
  setTextSize: (size: TextSize) => void;
  /** Effective reduced motion: explicit preference, else the OS setting. */
  reducedMotion: boolean;
  reducedMotionPreference: boolean | null;
  setReducedMotionPreference: (value: boolean | null) => void;
  wristMenu: boolean;
  setWristMenu: (value: boolean) => void;
  haptics: boolean;
  setHaptics: (value: boolean) => void;
  hintsSeen: boolean;
  setHintsSeen: (value: boolean) => void;
  /** Tabletop board or life-size world. */
  presentation: Presentation;
  setPresentation: (value: Presentation) => void;
  /** Life-size: where the XR origin (your play space) sits in the world, and how the site is turned to match real north. */
  lifeOrigin: OriginPose;
  setLifeOrigin: (origin: OriginPose) => void;
  northYaw: number;
  setNorthYaw: (yaw: number) => void;
}

const XRViewContext = createContext<XRViewState | null>(null);

export function XRViewStateProvider({ children, defaultBudget }: { children: ReactNode; defaultBudget: EntityBudgetId }) {
  const [board, rawDispatch] = useReducer(boardReducer, undefined, () => parseStoredBoardTransform(readStorage(BOARD_STORAGE_KEY)) ?? DEFAULT_BOARD_TRANSFORM);
  const [placementMode, setPlacementMode] = useState(false);
  const [layers, setLayers] = useState<XRLayerState>(() => parseStoredXRLayers(readStorage(KEYS.layers)) ?? DEFAULT_XR_LAYERS);
  const [preferences, setPreferences] = useState<StoredPreferences>(() => parsePreferences(readStorage(KEYS.preferences), defaultBudget));
  const [panelOffsets, setPanelOffsets] = useState<PanelOffsets>(() => parsePanelOffsets(readStorage(KEYS.panels)));
  const [alertCardHidden, setAlertCardHidden] = useState(false);
  const [selectionCardHidden, setSelectionCardHidden] = useState(false);
  const [selectionTab, setSelectionTab] = useState<SelectionTab>("summary");
  const [diagnosticsVisible, setDiagnosticsVisible] = useState(false);
  const [secondaryPanel, setSecondaryPanelState] = useState<SecondaryPanel>(() => (parsePreferences(readStorage(KEYS.preferences), defaultBudget).hintsSeen ? null : "hints"));
  const [focus, setFocusState] = useState<FocusState | null>(null);
  const [life, setLife] = useState<LifeState>(() => parseLifeState(readStorage(LIFE_STORAGE_KEY)));
  const systemReducedMotion = usePrefersReducedMotion();

  useEffect(() => writeStorage(BOARD_STORAGE_KEY, JSON.stringify(board)), [board]);
  useEffect(() => writeStorage(KEYS.layers, JSON.stringify(layers)), [layers]);
  useEffect(() => writeStorage(KEYS.preferences, JSON.stringify(preferences)), [preferences]);
  useEffect(() => writeStorage(KEYS.panels, JSON.stringify(panelOffsets)), [panelOffsets]);
  useEffect(() => writeStorage(LIFE_STORAGE_KEY, JSON.stringify(life)), [life]);

  const dispatchBoard = useCallback((action: BoardAction) => {
    if (action.type !== "setPose") {
      xrLog("info", `board: ${action.type}`);
    }
    rawDispatch(action);
  }, []);

  useEffect(() => {
    if (board.locked) {
      setPlacementMode(false);
    }
  }, [board.locked]);

  const update = useCallback(<K extends keyof StoredPreferences>(key: K, value: StoredPreferences[K]) => {
    xrLog("info", `pref ${key}=${String(value)}`);
    setPreferences((current) => ({ ...current, [key]: value }));
  }, []);

  const value = useMemo<XRViewState>(
    () => ({
      board,
      dispatchBoard,
      placementMode,
      setPlacementMode,
      layers,
      toggleLayer: (id) => setLayers((current) => toggleXRLayer(current, id)),
      budgetId: preferences.budgetId,
      setBudgetId: (id) => update("budgetId", id),
      alertCardHidden,
      setAlertCardHidden,
      selectionCardHidden,
      setSelectionCardHidden,
      selectionTab,
      setSelectionTab,
      diagnosticsVisible,
      setDiagnosticsVisible,
      secondaryPanel,
      setSecondaryPanel: (panel) => setSecondaryPanelState((current) => (current === panel ? null : panel)),
      focus,
      setFocus: (next) => {
        xrLog("info", next ? `focus x${next.zoom} at ${next.centerX.toFixed(1)},${next.centerZ.toFixed(1)}` : "focus cleared");
        setFocusState(next);
      },
      panelOffsets,
      setPanelOffset: (id, offset) => setPanelOffsets((current) => ({ ...current, [id]: offset })),
      resetPanels: () => {
        xrLog("info", "panels reset");
        setPanelOffsets({});
      },
      comfortMode: preferences.comfortMode,
      setComfortMode: (mode) => update("comfortMode", mode),
      textSize: preferences.textSize,
      setTextSize: (size) => update("textSize", size),
      reducedMotion: preferences.reducedMotion ?? systemReducedMotion,
      reducedMotionPreference: preferences.reducedMotion,
      setReducedMotionPreference: (next) => update("reducedMotion", next),
      wristMenu: preferences.wristMenu,
      setWristMenu: (next) => update("wristMenu", next),
      haptics: preferences.haptics,
      setHaptics: (next) => update("haptics", next),
      hintsSeen: preferences.hintsSeen,
      setHintsSeen: (next) => update("hintsSeen", next),
      presentation: preferences.presentation,
      setPresentation: (next) => {
        update("presentation", next);
        setFocusState(null);
        setPlacementMode(false);
      },
      lifeOrigin: life.origin,
      setLifeOrigin: (origin) => setLife((current) => ({ ...current, origin })),
      northYaw: life.northYaw,
      setNorthYaw: (yaw) => {
        xrLog("info", `north aligned: ${Math.round((yaw * 180) / Math.PI)} deg`);
        setLife((current) => ({ ...current, northYaw: yaw }));
      }
    }),
    [alertCardHidden, board, diagnosticsVisible, dispatchBoard, focus, layers, life, panelOffsets, placementMode, preferences, secondaryPanel, selectionCardHidden, selectionTab, systemReducedMotion, update]
  );

  return <XRViewContext.Provider value={value}>{children}</XRViewContext.Provider>;
}

export function useXRView(): XRViewState {
  const value = useContext(XRViewContext);
  if (!value) {
    throw new Error("useXRView must be used inside <XRViewStateProvider>");
  }
  return value;
}

export function parsePreferences(raw: string | null, defaultBudget: EntityBudgetId): StoredPreferences {
  const base = { ...DEFAULT_PREFERENCES, budgetId: defaultBudget };
  if (!raw) {
    return base;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<StoredPreferences>;
    return {
      comfortMode: parsed.comfortMode === "seated" ? "seated" : "standing",
      textSize: TEXT_SIZE_ORDER.includes(parsed.textSize as TextSize) ? (parsed.textSize as TextSize) : base.textSize,
      reducedMotion: typeof parsed.reducedMotion === "boolean" ? parsed.reducedMotion : null,
      wristMenu: parsed.wristMenu === true,
      haptics: parsed.haptics !== false,
      hintsSeen: parsed.hintsSeen === true,
      budgetId: parsed.budgetId && parsed.budgetId in ENTITY_BUDGETS ? parsed.budgetId : base.budgetId,
      presentation: parsed.presentation === "life" ? "life" : "board"
    };
  } catch {
    return base;
  }
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) {
      return;
    }
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

function readStorage(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // View-state persistence is a convenience only.
  }
}
