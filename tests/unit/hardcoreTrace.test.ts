import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import { DEFAULT_PHYSICS_SETUP } from '../../src/sim/types';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function input(seq: number, ms: number, over: Partial<InputFrame>): InputFrame {
  return { steering: 0, throttle: 0, brake: 0, clutch: 0, handbrake: 0, shiftUp: false, shiftDown: false, reset: false, timestamp: ms, sequence: seq, ...over };
}
function openWorld(): WorldSpec {
  return { gravity: 9.81, defaultMaterialId: 'asphalt_new', materials: [ { id: 'asphalt_new', muLongitudinal: 1.12, muLateral: 1.08, roughness: 0.28, wetness: 0, temperatureC: 28, rubberLevel: 0.55, rollingResistance: 0.012 } ], spawn: { position: [0, 0.72, 0], yawRad: 0 }, zones: [], barriers: [] } as unknown as WorldSpec;
}

describe('hardcore careful trace', () => {
  it('trace', () => {
    const runtime = new PhysicsRuntime(openWorld());
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    runtime.applySetup({ ...DEFAULT_PHYSICS_SETUP, tractionControl: 0, abs: 0, stabilityControl: 0 });
    let ms = 0; const dtMs = 1000 / 120;
    for (let i = 0; i < 240; i += 1) {
      runtime.submitInput(input(i, ms, { throttle: 0.45 }));
      ms += dtMs;
      const snap = runtime.step(ms);
      if (snap && (i < 30 || i % 30 === 0)) {
        const w = snap.telemetry.wheels;
        // eslint-disable-next-line no-console
        console.log(`i=${i} v=${(snap.telemetry.speedMps*3.6).toFixed(2)} gear=${snap.telemetry.gear} rpm=${snap.telemetry.rpm.toFixed(0)} omRL=${w.rearLeft.angularVelocity.toFixed(1)} srRL=${w.rearLeft.slipRatio.toFixed(2)} fxRL=${w.rearLeft.fx.toFixed(0)} muRL=${w.rearLeft.tireMuScale.toFixed(2)}`);
      }
    }
    expect(true).toBe(true);
  });
});
