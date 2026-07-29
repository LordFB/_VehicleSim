import { describe, expect, it } from 'vitest';
import defaultVehicle from '../../src/sim/data/defaultVehicle.json';
import testWorld from '../../src/sim/data/testWorld.json';
import { AiTireVehicle } from '../../src/race/AiTireVehicle';
import { SurfaceSystem } from '../../src/sim/runtime/SurfaceSystem';
import type { InputFrame, VehicleSpec, WorldSpec } from '../../src/sim/types';

const input = (steering: number): InputFrame => ({
  steering,
  throttle: 1,
  brake: 0,
  clutch: 0,
  handbrake: 0,
  shiftUp: false,
  shiftDown: false,
  reset: false,
  autoShift: true,
  timestamp: 0,
  sequence: 1,
});

describe('AiTireVehicle', () => {
  it('builds lateral tire force with speed instead of spinning from rest', () => {
    const spec = defaultVehicle as VehicleSpec;
    const world = testWorld as WorldSpec;
    const vehicle = new AiTireVehicle(spec, { position: [0, 0.72, 0], yawRad: 0 });
    const surface = new SurfaceSystem(world);
    vehicle.setInput(input(1));

    for (let step = 0; step < 60; step += 1) {
      vehicle.step(1 / 120, world.gravity, surface, (step + 1) / 120);
    }

    const snapshot = vehicle.getSnapshot(0);
    const [, qy, , qw] = snapshot.chassis.orientation;
    const yaw = 2 * Math.atan2(qy, qw);
    expect(snapshot.chassis.position[1]).toBeCloseTo(0.72, 3);
    expect(
      snapshot.wheels.frontLeft.pose.position[1] - spec.wheels[0].tire.radius,
    ).toBeCloseTo(0.02, 2);
    expect(snapshot.telemetry.speedMps).toBeGreaterThan(1);
    expect(Math.abs(yaw)).toBeLessThan(0.2);
    expect(Math.abs(snapshot.telemetry.yawRate)).toBeLessThan(1.2);
  });
});
