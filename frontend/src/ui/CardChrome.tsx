import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { dragCardDockPosition, type CardDockId, type CardDockItem, type CardDockVec3 } from "./useCardDock";

export interface CardChromeProps {
  card: CardDockItem;
  compact?: boolean;
  onHide: (id: CardDockId) => void;
  onShow: (id: CardDockId) => void;
  onDetach: (id: CardDockId) => void;
  onNudge: (id: CardDockId, delta: CardDockVec3) => void;
  onMove: (id: CardDockId, position: CardDockVec3) => void;
  onResize: (id: CardDockId, delta: number) => void;
  onReset: (id: CardDockId) => void;
}

export function CardChrome({ card, compact = false, onHide, onShow, onDetach, onNudge, onMove, onResize, onReset }: CardChromeProps) {
  const dragStart = useRef<{ clientX: number; clientY: number; position: CardDockVec3 } | null>(null);

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (card.mode !== "detached") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    dragStart.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      position: [...card.position]
    };
    const move = (moveEvent: PointerEvent) => {
      if (!dragStart.current) {
        return;
      }
      onMove(
        card.id,
        dragCardDockPosition(
          dragStart.current.position,
          {
            deltaX: moveEvent.clientX - dragStart.current.clientX,
            deltaY: moveEvent.clientY - dragStart.current.clientY
          },
          { depth: moveEvent.shiftKey }
        )
      );
    };
    const end = () => {
      dragStart.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div className={compact ? "card-chrome is-compact" : "card-chrome"} aria-label={`${card.label} card controls`}>
      <button type="button" aria-label={`Hide ${card.label}`} title="Hide" onClick={() => onHide(card.id)}>H</button>
      {card.mode === "detached" ? <button type="button" aria-label={`Show ${card.label} as overlay`} title="Overlay" onClick={() => onShow(card.id)}>O</button> : null}
      {card.mode !== "detached" ? <button type="button" aria-label={`Detach ${card.label} into 3D`} title="3D" onClick={() => onDetach(card.id)}>3D</button> : null}
      {card.mode === "detached" ? (
        <>
          <button type="button" className="card-drag-handle" aria-label={`Drag ${card.label} card`} title="Drag card. Hold Shift for depth." onPointerDown={beginDrag}>Drag</button>
          <button type="button" aria-label={`Move ${card.label} left`} title="Left" onClick={() => onNudge(card.id, [-1, 0, 0])}>L</button>
          <button type="button" aria-label={`Move ${card.label} right`} title="Right" onClick={() => onNudge(card.id, [1, 0, 0])}>R</button>
          <button type="button" aria-label={`Move ${card.label} up`} title="Up" onClick={() => onNudge(card.id, [0, 0.5, 0])}>U</button>
          <button type="button" aria-label={`Move ${card.label} down`} title="Down" onClick={() => onNudge(card.id, [0, -0.5, 0])}>D</button>
          <button type="button" aria-label={`Move ${card.label} closer`} title="Closer" onClick={() => onNudge(card.id, [0, 0, 1])}>Near</button>
          <button type="button" aria-label={`Move ${card.label} farther`} title="Farther" onClick={() => onNudge(card.id, [0, 0, -1])}>Far</button>
        </>
      ) : null}
      <button type="button" aria-label={`Make ${card.label} smaller`} title="Smaller" onClick={() => onResize(card.id, -0.1)}>-</button>
      <button type="button" aria-label={`Make ${card.label} larger`} title="Larger" onClick={() => onResize(card.id, 0.1)}>+</button>
      <button type="button" aria-label={`Reset ${card.label} layout`} title="Reset" onClick={() => onReset(card.id)}>R</button>
    </div>
  );
}
