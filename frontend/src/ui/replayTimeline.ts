import type { SceneModel } from "../data/sceneModel";

export interface ReplayFrame {
  capturedAt: string;
  sceneModel: SceneModel;
}

export function appendReplayFrame(frames: ReplayFrame[], sceneModel: SceneModel, capturedAt = new Date().toISOString(), maxFrames = 24): ReplayFrame[] {
  const next = [...frames, { capturedAt, sceneModel }];
  return next.slice(Math.max(0, next.length - maxFrames));
}

export function selectReplayFrame(frames: ReplayFrame[], currentIndex: number, direction: 1 | -1): { index: number; frame: ReplayFrame } | null {
  if (frames.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(frames.length - 1, currentIndex + direction));
  return { index, frame: frames[index] };
}

export function replayTimelineLabel(frames: ReplayFrame[], currentIndex: number): string {
  if (frames.length === 0) {
    return "Replay 0/0";
  }
  return `Replay ${Math.max(1, Math.min(frames.length, currentIndex + 1))}/${frames.length}`;
}
