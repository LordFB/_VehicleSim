import type {
  RaceClassificationEntry,
  RaceSessionSpec,
  RaceSnapshot,
  RaceVehicleInput,
  RaceVehicleSnapshot,
} from './types';

const FIXED_STEP_MS = 1000 / 120;
const FULL_ENTER_DISTANCE_M = 40;
const FULL_EXIT_DISTANCE_M = 60;
const FULL_EXIT_HOLD_MS = 1_000;
const CONTACT_LENGTH_M = 4.8;
const CONTACT_WIDTH_M = 1.9;
const RESET_PENALTY_MS = 5_000;
const RESET_GHOST_MS = 2_000;
const MAX_ACCEL_MPS2 = 10.5;
const MAX_BRAKE_MPS2 = 24;

type VehicleState = RaceVehicleSnapshot & {
  pace: number;
  farSinceMs: number;
  passCommitUntilMs: number;
};

type DebugVehicleState = Partial<Pick<
  VehicleState,
  'stationM' | 'lateralM' | 'speedMps' | 'completedLaps' | 'finished'
>>;

export class RaceRuntime {
  private readonly vehicles: VehicleState[];
  private readonly input = new Map<string, RaceVehicleInput>();
  private sequence = 0;
  private simTimeMs = 0;
  private raceTimeMs = 0;
  private countdownMs: number;
  private phase: RaceSnapshot['phase'] = 'countdown';
  private focusedVehicleId: string;
  private accumulatorMs = 0;
  private classification: RaceClassificationEntry[] = [];

  constructor(private readonly spec: RaceSessionSpec) {
    if (spec.vehicles.length !== 12) throw new Error('A Monza race requires exactly 12 vehicles.');
    if (spec.course.samples.length < 2 || spec.course.lengthM <= 0) {
      throw new Error('Race course requires ordered samples and a positive length.');
    }
    this.countdownMs = spec.countdownMs;
    this.focusedVehicleId = spec.playerVehicleId ?? spec.vehicles[5]?.id ?? spec.vehicles[0].id;
    this.vehicles = [...spec.vehicles]
      .sort((a, b) => a.gridPosition - b.gridPosition)
      .map((vehicle, index) => {
        const stationM = wrapStation(spec.course.lengthM - 1 - index * 8, spec.course.lengthM);
        const world = this.coursePose(stationM, index % 2 === 0 ? -1.5 : 1.5);
        return {
          id: vehicle.id,
          driverName: vehicle.driverName,
          ai: vehicle.ai,
          position: vehicle.gridPosition,
          worldPosition: world.position,
          yawRad: world.yaw,
          speedMps: 0,
          stationM,
          lateralM: index % 2 === 0 ? -1.5 : 1.5,
          lateralSpeedMps: 0,
          targetLateralM: nearestSample(spec, stationM).racingLineOffsetM,
          completedLaps: 0,
          fidelity: vehicle.ai ? 'full' : 'full',
          penaltyMs: 0,
          ghostMs: 0,
          contactCount: 0,
          finished: false,
          finishTimeMs: null,
          pace: vehicle.pace,
          farSinceMs: 0,
          passCommitUntilMs: 0,
        };
      });
    this.updateOrder();
  }

  step(deltaMs: number, inputs: readonly RaceVehicleInput[] = []): RaceSnapshot {
    for (const input of inputs) this.input.set(input.vehicleId, { ...input });
    this.accumulatorMs += Math.max(0, deltaMs);
    while (this.accumulatorMs + 1e-7 >= FIXED_STEP_MS) {
      this.fixedStep(FIXED_STEP_MS);
      this.accumulatorMs -= FIXED_STEP_MS;
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
      vehicles: this.vehicles.map(({
        pace: _pace,
        farSinceMs: _far,
        passCommitUntilMs: _pass,
        ...vehicle
      }) => ({
        ...vehicle,
        worldPosition: [...vehicle.worldPosition] as [number, number, number],
      })),
      classification: this.classification.map((entry) => ({ ...entry })),
    };
  }

  setSpectatorFocus(vehicleId: string): void {
    if (this.vehicles.some((vehicle) => vehicle.id === vehicleId)) {
      this.focusedVehicleId = vehicleId;
    }
  }

  debugSetVehicleState(vehicleId: string, state: DebugVehicleState): void {
    const vehicle = this.vehicles.find((candidate) => candidate.id === vehicleId);
    if (!vehicle) throw new Error(`Unknown race vehicle ${vehicleId}.`);
    Object.assign(vehicle, state);
    vehicle.stationM = wrapStation(vehicle.stationM, this.spec.course.lengthM);
    if (state.finished === true && vehicle.finishTimeMs === null) {
      vehicle.finishTimeMs = this.raceTimeMs;
    }
    this.syncWorldPose(vehicle);
    this.updateOrder();
  }

