/** Development telemetry sampled from the render loop, read by diagnostics at a low rate. */
export interface PerfStats {
  fps: number;
  frameMs: number;
  worstFrameMs: number;
  drawCalls: number;
  triangles: number;
  sampledAt: number;
}

export const perfStats: PerfStats = { fps: 0, frameMs: 0, worstFrameMs: 0, drawCalls: 0, triangles: 0, sampledAt: 0 };

export class FrameSampler {
  private frames = 0;
  private elapsed = 0;
  private worst = 0;

  constructor(private readonly windowSeconds = 0.5) {}

  /** Returns true when a new sample was published. */
  push(deltaSeconds: number, drawCalls: number, triangles: number, now: number): boolean {
    this.frames += 1;
    this.elapsed += deltaSeconds;
    this.worst = Math.max(this.worst, deltaSeconds);
    if (this.elapsed < this.windowSeconds) {
      return false;
    }
    perfStats.fps = Math.round(this.frames / this.elapsed);
    perfStats.frameMs = Math.round((this.elapsed / this.frames) * 10_000) / 10;
    perfStats.worstFrameMs = Math.round(this.worst * 10_000) / 10;
    perfStats.drawCalls = drawCalls;
    perfStats.triangles = triangles;
    perfStats.sampledAt = now;
    this.frames = 0;
    this.elapsed = 0;
    this.worst = 0;
    return true;
  }
}
