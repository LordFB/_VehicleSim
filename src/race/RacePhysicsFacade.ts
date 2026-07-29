import type {
  RaceSessionSpec,
  RaceSnapshot,
  RaceVehicleId,
  RaceVehicleInput,
  RaceWorkerRequest,
  RaceWorkerResponse,
} from './types';

export class RacePhysicsFacade {
  private readonly worker: Worker;
  private latestSnapshot: RaceSnapshot | null = null;
  private readyResolve: ((snapshot: RaceSnapshot) => void) | null = null;
  private errorReject: ((error: Error) => void) | null = null;
  private stepInFlight = false;
  private pendingDeltaMs = 0;
  private readonly pendingInputs = new Map<RaceVehicleId, RaceVehicleInput>();

  constructor() {
    this.worker = new Worker(new URL('./raceWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<RaceWorkerResponse>) => {
      const response = event.data;
      if (response.type === 'error') {
        this.stepInFlight = false;
        this.errorReject?.(new Error(response.message));
        this.errorReject = null;
        console.error(response.message);
        return;
      }
      this.latestSnapshot = response.snapshot;
      if (response.type === 'ready') {
        this.readyResolve?.(response.snapshot);
        this.readyResolve = null;
        this.errorReject = null;
      } else {
        this.stepInFlight = false;
        this.flushStep();
      }
    };
  }

  init(spec: RaceSessionSpec): Promise<RaceSnapshot> {
    this.post({ type: 'init', spec });
    return new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.errorReject = reject;
    });
  }

  step(deltaMs: number, inputs: readonly RaceVehicleInput[] = []): void {
    this.pendingDeltaMs += Math.max(0, deltaMs);
    for (const input of inputs) this.pendingInputs.set(input.vehicleId, { ...input });
    this.flushStep();
  }

  focus(vehicleId: RaceVehicleId): void {
    this.post({ type: 'focus', vehicleId });
  }

  snapshot(): RaceSnapshot | null {
    return this.latestSnapshot;
  }

  dispose(): void {
    this.worker.terminate();
    this.latestSnapshot = null;
    this.readyResolve = null;
    this.errorReject = null;
    this.stepInFlight = false;
    this.pendingDeltaMs = 0;
    this.pendingInputs.clear();
  }

  private flushStep(): void {
    if (this.stepInFlight || this.pendingDeltaMs <= 0) return;
    // Keep worker replies frequent enough for rendering/HUD updates. A single
    // multi-second catch-up message would be deterministic, but the browser
    // would display the last countdown snapshot until the whole batch ended.
    const deltaMs = Math.min(this.pendingDeltaMs, 100);
    const inputs = [...this.pendingInputs.values()];
    this.pendingDeltaMs -= deltaMs;
    this.pendingInputs.clear();
    this.stepInFlight = true;
    this.post({ type: 'step', deltaMs, inputs });
  }

  private post(request: RaceWorkerRequest): void {
    this.worker.postMessage(request);
  }
}
