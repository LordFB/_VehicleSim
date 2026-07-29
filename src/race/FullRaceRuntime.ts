import { SurfaceSystem } from '../sim/runtime/SurfaceSystem';
import { Vehicle } from '../sim/runtime/Vehicle';
import { Vec3 } from '../sim/math/Vec3';
import { Quat } from '../sim/math/Quat';
import { AiTireVehicle } from './AiTireVehicle';
import {
  applyRaceImpact,
  createPristineDamageState,
  damageEffects,
  type RaceImpact,
} from './DamageModel';
import type { BarrierSpec, InputFrame, PhysicsSnapshot, VehicleSpec, WorldSpec } from '../sim/types';
import type {
  RaceClassificationEntry,
  RaceCourseSpec,
  RaceSessionSpec,
  RaceSnapshot,
  RaceVehicleInput,
  RaceVehicleSnapshot,
  RaceDamageState,
} from './types';

const FIXED_DT = 1 / 120;
const VEHICLE_SUBSTEPS = 1;
const RESET_PENALTY_MS = 5_000;
const RESET_GHOST_MS = 2_000;
const CONTACT_RADIUS_M = 1.55;

type FullVehicleState = {
  id: string;
  driverName: string;
  ai: boolean;
  pace: number;
  position: number;
  completedLaps: number;
  stationM: number;
  lateralM: number;
  hint: number;
  penaltyMs: number;
  ghostMs: number;
  contactCount: number;
  finished: boolean;
  finishTimeMs: number | null;
  targetLateralM: number;
  passCommitUntilMs: number;
  sensor: {
    targetSpeedMps: number;
    distanceM: number;
    cornerName: string | null;
    trafficGapM: number | null;
  };
  runtime: Vehicle | AiTireVehicle;
  snapshot: PhysicsSnapshot;
  damage: RaceDamageState;
};

export class FullRaceRuntime {
  private readonly spec: RaceSessionSpec & { world: WorldSpec; vehicle: VehicleSpec };
  private readonly surface: SurfaceSystem;
  private readonly barriers: RaceBarrierIndex;
  private readonly vehicles: FullVehicleState[];
  private readonly inputs = new Map<string, RaceVehicleInput>();
  private accumulator = 0;
  private simTimeMs = 0;
  private raceTimeMs = 0;
  private countdownMs: number;
  private sequence = 0;
  private phase: RaceSnapshot['phase'] = 'countdown';
  private focusedVehicleId: string;
  private classification: RaceClassificationEntry[] = [];
  private inputSequence = 0;

  constructor(spec: RaceSessionSpec & { world: WorldSpec; vehicle: VehicleSpec }) {
    if (spec.vehicles.length !== 12) throw new Error('A full race requires exactly 12 vehicles.');
    this.spec = spec;
    this.surface = new SurfaceSystem(spec.world);
    this.barriers = new RaceBarrierIndex(spec.world.barriers);
    this.countdownMs = spec.countdownMs;
    this.focusedVehicleId = spec.playerVehicleId ?? spec.vehicles[5].id;
    this.vehicles = [...spec.vehicles]
      .sort((a, b) => a.gridPosition - b.gridPosition)
      .map((entry, index) => {
        const stationM = wrap(spec.course.lengthM - 1 - index * 8, spec.course.lengthM);
        const lateralM = index % 2 === 0 ? -1.5 : 1.5;
        const pose = coursePose(spec, stationM, lateralM);
        const runtime = entry.ai ? new AiTireVehicle(spec.vehicle, {
          position: pose.position,
          yawRad: pose.yaw,
        }) : new Vehicle(spec.vehicle, {
          position: pose.position,
          yawRad: pose.yaw,
        });
        return {
          id: entry.id,
          driverName: entry.driverName,
          ai: entry.ai,
          pace: entry.pace,
          position: entry.gridPosition,
          completedLaps: 0,
          stationM,
          lateralM,
          hint: sampleIndex(spec, stationM),
          penaltyMs: 0,
          ghostMs: 0,
          contactCount: 0,
          finished: false,
          finishTimeMs: null,
          targetLateralM: nearestSample(spec, stationM).racingLineOffsetM,
          passCommitUntilMs: 0,
          sensor: {
            targetSpeedMps: nearestSample(spec, stationM).targetSpeedMps,
            distanceM: 0,
            cornerName: null,
            trafficGapM: null,
          },
          runtime,
          snapshot: runtime.getSnapshot(0),
          damage: createPristineDamageState(),
        };
      });
    this.updateOrder();
  }

