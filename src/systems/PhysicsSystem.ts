import { eventBus, Events } from '../core/EventBus';
import type {
  InputFrame,
  PhysicsFacade,
  PhysicsSnapshot,
  SurfaceContact,
  Vec3Tuple,
  VehicleSpec,
  WorkerRequest,
  WorkerResponse,
  WorldSpec,
} from '../sim/types';

export class WorkerPhysicsFacade implements PhysicsFacade {
  private readonly worker: Worker;
  private latestSnapshot: PhysicsSnapshot | null = null;
  private initResolve: (() => void) | null = null;
  private vehicleResolve: ((id: string) => void) | null = null;
  private queryId = 1;
  private readonly surfaceQueries = new Map<number, (contact: SurfaceContact) => void>();

  constructor() {
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.handleMessage(event.data);
  }

  init(worldSpec: WorldSpec): Promise<void> {
    this.post({ type: 'init', world: worldSpec });
    return new Promise((resolve) => {
      this.initResolve = resolve;
    });
  }

  createVehicle(vehicleSpec: VehicleSpec): Promise<string> {
    this.post({ type: 'createVehicle', vehicle: vehicleSpec });
    return new Promise((resolve) => {
      this.vehicleResolve = resolve;
    });
  }

  submitInput(inputFrame: InputFrame): void {
    this.post({ type: 'input', input: inputFrame });
  }

  step(renderTimeMs: number): void {
    this.post({ type: 'step', renderTimeMs });
  }

  getSnapshot(): PhysicsSnapshot | null {
    return this.latestSnapshot;
  }

  reset(seed: number): void {
    this.post({ type: 'reset', seed });
  }

  querySurface(point: Vec3Tuple): Promise<SurfaceContact> {
    const id = this.queryId;
    this.queryId += 1;
    this.post({ type: 'querySurface', id, point });
    return new Promise((resolve) => this.surfaceQueries.set(id, resolve));
  }

  dispose(): void {
    this.worker.terminate();
  }

  private handleMessage(message: WorkerResponse): void {
    if (message.type === 'ready') {
      this.initResolve?.();
      this.initResolve = null;
      return;
    }
    if (message.type === 'vehicleCreated') {
      this.vehicleResolve?.(message.id);
      this.vehicleResolve = null;
      return;
    }
    if (message.type === 'snapshot') {
      this.latestSnapshot = message.snapshot;
      return;
    }
    if (message.type === 'surface') {
      this.surfaceQueries.get(message.id)?.(message.contact);
      this.surfaceQueries.delete(message.id);
      return;
    }
    if (message.type === 'error') {
      eventBus.emit(Events.PHYSICS_ERROR, { message: message.message });
      console.error(message.message);
    }
  }

  private post(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }
}