  private fixedStep(dtMs: number): void {
    this.simTimeMs += dtMs;
    if (this.phase === 'countdown') {
      this.updateFidelity(dtMs);
      this.solveContacts();
      this.updateOrder();
      this.countdownMs = Math.max(0, this.countdownMs - dtMs);
      if (this.countdownMs === 0) this.phase = 'running';
      return;
    }
    if (this.phase === 'finished') return;

    this.raceTimeMs += dtMs;
    const dt = dtMs / 1000;
    this.updateFidelity(dtMs);
    for (const vehicle of this.vehicles) {
      if (vehicle.finished) continue;
      vehicle.ghostMs = Math.max(0, vehicle.ghostMs - dtMs);
      const input = vehicle.ai ? this.aiInput(vehicle) : this.playerInput(vehicle);
      if (input.reset) {
        this.resetVehicle(vehicle);
        continue;
      }
      this.integrateVehicle(vehicle, input, dt);
    }
    this.solveContacts();
    this.updateOrder();
    this.updateFinish();
  }

  private playerInput(vehicle: VehicleState): RaceVehicleInput {
    return this.input.get(vehicle.id) ?? {
      vehicleId: vehicle.id,
      throttle: 0,
      brake: 0,
      steering: 0,
      reset: false,
    };
  }

  private aiInput(vehicle: VehicleState): RaceVehicleInput {
    const sample = nearestSample(this.spec, vehicle.stationM);
    const idealLine = sample.racingLineOffsetM;
    let target = this.lookAheadSpeed(vehicle) * vehicle.pace;
    const roadLimit = Math.max(0.5, sample.halfWidthM - 1.4);
    const traffic = this.vehicles
      .filter((other) => other !== vehicle && !other.finished)
      .map((other) => ({
        other,
        gap: forwardGap(vehicle.stationM, other.stationM, this.spec.course.lengthM),
      }))
      .filter(({ other, gap }) =>
        gap > 1 &&
        gap < 28 &&
        Math.abs(other.lateralM - vehicle.lateralM) < 3.2
      )
      .sort((a, b) => a.gap - b.gap)[0];

    if (traffic) {
      const leftTarget = clamp(idealLine - 2.4, -roadLimit, roadLimit);
      const rightTarget = clamp(idealLine + 2.4, -roadLimit, roadLimit);
      const leftClearance = this.laneClearance(vehicle, leftTarget);
      const rightClearance = this.laneClearance(vehicle, rightTarget);
      vehicle.targetLateralM = leftClearance === rightClearance
        ? (numericId(vehicle.id) % 2 === 0 ? leftTarget : rightTarget)
        : leftClearance > rightClearance ? leftTarget : rightTarget;
      vehicle.passCommitUntilMs = this.raceTimeMs + 1_400;
      if (traffic.gap < 11 && Math.abs(traffic.other.lateralM - vehicle.lateralM) < 1.35) {
        target = Math.min(target, Math.max(0, traffic.other.speedMps - 1.5));
      }
    } else if (this.raceTimeMs >= vehicle.passCommitUntilMs) {
      vehicle.targetLateralM = clamp(idealLine, -roadLimit, roadLimit);
    }

    const lateralError = vehicle.targetLateralM - vehicle.lateralM;
    const steering = clamp(lateralError * 0.34 - vehicle.lateralSpeedMps * 0.16, -1, 1);
    const error = target - vehicle.speedMps;
    return {
      vehicleId: vehicle.id,
      throttle: error > 0.4 ? 1 : error > -0.5 ? 0.25 : 0,
      brake: error < -0.5 ? Math.min(1, -error / 8) : 0,
      steering,
      reset: false,
    };
  }

