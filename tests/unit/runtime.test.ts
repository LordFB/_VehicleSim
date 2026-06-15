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

  it('uses mesh surface collisions before generated terrain or flat zones', () => {
    const world: WorldSpec = {
      ...(testWorldJson as WorldSpec),
      defaultMaterialId: 'grass',
      terrainTrack: {
        halfWidth: 4,
        shoulderWidth: 2,
        samples: [
          {
            pos: [0, 0],
            tangent: [1, 0],
            left: [0, 1],
            normal: [0, 1, 0],
            curvature: 0,
            s: 0,
            elevation: 0,
            camber: 0,
          },
          {
            pos: [10, 0],
            tangent: [1, 0],
            left: [0, 1],
            normal: [0, 1, 0],
            curvature: 0,
            s: 10,
            elevation: 0,
            camber: 0,
          },
        ],
      },
      meshSurface: {
        cellSize: 4,
        layers: [
          {
            id: 'raised-asphalt',
            materialId: 'asphalt_new',
            positions: [-2, 2.5, -2, 2, 2.5, -2, -2, 2.5, 2, 2, 2.5, 2],
            indices: [0, 1, 2, 2, 1, 3],
            normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
          },
        ],
      },
    };
    const runtime = new PhysicsRuntime(world);
    const contact = runtime.querySurface([0, 5, 0]);

    expect(contact.materialId).toBe('asphalt_new');
    expect(contact.point[1]).toBeCloseTo(2.5, 5);
    expect(contact.normal).toEqual([0, 1, 0]);
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
