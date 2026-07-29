import { describe, expect, it } from 'vitest';
import defaultVehicle from '../../src/sim/data/defaultVehicle.json';
import testWorld from '../../src/sim/data/testWorld.json';
import { FullRaceRuntime } from '../../src/race/FullRaceRuntime';
import { createTestRaceSpec } from './support/raceFixtures';
import type { VehicleSpec, WorldSpec } from '../../src/sim/types';

describe('FullRaceRuntime', () => {
  it('runs watch-mode AI through lightweight tire snapshots', () => {
    const runtime = new FullRaceRuntime({
      ...createTestRaceSpec('watch'),
      world: testWorld as WorldSpec,
      vehicle: defaultVehicle as VehicleSpec,
    });
    runtime.step(3_100);
    for (let frame = 0; frame < 180; frame += 1) runtime.step(1000 / 60);
    const snapshot = runtime.snapshot();
    expect(snapshot.vehicles).toHaveLength(12);
    for (const vehicle of snapshot.vehicles) {
      expect(vehicle.fidelity).toBe('full');
      expect(vehicle.physicsModel).toBe('ai-tire');
      expect(vehicle.physicsSnapshot?.wheels.frontLeft).toBeDefined();
      expect(vehicle.physicsSnapshot?.telemetry.wheels.frontLeft).toHaveProperty('slipRatio');
      expect(vehicle.physicsSnapshot?.telemetry.wheels.frontLeft).toHaveProperty('suspensionTravel');
      expect(Math.abs(vehicle.lateralM)).toBeLessThan(6);
    }
  }, 15_000);

  it('keeps the participant on Time Trial physics and AI on the lightweight tire model', () => {
    const runtime = new FullRaceRuntime({
      ...createTestRaceSpec('participate'),
      world: testWorld as WorldSpec,
      vehicle: defaultVehicle as VehicleSpec,
    });
    runtime.step(100);
    const vehicles = runtime.snapshot().vehicles;
    expect(vehicles.find((vehicle) => vehicle.id === 'car-6')?.physicsModel).toBe('full');
    expect(vehicles.filter((vehicle) => vehicle.id !== 'car-6').every(
      (vehicle) => vehicle.physicsModel === 'ai-tire',
    )).toBe(true);
  });

  it('is deterministic for the same twelve-car race', () => {
    const run = () => {
      const runtime = new FullRaceRuntime({
        ...createTestRaceSpec('watch'),
        world: testWorld as WorldSpec,
        vehicle: defaultVehicle as VehicleSpec,
      });
      runtime.step(3_100);
      for (let frame = 0; frame < 30; frame += 1) runtime.step(1000 / 60);
      return runtime.snapshot().vehicles.map((vehicle) => ({
        id: vehicle.id,
        stationM: vehicle.stationM,
        speedMps: vehicle.speedMps,
        chassis: vehicle.physicsSnapshot?.chassis,
      }));
    };
    expect(run()).toEqual(run());
  }, 15_000);

  it('advances a representative twelve-AI race faster than real time', () => {
    const runtime = new FullRaceRuntime({
      ...createTestRaceSpec('watch'),
      world: testWorld as WorldSpec,
      vehicle: defaultVehicle as VehicleSpec,
    });
    const startedAt = performance.now();
    for (let frame = 0; frame < 600; frame += 1) runtime.step(1000 / 60);
    const elapsedMs = performance.now() - startedAt;
    expect(runtime.snapshot().simTimeMs).toBeGreaterThanOrEqual(9_990);
    expect(elapsedMs).toBeLessThan(5_000);
  }, 10_000);
});