  private integrateVehicle(vehicle: VehicleState, input: RaceVehicleInput, dt: number): void {
    const fidelityScale = vehicle.fidelity === 'full' ? 1 : 0.985;
    const accel = clamp(input.throttle, 0, 1) * MAX_ACCEL_MPS2
      - clamp(input.brake, 0, 1) * MAX_BRAKE_MPS2
      - 0.0022 * vehicle.speedMps * vehicle.speedMps;
    vehicle.speedMps = clamp(vehicle.speedMps + accel * dt * fidelityScale, 0, 92);
    const lateralAccel = clamp(input.steering, -1, 1) * Math.min(12, 3 + vehicle.speedMps * 0.12)
      - vehicle.lateralSpeedMps * 3.8;
    vehicle.lateralSpeedMps = clamp(vehicle.lateralSpeedMps + lateralAccel * dt, -7, 7);
    vehicle.lateralM += vehicle.lateralSpeedMps * dt;
    const halfWidth = nearestSample(this.spec, vehicle.stationM).halfWidthM;
    const roadLimit = Math.max(0.5, halfWidth - 1.2);
    if (vehicle.lateralM < -roadLimit || vehicle.lateralM > roadLimit) {
      vehicle.lateralM = clamp(vehicle.lateralM, -roadLimit, roadLimit);
      vehicle.lateralSpeedMps *= -0.15;
    }
    const previous = vehicle.stationM;
    vehicle.stationM = wrapStation(vehicle.stationM + vehicle.speedMps * dt, this.spec.course.lengthM);
    if (vehicle.stationM < previous - this.spec.course.lengthM * 0.5) {
      vehicle.completedLaps += 1;
      if (vehicle.completedLaps >= this.spec.lapCount) {
        vehicle.finished = true;
        vehicle.finishTimeMs = this.raceTimeMs;
        vehicle.speedMps = 0;
      }
    }
    this.syncWorldPose(vehicle);
  }

  private updateFidelity(dtMs: number): void {
    for (const vehicle of this.vehicles) {
      if (!vehicle.ai || vehicle.id === this.spec.playerVehicleId) {
        vehicle.fidelity = 'full';
        vehicle.farSinceMs = 0;
        continue;
      }
      let nearest = Infinity;
      let imminent = false;
      for (const other of this.vehicles) {
        if (other === vehicle) continue;
        const gap = cyclicDistance(vehicle.stationM, other.stationM, this.spec.course.lengthM);
        const distance = Math.hypot(gap, vehicle.lateralM - other.lateralM);
        nearest = Math.min(nearest, distance);
        const closing = Math.abs(vehicle.speedMps - other.speedMps);
        if (closing > 0.1 && distance / closing < 2) imminent = true;
      }
      if (nearest <= FULL_ENTER_DISTANCE_M || imminent) {
        vehicle.fidelity = 'full';
        vehicle.farSinceMs = 0;
      } else if (nearest > FULL_EXIT_DISTANCE_M) {
        vehicle.farSinceMs += dtMs;
        if (vehicle.farSinceMs >= FULL_EXIT_HOLD_MS) vehicle.fidelity = 'simplified';
      } else {
        vehicle.farSinceMs = 0;
      }
    }
  }

  private solveContacts(): void {
    for (let i = 0; i < this.vehicles.length; i += 1) {
      const a = this.vehicles[i];
      if (a.ghostMs > 0 || a.finished) continue;
      for (let j = i + 1; j < this.vehicles.length; j += 1) {
        const b = this.vehicles[j];
        if (b.ghostMs > 0 || b.finished) continue;
        let ds = signedCyclicDelta(a.stationM, b.stationM, this.spec.course.lengthM);
        const dl = b.lateralM - a.lateralM;
        if (Math.abs(ds) >= CONTACT_LENGTH_M || Math.abs(dl) >= CONTACT_WIDTH_M) continue;

        const stationOverlap = CONTACT_LENGTH_M - Math.abs(ds);
        if (stationOverlap <= 0) continue;
        const sign = ds === 0 ? (a.id < b.id ? 1 : -1) : Math.sign(ds);
        const correction = stationOverlap * 0.52;
        a.stationM = wrapStation(a.stationM - sign * correction, this.spec.course.lengthM);
        b.stationM = wrapStation(b.stationM + sign * correction, this.spec.course.lengthM);
        const averageSpeed = (a.speedMps + b.speedMps) * 0.5;
        const relative = (a.speedMps - b.speedMps) * 0.18;
        a.speedMps = Math.max(0, averageSpeed - relative);
        b.speedMps = Math.max(0, averageSpeed + relative);
        const lateralPush = (CONTACT_WIDTH_M - Math.abs(dl)) * 0.18;
        a.lateralM -= (dl >= 0 ? 1 : -1) * lateralPush;
        b.lateralM += (dl >= 0 ? 1 : -1) * lateralPush;
        a.lateralSpeedMps *= 0.4;
        b.lateralSpeedMps *= 0.4;
        a.contactCount += 1;
        b.contactCount += 1;
        a.fidelity = 'full';
        b.fidelity = 'full';
        a.farSinceMs = 0;
        b.farSinceMs = 0;
        this.syncWorldPose(a);
        this.syncWorldPose(b);
        ds = signedCyclicDelta(a.stationM, b.stationM, this.spec.course.lengthM);
      }
    }
  }

