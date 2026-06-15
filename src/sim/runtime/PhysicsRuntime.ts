import type { BarrierSpec, InputFrame, PhysicsSetup, PhysicsSnapshot, SurfaceContact, VehicleSpec, WorldSpec } from '../types';
import { validateVehicleSpec, validateWorldSpec } from '../data/validation';
import { SurfaceSystem } from './SurfaceSystem';
import { Vehicle } from './Vehicle';

const FIXED_DT = 1 / 240;
const VEHICLE_SUBSTEPS = 3;
const MAX_CATCHUP_STEPS = 24;

export class PhysicsRuntime {
  private world: WorldSpec;
  private surfaceSystem: SurfaceSystem;
  private barrierIndex: BarrierIndex;
  private vehicle: Vehicle | null = null;
  private accumulator = 0;
  private simTime = 0;
  private lastRenderTimeMs: number | null = null;

  constructor(world: WorldSpec) {
    this.world = validateWorldSpec(world);
    this.surfaceSystem = new SurfaceSystem(this.world);
    this.barrierIndex = new BarrierIndex(this.world.barriers);
  }

  createVehicle(spec: VehicleSpec): string {
    this.vehicle = new Vehicle(validateVehicleSpec(spec), this.world.spawn);
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

  applySetup(setup: PhysicsSetup): void {
    this.vehicle?.applySetup(setup);
  }

  querySurface(point: [number, number, number]): SurfaceContact {
    return this.surfaceSystem.query(point);
  }

  private fixedStep(): void {
    if (!this.vehicle) return;
    const subDt = FIXED_DT / VEHICLE_SUBSTEPS;
    for (let i = 0; i < VEHICLE_SUBSTEPS; i += 1) {
      this.vehicle.step(subDt, this.world.gravity, this.surfaceSystem, this.simTime + subDt * (i + 1));
      const nearBarriers = this.barrierIndex.query(this.vehicle.chassis.position.x, this.vehicle.chassis.position.z);
      this.vehicle.solveBarriers(nearBarriers);
    }
    this.simTime += FIXED_DT;
  }
}

class BarrierIndex {
  private readonly cells = new Map<string, BarrierSpec[]>();
  private readonly cellSize = 18;
  private readonly padding = 5;

  constructor(barriers: BarrierSpec[]) {
    for (const barrier of barriers) this.insert(barrier);
  }

  query(x: number, z: number): BarrierSpec[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const out: BarrierSpec[] = [];
    const seen = new Set<string>();
    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const bucket = this.cells.get(`${cx + ox},${cz + oz}`);
        if (!bucket) continue;
        for (const barrier of bucket) {
          if (seen.has(barrier.id)) continue;
          seen.add(barrier.id);
          out.push(barrier);
        }
      }
    }
    return out;
  }

  private insert(barrier: BarrierSpec): void {
    const bounds = barrierBounds(barrier, this.padding);
    const minX = Math.floor(bounds.minX / this.cellSize);
    const maxX = Math.floor(bounds.maxX / this.cellSize);
    const minZ = Math.floor(bounds.minZ / this.cellSize);
    const maxZ = Math.floor(bounds.maxZ / this.cellSize);
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x},${z}`;
        const bucket = this.cells.get(key) ?? [];
        bucket.push(barrier);
        this.cells.set(key, bucket);
      }
    }
  }
}

function barrierBounds(barrier: BarrierSpec, padding: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const yaw = barrier.yawRad ?? 0;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  const halfX = Math.abs(cos) * barrier.halfExtents[0] + Math.abs(sin) * barrier.halfExtents[2] + padding;
  const halfZ = Math.abs(sin) * barrier.halfExtents[0] + Math.abs(cos) * barrier.halfExtents[2] + padding;
  return {
    minX: barrier.center[0] - halfX,
    maxX: barrier.center[0] + halfX,
    minZ: barrier.center[2] - halfZ,
    maxZ: barrier.center[2] + halfZ,
  };
}
