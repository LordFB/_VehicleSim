import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../../src/core/Constants';
import { getRaceCameraPose } from '../../src/render/RaceCamera';
import type { PhysicsSnapshot } from '../../src/sim/types';

describe('race camera', () => {
  it('uses a low chase frame with a long racing look-ahead', () => {
    const pose = getRaceCameraPose(snapshot());

    expect(pose.position.y).toBeCloseTo(1 + CAMERA.FOLLOW_HEIGHT, 4);
    expect(pose.position.z).toBeCloseTo(-CAMERA.FOLLOW_DISTANCE, 4);
    expect(pose.target.z).toBeCloseTo(CAMERA.LOOK_AHEAD_DISTANCE, 4);
  });

  it('keeps the horizon stable when the chassis rolls', () => {
    const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 5);
    const pose = getRaceCameraPose(snapshot({
      chassis: {
        position: [0, 1, 0],
        orientation: rolled.toArray() as [number, number, number, number],
      },
    }));

    expect(pose.position.x).toBeCloseTo(0, 4);
    expect(pose.position.y).toBeCloseTo(1 + CAMERA.FOLLOW_HEIGHT, 4);
    expect(pose.position.z).toBeCloseTo(-CAMERA.FOLLOW_DISTANCE, 4);
  });

  it('keeps speed FOV gain restrained for distance judgment', () => {
    const pose = getRaceCameraPose(snapshot({ linearVelocity: [0, 0, 90] }));

    expect(pose.fov).toBeGreaterThan(CAMERA.FOV);
    expect(pose.fov).toBeLessThanOrEqual(CAMERA.FOV + CAMERA.FOV_SPEED_GAIN);
    expect(CAMERA.FOV_SPEED_GAIN).toBeLessThanOrEqual(4);
  });
});

function snapshot(overrides: Partial<PhysicsSnapshot> = {}): PhysicsSnapshot {
  const base: PhysicsSnapshot = {
    sequence: 1,
    simTime: 0,
    alpha: 0,
    chassis: {
      position: [0, 1, 0],
      orientation: [0, 0, 0, 1],
    },
    linearVelocity: [0, 0, 0],
    angularVelocity: [0, 0, 0],
    wheels: {} as PhysicsSnapshot['wheels'],
    telemetry: {} as PhysicsSnapshot['telemetry'],
  };
  return { ...base, ...overrides };
}
