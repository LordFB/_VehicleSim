import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

function world(): WorldSpec {
  return {
    gravity: 9.81, defaultMaterialId: 'asphalt_new',
    materials: [{ id: 'asphalt_new', muLongitudinal: 1.12, muLateral: 1.08, roughness: 0.28, wetness: 0, temperatureC: 28, rubberLevel: 0.55, rollingResistance: 0.012 }],
    spawn: { position: [0, 0.72, 0], yawRad: 0 }, zones: [], barriers: [],
  } as unknown as WorldSpec;
}

describe('accel diagnosis', () => {
  it('logs speed/rpm/gear over a long straight pull', () => {
    const runtime = new PhysicsRuntime(world());
    runtime.createVehicle(defaultVehicleJson as VehicleSpec);
    let ms = 0;
    const rows: string[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const input: InputFrame = { steering: 0, throttle: 1, brake: 0, clutch: 0, handbrake: 0, shiftUp: false, shiftDown: false, reset: false, timestamp: ms, sequence: i };
      runtime.submitInput(input);
      ms += 1000 / 120;
      const snap = runtime.step(ms);
      if (snap && i % 400 === 0) {
        const t = snap.telemetry;
        rows.push(`t=${(i / 120).toFixed(1)}s speed=${(t.speedMps * 3.6).toFixed(0)}km/h rpm=${t.rpm.toFixed(0)} gear=${t.gear} throttle=${t.throttle.toFixed(2)}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n' + rows.join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
