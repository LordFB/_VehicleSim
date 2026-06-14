import { describe, expect, it } from 'vitest';
import { calculateTireForces, createTireState, updateTireThermalState } from '../../src/sim/runtime/TireModel';
import type { SurfaceContact, TireSpec } from '../../src/sim/types';

const tire: TireSpec = {
  radius: 0.33,
  width: 0.24,
  mass: 11,
  longitudinalStiffness: 110000,
  corneringStiffness: 90000,
  camberStiffness: 6000,
  relaxationLengthLongitudinal: 0.3,
  relaxationLengthLateral: 0.5,
  loadSensitivity: 0.12,
  pneumaticTrail: 0.05,
  rollingResistanceScale: 0.012,
  optimalTempC: 92,
  coldMuScale: 0.82,
  overheatMuScale: 0.75,
  wearRate: 1,
};

const surface: SurfaceContact = {
  point: [0, 0, 0],
  normal: [0, 1, 0],
  depth: 0,
  materialId: 'asphalt_new',
  muLongitudinal: 1.1,
  muLateral: 1.05,
  roughness: 0.2,
  wetness: 0,
  temperatureC: 25,
  rubberLevel: 0.5,
  gravelDepth: 0,
};

describe('tire model', () => {
  it('generates longitudinal force from slip ratio', () => {
    const force = calculateTireForces({
      tire,
      normalLoad: 3800,
      slipRatio: 0.1,
      slipAngleRad: 0,
      camberRad: 0,
      speedMps: 18,
      surface,
      dt: 1 / 120,
      state: createTireState(),
    });
    expect(force.fx).toBeGreaterThan(0);
    expect(Math.abs(force.fx)).toBeLessThanOrEqual(surface.muLongitudinal * 3800);
  });

  it('combines lateral and longitudinal demand inside the friction envelope', () => {
    const force = calculateTireForces({
      tire,
      normalLoad: 4200,
      slipRatio: 1.5,
      slipAngleRad: 0.7,
      camberRad: 0,
      speedMps: 22,
      surface,
      dt: 1 / 60,
      state: createTireState(),
    });
    const combined = Math.hypot(force.fx / (surface.muLongitudinal * 4200), force.fy / (surface.muLateral * 4200));
    expect(combined).toBeLessThanOrEqual(1.01);
  });

  it('tracks tire heat, wear, and grip scale', () => {
    const state = createTireState();
    const coldForce = calculateTireForces({
      tire,
      normalLoad: 3800,
      slipRatio: 0.08,
      slipAngleRad: 0,
      camberRad: 0,
      speedMps: 18,
      surface,
      dt: 1 / 120,
      state,
    });
    updateTireThermalState(tire, state, surface, 35000, 22, 3800, 1);
    const warmForce = calculateTireForces({
      tire,
      normalLoad: 3800,
      slipRatio: 0.08,
      slipAngleRad: 0,
      camberRad: 0,
      speedMps: 18,
      surface,
      dt: 1 / 120,
      state,
    });
    expect(state.surfaceTempC).toBeGreaterThan(24);
    expect(state.wear).toBeGreaterThan(0);
    expect(warmForce.muScale).toBeGreaterThanOrEqual(coldForce.muScale);
  });
});
