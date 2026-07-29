import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { SurfaceSystem } from '../../src/sim/runtime/SurfaceSystem';
import { Vehicle } from '../../src/sim/runtime/Vehicle';
import type { InputFrame, VehicleSpec, WheelId, WorldSpec } from '../../src/sim/types';

const STEP_SECONDS = 1 / 720;
const TEST_SPEED_MPS = 55;

function neutralInput(): InputFrame {
  return {
    steering: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    handbrake: 0,
    shiftUp: false,
    shiftDown: false,
    reset: false,
    timestamp: 0,
    sequence: 0,
  };
}

function settledLoadAtSpeed(speedMps: number): number {
  const spec = structuredClone(defaultVehicleJson) as VehicleSpec;
  const world = structuredClone(testWorldJson) as WorldSpec;
  world.zones = [];
  world.barriers = [];

  const vehicle = new Vehicle(spec, world.spawn);
  const surface = new SurfaceSystem(world);
  const wheels = (vehicle as unknown as {
    wheels: Map<WheelId, { angularVelocity: number; spec: VehicleSpec['wheels'][number] }>;
  }).wheels;

  vehicle.setInput(neutralInput());
  for (let step = 0; step < 1440; step += 1) {
    vehicle.chassis.linearVelocity.x = 0;
    vehicle.chassis.linearVelocity.z = speedMps;
    for (const wheel of wheels.values()) {
      wheel.angularVelocity = speedMps / wheel.spec.tire.radius;
    }
    vehicle.step(STEP_SECONDS, world.gravity, surface, (step + 1) * STEP_SECONDS);
  }

  return Object.values(vehicle.getSnapshot(1).telemetry.wheels)
    .reduce((total, wheel) => total + wheel.loadN, 0);
}

describe('high-speed aerodynamic grip', () => {
  it('approximately doubles the tire normal load by 200 km/h', () => {
    const staticWeight = (defaultVehicleJson as VehicleSpec).chassis.mass * 9.81;
    const highSpeedLoad = settledLoadAtSpeed(TEST_SPEED_MPS);

    expect(highSpeedLoad).toBeGreaterThan(staticWeight * 1.95);
  });
});
