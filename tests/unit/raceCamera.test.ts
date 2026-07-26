import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../../src/core/Constants';
import { CAMERA_MODES, getRaceCameraPose } from '../../src/render/RaceCamera';
import type { PhysicsSnapshot } from '../../src/sim/types';

describe('race camera', () => {
  it('uses a low chase frame with a long racing look-ahead', () => {
    const pose = getRaceCameraPose(snapshot(), 'chase');

    expect(pose.position.y).toBeCloseTo(1 + CAMERA.FOLLOW_HEIGHT, 4);
    expect(pose.position.z).toBeCloseTo(-CAMERA.FOLLOW_DISTANCE, 4);
    expect(pose.target.z).toBeCloseTo(CAMERA.LOOK_AHEAD_DISTANCE, 4);
    expect(pose.positionLerp).toBe(1);
    expect(pose.targetLerp).toBe(CAMERA.TARGET_LERP);
  });

  it('keeps the horizon stable when the chassis rolls', () => {
    const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 5);
    const pose = getRaceCameraPose(snapshot({
      chassis: {
        position: [0, 1, 0],
        orientation: rolled.toArray() as [number, number, number, number],
      },
    }), 'chase');

    expect(pose.position.x).toBeCloseTo(0, 4);
    expect(pose.position.y).toBeCloseTo(1 + CAMERA.FOLLOW_HEIGHT, 4);
    expect(pose.position.z).toBeCloseTo(-CAMERA.FOLLOW_DISTANCE, 4);
  });

  it('keeps speed FOV gain restrained for distance judgment', () => {
    const pose = getRaceCameraPose(snapshot({ linearVelocity: [0, 0, 90] }), 'chase');

    expect(pose.fov).toBeGreaterThan(CAMERA.FOV);
    expect(pose.fov).toBeLessThanOrEqual(CAMERA.FOV + CAMERA.FOV_SPEED_GAIN);
    expect(CAMERA.FOV_SPEED_GAIN).toBeLessThanOrEqual(4);
  });

  it('defines the shippable camera cycle order', () => {
    expect(CAMERA_MODES).toEqual(['chase', 'onboard', 'nose']);
  });

  it('places onboard view from chassis-local cockpit coordinates', () => {
    const yawed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const pose = getRaceCameraPose(snapshot({
      chassis: {
        position: [10, 2, 20],
        orientation: yawed.toArray() as [number, number, number, number],
      },
      linearVelocity: [70, 0, 0],
    }), 'onboard');

    expect(pose.fov).toBe(CAMERA.ONBOARD.FOV);
    expect(pose.position.x).toBeCloseTo(10 + CAMERA.ONBOARD.EYE_OFFSET[2], 4);
    expect(pose.position.y).toBeCloseTo(2 + CAMERA.ONBOARD.EYE_OFFSET[1] + CAMERA.ONBOARD.SPEED_HEAVE, 4);
    expect(pose.position.z).toBeCloseTo(20, 4);
    expect(pose.target.x).toBeGreaterThan(pose.position.x);
    expect(pose.target.y).toBeGreaterThan(pose.position.y - 0.2);
  });

  it('does not inherit chassis roll into onboard horizon placement', () => {
    const rolled = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    const pose = getRaceCameraPose(snapshot({
      chassis: {
        position: [0, 1, 0],
        orientation: rolled.toArray() as [number, number, number, number],
      },
    }), 'onboard');

    expect(pose.position.x).toBeCloseTo(0, 4);
    expect(pose.position.y).toBeCloseTo(1 + CAMERA.ONBOARD.EYE_OFFSET[1], 4);
  });

  it('places nose camera ahead and low with restrained FOV', () => {
    const pose = getRaceCameraPose(snapshot({ linearVelocity: [0, 0, 95] }), 'nose');

    expect(pose.position.y).toBeCloseTo(1 + CAMERA.NOSE.EYE_OFFSET[1], 4);
    expect(pose.position.z).toBeCloseTo(CAMERA.NOSE.EYE_OFFSET[2], 4);
    expect(pose.target.z).toBeGreaterThan(CAMERA.NOSE.EYE_OFFSET[2] + 10);
    expect(pose.fov).toBe(CAMERA.NOSE.FOV);
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
  return { ...base, ...overrides };
}
