import type { DrivetrainSpec, EngineSpec, InputFrame, WheelId } from '../types';
import { clamp, interpolateCurve } from '../math/Vec3';

export type DrivetrainState = {
  gearIndex: number;
  rpm: number;
  throttleState: number;
};

export function createDrivetrainState(engine: EngineSpec): DrivetrainState {
  return {
    gearIndex: 0,
    rpm: engine.idleRpm,
    throttleState: 0,
  };
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
  // Manual paddle/bumper shifts (always honoured — a deliberate shift wins).
  if (input.shiftUp && state.gearIndex < drivetrain.gearRatios.length - 1) state.gearIndex += 1;
  if (input.shiftDown && state.gearIndex > 0) state.gearIndex -= 1;

  const gearRatio = drivetrain.gearRatios[state.gearIndex];
  const averageWheelOmega =
    drivenWheelAngularVelocity.length > 0
      ? drivenWheelAngularVelocity.reduce((sum, omega) => sum + Math.abs(omega), 0) / drivenWheelAngularVelocity.length
      : 0;
  const coupledRpm = averageWheelOmega * Math.abs(gearRatio * drivetrain.finalDrive) * 60 / (Math.PI * 2);
  // Clutch-slip launch model: with no clutch the engine is pinned to wheel speed and
  // bogs at idle off the line (a 400 hp car crawling). Under throttle at low coupled
  // rpm we let the engine rev up toward its power band (clutch slipping), so the car
  // launches with authority. The slip fades out as the wheels catch up to the engine.
  const launchRpm = engine.idleRpm + (engine.redlineRpm * 0.62 - engine.idleRpm) * clamp(input.throttle, 0, 1);
  const slipBlend = clamp(1 - coupledRpm / (engine.redlineRpm * 0.5), 0, 1) * clamp(input.throttle, 0, 1);
  const effectiveRpm = Math.max(coupledRpm, launchRpm * slipBlend + coupledRpm * (1 - slipBlend));
  state.rpm = clamp(Math.max(engine.idleRpm, effectiveRpm), engine.idleRpm, engine.redlineRpm);

  // Auto-shift only when the effective transmission mode is automatic. The input
  // may override the spec default (player toggles manual/auto), and a manual shift
  // input this frame suppresses auto so the two never fight.
  const autoShift = input.autoShift ?? drivetrain.autoShift;
  if (autoShift && !input.shiftUp && !input.shiftDown) {
    if (state.rpm > drivetrain.shiftUpRpm && state.gearIndex < drivetrain.gearRatios.length - 1) state.gearIndex += 1;
    if (state.rpm < drivetrain.shiftDownRpm && state.gearIndex > 0) state.gearIndex -= 1;
  }

  state.throttleState += (clamp(input.throttle, 0, 1) - state.throttleState) * clamp(dt * engine.throttleResponse, 0, 1);
  const engineTorque = interpolateCurve(engine.torqueCurve, state.rpm) * state.throttleState;
  // Engine braking scales with revs above idle, so a stationary car at idle gets ~0
  // drag torque (otherwise it would be driven backwards off the line / at rest).
  const revFactor = clamp((state.rpm - engine.idleRpm) / Math.max(1, engine.redlineRpm - engine.idleRpm), 0, 1);
  const brakingTorque = engine.engineBrakingTorque * (1 - state.throttleState) * revFactor;
  const totalTorque = (engineTorque - brakingTorque) * gearRatio * drivetrain.finalDrive * drivetrain.drivetrainEfficiency;
  const torquePerWheel = drivenWheelIds.length > 0 ? totalTorque / drivenWheelIds.length : 0;

  const driveTorqueByWheel: Partial<Record<WheelId, number>> = {};
  for (const wheelId of drivenWheelIds) driveTorqueByWheel[wheelId] = torquePerWheel;

  return {
    driveTorqueByWheel,
    rpm: state.rpm,
    gear: state.gearIndex + 1,
  };
}
