import type { InputFrame, PhysicsSnapshot, SurfaceContact, VehicleSpec, WorldSpec } from '../types';
import { validateVehicleSpec, validateWorldSpec } from '../data/validation';
import { SurfaceSystem } from './SurfaceSystem';
import { Vehicle } from './Vehicle';

const FIXED_DT = 1 / 240;
const VEHICLE_SUBSTEPS = 3;
const MAX_CATCHUP_STEPS = 24;

export class PhysicsRuntime {
  private world: WorldSpec;
  private surfaceSystem: SurfaceSystem;
  private vehicle: Vehicle | null = null;
  private accumulator = 0;
  private simTime = 0;
  private lastRenderTimeMs: number | null = null;

  constructor(world: WorldSpec) {
    this.world = validateWorldSpec(world);
    this.surfaceSystem = new SurfaceSystem(this.world);
  }

  createVehicle(spec: VehicleSpec): string {
    this.vehicle = new Vehicle(validateVehicleSpec(spec));
    return this.vehicle.id;
  }

  submitInput(input: InputFrame): void {
    if (input.reset) this.reset(input.sequence);
    this.vehicle?.setInput(input);
  }

  step(renderTimeMs: number): PhysicsSnapshot | null {
    if (!this.vehicle) return null;
    if (this.lastRenderTimeMs === null) this.lastRenderTimeMs = renderTimeMs;
    const frameDt = Math.min(Math.max(0, (renderTimeMs - this.lastRenderTimeMs) / 1000), 0.1);
    this.lastRenderTimeMs = renderTimeMs;
    this.accumulator += frameDt;

    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_CATCHUP_STEPS) {
      this.fixedStep();
      this.accumulator -= FIXED_DT;
      steps += 1;
    }
    if (steps >= MAX_CATCHUP_STEPS) this.accumulator = Math.min(this.accumulator, FIXED_DT);
    return this.getSnapshot();
  }

  getSnapshot(): PhysicsSnapshot | null {
    if (!this.vehicle) return null;
    return this.vehicle.getSnapshot(this.accumulator / FIXED_DT);
  }

  reset(seed: number): void {
    this.accumulator = 0;
    this.simTime = 0;
    this.lastRenderTimeMs = null;
    this.vehicle?.reset(seed);
  }

  querySurface(point: [number, number, number]): SurfaceContact {
    return this.surfaceSystem.query(point);
  }

  private fixedStep(): void {
    if (!this.vehicle) return;
    const subDt = FIXED_DT / VEHICLE_SUBSTEPS;
    for (let i = 0; i < VEHICLE_SUBSTEPS; i += 1) {
      this.vehicle.step(subDt, this.world.gravity, this.surfaceSystem, this.simTime + subDt * (i + 1));
      this.vehicle.solveBarriers(this.world.barriers);
    }
    this.simTime += FIXED_DT;
  }
}