  private resetVehicle(vehicle: VehicleState): void {
    vehicle.speedMps = 0;
    vehicle.lateralM = 0;
    vehicle.lateralSpeedMps = 0;
    vehicle.targetLateralM = nearestSample(this.spec, vehicle.stationM).racingLineOffsetM;
    vehicle.penaltyMs += RESET_PENALTY_MS;
    vehicle.ghostMs = RESET_GHOST_MS;
    this.syncWorldPose(vehicle);
    const current = this.input.get(vehicle.id);
    if (current) current.reset = false;
  }

  private updateOrder(): void {
    const ordered = [...this.vehicles].sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) {
        return (a.finishTimeMs! + a.penaltyMs) - (b.finishTimeMs! + b.penaltyMs);
      }
      if (a.completedLaps !== b.completedLaps) return b.completedLaps - a.completedLaps;
      if (a.stationM !== b.stationM) return b.stationM - a.stationM;
      return a.id.localeCompare(b.id);
    });
    ordered.forEach((vehicle, index) => {
      vehicle.position = index + 1;
    });
  }

  private updateFinish(): void {
    const playerFinished = this.spec.playerVehicleId
      ? this.vehicles.find((vehicle) => vehicle.id === this.spec.playerVehicleId)?.finished === true
      : false;
    const watchFinished = this.spec.mode === 'watch' && this.vehicles.every((vehicle) => vehicle.finished);
    if (!playerFinished && !watchFinished) return;
    this.phase = 'finished';
    this.classification = [...this.vehicles]
      .sort((a, b) => a.position - b.position)
      .map((vehicle) => {
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
        };
      });
  }

  private syncWorldPose(vehicle: VehicleState): void {
    const pose = this.coursePose(vehicle.stationM, vehicle.lateralM);
    vehicle.worldPosition = pose.position;
    vehicle.yawRad = pose.yaw;
  }

  private lookAheadSpeed(vehicle: VehicleState): number {
    let target = nearestSample(this.spec, vehicle.stationM).targetSpeedMps;
    for (const distance of [24, 52, 90, 140, 210]) {
      const ahead = nearestSample(
        this.spec,
        wrapStation(vehicle.stationM + distance, this.spec.course.lengthM),
      );
      const brakeLimited = Math.sqrt(ahead.targetSpeedMps ** 2 + 2 * 14 * distance);
      target = Math.min(target, brakeLimited);
    }
    return target;
  }

  private laneClearance(vehicle: VehicleState, targetLateralM: number): number {
    let clearance = 50;
    for (const other of this.vehicles) {
      if (other === vehicle || other.finished) continue;
      const along = cyclicDistance(vehicle.stationM, other.stationM, this.spec.course.lengthM);
      if (along > 34) continue;
      clearance = Math.min(
        clearance,
        Math.hypot(along * 0.45, (other.lateralM - targetLateralM) * 2.4),
      );
    }
    return clearance;
  }

  private coursePose(stationM: number, lateralM: number): {
    position: [number, number, number];
    yaw: number;
  } {
    const samples = this.spec.course.samples;
    const index = sampleIndex(this.spec, stationM);
    const a = samples[index];
    const b = samples[(index + 1) % samples.length];
    const span = forwardGap(a.stationM, b.stationM, this.spec.course.lengthM) || 1;
    const along = forwardGap(a.stationM, stationM, this.spec.course.lengthM);
    const t = clamp(along / span, 0, 1);
    const tx = lerp(a.tangent[0], b.tangent[0], t);
    const tz = lerp(a.tangent[1], b.tangent[1], t);
    const length = Math.hypot(tx, tz) || 1;
    const nx = -tz / length;
    const nz = tx / length;
    return {
      position: [
        lerp(a.position[0], b.position[0], t) + nx * lateralM,
        lerp(a.position[1], b.position[1], t),
        lerp(a.position[2], b.position[2], t) + nz * lateralM,
      ],
      yaw: Math.atan2(tx, tz),
    };
  }
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

function forwardGap(from: number, to: number, length: number): number {
  return to >= from ? to - from : length - from + to;
}

function cyclicDistance(a: number, b: number, length: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, length - delta);
}

function signedCyclicDelta(from: number, to: number, length: number): number {
  let delta = to - from;
  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;
  return delta;
}

function wrapStation(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function numericId(id: string): number {
  const value = Number(id.match(/\d+$/)?.[0] ?? 0);
  return Number.isFinite(value) ? value : 0;
}
