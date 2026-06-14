import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

describe('vehicle scenarios', () => {
  it('accelerates from rest under throttle', () => {
    const snapshot = runScenario(5, () => ({ steering: 0, throttle: 1, brake: 0, handbrake: 0 }));
    expect(snapshot.telemetry.speedMps).toBeGreaterThan(12);
    expect(snapshot.telemetry.rpm).toBeGreaterThan(1000);
  });

  it('reduces speed under straight-line braking', () => {
    const runtime = createRuntime();
    drive(runtime, 4, () => ({ steering: 0, throttle: 1, brake: 0, handbrake: 0 }));
    const before = runtime.getSnapshot()!.telemetry.speedMps;
    drive(runtime, 2, () => ({ steering: 0, throttle: 0, brake: 1, handbrake: 0 }));
    const after = runtime.getSnapshot()!.telemetry.speedMps;
    expect(before).toBeGreaterThan(8);
    expect(after).toBeLessThan(before);
  });

  it('creates yaw response under step steer', () => {
    const snapshot = runScenario(4, (step) => ({ steering: step > 160 ? 0.55 : 0, throttle: 0.55, brake: 0, handbrake: 0 }));
    expect(Math.abs(snapshot.telemetry.yawRate)).toBeGreaterThan(0.05);
  });
});

function runScenario(seconds: number, inputAt: (step: number) => Partial<InputFrame>) {
  const runtime = createRuntime();
  drive(runtime, seconds, inputAt);
  const snapshot = runtime.getSnapshot();
  if (!snapshot) throw new Error('Missing snapshot');
  return snapshot;
}

function createRuntime(): PhysicsRuntime {
  const runtime = new PhysicsRuntime(testWorldJson as WorldSpec);
  runtime.createVehicle(defaultVehicleJson as VehicleSpec);
  return runtime;
}

function drive(runtime: PhysicsRuntime, seconds: number, inputAt: (step: number) => Partial<InputFrame>): void {
  const frameHz = 120;
  const steps = Math.round(seconds * frameHz);
  for (let i = 0; i < steps; i += 1) {
    const partial = inputAt(i);
    const timestamp = i * 1000 / frameHz;
    runtime.submitInput({
      steering: partial.steering ?? 0,
      throttle: partial.throttle ?? 0,
      brake: partial.brake ?? 0,
      clutch: partial.clutch ?? 0,
      handbrake: partial.handbrake ?? 0,
      shiftUp: partial.shiftUp ?? false,
      shiftDown: partial.shiftDown ?? false,
      reset: partial.reset ?? false,
      timestamp,
      sequence: i,
    });
    runtime.step(timestamp);
  }
}
