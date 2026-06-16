import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import { Quat } from '../../src/sim/math/Quat';
import { VEC3_UP } from '../../src/sim/math/Vec3';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function tiltDeg(orientation: [number, number, number, number]): number {
  const up = Quat.fromTuple(orientation).rotateVector(VEC3_UP);
  return (Math.acos(Math.min(1, Math.max(-1, up.dot(VEC3_UP)))) * 180) / Math.PI;
}

function input(seq: number, ms: number, over: Partial<InputFrame>): InputFrame {
  return {
    steering: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0,
    shiftUp: false, shiftDown: false, reset: false, timestamp: ms, sequence: seq, ...over,
  };
}

// Flat, open, wall-free world so we can isolate the vehicle's own stability.
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

describe('rollover/stability diagnostic at racing speed', () => {
  it('accelerates straight then takes a hard corner', () => {
    const runtime = new PhysicsRuntime(openWorld());
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    let ms = 0;
    let maxTilt = 0;
    let maxSpeed = 0;
    const dtMs = 1000 / 120;
    const turnInStep = 3000;
    for (let i = 0; i < 4200; i += 1) {
      const steering = i > turnInStep ? 1 : 0;
      runtime.submitInput(input(i, ms, { throttle: 1, steering }));
      ms += dtMs;
      const snap = runtime.step(ms);
      if (!snap) continue;
      const t = tiltDeg(snap.chassis.orientation);
      maxTilt = Math.max(maxTilt, t);
      maxSpeed = Math.max(maxSpeed, snap.telemetry.speedMps);
      if (i < 60 || i % 300 === 0 || i === turnInStep) {
        const w = snap.telemetry.wheels;
        // eslint-disable-next-line no-console
        console.log(
          `i=${i} v=${(snap.telemetry.speedMps * 3.6).toFixed(1)}km/h ` +
            `yaw=${snap.telemetry.yawRate.toFixed(2)} gear=${snap.telemetry.gear} rpm=${snap.telemetry.rpm.toFixed(0)} ` +
            `omRL=${w.rearLeft.angularVelocity.toFixed(1)} omRR=${w.rearRight.angularVelocity.toFixed(1)} ` +
            `srRL=${w.rearLeft.slipRatio.toFixed(2)} fxRL=${w.rearLeft.fx.toFixed(0)}`,
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log(`RESULT peakTilt=${maxTilt.toFixed(1)}deg peakSpeed=${(maxSpeed * 3.6).toFixed(0)}km/h`);
    expect(true).toBe(true);
  });
});
