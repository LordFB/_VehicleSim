import type { SurfaceContact, TireSpec } from '../types';
import { clamp } from '../math/Vec3';

export type TireState = {
  relaxedSlipRatio: number;
  relaxedSlipAngle: number;
  surfaceTempC: number;
  carcassTempC: number;
  wear: number;
};

export type TireForceInput = {
  tire: TireSpec;
  normalLoad: number;
  slipRatio: number;
  slipAngleRad: number;
  camberRad: number;
  speedMps: number;
  surface: SurfaceContact;
  dt: number;
  state: TireState;
};

export type TireForceOutput = {
  fx: number;
  fy: number;
  mz: number;
  slipRatio: number;
  slipAngleRad: number;
  muScale: number;
};

export function createTireState(): TireState {
  return { relaxedSlipRatio: 0, relaxedSlipAngle: 0, surfaceTempC: 24, carcassTempC: 24, wear: 0 };
}

export function calculateTireForces(input: TireForceInput): TireForceOutput {
  const { tire, normalLoad, surface, state } = input;
  if (normalLoad <= 1 || !Number.isFinite(normalLoad)) {
    state.relaxedSlipRatio = 0;
    state.relaxedSlipAngle = 0;
    return { fx: 0, fy: 0, mz: 0, slipRatio: 0, slipAngleRad: 0, muScale: thermalWearMuScale(tire, state) };
  }

  const relaxationSpeed = Math.max(Math.abs(input.speedMps), 2);
  const longRate = relaxationSpeed / Math.max(tire.relaxationLengthLongitudinal, 0.05);
  const latRate = relaxationSpeed / Math.max(tire.relaxationLengthLateral, 0.05);
  state.relaxedSlipRatio += (input.slipRatio - state.relaxedSlipRatio) * clamp(input.dt * longRate, 0, 1);
  state.relaxedSlipAngle += (input.slipAngleRad - state.relaxedSlipAngle) * clamp(input.dt * latRate, 0, 1);

  const loadScale = clamp(1 - tire.loadSensitivity * Math.max(0, normalLoad - 3500) / 3500, 0.72, 1.12);
  const muScale = thermalWearMuScale(tire, state);
  const muLong = surface.muLongitudinal * loadScale * muScale;
  const muLat = surface.muLateral * loadScale * muScale;

  let fx = tire.longitudinalStiffness * state.relaxedSlipRatio;
  let fy = -tire.corneringStiffness * state.relaxedSlipAngle + tire.camberStiffness * input.camberRad;
  const longCapacity = Math.max(1, muLong * normalLoad);
  const latCapacity = Math.max(1, muLat * normalLoad);
  const combined = Math.hypot(fx / longCapacity, fy / latCapacity);
  if (combined > 1) {
    fx /= combined;
    fy /= combined;
  }
  const mz = -fy * tire.pneumaticTrail;
  return {
    fx,
    fy,
    mz,
    slipRatio: state.relaxedSlipRatio,
    slipAngleRad: state.relaxedSlipAngle,
    muScale,
  };
}

export function updateTireThermalState(
  tire: TireSpec,
  state: TireState,
  surface: SurfaceContact,
  slipPowerW: number,
  speedMps: number,
  normalLoad: number,
  dt: number,
): void {
  const heatCapacitySurface = Math.max(250, tire.mass * 95);
  const heatCapacityCarcass = Math.max(600, tire.mass * 180);
  const scrubHeatC = slipPowerW * dt / heatCapacitySurface;
  const loadFlexHeatC = Math.abs(speedMps) * normalLoad * tire.rollingResistanceScale * dt / heatCapacityCarcass * 0.035;
  const wetCooling = 1 + surface.wetness * 8;
  const airCooling = (0.42 + Math.abs(speedMps) * 0.018) * wetCooling;
  const surfaceToCarcass = (state.surfaceTempC - state.carcassTempC) * 0.9 * dt;

  state.surfaceTempC += scrubHeatC - surfaceToCarcass - (state.surfaceTempC - surface.temperatureC) * airCooling * dt;
  state.carcassTempC += surfaceToCarcass + loadFlexHeatC - (state.carcassTempC - surface.temperatureC) * 0.055 * wetCooling * dt;

  const overheat = Math.max(0, state.surfaceTempC - tire.optimalTempC - 22);
  const wearDelta = (slipPowerW * dt * 1e-8 + overheat * overheat * dt * 2e-7) * tire.wearRate;
  state.wear = clamp(state.wear + wearDelta, 0, 1);
}

function thermalWearMuScale(tire: TireSpec, state: TireState): number {
  const temp = state.surfaceTempC;
  let tempScale = 1;
  if (temp < tire.optimalTempC) {
    const coldT = clamp((tire.optimalTempC - temp) / 55, 0, 1);
    tempScale = 1 - (1 - tire.coldMuScale) * coldT;
  } else {
    const hotT = clamp((temp - tire.optimalTempC) / 65, 0, 1);
    tempScale = 1 - (1 - tire.overheatMuScale) * hotT;
  }
  const wearScale = 1 - state.wear * 0.36;
  return clamp(tempScale * wearScale, 0.48, 1.08);
}
