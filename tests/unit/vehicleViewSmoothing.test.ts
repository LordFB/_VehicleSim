import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { VehicleView } from '../../src/render/VehicleView';
import defaultVehicleJson from '../../src/sim/data/defaultVehicle.json';
import type { PhysicsSnapshot, VehicleSpec } from '../../src/sim/types';

describe('vehicle view smoothing', () => {
  it('keeps chassis position exact while smoothing body orientation changes', () => {
    const view = new VehicleView(defaultVehicleJson as VehicleSpec);
    view.applySnapshot(snapshot([0, 1, 0], [0, 0, 0, 1]), 1 / 60);

    const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    view.applySnapshot(snapshot([0, 1, 25], target.toArray() as [number, number, number, number]), 1 / 60);

    const chassis = view.group.getObjectByName('vehicle-chassis');
    expect(chassis).toBeDefined();
    expect(chassis!.position.z).toBeCloseTo(25, 4);
    expect(chassis!.quaternion.angleTo(target)).toBeGreaterThan(0.1);
    expect(chassis!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(0.01);
    view.dispose();
  });
});

function snapshot(position: [number, number, number], orientation: [number, number, number, number]): PhysicsSnapshot {
  return {
    sequence: 1,
    simTime: 0,
    alpha: 0,
    chassis: { position, orientation },
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    wheels: {} as PhysicsSnapshot['wheels'],
    telemetry: {
      time: 0,
      speedMps: 0,
      yawRate: 0,
      sideslipRad: 0,
      steeringAngleRad: 0,
      rpm: 0,
      gear: 0,
      throttle: 0,
      brake: 0,
      simFrameMs: 0,
      wheels: {} as PhysicsSnapshot['telemetry']['wheels'],
    },
  };
}
