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
  /** Effective ∂fx/∂(slip ratio) after load/combined limiting — used to integrate the
   *  wheel spin semi-implicitly (the longitudinal slope seen by the wheel ODE). */
  dFxdSlip: number;
};

export function createTireState(): TireState {
  return { relaxedSlipRatio: 0, relaxedSlipAngle: 0, surfaceTempC: 24, carcassTempC: 24, wear: 0 };
}

export function calculateTireForces(input: TireForceInput): TireForceOutput {
  const { tire, normalLoad, surface, state } = input;
  if (normalLoad <= 1 || !Number.isFinite(normalLoad)) {
    state.relaxedSlipRatio = 0;
    state.relaxedSlipAngle = 0;
    return { fx: 0, fy: 0, mz: 0, slipRatio: 0, slipAngleRad: 0, muScale: thermalWearMuScale(tire, state), dFxdSlip: tire.longitudinalStiffness };
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
  const longCapacity = Math.max(1, muLong * normalLoad);
  const latCapacity = Math.max(1, muLat * normalLoad);

  // Saturating brush model. The raw linear forces (stiffness × slip) are only physical
  // near zero slip; past the friction peak the contact patch slides and the force must
  // plateau at μ·Fz rather than grow without bound. We form a single normalised combined
  // slip σ, pass it through a saturation curve f(σ) that rises ~linearly then rolls off to
  // 1.0, and distribute the resulting capacity back onto each axis by its share of σ. This
  // keeps the linear regime (small-slip tests) intact while making high-slip behaviour
  // bounded and giving a marginal-slope that collapses past the peak — the wheel-spin ODE
  // relies on that collapse to be able to break the tyres loose under big throttle.
  const sigmaX = (tire.longitudinalStiffness * state.relaxedSlipRatio) / longCapacity;
  const camberForce = tire.camberStiffness * input.camberRad;
  const sigmaY = (-tire.corneringStiffness * state.relaxedSlipAngle + camberForce) / latCapacity;
  const sigma = Math.hypot(sigmaX, sigmaY);

  // f(σ): unit-slope at the origin, saturating to 1. (σ - σ²/3 + σ³/27) is the classic
  // brush parabola up to the full-slide point σ=3; beyond that it holds at the peak.
  const fSat = sigma >= 3 ? 1 : sigma * (1 - sigma / 3 + (sigma * sigma) / 27);
  // Marginal slope df/dσ of that curve (→1 at σ=0, →0 at σ=3), used for ODE damping.
  const dfdSigma = sigma >= 3 ? 0 : 1 - (2 * sigma) / 3 + (sigma * sigma) / 9;
  const scale = sigma > 1e-6 ? fSat / sigma : 1;

  let fx = sigmaX * scale * longCapacity;
  let fy = sigmaY * scale * latCapacity;
  // Numerical guard: never exceed the friction ellipse (rounding on the curve edges).
  const combined = Math.hypot(fx / longCapacity, fy / latCapacity);
  if (combined > 1) {
    fx /= combined;
    fy /= combined;
  }

  // ∂fx/∂(slip ratio): chain rule through σ. Near zero slip this is the full longitudinal
  // stiffness; once the tyre saturates dfdSigma → 0 so the marginal slope collapses.
  const dFxdSlip = tire.longitudinalStiffness * (sigma > 1e-6 ? dfdSigma : 1);
  const mz = -fy * tire.pneumaticTrail;
  return {
    fx,
    fy,
    mz,
    slipRatio: state.relaxedSlipRatio,
    slipAngleRad: state.relaxedSlipAngle,
    muScale,
    dFxdSlip: Math.max(0, dFxdSlip),
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
