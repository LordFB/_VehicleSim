import { describe, expect, it } from 'vitest';
import { RaceRuntime } from '../../src/race/RaceRuntime';
import { createTestRaceSpec } from './support/raceFixtures';

describe('race control', () => {
  it('locks the standing start, turns green, and orders by laps then progress', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('participate'));
    runtime.step(2_900, [{ vehicleId: 'car-6', throttle: 1, brake: 0, steering: 0, reset: false }]);
    expect(runtime.snapshot().phase).toBe('countdown');
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')?.speedMps).toBe(0);
    runtime.step(200);
    expect(runtime.snapshot().phase).toBe('running');
    runtime.step(1_000, [{ vehicleId: 'car-6', throttle: 1, brake: 0, steering: 0, reset: false }]);
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')?.speedMps).toBeGreaterThan(0);
  });

  it('applies reset penalty and ghosting', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('participate'));
    runtime.step(3_100);
    runtime.step(16, [{ vehicleId: 'car-6', throttle: 0, brake: 0, steering: 0, reset: true }]);
    const player = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')!;
    expect(player.penaltyMs).toBe(5_000);
    expect(player.ghostMs).toBeGreaterThan(1_900);
    runtime.step(2_100);
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-6')?.ghostMs).toBe(0);
  });

  it('finishes participant and watch sessions according to their rules', () => {
    const participant = new RaceRuntime(createTestRaceSpec('participate'));
    participant.step(3_100);
    participant.debugSetVehicleState('car-6', { completedLaps: 3, finished: true });
    participant.step(16);
    expect(participant.snapshot().phase).toBe('finished');
    expect(participant.snapshot().classification).toHaveLength(12);

    const watch = new RaceRuntime(createTestRaceSpec('watch'));
    watch.step(3_100);
    for (let i = 1; i <= 11; i += 1) {
      watch.debugSetVehicleState(`car-${i}`, { completedLaps: 3, finished: true });
    }
    watch.step(16);
    expect(watch.snapshot().phase).toBe('running');
    watch.debugSetVehicleState('car-12', { completedLaps: 3, finished: true });
    watch.step(16);
    expect(watch.snapshot().phase).toBe('finished');
  });
});
