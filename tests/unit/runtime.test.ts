import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

describe('physics runtime', () => {
  it('queries authored surface zones', () => {
    const runtime = new PhysicsRuntime(testWorldJson as WorldSpec);
    const contact = runtime.querySurface([-2.6, 0.4, 48]);
    expect(contact.materialId).toBe('ice');
    expect(contact.muLongitudinal).toBeLessThan(0.3);
  });

  it('replays the same input stream deterministically', () => {
    const first = runReplay();
    const second = runReplay();
    expect(first.chassis.position[0]).toBeCloseTo(second.chassis.position[0], 8);
    expect(first.chassis.position[2]).toBeCloseTo(second.chassis.position[2], 8);
    expect(first.telemetry.speedMps).toBeCloseTo(second.telemetry.speedMps, 8);
  });
});

function runReplay() {
  const runtime = new PhysicsRuntime(testWorldJson as WorldSpec);
  runtime.createVehicle(defaultVehicleJson as VehicleSpec);
  let timeMs = 0;
  for (let i = 0; i < 480; i += 1) {
    const input: InputFrame = {
      steering: i > 120 ? 0.25 : 0,
      throttle: 1,
      brake: 0,
      clutch: 0,
      handbrake: 0,
      shiftUp: false,
      shiftDown: false,
      reset: false,
      timestamp: timeMs,
      sequence: i,
    };
    runtime.submitInput(input);
    timeMs += 1000 / 120;
    runtime.step(timeMs);
  }
  const snapshot = runtime.getSnapshot();
  if (!snapshot) throw new Error('Missing snapshot');
  return snapshot;
}