  step(deltaMs: number, inputs: readonly RaceVehicleInput[] = []): RaceSnapshot {
    for (const input of inputs) this.inputs.set(input.vehicleId, { ...input });
    this.accumulator += Math.max(0, deltaMs) / 1000;
    while (this.accumulator + 1e-10 >= FIXED_DT) {
      this.fixedStep();
      this.accumulator -= FIXED_DT;
    }
    this.sequence += 1;
    return this.snapshot();
  }

  snapshot(): RaceSnapshot {
    return {
      sequence: this.sequence,
      simTimeMs: round(this.simTimeMs),
      raceTimeMs: round(this.raceTimeMs),
      countdownMs: round(this.countdownMs),
      phase: this.phase,
      mode: this.spec.mode,
      lapCount: this.spec.lapCount,
      focusedVehicleId: this.focusedVehicleId,
      vehicles: this.vehicles.map((vehicle) => this.vehicleSnapshot(vehicle)),
      classification: this.classification.map((entry) => ({ ...entry })),
    };
  }

  setSpectatorFocus(vehicleId: string): void {
    if (this.vehicles.some((vehicle) => vehicle.id === vehicleId)) this.focusedVehicleId = vehicleId;
  }

  debugApplyImpact(vehicleId: string, impact: Omit<RaceImpact, 'timeMs'>): void {
    const vehicle = this.vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) throw new Error(`Unknown race vehicle ${vehicleId}.`);
    this.applyImpact(vehicle, { ...impact, timeMs: this.simTimeMs });
  }

  debugSetVehicleKinematics(
    vehicleId: string,
    position: [number, number, number],
    velocity: [number, number, number],
    yawRad?: number,
  ): void {
    const vehicle = this.vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) throw new Error(`Unknown race vehicle ${vehicleId}.`);
    vehicle.runtime.chassis.position.set(...position);
    vehicle.runtime.chassis.linearVelocity.set(...velocity);
    if (yawRad !== undefined) {
      vehicle.runtime.chassis.orientation.copy(Quat.fromAxisAngle(new Vec3(0, 1, 0), yawRad));
    }
  }

  private fixedStep(): void {
    this.simTimeMs += FIXED_DT * 1000;
    if (this.phase === 'countdown') {
      this.countdownMs = Math.max(0, this.countdownMs - FIXED_DT * 1000);
      this.setAllInputs(true);
      if (this.countdownMs === 0) this.phase = 'running';
      return;
    }
    if (this.phase === 'finished') return;

    this.raceTimeMs += FIXED_DT * 1000;
    this.setAllInputs(false);
    this.stepVehicles();
    this.solveVehicleContacts();
    this.updateProgress();
    this.updateOrder();
    this.updateFinish();
  }

  private setAllInputs(startLocked: boolean): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.finished || vehicle.damage.retired) {
        vehicle.runtime.setInput(this.frame(0, 1, 0));
        continue;
      }
      vehicle.ghostMs = Math.max(0, vehicle.ghostMs - FIXED_DT * 1000);
      const requested = vehicle.ai ? this.aiInput(vehicle) : this.playerInput(vehicle);
      if (requested.reset) {
        this.resetVehicle(vehicle);
        continue;
      }
      vehicle.runtime.setInput(startLocked
        ? this.frame(0, 1, 0)
        : this.frame(requested.throttle, requested.brake, requested.steering));
    }
  }

  private stepVehicles(): void {
    const subDt = FIXED_DT / VEHICLE_SUBSTEPS;
    for (let substep = 0; substep < VEHICLE_SUBSTEPS; substep += 1) {
      const simSeconds = this.simTimeMs / 1000 + subDt * (substep + 1);
      for (const vehicle of this.vehicles) {
        if (vehicle.damage.retired) continue;
        vehicle.runtime.step(subDt, this.spec.world.gravity, this.surface, simSeconds);
        const chassis = vehicle.runtime.chassis;
        const velocityBefore = chassis.linearVelocity.clone();
        vehicle.runtime.solveBarriers(this.barriers.query(chassis.position.x, chassis.position.z));
        const velocityDelta = velocityBefore.clone().sub(chassis.linearVelocity);
        const deltaSpeedMps = Math.hypot(velocityDelta.x, velocityDelta.z);
        if (deltaSpeedMps > 3.5) {
          const local = chassis.localVector(velocityDelta);
          this.applyImpact(vehicle, {
            source: 'barrier',
            deltaSpeedMps,
            localX: local.x,
            localZ: local.z,
            timeMs: this.simTimeMs,
          });
        }
      }
      this.solveVehicleContacts();
    }
    for (const vehicle of this.vehicles) {
      vehicle.snapshot = vehicle.runtime.getSnapshot(this.accumulator / FIXED_DT);
    }
  }

  private aiInput(vehicle: FullVehicleState): RaceVehicleInput {
    const { runtime } = vehicle;
    const position = runtime.chassis.position;
    const current = projectToCourse(this.spec, position.x, position.z, vehicle.hint);
    vehicle.hint = current.index;
    vehicle.stationM = current.stationM;
    vehicle.lateralM = current.lateralM;
    const sample = this.spec.course.samples[current.index];
    const lookaheadM = clamp(10 + runtime.chassis.linearVelocity.length() * 0.55, 12, 48);
    const aheadStation = wrap(current.stationM + lookaheadM, this.spec.course.lengthM);
    const aheadSample = nearestSample(this.spec, aheadStation);
    const traffic = this.nearestTrafficAhead(vehicle, 32);
    const roadLimit = Math.max(0.5, sample.halfWidthM - 1.5);

    if (traffic) {
      const ideal = aheadSample.racingLineOffsetM;
      const left = clamp(ideal - 2.2, -roadLimit, roadLimit);
      const right = clamp(ideal + 2.2, -roadLimit, roadLimit);
      vehicle.targetLateralM = this.laneClearance(vehicle, left) >= this.laneClearance(vehicle, right)
        ? left
        : right;
      vehicle.passCommitUntilMs = this.raceTimeMs + 1_250;
    } else if (this.raceTimeMs >= vehicle.passCommitUntilMs) {
      vehicle.targetLateralM = clamp(aheadSample.racingLineOffsetM, -roadLimit, roadLimit);
    }

    const target = coursePose(this.spec, aheadStation, vehicle.targetLateralM).position;
    const desiredYaw = Math.atan2(target[0] - position.x, target[2] - position.z);
    const forward = runtime.chassis.worldVector(new Vec3(0, 0, 1));
    const yaw = Math.atan2(forward.x, forward.z);
    const headingError = wrapAngle(desiredYaw - yaw);
    const crossTrack = vehicle.targetLateralM - current.lateralM;
    const steering = clamp(
      headingError * 1.9 + Math.atan2(crossTrack * 2.8, runtime.chassis.linearVelocity.length() + 8),
      -1,
      1,
    );

    const brakingSensor = computeBrakingTarget(this.spec.course, current.stationM);
    let targetSpeed = brakingSensor.targetSpeedMps * vehicle.pace;
    vehicle.sensor = {
      ...brakingSensor,
      trafficGapM: traffic?.gapM ?? null,
    };
    if (traffic && traffic.gapM < 13 && Math.abs(traffic.vehicle.lateralM - current.lateralM) < 1.4) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, traffic.vehicle.snapshot.telemetry.speedMps - 2));
    }
    const speed = vehicle.snapshot.telemetry.speedMps;
    const speedError = targetSpeed - speed;
    return {
      vehicleId: vehicle.id,
      throttle: speedError > 1 ? 1 : speedError > -0.5 ? 0.2 : 0,
      brake: speedError < -0.5 ? clamp(-speedError / 12, 0, 1) : 0,
      steering,
      reset: false,
    };
  }

  private playerInput(vehicle: FullVehicleState): RaceVehicleInput {
    return this.inputs.get(vehicle.id) ?? {
      vehicleId: vehicle.id,
      throttle: 0,
      brake: 0,
      steering: 0,
      reset: false,
    };
  }

  private frame(throttle: number, brake: number, steering: number): InputFrame {
    this.inputSequence += 1;
    return {
      steering,
      throttle,
      brake,
      clutch: 0,
      handbrake: 0,
      shiftUp: false,
      shiftDown: false,
      reset: false,
      autoShift: true,
      timestamp: this.simTimeMs,
      sequence: this.inputSequence,
    };
  }

  private solveVehicleContacts(): void {
    for (let i = 0; i < this.vehicles.length; i += 1) {
      const a = this.vehicles[i];
      if (a.ghostMs > 0 || a.finished || a.damage.retired) continue;
      for (let j = i + 1; j < this.vehicles.length; j += 1) {
        const b = this.vehicles[j];
        if (b.ghostMs > 0 || b.finished || b.damage.retired) continue;
        const pa = a.runtime.chassis.position;
        const pb = b.runtime.chassis.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const distance = Math.hypot(dx, dz);
        const minimum = CONTACT_RADIUS_M * 2;
        if (distance >= minimum || Math.abs(pb.y - pa.y) > 1.4) continue;
        const nx = distance > 1e-5 ? dx / distance : (a.id < b.id ? 1 : -1);
        const nz = distance > 1e-5 ? dz / distance : 0;
        const penetration = minimum - distance;
        pa.x -= nx * penetration * 0.51;
        pa.z -= nz * penetration * 0.51;
        pb.x += nx * penetration * 0.51;
        pb.z += nz * penetration * 0.51;
        const va = a.runtime.chassis.linearVelocity;
        const vb = b.runtime.chassis.linearVelocity;
        const relativeNormal = (vb.x - va.x) * nx + (vb.z - va.z) * nz;
        if (relativeNormal < 0) {
          const closingSpeed = -relativeNormal;
          const impulse = -relativeNormal * 0.56;
          va.x -= nx * impulse;
          va.z -= nz * impulse;
          vb.x += nx * impulse;
          vb.z += nz * impulse;
          const localA = a.runtime.chassis.localVector(new Vec3(nx, 0, nz));
          const localB = b.runtime.chassis.localVector(new Vec3(-nx, 0, -nz));
          this.applyImpact(a, {
            source: 'vehicle',
            deltaSpeedMps: closingSpeed,
            localX: localA.x,
            localZ: localA.z,
            timeMs: this.simTimeMs,
          });
          this.applyImpact(b, {
            source: 'vehicle',
            deltaSpeedMps: closingSpeed,
            localX: localB.x,
            localZ: localB.z,
            timeMs: this.simTimeMs,
          });
        }
        a.contactCount += 1;
        b.contactCount += 1;
      }
    }
  }

  private updateProgress(): void {
    for (const vehicle of this.vehicles) {
      if (vehicle.damage.retired) continue;
      const p = vehicle.runtime.chassis.position;
      const projected = projectToCourse(this.spec, p.x, p.z, vehicle.hint);
      const previous = vehicle.stationM;
      vehicle.hint = projected.index;
      vehicle.stationM = projected.stationM;
      vehicle.lateralM = projected.lateralM;
      if (vehicle.stationM < previous - this.spec.course.lengthM * 0.5) {
        vehicle.completedLaps += 1;
        if (vehicle.completedLaps >= this.spec.lapCount) {
          vehicle.finished = true;
          vehicle.finishTimeMs = this.raceTimeMs;
        }
      }
    }
  }

  private updateOrder(): void {
    const ordered = [...this.vehicles].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return (a.finishTimeMs! + a.penaltyMs) - (b.finishTimeMs! + b.penaltyMs);
      if (a.damage.retired !== b.damage.retired) return a.damage.retired ? 1 : -1;
      if (a.completedLaps !== b.completedLaps) return b.completedLaps - a.completedLaps;
      return b.stationM - a.stationM || a.id.localeCompare(b.id);
    });
    ordered.forEach((vehicle, index) => { vehicle.position = index + 1; });
  }

  private updateFinish(): void {
    const playerFinished = this.spec.playerVehicleId
      ? (() => {
          const player = this.vehicles.find((vehicle) => vehicle.id === this.spec.playerVehicleId);
          return player?.finished === true || player?.damage.retired === true;
        })()
      : false;
    const watchFinished = this.spec.mode === 'watch'
      && this.vehicles.every((vehicle) => vehicle.finished || vehicle.damage.retired);
    if (!playerFinished && !watchFinished) return;
    this.phase = 'finished';
    this.classification = [...this.vehicles].sort((a, b) => a.position - b.position).map((vehicle) => {
      const elapsedMs = vehicle.finishTimeMs ?? this.raceTimeMs;
      return {
        position: vehicle.position,
        vehicleId: vehicle.id,
        driverName: vehicle.driverName,
        completedLaps: vehicle.completedLaps,
        elapsedMs: round(elapsedMs),
        penaltyMs: vehicle.penaltyMs,
        totalMs: round(elapsedMs + vehicle.penaltyMs),
        finished: vehicle.finished,
        retired: vehicle.damage.retired,
      };
    });
  }

  private resetVehicle(vehicle: FullVehicleState): void {
    const pose = coursePose(this.spec, vehicle.stationM, 0);
    vehicle.runtime = vehicle.ai
      ? new AiTireVehicle(this.spec.vehicle, { position: pose.position, yawRad: pose.yaw })
      : new Vehicle(this.spec.vehicle, { position: pose.position, yawRad: pose.yaw });
    vehicle.snapshot = vehicle.runtime.getSnapshot(0);
    vehicle.runtime.applyDamageEffects(damageEffects(vehicle.damage));
    vehicle.lateralM = 0;
    vehicle.penaltyMs += RESET_PENALTY_MS;
    vehicle.ghostMs = RESET_GHOST_MS;
    const input = this.inputs.get(vehicle.id);
    if (input) input.reset = false;
  }

  private nearestTrafficAhead(vehicle: FullVehicleState, maxGap: number): { vehicle: FullVehicleState; gapM: number } | null {
    let result: { vehicle: FullVehicleState; gapM: number } | null = null;
    for (const other of this.vehicles) {
      if (other === vehicle || other.finished) continue;
      const gapM = forwardGap(vehicle.stationM, other.stationM, this.spec.course.lengthM);
      if (gapM <= 1 || gapM >= maxGap) continue;
      if (!result || gapM < result.gapM) result = { vehicle: other, gapM };
    }
    return result;
  }

  private laneClearance(vehicle: FullVehicleState, lateralM: number): number {
    let clearance = 50;
    for (const other of this.vehicles) {
      if (other === vehicle || other.finished) continue;
      const along = cyclicDistance(vehicle.stationM, other.stationM, this.spec.course.lengthM);
      if (along > 35) continue;
      clearance = Math.min(clearance, Math.hypot(along * 0.45, (other.lateralM - lateralM) * 2.5));
    }
    return clearance;
  }

  private vehicleSnapshot(vehicle: FullVehicleState): RaceVehicleSnapshot {
    const snapshot = vehicle.snapshot;
    return {
      id: vehicle.id,
      driverName: vehicle.driverName,
      ai: vehicle.ai,
      position: vehicle.position,
      worldPosition: [...snapshot.chassis.position],
      yawRad: yawFromSnapshot(snapshot),
      speedMps: snapshot.telemetry.speedMps,
      stationM: vehicle.stationM,
      lateralM: vehicle.lateralM,
      lateralSpeedMps: 0,
      targetLateralM: vehicle.targetLateralM,
      completedLaps: vehicle.completedLaps,
      fidelity: 'full',
      physicsModel: vehicle.ai ? 'ai-tire' : 'full',
      penaltyMs: vehicle.penaltyMs,
      ghostMs: vehicle.ghostMs,
      contactCount: vehicle.contactCount,
      finished: vehicle.finished,
      retired: vehicle.damage.retired,
      finishTimeMs: vehicle.finishTimeMs,
      physicsSnapshot: snapshot,
      aiSensor: { ...vehicle.sensor },
      damage: cloneDamage(vehicle.damage),
    };
  }

  private applyImpact(vehicle: FullVehicleState, impact: RaceImpact): void {
    const next = applyRaceImpact(vehicle.damage, impact);
    if (next === vehicle.damage || next.totalDamage === vehicle.damage.totalDamage) return;
    vehicle.damage = next;
    vehicle.runtime.applyDamageEffects(damageEffects(next));
  }
}

