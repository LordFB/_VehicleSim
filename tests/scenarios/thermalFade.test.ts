import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { PhysicsRuntime } from '../../src/sim/runtime/PhysicsRuntime';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

describe('thermal vehicle systems', () => {
  it('heats rear tires during a stationary burnout', () => {
    const runtime = createRuntime();
    drive(runtime, 5, () => ({ throttle: 1, brake: 0, handbrake: 1, steering: 0 }));
    const telemetry = runtime.getSnapshot()!.telemetry;
    expect(telemetry.wheels.rearLeft.tireSurfaceTempC).toBeGreaterThan(telemetry.wheels.frontLeft.tireSurfaceTempC);
    expect(telemetry.wheels.rearRight.tireWear).toBeGreaterThan(0);
  });

  it('heats brakes during repeated braking events', () => {
    const runtime = createRuntime();
    drive(runtime, 4, () => ({ throttle: 1, brake: 0, handbrake: 0, steering: 0 }));
    drive(runtime, 3, (step) => ({ throttle: step % 100 < 45 ? 0 : 1, brake: step % 100 < 45 ? 1 : 0, handbrake: 0, steering: 0 }));
    const telemetry = runtime.getSnapshot()!.telemetry;
    expect(telemetry.wheels.frontLeft.brakeTempC).toBeGreaterThan(30);
    expect(telemetry.wheels.frontLeft.brakeFade).toBeLessThanOrEqual(1);
  });
});

function createRuntime(): PhysicsRuntime {
  const runtime = new PhysicsRuntime(testWorldJson as WorldSpec);
  runtime.createVehicle(defaultVehicleJson as VehicleSpec);
  return runtime;
}

function drive(runtime: PhysicsRuntime, seconds: number, inputAt: (step: number) => Partial<InputFrame>): void {
  const frameHz = 120;
  const steps = Math.round(seconds * frameHz);
  for (let i = 0; i < steps; i += 1) {
    const timestamp = i * 1000 / frameHz;
    const partial = inputAt(i);
    runtime.submitInput({
      steering: partial.steering ?? 0,
      throttle: partial.throttle ?? 0,
      brake: partial.brake ?? 0,
      clutch: partial.clutch ?? 0,
      handbrake: partial.handbrake ?? 0,
      shiftUp: false,
      shiftDown: false,
      reset: false,
      timestamp,
      sequence: i,
    });
    runtime.step(timestamp);
  }
}
