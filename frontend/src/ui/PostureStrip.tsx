import type { PostureLabel, SituationPosture } from "../data/situationModel";
import type { SituationDataStatus } from "../data/useSituationData";
import type { CSSProperties, ReactNode } from "react";

export function PostureStrip({
  posture,
  lastUpdatedAt,
  status,
  cardControls,
  cardStyle
}: {
  posture: SituationPosture | null;
  lastUpdatedAt: string | null;
  status: SituationDataStatus;
  cardControls?: ReactNode;
  cardStyle?: CSSProperties;
}) {
  const visiblePosture = posture ?? {
    label: "WATCH" as PostureLabel,
    confidence: 0,
    reasons: ["Situation loading"]
  };

  return (
    <section className={`posture-strip posture-${visiblePosture.label.toLowerCase()}`} aria-label="TDS posture summary" style={cardStyle}>
      <div>
        <span className="panel-label">Posture</span>
        <strong>{visiblePosture.label}</strong>
      </div>
      <div>
        <span className="panel-label">Confidence</span>
        <strong>{visiblePosture.confidence}%</strong>
      </div>
      <div className="posture-reasons">
        {visiblePosture.reasons.slice(0, 2).map((reason) => (
          <span key={reason}>{reason}</span>
        ))}
      </div>
      <span className="posture-sync">{lastUpdatedAt ? `sync ${new Date(lastUpdatedAt).toLocaleTimeString()}` : `sync ${status}`}</span>
      {cardControls}
    </section>
  );
}