export function computeBrakingTarget(
  course: RaceCourseSpec,
  stationM: number,
  decelerationMps2 = 9.5,
  horizonM = 650,
): { targetSpeedMps: number; distanceM: number; cornerName: string | null } {
  const currentIndex = courseSampleIndex(course, stationM);
  const current = course.samples[currentIndex];
  let result = {
    targetSpeedMps: current.brakeTargetSpeedMps,
    distanceM: 0,
    cornerName: current.cornerName,
  };
  for (let offset = 1; offset < course.samples.length; offset += 1) {
    const sample = course.samples[(currentIndex + offset) % course.samples.length];
    const distanceM = forwardGap(stationM, sample.stationM, course.lengthM);
    if (distanceM <= 0) continue;
    if (distanceM > horizonM) break;
    const usableDistance = Math.max(0, distanceM - 20);
    const allowed = Math.sqrt(
      sample.brakeTargetSpeedMps ** 2 + 2 * decelerationMps2 * usableDistance,
    );
    if (allowed < result.targetSpeedMps) {
      result = {
        targetSpeedMps: allowed,
        distanceM,
        cornerName: sample.cornerName,
      };
    }
  }
  return result;
}

function courseSampleIndex(course: RaceCourseSpec, stationM: number): number {
  let low = 0;
  let high = course.samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (course.samples[mid].stationM <= stationM) low = mid;
    else high = mid - 1;
  }
  return low;
}

