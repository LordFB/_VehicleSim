import { describe, expect, it } from 'vitest';
import defaultVehicle from '../../src/sim/data/defaultVehicle.json';
import testWorld from '../../src/sim/data/testWorld.json';
import { FullRaceRuntime } from '../../src/race/FullRaceRuntime';
import type { VehicleSpec, WorldSpec } from '../../src/sim/types';
import { createTestRaceSpec } from './support/raceFixtures';

const createRuntime = () => new FullRaceRuntime({
  ...createTestRaceSpec('participate'),
  world: testWorld as WorldSpec,
  vehicle: defaultVehicle as VehicleSpec,
});

describe('FullRaceRuntime damage integration', () => {
  it('turns a barrier velocity impulse into persistent localized damage', () => {
    const runtime = createRuntime();
    runtime.step(3_100);
    runtime.debugSetVehicleKinematics('car-6', [0, 0.4, 69.8], [0, 0, 24], 0);
    runtime.step(1000 / 60);
    const damaged = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')!;

    expect(damaged.damage!.totalDamage).toBeGreaterThan(0);
    expect(damaged.damage!.health.frontWing).toBeLessThan(1);

    runtime.step(1000 / 60, [{
      vehicleId: 'car-6',
      throttle: 0,
      brake: 0,
      steering: 0,
      reset: true,
    }]);
    const reset = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')!;
    expect(reset.damage).toEqual(damaged.damage);
  });

  it('retires and classifies a critically damaged participant', () => {
    const runtime = createRuntime();
    runtime.step(3_100);
    for (let hit = 0; hit < 5; hit += 1) {
      runtime.debugApplyImpact('car-6', {
        source: 'barrier',
        deltaSpeedMps: 42,
        localX: 0,
        localZ: -1,
      });
    }
    runtime.step(1000 / 60);
    const snapshot = runtime.snapshot();
    const player = snapshot.vehicles.find((vehicle) => vehicle.id === 'car-6')!;
    expect(player.retired).toBe(true);
    expect(snapshot.phase).toBe('finished');
    expect(snapshot.classification.find((entry) => entry.vehicleId === 'car-6')).toMatchObject({
      finished: false,
      retired: true,
    });
  });
});
