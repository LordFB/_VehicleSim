import type { DrivetrainSpec, EngineSpec, InputFrame, WheelId } from '../types';
import { clamp, interpolateCurve } from '../math/Vec3';

export type DrivetrainState = {
  gearIndex: number;
  rpm: number;
  throttleState: number;
};

// Gear positions are encoded so reverse and neutral sit below first gear:
//   REVERSE = -1, NEUTRAL = 0, and 1..gearRatios.length are the forward gears.
// gearRatios[0] is 1st, so forward gear g maps to gearRatios[g - 1].
const REVERSE = -1;
const NEUTRAL = 0;

export function createDrivetrainState(engine: EngineSpec): DrivetrainState {
  return {
    gearIndex: NEUTRAL,
    rpm: engine.idleRpm,
    throttleState: 0,
  };
}

/** Effective gear ratio for a gear position (reverse = negative, neutral = 0). */
function ratioFor(drivetrain: DrivetrainSpec, gearIndex: number): number {
  if (gearIndex === NEUTRAL) return 0;
  if (gearIndex === REVERSE) {
    // Reverse uses the reverse ratio if provided, else 1st-gear ratio, negated.
    const r = drivetrain.reverseRatio ?? drivetrain.gearRatios[0];
    return -Math.abs(r);
  }
  return drivetrain.gearRatios[gearIndex - 1];
}

export type DrivetrainOutput = {
  driveTorqueByWheel: Partial<Record<WheelId, number>>;
  rpm: number;
  gear: number;
};

export function solveDrivetrain(
  engine: EngineSpec,
  drivetrain: DrivetrainSpec,
  input: InputFrame,
  drivenWheelAngularVelocity: number[],
  drivenWheelIds: WheelId[],
  dt: number,
  state: DrivetrainState,
): DrivetrainOutput {
  // Manual paddle/bumper shifts (always honoured — a deliberate shift wins). Gears run
  // REVERSE(-1) → NEUTRAL(0) → 1 … gearRatios.length. Shifting into reverse is only
  // allowed from neutral when nearly stopped, so a downshift at speed can't slam it into
  // reverse.
  const topGear = drivetrain.gearRatios.length;
  const averageWheelOmega =
    drivenWheelAngularVelocity.length > 0
      ? drivenWheelAngularVelocity.reduce((sum, omega) => sum + Math.abs(omega), 0) / drivenWheelAngularVelocity.length
      : 0;
  const nearlyStopped = averageWheelOmega < 1.5; // rad/s at the wheel (~0.5 m/s)
  if (input.shiftUp && state.gearIndex < topGear) state.gearIndex += 1;
  if (input.shiftDown) {
    if (state.gearIndex > NEUTRAL) state.gearIndex -= 1;
    else if (state.gearIndex === NEUTRAL && nearlyStopped) state.gearIndex = REVERSE;
  }

  const gearRatio = ratioFor(drivetrain, state.gearIndex);
  const coupledRpm = averageWheelOmega * Math.abs(gearRatio * drivetrain.finalDrive) * 60 / (Math.PI * 2);
  const engaged = state.gearIndex !== NEUTRAL;
  // Clutch-slip launch model: with no clutch the engine is pinned to wheel speed and
  // bogs at idle off the line (a 400 hp car crawling). Under throttle at low coupled
  // rpm we let the engine rev up toward its power band (clutch slipping), so the car
  // launches with authority. The slip fades out as the wheels catch up to the engine.
  // In neutral the engine is disconnected and simply tracks throttle (free-revving).
  if (!engaged) {
    const target = engine.idleRpm + (engine.redlineRpm * 0.92 - engine.idleRpm) * clamp(input.throttle, 0, 1);
    state.rpm += (target - state.rpm) * clamp(dt * engine.throttleResponse, 0, 1);
    state.rpm = clamp(state.rpm, engine.idleRpm, engine.redlineRpm);
  } else {
    const launchRpm = engine.idleRpm + (engine.redlineRpm * 0.62 - engine.idleRpm) * clamp(input.throttle, 0, 1);
    const slipBlend = clamp(1 - coupledRpm / (engine.redlineRpm * 0.5), 0, 1) * clamp(input.throttle, 0, 1);
    const effectiveRpm = Math.max(coupledRpm, launchRpm * slipBlend + coupledRpm * (1 - slipBlend));
    state.rpm = clamp(Math.max(engine.idleRpm, effectiveRpm), engine.idleRpm, engine.redlineRpm);
  }

  // Auto-shift only when the effective transmission mode is automatic. The input
  // may override the spec default (player toggles manual/auto), and a manual shift
  // input this frame suppresses auto so the two never fight. Auto engages 1st from
  // neutral under throttle, then shifts between forward gears only (never into reverse).
  const autoShift = input.autoShift ?? drivetrain.autoShift;
  if (autoShift && !input.shiftUp && !input.shiftDown) {
    if (state.gearIndex === NEUTRAL && input.throttle > 0.05) state.gearIndex = 1;
    else if (state.gearIndex >= 1) {
      if (state.rpm > drivetrain.shiftUpRpm && state.gearIndex < topGear) state.gearIndex += 1;
      if (state.rpm < drivetrain.shiftDownRpm && state.gearIndex > 1) state.gearIndex -= 1;
    }
  }

  // Recompute the ratio in case auto-shift changed the gear this frame. In neutral the
  // ratio is 0, so no drive torque reaches the wheels (engine free-revs). The ratio sign
  // (negative in reverse) drives the wheels backwards, so the same forward torque math
  // launches the car in reverse.
  const effectiveRatio = ratioFor(drivetrain, state.gearIndex);
  state.throttleState += (clamp(input.throttle, 0, 1) - state.throttleState) * clamp(dt * engine.throttleResponse, 0, 1);
  const engineTorque = interpolateCurve(engine.torqueCurve, state.rpm) * state.throttleState;
  // Engine braking scales with revs above idle, so a stationary car at idle gets ~0
  // drag torque (otherwise it would be driven backwards off the line / at rest).
  const revFactor = clamp((state.rpm - engine.idleRpm) / Math.max(1, engine.redlineRpm - engine.idleRpm), 0, 1);
  const brakingTorque = engine.engineBrakingTorque * (1 - state.throttleState) * revFactor;
  const totalTorque = (engineTorque - brakingTorque) * effectiveRatio * drivetrain.finalDrive * drivetrain.drivetrainEfficiency;
  const torquePerWheel = drivenWheelIds.length > 0 ? totalTorque / drivenWheelIds.length : 0;

  const driveTorqueByWheel: Partial<Record<WheelId, number>> = {};
  for (const wheelId of drivenWheelIds) driveTorqueByWheel[wheelId] = torquePerWheel;

  return {
    driveTorqueByWheel,
    rpm: state.rpm,
    // Display gear: -1 → reverse, 0 → neutral, n → forward gear n. The HUD already maps
    // <0 to "R" and 0 to "N".
    gear: state.gearIndex,
  };
}
