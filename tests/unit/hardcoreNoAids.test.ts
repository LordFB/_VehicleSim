import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import { DEFAULT_PHYSICS_SETUP } from '../../src/sim/types';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function input(seq: number, ms: number, over: Partial<InputFrame>): InputFrame {
  return {
    steering: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0,
    shiftUp: false, shiftDown: false, reset: false, timestamp: ms, sequence: seq, ...over,
  };
}

function openWorld(): WorldSpec {
  return {
    gravity: 9.81,
    defaultMaterialId: 'asphalt_new',
    materials: [
      { id: 'asphalt_new', muLongitudinal: 1.12, muLateral: 1.08, roughness: 0.28, wetness: 0, temperatureC: 28, rubberLevel: 0.55, rollingResistance: 0.012 },
    ],
    spawn: { position: [0, 0.72, 0], yawRad: 0 },
    zones: [],
    barriers: [],
  } as unknown as WorldSpec;
}

describe('hardcore (all aids off) stability', () => {
  it('full-throttle launch with no aids stays numerically bounded (wheels may spin, but not explode)', () => {
    const runtime = new PhysicsRuntime(openWorld());
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    runtime.applySetup({ ...DEFAULT_PHYSICS_SETUP, tractionControl: 0, abs: 0, stabilityControl: 0 });
    let ms = 0;
    let maxOmega = 0;
    const dtMs = 1000 / 120;
    for (let i = 0; i < 1200; i += 1) {
      runtime.submitInput(input(i, ms, { throttle: 1 }));
      ms += dtMs;
      const snap = runtime.step(ms);
      if (!snap) continue;
      for (const id of ['rearLeft', 'rearRight'] as const) {
        maxOmega = Math.max(maxOmega, Math.abs(snap.telemetry.wheels[id].angularVelocity));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`hardcore launch maxWheelOmega=${maxOmega.toFixed(0)} rad/s`);
    // Wheels spin without TC, but the integrator must keep them bounded (pre-fix this ran
    // to thousands of rad/s). A spinning slick tops out well under this.
    expect(maxOmega).toBeLessThan(400);
    expect(Number.isFinite(maxOmega)).toBe(true);
  });

  it('careful (part-throttle) launch with no aids still accelerates the car', () => {
    const runtime = new PhysicsRuntime(openWorld());
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    runtime.applySetup({ ...DEFAULT_PHYSICS_SETUP, tractionControl: 0, abs: 0, stabilityControl: 0 });
    let ms = 0;
    let maxSpeed = 0;
    const dtMs = 1000 / 120;
    for (let i = 0; i < 1800; i += 1) {
      runtime.submitInput(input(i, ms, { throttle: 0.45 }));
      ms += dtMs;
      const snap = runtime.step(ms);
      if (snap) maxSpeed = Math.max(maxSpeed, snap.telemetry.speedMps);
    }
    // eslint-disable-next-line no-console
    console.log(`hardcore careful launch maxSpeed=${(maxSpeed * 3.6).toFixed(0)} km/h`);
    expect(maxSpeed).toBeGreaterThan(15); // at least gets rolling properly
  });
});
