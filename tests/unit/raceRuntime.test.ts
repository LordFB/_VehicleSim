import { describe, expect, it } from 'vitest';
import { RaceRuntime } from '../../src/race/RaceRuntime';
import { createTestRaceSpec } from './support/raceFixtures';

describe('RaceRuntime', () => {
  it('creates stable twelve-car snapshots and starts the player sixth', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('participate'));
    const snapshot = runtime.snapshot();
    expect(snapshot.vehicles).toHaveLength(12);
    expect(snapshot.vehicles.map((vehicle) => vehicle.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `car-${index + 1}`),
    );
    expect(snapshot.vehicles.find((vehicle) => vehicle.id === 'car-6')).toMatchObject({
      ai: false,
      position: 6,
      fidelity: 'full',
    });
  });

  it('replays identical inputs deterministically', () => {
    const run = () => {
      const runtime = new RaceRuntime(createTestRaceSpec('participate'));
      for (let frame = 0; frame < 900; frame += 1) {
        runtime.step(1000 / 60, [{
          vehicleId: 'car-6',
          throttle: 1,
          brake: 0,
          steering: Math.sin(frame / 80) * 0.08,
          reset: false,
        }]);
      }
      return runtime.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it('uses deterministic proximity fidelity with hysteresis and camera-independent state', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('watch'));
    runtime.debugSetVehicleState('car-1', { stationM: 100, speedMps: 30 });
    runtime.debugSetVehicleState('car-2', { stationM: 130, speedMps: 28 });
    runtime.step(1000 / 60);
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')?.fidelity).toBe('full');

    runtime.debugSetVehicleState('car-2', { stationM: 180, speedMps: 28 });
    runtime.step(500);
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')?.fidelity).toBe('full');
    runtime.step(600);
    expect(runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')?.fidelity).toBe('simplified');

    const before = runtime.snapshot();
    runtime.setSpectatorFocus('car-9');
    expect(runtime.snapshot().vehicles).toEqual(before.vehicles);
  });

  it('keeps collision bodies active and separates overlapping cars', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('watch'));
    runtime.debugSetVehicleState('car-1', { stationM: 100, lateralM: 0, speedMps: 20 });
    runtime.debugSetVehicleState('car-2', { stationM: 100.5, lateralM: 0, speedMps: 10 });
    runtime.step(1000 / 60);
    const [a, b] = ['car-1', 'car-2'].map(
      (id) => runtime.snapshot().vehicles.find((vehicle) => vehicle.id === id)!,
    );
    expect(Math.abs(a.stationM - b.stationM) + Math.abs(a.lateralM - b.lateralM)).toBeGreaterThan(1);
    expect(a.contactCount + b.contactCount).toBeGreaterThan(0);
  });

  it('recovers from the road edge and converges on the racing line', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('watch'));
    runtime.debugSetVehicleState('car-1', { stationM: 120, lateralM: 6.4, speedMps: 35 });
    runtime.step(3_100);
    for (let frame = 0; frame < 360; frame += 1) runtime.step(1000 / 60);
    const car = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')!;
    expect(Math.abs(car.lateralM)).toBeLessThan(2.2);
    expect(Math.abs(car.targetLateralM)).toBeLessThanOrEqual(3);
  });

  it('uses a bounded passing lane and returns to the ideal line after traffic clears', () => {
    const runtime = new RaceRuntime(createTestRaceSpec('watch'));
    runtime.step(3_100);
    runtime.debugSetVehicleState('car-1', { stationM: 200, lateralM: 0, speedMps: 42 });
    runtime.debugSetVehicleState('car-2', { stationM: 212, lateralM: 0, speedMps: 25 });
    let maxLateral = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      runtime.step(1000 / 60);
      const car = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')!;
      maxLateral = Math.max(maxLateral, Math.abs(car.lateralM));
    }
    expect(maxLateral).toBeGreaterThan(0.4);
    expect(maxLateral).toBeLessThan(4.5);

    runtime.debugSetVehicleState('car-2', { stationM: 700, lateralM: 0, speedMps: 30 });
    for (let frame = 0; frame < 300; frame += 1) runtime.step(1000 / 60);
    const recovered = runtime.snapshot().vehicles.find((vehicle) => vehicle.id === 'car-1')!;
    expect(Math.abs(recovered.lateralM - recovered.targetLateralM)).toBeLessThan(1);
    expect(Math.abs(recovered.targetLateralM)).toBeLessThan(1);
  });
});
