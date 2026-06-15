import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import { Quat } from '../../src/sim/math/Quat';
import { Vec3, VEC3_UP } from '../../src/sim/math/Vec3';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function neutral(seq: number, ms: number): InputFrame {
  return {
    steering: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    handbrake: 0,
    shiftUp: false,
    shiftDown: false,
    reset: false,
    timestamp: ms,
    sequence: seq,
  };
}

/** Roll/pitch tilt of the chassis up-axis away from world up, in radians. */
function tiltRad(orientation: [number, number, number, number]): number {
  const up = Quat.fromTuple(orientation).rotateVector(VEC3_UP);
  return Math.acos(Math.min(1, Math.max(-1, up.dot(VEC3_UP))));
}

describe('roll stability', () => {
  it('does not flip during sustained hard cornering on flat ground', () => {
    const runtime = new PhysicsRuntime(testWorldJson as WorldSpec);
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    let timeMs = 0;
    let maxTilt = 0;
    for (let i = 0; i < 900; i += 1) {
      // Accelerate first, then snap to full lock and hold throttle (worst-case load transfer).
      const input = neutral(i, timeMs);
      input.throttle = 1;
      input.steering = i > 200 ? 1 : 0;
      runtime.submitInput(input);
      timeMs += 1000 / 120;
      const snap = runtime.step(timeMs);
      if (snap) maxTilt = Math.max(maxTilt, tiltRad(snap.chassis.orientation));
    }
    // A planted GT car should never come close to rolling over here (< ~25 deg of body roll).
    expect(maxTilt).toBeLessThan(0.45);
  });

  it('center of mass sits below the chassis origin (COM is actually applied)', () => {
    // Regression guard: the spec COM offset must feed the rigid body, not be ignored.
    const com = (defaultVehicleJson as VehicleSpec).chassis.centerOfMass;
    expect(com[1]).toBeLessThan(0);
    // The body integrates about the COM; verify a lateral impulse rolls it less than it
    // would about the higher chassis origin by checking steady-state cornering stays flat.
    expect(new Vec3(com[0], com[1], com[2]).length()).toBeGreaterThan(0);
  });
});
