import { describe, expect, it } from 'vitest';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import testWorldJson from '../../src/sim/data/testWorld.json';
import { calculateTireForces, createTireState } from '../../src/sim/runtime/TireModel';
import type { SurfaceContact, VehicleSpec, WorldSpec } from '../../src/sim/types';

describe('Formula 3 cornering grip', () => {
  it('provides at least 1.25 g of cold mechanical lateral grip on dry asphalt', () => {
    const vehicle = defaultVehicleJson as VehicleSpec;
    const world = testWorldJson as WorldSpec;
    const asphalt = world.materials.find((material) => material.id === 'asphalt_new');
    expect(asphalt).toBeDefined();

    const contact: SurfaceContact = {
      ...asphalt!,
      materialId: asphalt!.id,
      point: [0, 0, 0],
      normal: [0, 1, 0],
      depth: 0,
      gravelDepth: 0,
    };

    for (const wheel of vehicle.wheels) {
      const state = createTireState();
      const force = calculateTireForces({
        tire: wheel.tire,
        normalLoad: 3500,
        slipRatio: 0,
        slipAngleRad: 0.12,
        camberRad: 0,
        speedMps: 30,
        surface: contact,
        dt: 1,
        state,
      });
      expect(Math.abs(force.fy) / 3500).toBeGreaterThanOrEqual(1.25);
    }
  });
});