type CourseProjection = { index: number; stationM: number; lateralM: number };

function projectToCourse(spec: RaceSessionSpec, x: number, z: number, hint: number): CourseProjection {
  const samples = spec.course.samples;
  let bestIndex = hint;
  let bestDistance = Infinity;
  const searchAll = !Number.isFinite(hint) || hint < 0 || hint >= samples.length;
  const radius = searchAll ? samples.length : Math.min(28, samples.length);
  for (let offset = -radius; offset <= radius; offset += 1) {
    const index = searchAll ? offset + radius : (hint + offset + samples.length) % samples.length;
    if (index < 0 || index >= samples.length) continue;
    const sample = samples[index];
    const dx = x - sample.position[0];
    const dz = z - sample.position[2];
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  const sample = samples[bestIndex];
  const dx = x - sample.position[0];
  const dz = z - sample.position[2];
  return {
    index: bestIndex,
    stationM: sample.stationM,
    lateralM: dx * -sample.tangent[1] + dz * sample.tangent[0],
  };
}

function coursePose(spec: RaceSessionSpec, stationM: number, lateralM: number) {
  const sample = nearestSample(spec, stationM);
  const tangentLength = Math.hypot(sample.tangent[0], sample.tangent[1]) || 1;
  const tx = sample.tangent[0] / tangentLength;
  const tz = sample.tangent[1] / tangentLength;
  return {
    position: [
      sample.position[0] - tz * lateralM,
      sample.position[1],
      sample.position[2] + tx * lateralM,
    ] as [number, number, number],
    yaw: Math.atan2(tx, tz),
  };
}

function nearestSample(spec: RaceSessionSpec, stationM: number) {
  return spec.course.samples[sampleIndex(spec, stationM)];
}

function sampleIndex(spec: RaceSessionSpec, stationM: number): number {
  const samples = spec.course.samples;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (samples[mid].stationM <= stationM) low = mid;
    else high = mid - 1;
  }
  return low;
}

