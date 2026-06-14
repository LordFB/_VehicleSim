import type { PhysicsSnapshot } from '../sim/types';
import type { StartFinishLine } from '../level/LevelBuilder';

/**
 * Render-side lap timing — the iRacing "credibility + objective" layer. It reads
 * only the chassis position from the snapshot and never touches physics or
 * determinism. The car must pass through the ordered checkpoints (a there-and-back
 * loop on the existing test straight) and cross the start/finish to bank a lap.
 * Tracks current / last / best and a live delta versus the best lap.
 */

export type LapState = {
  running: boolean;
  currentMs: number;
  lastMs: number | null;
  bestMs: number | null;
  deltaMs: number | null; // current vs best at the same checkpoint progress (+ slower / - faster)
  lapCount: number;
  checkpointIndex: number; // next checkpoint to hit
  checkpointCount: number;
  justCompleted: boolean;
};

export type Checkpoint = { x: number; z: number; radius: number };

export class LapTimer {
  private state!: LapState;
  private lastZ = 0;
  private bestSplits: number[] = []; // ms at each checkpoint on the best lap
  private currentSplits: number[] = [];
  private startMs = 0;
  private readonly checkpoints: Checkpoint[];
  private readonly startFinishLine: StartFinishLine;
  private readonly path: Array<[number, number]>;

  /**
   * @param checkpoints  ordered gates the car must hit before banking a lap
   * @param startFinish  the start/finish plane
   * @param path         polyline for the mini-map (defaults to checkpoints + S/F)
   */
  constructor(checkpoints: Checkpoint[], startFinish: StartFinishLine, path?: Array<[number, number]>) {
    this.checkpoints = checkpoints;
    this.startFinishLine = startFinish;
    this.path = path ?? [
      [startFinish.center[0], startFinish.center[1]],
      ...checkpoints.map((c) => [c.x, c.z] as [number, number]),
      [startFinish.center[0], startFinish.center[1]],
    ];
    this.state = this.fresh();
  }

  startFinish(): StartFinishLine {
    return this.startFinishLine;
  }

  /** Polyline (x,z) of the track for the mini-map. */
  trackPath(): Array<[number, number]> {
    return this.path;
  }

  reset(): void {
    this.state = this.fresh();
    this.currentSplits = [];
    this.lastZ = 0;
  }

  update(snapshot: PhysicsSnapshot, nowMs: number): LapState {
    this.state.justCompleted = false;
    const x = snapshot.chassis.position[0];
    const z = snapshot.chassis.position[2];

    if (this.state.running) {
      this.state.currentMs = nowMs - this.startMs;

      // Hit the next checkpoint if within its radius.
      const next = this.checkpoints[this.state.checkpointIndex];
      if (next && Math.hypot(x - next.x, z - next.z) <= next.radius) {
        this.currentSplits[this.state.checkpointIndex] = this.state.currentMs;
        this.state.checkpointIndex += 1;
      }

      // Live delta vs best at the most recent shared checkpoint.
      this.state.deltaMs = this.computeDelta();

      // Completing a lap: all checkpoints hit, then cross start/finish (z: + -> 0 region).
      if (this.state.checkpointIndex >= this.checkpoints.length && this.crossedStartFinish(z)) {
        this.bankLap();
      }
    } else if (this.crossedStartFinish(z) && z >= -2) {
      // First forward crossing of start/finish arms the timer.
      this.startLap(nowMs);
    }

    this.lastZ = z;
    return this.state;
  }

  private crossedStartFinish(z: number): boolean {
    // Start/finish plane at z = 0, crossing from negative to non-negative while near x.
    return this.lastZ < 0 && z >= 0;
  }

  private startLap(nowMs: number): void {
    this.state.running = true;
    this.startMs = nowMs;
    this.state.currentMs = 0;
    this.state.checkpointIndex = 0;
    this.state.deltaMs = null;
    this.currentSplits = [];
  }

  private bankLap(): void {
    const lapMs = this.state.currentMs;
    this.state.lastMs = lapMs;
    this.state.lapCount += 1;
    if (this.state.bestMs === null || lapMs < this.state.bestMs) {
      this.state.bestMs = lapMs;
      this.bestSplits = this.currentSplits.slice();
    }
    // Roll straight into the next lap.
    this.state.checkpointIndex = 0;
    this.state.currentMs = 0;
    this.startMs = performance.now();
    this.currentSplits = [];
    this.state.justCompleted = true;
  }

  private computeDelta(): number | null {
    if (this.state.bestMs === null || this.bestSplits.length === 0) return null;
    const idx = this.state.checkpointIndex - 1;
    if (idx < 0 || this.bestSplits[idx] === undefined || this.currentSplits[idx] === undefined) {
      return this.state.deltaMs; // hold previous delta between checkpoints
    }
    return this.currentSplits[idx] - this.bestSplits[idx];
  }

  private fresh(): LapState {
    return {
      running: false,
      currentMs: 0,
      lastMs: null,
      bestMs: null,
      deltaMs: null,
      lapCount: 0,
      checkpointIndex: 0,
      checkpointCount: this.checkpoints.length,
      justCompleted: false,
    };
  }
}