function yawFromSnapshot(snapshot: PhysicsSnapshot): number {
  const [x, y, z, w] = snapshot.chassis.orientation;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

function wrapAngle(angle: number): number {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function forwardGap(from: number, to: number, length: number): number {
  return to >= from ? to - from : length - from + to;
}

function cyclicDistance(a: number, b: number, length: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, length - delta);
}

function wrap(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cloneDamage(damage: RaceDamageState): RaceDamageState {
  return {
    health: { ...damage.health },
    totalDamage: damage.totalDamage,
    punctures: [...damage.punctures],
    retired: damage.retired,
    lastImpact: damage.lastImpact ? { ...damage.lastImpact } : null,
  };
}

class RaceBarrierIndex {
  private readonly cells = new Map<string, BarrierSpec[]>();
  private readonly cellSize = 22;

  constructor(barriers: BarrierSpec[]) {
    for (const barrier of barriers) {
      const radius = Math.hypot(barrier.halfExtents[0], barrier.halfExtents[2]) + 5;
      const minX = Math.floor((barrier.center[0] - radius) / this.cellSize);
      const maxX = Math.floor((barrier.center[0] + radius) / this.cellSize);
      const minZ = Math.floor((barrier.center[2] - radius) / this.cellSize);
      const maxZ = Math.floor((barrier.center[2] + radius) / this.cellSize);
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

  query(x: number, z: number): BarrierSpec[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const result: BarrierSpec[] = [];
    const seen = new Set<string>();
    for (let oz = -1; oz <= 1; oz += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        for (const barrier of this.cells.get(`${cx + ox},${cz + oz}`) ?? []) {
          if (seen.has(barrier.id)) continue;
          seen.add(barrier.id);
          result.push(barrier);
        }
      }
    }
    return result;
  }
}
